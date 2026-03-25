const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');
const DocumentService = require('../services/documentService');
const { ensureDigitalPapersCompatibility } = require('../services/digitalPapersCompatibilityService');
const {
  getGuardianNameExpression,
  getUserNameExpressions,
  tableExists,
} = require('../utils/queryCompatibility');

const documentService = new DocumentService();

// Middleware to authenticate all document routes
router.use(authenticateToken);
router.use(async (_req, _res, next) => {
  try {
    await ensureDigitalPapersCompatibility();
    next();
  } catch (error) {
    next(error);
  }
});

const schemaCache = {
  columns: new Map(),
};

const CLINIC_SCOPED_LEGACY_ROLES = new Set([
  'clinic_manager',
  'healthcare_worker',
  'health_worker',
  'doctor',
  'physician',
  'nurse',
  'midwife',
  'staff',
]);

const FULL_DOCUMENT_ADMIN_LEGACY_ROLES = new Set([
  'system_admin',
  'super_admin',
  'superadmin',
  'administrator',
  'admin',
]);

const resolveFirstExistingColumn = async (
  tableName,
  candidateColumns,
  fallback = candidateColumns[0],
) => {
  const cacheKey = `${tableName}:${candidateColumns.join(',')}`;
  if (schemaCache.columns.has(cacheKey)) {
    return schemaCache.columns.get(cacheKey);
  }

  try {
    const result = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = ANY($2::text[])
      `,
      [tableName, candidateColumns],
    );

    const availableColumns = new Set(result.rows.map((row) => row.column_name));
    const resolvedColumn =
      candidateColumns.find((columnName) => availableColumns.has(columnName)) ||
      fallback;

    schemaCache.columns.set(cacheKey, resolvedColumn);
    return resolvedColumn;
  } catch (_error) {
    schemaCache.columns.set(cacheKey, fallback);
    return fallback;
  }
};

const getPatientFacilityColumn = () =>
  resolveFirstExistingColumn('patients', ['clinic_id', 'facility_id'], 'clinic_id');

const getLegacyInfantFacilityColumn = () =>
  resolveFirstExistingColumn('infants', ['clinic_id', 'facility_id'], 'clinic_id');

const getLegacyInfantSupport = async (alias = 'li', foreignKeyExpression = 'dg.infant_id') => {
  const hasLegacyInfantsTable = await tableExists('infants');
  if (!hasLegacyInfantsTable) {
    return {
      joinClause: '',
      firstNameExpression: '\'\'',
      lastNameExpression: '\'\'',
      guardianIdExpression: 'NULL',
      clinicExpression: 'NULL',
    };
  }

  const legacyInfantFacilityColumn = await getLegacyInfantFacilityColumn();

  return {
    joinClause: `LEFT JOIN infants ${alias} ON ${foreignKeyExpression} = ${alias}.id`,
    firstNameExpression: `${alias}.first_name`,
    lastNameExpression: `${alias}.last_name`,
    guardianIdExpression: `${alias}.guardian_id`,
    clinicExpression: `${alias}.${legacyInfantFacilityColumn}`,
  };
};

const parsePositiveInt = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
};

const sanitizePagination = (query = {}, defaults = {}) => {
  const defaultLimit = defaults.defaultLimit || 50;
  const maxLimit = defaults.maxLimit || 100;
  const limit = Math.min(
    parsePositiveInt(query.limit) || defaultLimit,
    maxLimit,
  );
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);

  return { limit, offset };
};

const isGuardianRequest = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

const isClinicScopedRequest = (req) => {
  const canonicalRole = getCanonicalRole(req);
  if (canonicalRole === CANONICAL_ROLES.CLINIC_MANAGER) {
    return true;
  }

  const legacyRole = String(req.user?.legacy_role || '').trim().toLowerCase();
  return CLINIC_SCOPED_LEGACY_ROLES.has(legacyRole);
};

const getGuardianScopeId = (req) =>
  parsePositiveInt(req.user?.guardian_id) || parsePositiveInt(req.user?.id);

const normalizeDownloadStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized || normalized === 'generated' || normalized === 'downloaded' || normalized === 'completed') {
    return 'COMPLETED';
  }

  if (normalized === 'pending' || normalized === 'processing') {
    return 'PENDING';
  }

  if (normalized === 'failed' || normalized === 'error') {
    return 'FAILED';
  }

  return normalized.toUpperCase();
};

const normalizeDocumentRecord = (record) => {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    ...record,
    template_name: record.template_name || record.title || 'Document',
    template_type: record.template_type || record.document_type || null,
    infant_first_name: record.infant_first_name || record.first_name || '',
    infant_last_name: record.infant_last_name || record.last_name || '',
    first_name: record.first_name || record.infant_first_name || '',
    last_name: record.last_name || record.infant_last_name || '',
    user_first_name: record.user_first_name || record.generated_by_first || '',
    user_last_name: record.user_last_name || record.generated_by_last || '',
    generated_by_first: record.generated_by_first || record.user_first_name || '',
    generated_by_last: record.generated_by_last || record.user_last_name || '',
    download_type: record.download_type || record.document_type || record.template_type || 'PDF',
    download_date: record.download_date || record.last_downloaded || record.created_at || null,
    download_status: normalizeDownloadStatus(record.download_status || record.status),
  };
};

const requireDocumentGenerationAccess = (req, res, next) => {
  if (isGuardianRequest(req)) {
    return next();
  }

  return requirePermission('document:create')(req, res, next);
};

const buildDocumentSelectQuery = async () => {
  const patientFacilityColumn = await getPatientFacilityColumn();
  const userNameExpressions = await getUserNameExpressions('u_sender', {
    fallbackFirstName: 'System User',
  });
  const guardianNameExpression = await getGuardianNameExpression('g', {
    fallbackName: 'Guardian',
  });
  const legacyInfantSupport = await getLegacyInfantSupport();

  return `
    SELECT
      dg.*,
      dp.title,
      dp.document_type,
      t.name AS template_name,
      t.template_type,
      COALESCE(p.first_name, ${legacyInfantSupport.firstNameExpression}, '') AS infant_first_name,
      COALESCE(p.last_name, ${legacyInfantSupport.lastNameExpression}, '') AS infant_last_name,
      COALESCE(p.first_name, ${legacyInfantSupport.firstNameExpression}, '') AS first_name,
      COALESCE(p.last_name, ${legacyInfantSupport.lastNameExpression}, '') AS last_name,
      COALESCE(p.guardian_id, ${legacyInfantSupport.guardianIdExpression}, dg.guardian_id) AS owner_guardian_id,
      COALESCE(p.${patientFacilityColumn}, ${legacyInfantSupport.clinicExpression}, g.clinic_id) AS infant_clinic_id,
      ${guardianNameExpression} AS guardian_name,
      g.email AS guardian_email,
      ${userNameExpressions.firstName} AS user_first_name,
      ${userNameExpressions.lastName} AS user_last_name,
      ${userNameExpressions.firstName} AS generated_by_first,
      ${userNameExpressions.lastName} AS generated_by_last,
      COALESCE(dg.last_downloaded, dg.created_at) AS download_date,
      COALESCE(dp.document_type, t.template_type, 'PDF') AS download_type
    FROM document_generation dg
    LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
    LEFT JOIN paper_templates t ON dg.template_id = t.id
    LEFT JOIN patients p ON dg.infant_id = p.id
    ${legacyInfantSupport.joinClause}
    LEFT JOIN guardians g ON COALESCE(dg.guardian_id, p.guardian_id, ${legacyInfantSupport.guardianIdExpression}) = g.id
    LEFT JOIN users u_sender ON dg.generated_by = u_sender.id
    WHERE 1=1
  `;
};

const getPatientRecord = async (infantId) => {
  const normalizedInfantId = parsePositiveInt(infantId);
  if (!normalizedInfantId) {
    return null;
  }

  const patientFacilityColumn = await getPatientFacilityColumn();
  const patientResult = await pool.query(
    `
      SELECT
        p.id,
        p.first_name,
        p.last_name,
        p.guardian_id,
        COALESCE(p.${patientFacilityColumn}, g.clinic_id) AS clinic_id
      FROM patients p
      LEFT JOIN guardians g ON g.id = p.guardian_id
      WHERE p.id = $1
        AND p.is_active = true
      LIMIT 1
    `,
    [normalizedInfantId],
  );

  if (patientResult.rows[0]) {
    return patientResult.rows[0];
  }

  if (!(await tableExists('infants'))) {
    return null;
  }

  const legacyInfantFacilityColumn = await getLegacyInfantFacilityColumn();

  const legacyInfantResult = await pool.query(
    `
      SELECT
        i.id,
        i.first_name,
        i.last_name,
        i.guardian_id,
        COALESCE(i.${legacyInfantFacilityColumn}, g.clinic_id) AS clinic_id
      FROM infants i
      LEFT JOIN guardians g ON g.id = i.guardian_id
      WHERE i.id = $1
        AND i.is_active = true
      LIMIT 1
    `,
    [normalizedInfantId],
  );

  return legacyInfantResult.rows[0] || null;
};

const ensurePatientAccess = async (req, patientRecord) => {
  if (!patientRecord) {
    return false;
  }

  if (isGuardianRequest(req)) {
    return parsePositiveInt(patientRecord.guardian_id) === getGuardianScopeId(req);
  }

  if (isClinicScopedRequest(req) && parsePositiveInt(req.user?.clinic_id)) {
    return parsePositiveInt(patientRecord.clinic_id) === parsePositiveInt(req.user.clinic_id);
  }

  return true;
};

const canManageDocumentRecord = (req, documentRecord) => {
  if (!documentRecord) {
    return false;
  }

  if (parsePositiveInt(documentRecord.generated_by) === parsePositiveInt(req.user?.id)) {
    return true;
  }

  if (isGuardianRequest(req)) {
    return false;
  }

  const legacyRole = String(req.user?.legacy_role || '').trim().toLowerCase();
  return FULL_DOCUMENT_ADMIN_LEGACY_ROLES.has(legacyRole) || !isClinicScopedRequest(req);
};

const hasDocumentAccess = async (req, documentRecord) => {
  if (!documentRecord) {
    return false;
  }

  if (!isGuardianRequest(req)) {
    if (isClinicScopedRequest(req) && parsePositiveInt(req.user?.clinic_id) && documentRecord.infant_id) {
      const patientRecord = await getPatientRecord(documentRecord.infant_id);
      return ensurePatientAccess(req, patientRecord);
    }
    return true;
  }

  const guardianId = getGuardianScopeId(req);
  const userId = parsePositiveInt(req.user?.id);

  if (
    parsePositiveInt(documentRecord.guardian_id) === guardianId ||
    parsePositiveInt(documentRecord.owner_guardian_id) === guardianId ||
    parsePositiveInt(documentRecord.generated_by) === userId
  ) {
    return true;
  }

  if (!documentRecord.infant_id) {
    return false;
  }

  const patientRecord = await getPatientRecord(documentRecord.infant_id);
  return ensurePatientAccess(req, patientRecord);
};

const buildScopedListQuery = async (req, filters = {}) => {
  const { infantId, templateType, status } = filters;
  const patientFacilityColumn = await getPatientFacilityColumn();
  const legacyInfantSupport = await getLegacyInfantSupport();
  let query = await buildDocumentSelectQuery();
  const params = [];

  if (isGuardianRequest(req)) {
    const guardianId = getGuardianScopeId(req);
    if (!guardianId) {
      const error = new Error('Guardian account mapping is missing');
      error.statusCode = 403;
      throw error;
    }

    query += ` AND (COALESCE(dg.guardian_id, p.guardian_id, ${legacyInfantSupport.guardianIdExpression}) = $${params.length + 1} OR dg.generated_by = $${params.length + 2})`;
    params.push(guardianId, parsePositiveInt(req.user?.id) || guardianId);
  } else if (isClinicScopedRequest(req) && parsePositiveInt(req.user?.clinic_id)) {
    query += ` AND COALESCE(p.${patientFacilityColumn}, ${legacyInfantSupport.clinicExpression}, g.clinic_id) = $${params.length + 1}`;
    params.push(parsePositiveInt(req.user.clinic_id));
  }

  if (parsePositiveInt(infantId)) {
    query += ` AND dg.infant_id = $${params.length + 1}`;
    params.push(parsePositiveInt(infantId));
  }

  if (templateType) {
    query += ` AND t.template_type = $${params.length + 1}`;
    params.push(templateType);
  }

  if (status) {
    query += ` AND LOWER(COALESCE(dg.status, '')) = LOWER($${params.length + 1})`;
    params.push(status);
  }

  return { query, params };
};

const fetchPaginatedDocuments = async (req, filters = {}) => {
  const { limit, offset } = sanitizePagination(filters);
  const { query, params } = await buildScopedListQuery(req, filters);
  const countResult = await pool.query(
    `SELECT COUNT(*) AS count FROM (${query}) AS scoped_documents`,
    params,
  );
  const total = parseInt(countResult.rows[0]?.count || 0, 10);

  const result = await pool.query(
    `${query} ORDER BY dg.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return {
    data: result.rows.map(normalizeDocumentRecord),
    pagination: {
      limit,
      offset,
      total,
    },
  };
};

const fetchDetailedDocument = async (id) => {
  const patientFacilityColumn = await getPatientFacilityColumn();
  const userNameExpressions = await getUserNameExpressions('u_sender', {
    fallbackFirstName: 'System User',
  });
  const guardianNameExpression = await getGuardianNameExpression('g', {
    fallbackName: 'Guardian',
  });
  const legacyInfantSupport = await getLegacyInfantSupport();
  const result = await pool.query(
    `
      SELECT
        dg.*,
        dp.title,
        dp.document_type,
        dp.content,
        t.name AS template_name,
        t.template_type,
        COALESCE(p.first_name, ${legacyInfantSupport.firstNameExpression}, '') AS infant_first_name,
        COALESCE(p.last_name, ${legacyInfantSupport.lastNameExpression}, '') AS infant_last_name,
        COALESCE(p.first_name, ${legacyInfantSupport.firstNameExpression}, '') AS first_name,
        COALESCE(p.last_name, ${legacyInfantSupport.lastNameExpression}, '') AS last_name,
        COALESCE(p.guardian_id, ${legacyInfantSupport.guardianIdExpression}, dg.guardian_id) AS owner_guardian_id,
        COALESCE(p.${patientFacilityColumn}, ${legacyInfantSupport.clinicExpression}, g.clinic_id) AS infant_clinic_id,
        ${guardianNameExpression} AS guardian_name,
        g.email AS guardian_email,
        ${userNameExpressions.firstName} AS user_first_name,
        ${userNameExpressions.lastName} AS user_last_name,
        ${userNameExpressions.firstName} AS generated_by_first,
        ${userNameExpressions.lastName} AS generated_by_last,
        COALESCE(dg.last_downloaded, dg.created_at) AS download_date,
        COALESCE(dp.document_type, t.template_type, 'PDF') AS download_type
      FROM document_generation dg
      LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
      LEFT JOIN paper_templates t ON dg.template_id = t.id
      LEFT JOIN patients p ON dg.infant_id = p.id
      ${legacyInfantSupport.joinClause}
      LEFT JOIN guardians g ON COALESCE(dg.guardian_id, p.guardian_id, ${legacyInfantSupport.guardianIdExpression}) = g.id
      LEFT JOIN users u_sender ON dg.generated_by = u_sender.id
      WHERE dg.id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] ? normalizeDocumentRecord(result.rows[0]) : null;
};

// GET /api/documents - Get all documents (MUST be before /:id)
router.get('/', requirePermission('document:view'), async (req, res) => {
  try {
    const documents = await fetchPaginatedDocuments(req, req.query);

    res.json({
      success: true,
      data: documents.data,
      pagination: documents.pagination,
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Failed to fetch documents',
      error: error.message,
    });
  }
});

// GET /api/documents/history - Get document download history
router.get('/history', requirePermission('document:view'), async (req, res) => {
  try {
    const documents = await fetchPaginatedDocuments(req, req.query);

    res.json({
      success: true,
      data: documents.data,
      pagination: documents.pagination,
    });
  } catch (error) {
    console.error('Error fetching document history:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Failed to fetch document history',
      error: error.message,
    });
  }
});

// GET /api/documents/status/:infantId - Get document completion status
router.get('/status/:infantId', requirePermission('document:view'), async (req, res) => {
  try {
    const infantId = parsePositiveInt(req.params.infantId);
    if (!infantId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid infant ID',
      });
    }

    const patientRecord = await getPatientRecord(infantId);
    if (!patientRecord) {
      return res.status(404).json({
        success: false,
        message: 'Infant not found',
      });
    }

    const hasAccess = await ensurePatientAccess(req, patientRecord);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const vaccinationsResult = await pool.query(
      `
        SELECT DISTINCT vaccine_id, dose_no
        FROM immunization_records
        WHERE patient_id = $1
          AND is_active = true
      `,
      [infantId],
    );

    const generatedResult = await pool.query(
      `
        SELECT t.template_type, COUNT(*) AS count
        FROM document_generation dg
        LEFT JOIN paper_templates t ON dg.template_id = t.id
        WHERE dg.infant_id = $1
          AND LOWER(COALESCE(dg.status, 'generated')) IN ('generated', 'downloaded', 'completed')
        GROUP BY t.template_type
      `,
      [infantId],
    );

    const generatedMap = generatedResult.rows.reduce((accumulator, row) => {
      accumulator[row.template_type] = parseInt(row.count, 10);
      return accumulator;
    }, {});

    const requiredDocuments = [
      { type: 'VACCINE_SCHEDULE', name: 'Vaccine Schedule', required: true },
      { type: 'IMMUNIZATION_RECORD', name: 'Immunization Record', required: true },
      { type: 'GROWTH_CHART', name: 'Growth Chart', required: true },
    ];

    const completionStatus = requiredDocuments.map((document) => ({
      ...document,
      generated: generatedMap[document.type] || 0,
      status: (generatedMap[document.type] || 0) > 0 ? 'completed' : 'pending',
    }));

    res.json({
      success: true,
      infantId,
      completionStatus,
      totalVaccinations: vaccinationsResult.rows.length,
      generatedDocuments: generatedResult.rows,
    });
  } catch (error) {
    console.error('Error fetching completion status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch completion status',
      error: error.message,
    });
  }
});

// POST /api/documents/generate/:templateId - Generate document
router.post('/generate/:templateId', requireDocumentGenerationAccess, async (req, res) => {
  try {
    const templateId = parsePositiveInt(req.params.templateId);
    const infantId = parsePositiveInt(req.body?.infantId ?? req.body?.infant_id);
    const requestedGuardianId = parsePositiveInt(
      req.body?.guardianId ?? req.body?.guardian_id,
    );
    const customData = req.body?.customData || req.body?.custom_data || {};

    if (!templateId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template ID',
      });
    }

    const templateResult = await pool.query(
      'SELECT * FROM paper_templates WHERE id = $1 AND is_active = true',
      [templateId],
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Template not found or inactive',
      });
    }

    let patientRecord = null;
    if (infantId) {
      patientRecord = await getPatientRecord(infantId);

      if (!patientRecord) {
        return res.status(404).json({
          success: false,
          message: 'Infant not found',
        });
      }

      const hasAccess = await ensurePatientAccess(req, patientRecord);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }
    }

    const resolvedGuardianId =
      requestedGuardianId ||
      parsePositiveInt(patientRecord?.guardian_id) ||
      (isGuardianRequest(req) ? getGuardianScopeId(req) : null);

    const result = await documentService.generateDocument(
      templateId,
      infantId,
      resolvedGuardianId,
      parsePositiveInt(req.user?.id),
      customData,
    );

    res.status(201).json({
      success: true,
      message: 'Document generated successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error generating document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate document',
      error: error.message,
    });
  }
});

// GET /api/documents/download/:id - Download document
router.get('/download/:id', requirePermission('document:export'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID',
      });
    }

    const generation = await fetchDetailedDocument(id);

    if (!generation) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const hasAccess = await hasDocumentAccess(req, generation);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const downloadResult = await documentService.downloadDocument(id);

    if (!downloadResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to download document',
        error: downloadResult.error,
      });
    }

    await documentService.incrementDownloadCount(id);

    res.setHeader('Content-Type', downloadResult.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadResult.filename}"`);
    res.setHeader('Content-Length', downloadResult.buffer.length);

    res.send(downloadResult.buffer);
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download document',
      error: error.message,
    });
  }
});

// GET /api/documents/analytics - Get document analytics
router.get('/analytics', requirePermission('dashboard:analytics'), async (req, res) => {
  try {
    const { startDate, endDate, templateType, infantId } = req.query;

    const analytics = await documentService.getDocumentAnalytics({
      startDate,
      endDate,
      templateType,
      infantId,
    });

    res.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    console.error('Error fetching document analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document analytics',
      error: error.message,
    });
  }
});

// GET /api/documents/stats - Get document statistics
router.get('/stats', requirePermission('dashboard:analytics'), async (req, res) => {
  try {
    const stats = await documentService.getDocumentStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching document stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document stats',
      error: error.message,
    });
  }
});

// GET /api/documents/templates/:templateId/fields - Get template fields (for frontend)
router.get('/templates/:templateId/fields', requirePermission('document:view'), async (req, res) => {
  try {
    const templateId = parsePositiveInt(req.params.templateId);

    if (!templateId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template ID',
      });
    }

    const result = await pool.query(
      'SELECT fields FROM paper_templates WHERE id = $1 AND is_active = true',
      [templateId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    const rawFields = result.rows[0].fields;
    const fields =
      typeof rawFields === 'string'
        ? JSON.parse(rawFields)
        : Array.isArray(rawFields)
          ? rawFields
          : [];

    res.json({
      success: true,
      data: fields,
    });
  } catch (error) {
    console.error('Error fetching template fields:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch template fields',
      error: error.message,
    });
  }
});

// GET /api/documents/shared/with-me - Get documents shared with user
router.get('/shared/with-me', requirePermission('document:view'), async (req, res) => {
  try {
    const { limit, offset } = sanitizePagination(req.query);
    const userId = parsePositiveInt(req.user?.id);
    const guardianId = isGuardianRequest(req) ? getGuardianScopeId(req) : null;
    const params = [userId];
    let whereClause = 'WHERE (ds.shared_with_user_id = $1';

    if (guardianId) {
      whereClause += ` OR ds.shared_with_guardian_id = $${params.length + 1}`;
      params.push(guardianId);
    }
    whereClause += ')';

    const patientFacilityColumn = await getPatientFacilityColumn();
    const sharedByExpressions = await getUserNameExpressions('shared_by', {
      fallbackFirstName: 'System User',
    });
    const legacyInfantSupport = await getLegacyInfantSupport();
    const baseQuery = `
      SELECT
        dg.*,
        dp.title,
        dp.document_type,
        t.name AS template_name,
        t.template_type,
        COALESCE(p.first_name, ${legacyInfantSupport.firstNameExpression}, '') AS infant_first_name,
        COALESCE(p.last_name, ${legacyInfantSupport.lastNameExpression}, '') AS infant_last_name,
        COALESCE(p.first_name, ${legacyInfantSupport.firstNameExpression}, '') AS first_name,
        COALESCE(p.last_name, ${legacyInfantSupport.lastNameExpression}, '') AS last_name,
        COALESCE(p.${patientFacilityColumn}, ${legacyInfantSupport.clinicExpression}, g.clinic_id) AS infant_clinic_id,
        ${sharedByExpressions.firstName} AS shared_by_first,
        ${sharedByExpressions.lastName} AS shared_by_last,
        ds.shared_at,
        ds.access_type,
        COALESCE(dg.last_downloaded, dg.created_at) AS download_date,
        COALESCE(dp.document_type, t.template_type, 'PDF') AS download_type
      FROM document_shares ds
      JOIN document_generation dg ON ds.document_id = dg.id
      LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
      LEFT JOIN paper_templates t ON dg.template_id = t.id
      LEFT JOIN patients p ON dg.infant_id = p.id
      ${legacyInfantSupport.joinClause}
      LEFT JOIN guardians g ON COALESCE(dg.guardian_id, p.guardian_id, ${legacyInfantSupport.guardianIdExpression}) = g.id
      LEFT JOIN users shared_by ON ds.shared_by = shared_by.id
      ${whereClause}
        AND (ds.expires_at IS NULL OR ds.expires_at > CURRENT_TIMESTAMP)
    `;

    const countResult = await pool.query(
      `SELECT COUNT(*) AS count FROM (${baseQuery}) AS shared_documents`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.count || 0, 10);

    const result = await pool.query(
      `${baseQuery} ORDER BY ds.shared_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({
      success: true,
      data: result.rows.map(normalizeDocumentRecord),
      pagination: {
        limit,
        offset,
        total,
      },
    });
  } catch (error) {
    console.error('Error fetching shared documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shared documents',
      error: error.message,
    });
  }
});

// GET /api/documents/:id - Get specific document details
router.get('/:id(\\d+)', requirePermission('document:view'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID',
      });
    }

    const document = await fetchDetailedDocument(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const hasAccess = await hasDocumentAccess(req, document);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    res.json({
      success: true,
      data: document,
    });
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document',
      error: error.message,
    });
  }
});

// PUT /api/documents/:id - Update document metadata
router.put('/:id(\\d+)', requirePermission('document:view'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID',
      });
    }

    const existing = await fetchDetailedDocument(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const hasAccess = await hasDocumentAccess(req, existing);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    if (!canManageDocumentRecord(req, existing)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const { title, notes, tags } = req.body || {};

    const result = await pool.query(
      `
        UPDATE document_generation
        SET title = COALESCE($1, title),
            notes = COALESCE($2, notes),
            tags = COALESCE($3, tags),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
      `,
      [title || null, notes || null, tags ? JSON.stringify(tags) : null, id],
    );

    res.json({
      success: true,
      message: 'Document updated successfully',
      data: normalizeDocumentRecord(result.rows[0]),
    });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update document',
      error: error.message,
    });
  }
});

// DELETE /api/documents/:id - Delete document
router.delete('/:id(\\d+)', requirePermission('document:view'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID',
      });
    }

    const existing = await fetchDetailedDocument(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const hasAccess = await hasDocumentAccess(req, existing);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    if (!canManageDocumentRecord(req, existing)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    await pool.query('DELETE FROM digital_papers WHERE document_generation_id = $1', [id]);

    if (existing.file_path) {
      try {
        await fs.unlink(existing.file_path);
      } catch (fileError) {
        console.warn('Unable to delete document file:', fileError.message);
      }
    }

    await pool.query('DELETE FROM document_generation WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message,
    });
  }
});

// POST /api/documents/:id/share - Share document with another user
router.post('/:id(\\d+)/share', requirePermission('document:view'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID',
      });
    }

    const existing = await fetchDetailedDocument(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const hasAccess = await hasDocumentAccess(req, existing);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    if (!canManageDocumentRecord(req, existing)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const shareWithUserId = parsePositiveInt(req.body?.shareWithUserId);
    const shareWithGuardianId = parsePositiveInt(req.body?.shareWithGuardianId);
    const accessType = req.body?.accessType || 'view';
    const expiresAt = req.body?.expiresAt || null;

    if (!shareWithUserId && !shareWithGuardianId) {
      return res.status(400).json({
        success: false,
        message: 'Either shareWithUserId or shareWithGuardianId is required',
      });
    }

    const result = await pool.query(
      `
        INSERT INTO document_shares (
          document_id,
          shared_by,
          shared_with_user_id,
          shared_with_guardian_id,
          access_type,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [
        id,
        parsePositiveInt(req.user?.id),
        shareWithUserId || null,
        shareWithGuardianId || null,
        accessType,
        expiresAt,
      ],
    );

    res.status(201).json({
      success: true,
      message: 'Document shared successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error sharing document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share document',
      error: error.message,
    });
  }
});

module.exports = router;
