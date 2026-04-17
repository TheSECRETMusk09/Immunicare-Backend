/**
 * Infant Documents Router
 * Handles API routes for uploading and managing infant profile documents
 *
 * Endpoints:
 * - POST /api/infant-documents/:infantId - Upload document
 * - GET /api/infant-documents/:infantId - List documents
 * - GET /api/infant-documents/file/:documentId - Download document
 * - GET /api/infant-documents/info/:documentId - Get document metadata
 * - PUT /api/infant-documents/:documentId - Update document
 * - DELETE /api/infant-documents/:documentId - Delete document
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { getUserNameExpressions } = require('../utils/queryCompatibility');
const { resolveStorageRoot } = require('../utils/runtimeStorage');
const patientService = require('../services/patientService');

// Middleware to authenticate all infant document routes
router.use(authenticateToken);

// Ensure infant_documents upload directory exists
const infantDocsDir = resolveStorageRoot('uploads', 'infant_documents');
const ensureInfantDocsDirectory = async () => {
  try {
    await fs.access(infantDocsDir);
  } catch (error) {
    try {
      await fs.mkdir(infantDocsDir, { recursive: true });
    } catch (_mkdirError) {
      // Ignore directory bootstrap failures in read-only/serverless runtimes.
    }
  }
};
ensureInfantDocsDirectory();

// Multer storage for infant documents
const infantDocStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await ensureInfantDocsDirectory();
    cb(null, infantDocsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const filename = `infant_${req.params.infantId}_${uniqueSuffix}${ext}`;
    cb(null, filename);
  },
});

// File filter for infant documents
const infantDocFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed types: PDF, JPEG, PNG, WEBP, GIF, DOC, DOCX'), false);
  }
};

const uploadInfantDoc = multer({
  storage: infantDocStorage,
  fileFilter: infantDocFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Valid document types
const VALID_DOCUMENT_TYPES = ['vaccination_card', 'birth_certificate', 'medical_record', 'image', 'other'];

const normalizeRuntimeRole = (role) => String(role || '').trim().toLowerCase();

const serializeInfantDocument = (doc = {}) => {
  if (!doc || typeof doc !== 'object') {
    return doc;
  }

  const documentId = doc.id || doc.document_id || doc.documentId || null;
  const downloadUrl = documentId ? `/api/infant-documents/file/${documentId}` : null;

  return {
    ...doc,
    id: documentId,
    document_id: documentId,
    documentId,
    file_name: doc.original_filename || doc.file_name || doc.filename || null,
    file_type: doc.mime_type || doc.file_type || null,
    downloadUrl: doc.downloadUrl || doc.download_url || downloadUrl,
    download_url: doc.download_url || doc.downloadUrl || downloadUrl,
  };
};

const ADMIN_DOCUMENT_ROLES = new Set([
  'system_admin',
  'super_admin',
  'admin',
  'healthcare_worker',
  'clinic_manager',
]);

const fetchInfantOwner = async (infantId) => {
  // Use canonical patient service for patient lookup
  const patient = await patientService.getPatientById(infantId);
  if (patient) {
    return {
      source: 'patients',
      id: patient.id,
      guardian_id: patient.guardianId,
    };
  }

  return null;
};

const isGuardianOwner = (reqUser, recordGuardianId) => {
  const normalizedRole = normalizeRuntimeRole(reqUser?.role || reqUser?.role_type);
  if (normalizedRole !== 'guardian') {
    return false;
  }

  return Number(recordGuardianId) === Number(reqUser?.guardian_id || reqUser?.id);
};

const hasAdminDocumentAccess = (reqUser) =>
  ADMIN_DOCUMENT_ROLES.has(normalizeRuntimeRole(reqUser?.role || reqUser?.role_type));

// POST /api/infant-documents/:infantId - Upload document for infant
router.post('/:infantId', uploadInfantDoc.single('file'), async (req, res) => {
  try {
    const { infantId } = req.params;
    const { id: userId, role, guardian_id } = req.user;
    const { documentType, description } = req.body;

    // Validate infant ID
    const infantIdNum = parseInt(infantId);
    if (isNaN(infantIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid infant ID',
      });
    }

    // Check if infant exists and user has access
    const infant = await fetchInfantOwner(infantIdNum);

    if (!infant) {
      return res.status(404).json({
        success: false,
        message: 'Infant not found',
      });
    }

    // Check permissions
    if (
      normalizeRuntimeRole(role) === 'guardian' &&
      !isGuardianOwner({ id: userId, guardian_id, role }, infant.guardian_id)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - not the guardian of this infant',
      });
    }

    // Validate document type
    const docType = documentType || 'other';
    if (!VALID_DOCUMENT_TYPES.includes(docType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type. Valid types: ' + VALID_DOCUMENT_TYPES.join(', '),
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    // Store document in database
    const result = await pool.query(
      `INSERT INTO infant_documents
       (infant_id, document_type, file_path, original_filename, mime_type, file_size, uploaded_by, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        infantIdNum,
        docType,
        req.file.path,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        userId,
        description || null,
      ],
    );

    const documentRecord = serializeInfantDocument(result.rows[0]);

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      id: documentRecord.id,
      document_id: documentRecord.id,
      documentId: documentRecord.id,
      data: documentRecord,
      document: documentRecord,
    });
  } catch (error) {
    // Use caught error objects for structured logging and error-response context
    console.error('Error uploading infant document:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail,
      infantId: req.params.infantId,
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      message: 'Failed to upload document',
      error: error.message,
      errorCode: error.code,
    });
  }
});

// GET /api/infant-documents/:infantId - List all documents for infant
router.get('/:infantId', async (req, res) => {
  try {
    const { infantId } = req.params;
    const { id: userId, role, guardian_id } = req.user;
    const { documentType, limit = 50, offset = 0 } = req.query;

    const infantIdNum = parseInt(infantId);
    if (isNaN(infantIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid infant ID',
      });
    }

    // Check if infant exists and user has access
    const infant = await fetchInfantOwner(infantIdNum);

    if (!infant) {
      return res.status(404).json({
        success: false,
        message: 'Infant not found',
      });
    }

    // Check permissions
    if (
      normalizeRuntimeRole(role) === 'guardian' &&
      !isGuardianOwner({ id: userId, guardian_id, role }, infant.guardian_id)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - not the guardian of this infant',
      });
    }

    const uploadedByExpressions = await getUserNameExpressions('u', {
      fallbackFirstName: 'System User',
    });

    // Build query
    let query = `
      SELECT doc.*, ${uploadedByExpressions.firstName} as uploaded_by_first, ${uploadedByExpressions.lastName} as uploaded_by_last
      FROM infant_documents doc
      LEFT JOIN users u ON doc.uploaded_by = u.id
      WHERE doc.infant_id = $1 AND doc.is_active = true
    `;
    const params = [infantIdNum];
    let paramIndex = 2;

    if (documentType) {
      query += ` AND doc.document_type = $${paramIndex}`;
      params.push(documentType);
      paramIndex++;
    }

    query += ` ORDER BY doc.uploaded_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM infant_documents WHERE infant_id = $1 AND is_active = true';
    const countParams = [infantIdNum];
    if (documentType) {
      countQuery += ' AND document_type = $2';
      countParams.push(documentType);
    }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      success: true,
      data: result.rows.map(serializeInfantDocument),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: parseInt(countResult.rows[0].total),
      },
    });
  } catch (error) {
    // Use caught error objects for structured logging and error-response context
    console.error('Error fetching infant documents:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail,
      infantId: req.params.infantId,
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch documents',
      error: error.message,
      errorCode: error.code,
    });
  }
});

// GET /api/infant-documents/file/:documentId - Download/view infant document
router.get('/file/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { id: userId, role, guardian_id } = req.user;

    const documentIdNum = parseInt(documentId);
    if (isNaN(documentIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID',
      });
    }

    // Get document info
    const docResult = await pool.query(
      'SELECT * FROM infant_documents WHERE id = $1 AND is_active = true',
      [documentIdNum],
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = docResult.rows[0];

    // Check if infant exists and user has access
    const infant = await fetchInfantOwner(doc.infant_id);

    if (!infant) {
      return res.status(404).json({
        success: false,
        message: 'Infant not found',
      });
    }

    // Check permissions
    if (
      normalizeRuntimeRole(role) === 'guardian' &&
      !isGuardianOwner({ id: userId, guardian_id, role }, infant.guardian_id)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if file exists
    try {
      await fs.access(doc.file_path);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server',
      });
    }

    // Read and serve the file
    const fileBuffer = await fs.readFile(doc.file_path);

    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${doc.original_filename}"`);
    res.setHeader('Content-Length', doc.file_size);

    res.send(fileBuffer);
  } catch (error) {
    console.error('Error downloading infant document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download document',
      error: error.message,
    });
  }
});

// GET /api/infant-documents/info/:documentId - Get infant document metadata
router.get('/info/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { id: userId, role, guardian_id } = req.user;

    const documentIdNum = parseInt(documentId);
    if (isNaN(documentIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID',
      });
    }

    const uploadedByExpressions = await getUserNameExpressions('u', {
      fallbackFirstName: 'System User',
    });

    // Get document info
    const docResult = await pool.query(
      `SELECT doc.*, ${uploadedByExpressions.firstName} as uploaded_by_first, ${uploadedByExpressions.lastName} as uploaded_by_last
       FROM infant_documents doc
       LEFT JOIN users u ON doc.uploaded_by = u.id
       WHERE doc.id = $1 AND doc.is_active = true`,
      [documentIdNum],
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = docResult.rows[0];

    // Check if infant exists and user has access
    const infant = await fetchInfantOwner(doc.infant_id);

    if (!infant) {
      return res.status(404).json({
        success: false,
        message: 'Infant not found',
      });
    }

    // Check permissions
    if (
      normalizeRuntimeRole(role) === 'guardian' &&
      !isGuardianOwner({ id: userId, guardian_id, role }, infant.guardian_id)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    res.json({
      success: true,
      data: serializeInfantDocument(doc),
    });
  } catch (error) {
    console.error('Error fetching infant document info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document info',
      error: error.message,
    });
  }
});

// PUT /api/infant-documents/:documentId - Update infant document metadata
router.put('/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { id: userId, role, guardian_id } = req.user;
    const { documentType, description } = req.body;

    const documentIdNum = parseInt(documentId);
    if (isNaN(documentIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID',
      });
    }

    // Get existing document
    const docResult = await pool.query(
      'SELECT * FROM infant_documents WHERE id = $1 AND is_active = true',
      [documentIdNum],
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = docResult.rows[0];

    // Check if infant exists and user has access
    const infant = await fetchInfantOwner(doc.infant_id);

    if (!infant) {
      return res.status(404).json({
        success: false,
        message: 'Infant not found',
      });
    }

    // Check permissions - allow update if guardian or healthcare worker
    let hasPermission = false;
    if (hasAdminDocumentAccess({ role })) {
      hasPermission = true;
    } else if (isGuardianOwner({ id: userId, guardian_id, role }, infant.guardian_id)) {
      hasPermission = true;
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Validate document type if provided
    if (documentType && !VALID_DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type. Valid types: ' + VALID_DOCUMENT_TYPES.join(', '),
      });
    }

    // Update document
    const result = await pool.query(
      `UPDATE infant_documents
       SET document_type = COALESCE($1, document_type),
           description = COALESCE($2, description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [documentType || null, description !== undefined ? description : null, documentIdNum],
    );

    res.json({
      success: true,
      message: 'Document updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error updating infant document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update document',
      error: error.message,
    });
  }
});

// DELETE /api/infant-documents/:documentId - Soft delete infant document
router.delete('/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { id: userId, role, guardian_id } = req.user;

    const documentIdNum = parseInt(documentId);
    if (isNaN(documentIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID',
      });
    }

    // Get existing document
    const docResult = await pool.query(
      'SELECT * FROM infant_documents WHERE id = $1 AND is_active = true',
      [documentIdNum],
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = docResult.rows[0];

    // Check if infant exists and user has access
    const infant = await fetchInfantOwner(doc.infant_id);

    if (!infant) {
      return res.status(404).json({
        success: false,
        message: 'Infant not found',
      });
    }

    // Check permissions - allow delete if guardian, healthcare worker, or uploader
    let hasPermission = false;
    if (hasAdminDocumentAccess({ role })) {
      hasPermission = true;
    } else if (isGuardianOwner({ id: userId, guardian_id, role }, infant.guardian_id)) {
      hasPermission = true;
    } else if (doc.uploaded_by === userId) {
      hasPermission = true;
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Soft delete - set is_active to false
    await pool.query(
      'UPDATE infant_documents SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [documentIdNum],
    );

    res.json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting infant document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message,
    });
  }
});

// Handle multer errors
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds 10MB limit',
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files uploaded',
      });
    }
  }
  next(error);
});

module.exports = router;
