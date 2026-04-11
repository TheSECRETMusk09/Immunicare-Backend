const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');
const VaccinationReminderService = require('../services/vaccinationReminderService');
const socketService = require('../services/socketService');
const {
  getOperationalVaccineSourceNames,
  getApprovedVaccines,
  resolveOperationalVaccineAliases,
  validateApprovedVaccine,
  validateApprovedVaccineBrand,
} = require('../utils/approvedVaccines');
const {
  AUTO_AT_BIRTH_SOURCE,
  isAutoAtBirthRecord,
  normalizeDateOnly,
} = require('../services/atBirthVaccinationService');
const vaccineEligibilityService = require('../services/vaccineEligibilityService');
const immunizationScheduleService = require('../services/immunizationScheduleService');
const {
  isScopeRequestAllowed,
  resolveEffectiveScope,
} = require('../services/entityScopeService');

const reminderService = new VaccinationReminderService();

const queueFirstVaccineNotification = (patientId, vaccineId, adminDate) => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  setImmediate(() => {
    reminderService
      .sendFirstVaccineNotification(patientId, vaccineId, adminDate)
      .catch((notificationError) => {
        console.error('Error sending vaccine notification:', notificationError);
      });
  });
};

router.use(authenticateToken);

const PROVIDER_FALLBACK_LABEL = 'Provider unavailable';
const PROVIDER_FALLBACK_LABEL_SQL = PROVIDER_FALLBACK_LABEL.replace(/'/g, '\'\'');
const PROVIDER_NAME_COLUMNS = ['full_name', 'name', 'username', 'email'];

let providerSchemaPromise = null;
let vaccinationTrackingColumnsPromise = null;
let batchFacilityColumnPromise = null;
const routeResponseCache = new Map();

const RECONCILIATION_CACHE_TTL_MS = 60 * 1000;
const SCHEDULES_CACHE_TTL_MS = 5 * 60 * 1000;

const buildScopeCacheKey = (scopeContext = {}) => {
  if (!scopeContext?.useScope) {
    return 'system';
  }

  const scopeIds = Array.isArray(scopeContext.scopeIds)
    ? [...scopeContext.scopeIds].map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right)
    : [];

  return scopeIds.length > 0 ? scopeIds.join(',') : 'scoped';
};

const getRouteCacheEntry = (key) => {
  const cachedEntry = routeResponseCache.get(key);
  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    routeResponseCache.delete(key);
    return null;
  }

  return cachedEntry.payload;
};

const setRouteCacheEntry = (key, payload, ttlMs) => {
  routeResponseCache.set(key, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });
};

const invalidateRouteCache = (prefix = '') => {
  Array.from(routeResponseCache.keys()).forEach((key) => {
    if (!prefix || key.startsWith(prefix)) {
      routeResponseCache.delete(key);
    }
  });
};

const invalidateVaccinationDashboardCaches = () => {
  invalidateRouteCache('reconciliation:');
};

const hasOwn = (payload, key) => Object.prototype.hasOwnProperty.call(payload || {}, key);

const sanitizeOptionalText = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const OPERATIONAL_YEAR_START = '2026-01-01';
const OPERATIONAL_YEAR_END = '2026-12-31';

const normalizeOptionalDateFilter = (value, fieldName) => {
  const normalizedValue = sanitizeOptionalText(value);
  if (!normalizedValue) {
    return { value: null };
  }

  const normalizedDate = normalizeDateOnly(normalizedValue);
  if (!normalizedDate) {
    return {
      error: `${fieldName} must be a valid date`,
    };
  }

  return { value: normalizedDate };
};

const appendDateRangeFilter = ({
  whereParts,
  params,
  expression,
  startDate,
  endDate,
}) => {
  if (startDate) {
    whereParts.push(`${expression} >= $${params.length + 1}::date`);
    params.push(startDate);
  }

  if (endDate) {
    whereParts.push(`${expression} <= $${params.length + 1}::date`);
    params.push(endDate);
  }
};

const resolveLotBatchValue = (...values) => {
  for (const value of values.flat()) {
    const normalized = sanitizeOptionalText(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const ensureVaccinationTrackingColumns = async () => {
  if (!vaccinationTrackingColumnsPromise) {
    vaccinationTrackingColumnsPromise = Promise.resolve();
  }

  return vaccinationTrackingColumnsPromise;
};

const resolveBatchFacilityColumn = async () => {
  if (!batchFacilityColumnPromise) {
    batchFacilityColumnPromise = pool
      .query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'vaccine_batches'
            AND column_name = ANY($1::text[])
        `,
        [['clinic_id', 'facility_id']],
      )
      .then((result) => {
        const availableColumns = new Set((result.rows || []).map((row) => row.column_name));
        if (availableColumns.has('clinic_id')) {
          return 'clinic_id';
        }

        if (availableColumns.has('facility_id')) {
          return 'facility_id';
        }

        return null;
      })
      .catch((error) => {
        batchFacilityColumnPromise = null;
        throw error;
      });
  }

  return batchFacilityColumnPromise;
};

const buildResolvedLotBatchExpression = (
  recordAlias = 'ir',
  batchAlias = 'batch',
  preferredField = 'batch_number',
) => {
  const preferredColumn = preferredField === 'lot_number' ? 'lot_number' : 'batch_number';
  const secondaryColumn = preferredColumn === 'lot_number' ? 'batch_number' : 'lot_number';

  return `COALESCE(
    NULLIF(TRIM(${recordAlias}.${preferredColumn}), ''),
    NULLIF(TRIM(${recordAlias}.${secondaryColumn}), ''),
    NULLIF(TRIM(COALESCE(${batchAlias}.lot_no, ${batchAlias}.lot_number)), '')
  )`;
};

const resolveBatchIdFromLotBatch = async ({
  vaccineId,
  batchId = null,
  lotBatchNumber = null,
  clinicId = null,
}) => {
  const parsedBatchId = parseInt(batchId, 10);
  if (!Number.isNaN(parsedBatchId) && parsedBatchId > 0) {
    return parsedBatchId;
  }

  const normalizedLotBatchNumber = resolveLotBatchValue(lotBatchNumber);
  if (!normalizedLotBatchNumber) {
    return null;
  }

  const batchFacilityColumn = clinicId ? await resolveBatchFacilityColumn() : null;
  const scopedClinicId = clinicId ? parseInt(clinicId, 10) : null;
  const queryParams = [vaccineId, normalizedLotBatchNumber];
  let clinicClause = '';

  if (batchFacilityColumn && !Number.isNaN(scopedClinicId) && scopedClinicId > 0) {
    clinicClause = ` AND ${batchFacilityColumn} = $3`;
    queryParams.push(scopedClinicId);
  }

  const result = await pool.query(
    `
      SELECT id
      FROM vaccine_batches
      WHERE vaccine_id = $1
        AND COALESCE(NULLIF(TRIM(lot_no), ''), NULLIF(TRIM(lot_number), '')) = $2
        AND is_active = true
        ${clinicClause}
      ORDER BY expiry_date ASC NULLS LAST, id ASC
      LIMIT 1
    `,
    queryParams,
  );

  return result.rows[0]?.id || null;
};

const resolveProviderSchema = async () => {
  try {
    const [tablesResult, columnsResult] = await Promise.all([
      pool.query(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = ANY($1::text[])
        `,
        [['users', 'admin']],
      ),
      pool.query(
        `
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = ANY($1::text[])
            AND column_name = ANY($2::text[])
        `,
        [['users', 'admin'], PROVIDER_NAME_COLUMNS],
      ),
    ]);

    const availableTables = new Set((tablesResult.rows || []).map((row) => row.table_name));
    const columnsByTable = {
      users: new Set(),
      admin: new Set(),
    };

    (columnsResult.rows || []).forEach((row) => {
      if (!columnsByTable[row.table_name]) {
        columnsByTable[row.table_name] = new Set();
      }
      columnsByTable[row.table_name].add(row.column_name);
    });

    return {
      tables: availableTables,
      columnsByTable,
    };
  } catch (error) {
    console.error('Error resolving vaccination provider schema:', error);
    return {
      tables: new Set(['users']),
      columnsByTable: {
        users: new Set(['username', 'email']),
        admin: new Set(),
      },
    };
  }
};

const getProviderSchema = async () => {
  if (!providerSchemaPromise) {
    providerSchemaPromise = resolveProviderSchema();
  }

  return providerSchemaPromise;
};

const buildProviderNameCandidates = (alias, availableColumns) =>
  PROVIDER_NAME_COLUMNS
    .filter((column) => availableColumns.has(column))
    .map((column) => `NULLIF(TRIM(${alias}.${column}), '')`);

const getProviderSqlFragments = async () => {
  const schema = await getProviderSchema();
  const providerJoins = [];
  const providerNameCandidates = [];

  if (schema.tables.has('users')) {
    providerJoins.push('LEFT JOIN users provider_user ON provider_user.id = ir.administered_by');
    providerNameCandidates.push(
      ...buildProviderNameCandidates('provider_user', schema.columnsByTable.users || new Set()),
    );
  }

  if (schema.tables.has('admin')) {
    providerJoins.push('LEFT JOIN admin provider_admin ON provider_admin.id = ir.administered_by');
    providerNameCandidates.push(
      ...buildProviderNameCandidates('provider_admin', schema.columnsByTable.admin || new Set()),
    );
  }

  const providerValueExpression =
    providerNameCandidates.length > 0
      ? `COALESCE(${providerNameCandidates.join(', ')}, '${PROVIDER_FALLBACK_LABEL_SQL}')`
      : `'${PROVIDER_FALLBACK_LABEL_SQL}'`;

  return {
    providerJoinsSql: providerJoins.join('\n'),
    providerValueExpression,
  };
};

const normalizeVaccinationProvider = (record) => {
  // First try user/admin based provider, then fall back to manual health_care_provider text
  const userProviderName =
    record?.provider_name || record?.administered_by_name || PROVIDER_FALLBACK_LABEL;

  const manualProviderName = record?.health_care_provider || null;
  const lotBatchNumber = resolveLotBatchValue(
    record?.lot_batch_number,
    record?.resolved_batch_number,
    record?.resolved_lot_number,
    record?.batch_number,
    record?.lot_number,
    record?.lot_no,
  );
  const lotNumber = resolveLotBatchValue(
    record?.lot_number,
    record?.resolved_lot_number,
    lotBatchNumber,
  );
  const batchNumber = resolveLotBatchValue(
    record?.batch_number,
    record?.resolved_batch_number,
    lotBatchNumber,
  );

  const finalProviderName = manualProviderName || userProviderName;

  return {
    ...record,
    lot_batch_number: lotBatchNumber,
    lot_number: lotNumber,
    batch_number: batchNumber,
    provider_name: finalProviderName,
    administered_by_name: finalProviderName,
    health_care_provider: manualProviderName,
  };
};

const sanitizeLimit = (value, fallback = 20, max = 200) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
};

const sanitizeOffset = (value, fallback = 0) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const resolveVaccinationScopeContext = (req) => {
  const scope = resolveEffectiveScope({
    query: req.query,
    user: req.user,
    canonicalRole: getCanonicalRole(req),
  });

  if (!isScopeRequestAllowed(scope)) {
    return {
      error: 'Cross-facility vaccination access is not allowed. Use your assigned facility scope.',
      status: 403,
    };
  }

  return scope;
};

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

const patientService = require('../services/patientService');

const guardianOwnsInfant = async (guardianId, infantId) => {
  const patient = await patientService.getPatientById(infantId);
  return patient && patient.guardianId === guardianId;
};

const getVaccinationRecord = async (id) => {
  await ensureVaccinationTrackingColumns();
  const { providerJoinsSql, providerValueExpression } = await getProviderSqlFragments();
  const resolvedBatchNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'batch_number');
  const resolvedLotNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'lot_number');

  const result = await pool.query(
    `
      SELECT
        ir.*,
        p.guardian_id AS owner_guardian_id,
        p.control_number AS control_number,
        p.first_name AS patient_first_name,
        p.last_name AS patient_last_name,
        v.name as vaccine_name,
        v.code as vaccine_code,
        ${resolvedBatchNumberExpression} AS resolved_batch_number,
        ${resolvedLotNumberExpression} AS resolved_lot_number,
        ${providerValueExpression} AS provider_name,
        ${providerValueExpression} AS administered_by_name
      FROM immunization_records ir
      LEFT JOIN patients p ON p.id = ir.patient_id
      JOIN vaccines v ON v.id = ir.vaccine_id
      LEFT JOIN vaccine_batches batch ON batch.id = ir.batch_id
      ${providerJoinsSql}
      WHERE ir.id = $1
        AND p.is_active = true
      LIMIT 1
    `,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return normalizeVaccinationProvider(result.rows[0]);
};

const validateAdministrationDateForPatient = async (patientId, adminDate) => {
  const normalizedAdminDate = normalizeDateOnly(adminDate);
  if (!normalizedAdminDate) {
    return {
      valid: false,
      error: 'Administration date must be a valid date',
    };
  }

  const patientResult = await pool.query(
    `
      SELECT dob
      FROM patients
      WHERE id = $1
        AND is_active = true
      LIMIT 1
    `,
    [patientId],
  );

  if (patientResult.rows.length === 0) {
    return {
      valid: false,
      error: 'Patient not found',
    };
  }

  const normalizedDob = normalizeDateOnly(patientResult.rows[0].dob);
  const today = normalizeDateOnly(new Date());

  if (normalizedAdminDate > today) {
    return {
      valid: false,
      error: 'Administration date cannot be in the future',
    };
  }

  if (normalizedDob && normalizedAdminDate < normalizedDob) {
    return {
      valid: false,
      error: 'Administration date cannot be earlier than the infant\'s date of birth',
    };
  }

  return {
    valid: true,
    normalizedAdminDate,
  };
};

const buildGuardianVaccinationNotes = ({
  existingNotes = null,
  notes = null,
  vaccinationCardUrl = null,
}) => {
  const noteParts = [
    sanitizeOptionalText(existingNotes),
    sanitizeOptionalText(notes),
    sanitizeOptionalText(vaccinationCardUrl)
      ? `Proof file: ${sanitizeOptionalText(vaccinationCardUrl)}`
      : null,
  ].filter(Boolean);

  return noteParts.length > 0 ? noteParts.join('\n') : null;
};

const validateVaccinationCompletionForPatient = async ({
  patientId,
  vaccineId,
  doseNo,
  adminDate,
  currentRecordId = null,
}) => {
  const adminDateValidation = await validateAdministrationDateForPatient(patientId, adminDate);
  if (!adminDateValidation.valid) {
    return adminDateValidation;
  }

  const patientResult = await pool.query(
    `
      SELECT dob
      FROM patients
      WHERE id = $1
        AND is_active = true
      LIMIT 1
    `,
    [patientId],
  );

  if (patientResult.rows.length === 0) {
    return {
      valid: false,
      error: 'Patient not found',
    };
  }

  const childDob = normalizeDateOnly(patientResult.rows[0].dob);
  const normalizedAdminDate = adminDateValidation.normalizedAdminDate;
  const normalizedDoseNo = parseInt(doseNo, 10);

  if (Number.isNaN(normalizedDoseNo) || normalizedDoseNo <= 0) {
    return {
      valid: false,
      error: 'Dose number must be a positive integer',
    };
  }

  const scheduleResult = await pool.query(
    `
      SELECT
        id,
        vaccine_name,
        age_description,
        COALESCE(
          minimum_age_days,
          CASE
            WHEN age_months IS NOT NULL THEN ROUND(age_months * 30.44)::INT
            WHEN age_in_months IS NOT NULL THEN ROUND(age_in_months * 30.44)::INT
            ELSE NULL
          END
        ) AS minimum_age_days
      FROM vaccination_schedules
      WHERE vaccine_id = $1
        AND COALESCE(dose_number, 1) = $2
        AND COALESCE(is_active, true) = true
      ORDER BY id ASC
      LIMIT 1
    `,
    [vaccineId, normalizedDoseNo],
  );

  const matchingSchedule = scheduleResult.rows[0] || null;

  if (matchingSchedule && childDob) {
    const childDobDate = new Date(childDob);
    const administeredDate = new Date(normalizedAdminDate);
    const minimumAgeDays = Number(matchingSchedule.minimum_age_days);

    if (Number.isFinite(minimumAgeDays)) {
      const ageInDays = Math.floor(
        (administeredDate.getTime() - childDobDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (ageInDays < minimumAgeDays) {
        return {
          valid: false,
          error: `${matchingSchedule.vaccine_name} dose ${normalizedDoseNo} cannot be administered before ${
            matchingSchedule.age_description || `${minimumAgeDays} days of age`
          }.`,
        };
      }
    }
  }

  const completedResult = await pool.query(
    `
      SELECT id, dose_no, admin_date, status
      FROM immunization_records
      WHERE patient_id = $1
        AND vaccine_id = $2
        AND is_active = true
        AND ($3::int IS NULL OR id <> $3)
        AND (
          LOWER(COALESCE(status, '')) = 'completed'
          OR admin_date IS NOT NULL
        )
      ORDER BY dose_no ASC, admin_date ASC NULLS LAST, created_at ASC NULLS LAST
    `,
    [patientId, vaccineId, currentRecordId],
  );

  const completedByDose = new Map();
  completedResult.rows.forEach((row) => {
    const rowDoseNo = parseInt(row.dose_no, 10);
    if (!completedByDose.has(rowDoseNo)) {
      completedByDose.set(rowDoseNo, row);
    }
  });

  const duplicateDose = completedByDose.get(normalizedDoseNo);
  if (duplicateDose) {
    return {
      valid: false,
      error: `Dose ${normalizedDoseNo} is already recorded for this child.`,
    };
  }

  if (normalizedDoseNo > 1) {
    const previousDose = completedByDose.get(normalizedDoseNo - 1);
    if (!previousDose) {
      return {
        valid: false,
        error: `Dose ${normalizedDoseNo} cannot be marked completed before dose ${
          normalizedDoseNo - 1
        }.`,
      };
    }

    const previousAdminDate = normalizeDateOnly(previousDose.admin_date);
    if (previousAdminDate && previousAdminDate > normalizedAdminDate) {
      return {
        valid: false,
        error: `Dose ${normalizedDoseNo} must be on or after dose ${normalizedDoseNo - 1}.`,
      };
    }
  }

  const nextDose = [...completedByDose.entries()]
    .filter(([rowDoseNo]) => rowDoseNo > normalizedDoseNo)
    .sort((left, right) => left[0] - right[0])[0]?.[1];

  const nextAdminDate = normalizeDateOnly(nextDose?.admin_date);
  if (nextAdminDate && normalizedAdminDate > nextAdminDate) {
    return {
      valid: false,
      error: `Dose ${normalizedDoseNo} must be on or before the next recorded dose.`,
    };
  }

  return {
    valid: true,
    normalizedAdminDate,
    scheduleId: matchingSchedule?.id || null,
  };
};

// Base route
router.get('/', async (_req, res) => {
  res.json({
    success: true,
    message: 'Vaccinations API is running',
    availableEndpoints: [
      '/api/vaccinations/records',
      '/api/vaccinations/vaccines',
      '/api/vaccinations/schedules',
      '/api/vaccinations/batches',
      '/api/vaccinations/patient/:patientId',
    ],
  });
});

// Get vaccination records by infant ID
router.get('/records/infant/:infantId', async (req, res) => {
  try {
    await ensureVaccinationTrackingColumns();
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const { providerJoinsSql, providerValueExpression } = await getProviderSqlFragments();
    const resolvedBatchNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'batch_number');
    const resolvedLotNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'lot_number');

    // Validate patient exists using canonical service
    const patient = await patientService.getPatientById(infantId);
    if (!patient) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    const result = await pool.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          v.code as vaccine_code,
          ${resolvedBatchNumberExpression} as resolved_batch_number,
          ${resolvedLotNumberExpression} as resolved_lot_number,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN patients p ON p.id = ir.patient_id
        LEFT JOIN vaccine_batches batch ON batch.id = ir.batch_id
        ${providerJoinsSql}
        WHERE ir.patient_id = $1
          AND ir.is_active = true
          AND p.is_active = true
        ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC
      `,
      [infantId],
    );

    res.json(result.rows.map(normalizeVaccinationProvider));
  } catch (error) {
    console.error('Error fetching infant vaccination records:', error);
    res.status(500).json({ error: 'Failed to fetch infant vaccination records' });
  }
});

// Get all vaccination records (SYSTEM_ADMIN)
router.get('/records/reconciliation', requirePermission('vaccination:view'), async (req, res) => {
  try {
    await ensureVaccinationTrackingColumns();
    const scopeContext = resolveVaccinationScopeContext(req);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({ error: scopeContext.error });
    }

    const cacheKey = `reconciliation:${buildScopeCacheKey(scopeContext)}`;
    const cachedPayload = getRouteCacheEntry(cacheKey);
    if (cachedPayload) {
      res.setHeader('X-Immunicare-Cache', 'HIT');
      return res.json(cachedPayload);
    }

    const params = [];
    let whereClause = `
      WHERE ir.is_active = true
        AND p.is_active = true
    `;

    if (scopeContext.useScope) {
      whereClause += ` AND p.facility_id = ANY($${params.length + 1}::int[])`;
      params.push(scopeContext.scopeIds);
    }

    const result = await pool.query(
      `
        WITH filtered_records AS (
          SELECT
            ir.id,
            ir.patient_id,
            ir.vaccine_id,
            COALESCE(ir.dose_no, 1) AS dose_no,
            ir.admin_date,
            LOWER(NULLIF(TRIM(COALESCE(ir.status::text, '')), '')) AS normalized_status
          FROM immunization_records ir
          JOIN patients p ON p.id = ir.patient_id
          ${whereClause}
        ),
        aggregated_records AS (
          SELECT
            patient_id,
            vaccine_id,
            dose_no,
            MAX(id) AS id,
            MAX(admin_date) AS admin_date,
            BOOL_OR(admin_date IS NOT NULL) AS has_admin_date,
            BOOL_OR(normalized_status = 'completed') AS has_completed_status,
            BOOL_OR(normalized_status = 'attended') AS has_attended_status,
            BOOL_OR(normalized_status = 'overdue') AS has_overdue_status,
            BOOL_OR(normalized_status = 'due') AS has_due_status,
            BOOL_OR(normalized_status = 'upcoming') AS has_upcoming_status,
            BOOL_OR(normalized_status = 'pending') AS has_pending_status
          FROM filtered_records
          GROUP BY patient_id, vaccine_id, dose_no
        )
        SELECT
          id,
          patient_id,
          vaccine_id,
          dose_no,
          admin_date,
          CASE
            WHEN has_admin_date OR has_completed_status OR has_attended_status THEN 'completed'
            WHEN has_overdue_status THEN 'overdue'
            WHEN has_due_status THEN 'due'
            WHEN has_upcoming_status THEN 'upcoming'
            WHEN has_pending_status THEN 'pending'
            ELSE 'pending'
          END AS status
        FROM aggregated_records
        ORDER BY patient_id ASC, vaccine_id ASC, dose_no ASC
      `,
      params,
    );

    const payload = {
      records: result.rows,
      metadata: {
        total: result.rows.length,
      },
    };

    setRouteCacheEntry(cacheKey, payload, RECONCILIATION_CACHE_TTL_MS);
    res.setHeader('X-Immunicare-Cache', 'MISS');
    res.json(payload);
  } catch (error) {
    console.error('Error fetching vaccination reconciliation records:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination reconciliation records' });
  }
});

router.get('/records', requirePermission('vaccination:view'), async (req, res) => {
  try {
    await ensureVaccinationTrackingColumns();
    const limit = sanitizeLimit(req.query.limit, 200, 5000);
    const page = sanitizeLimit(req.query.page, 1, 100000);
    const offset = req.query.page !== undefined
      ? (page - 1) * limit
      : sanitizeOffset(req.query.offset, 0);
    const searchTerm = sanitizeOptionalText(req.query.search || req.query.query);
    const vaccineNameFilter = sanitizeOptionalText(req.query.vaccine_name || req.query.vaccine);
    const vaccineIdFilter = parseInt(req.query.vaccine_id, 10);
    const statusFilter = sanitizeOptionalText(req.query.status);
    const dateView = String(req.query.date_view || req.query.dateView || 'all')
      .trim()
      .toLowerCase();
    const administeredStart = normalizeOptionalDateFilter(
      req.query.administered_start_date || req.query.date_administered_start,
      'administered_start_date',
    );
    const administeredEnd = normalizeOptionalDateFilter(
      req.query.administered_end_date || req.query.date_administered_end,
      'administered_end_date',
    );
    const nextDueStart = normalizeOptionalDateFilter(
      req.query.next_due_start_date || req.query.nextDueStart,
      'next_due_start_date',
    );
    const nextDueEnd = normalizeOptionalDateFilter(
      req.query.next_due_end_date || req.query.nextDueEnd,
      'next_due_end_date',
    );
    const dateFilterErrors = {
      ...(administeredStart.error ? { administered_start_date: administeredStart.error } : {}),
      ...(administeredEnd.error ? { administered_end_date: administeredEnd.error } : {}),
      ...(nextDueStart.error ? { next_due_start_date: nextDueStart.error } : {}),
      ...(nextDueEnd.error ? { next_due_end_date: nextDueEnd.error } : {}),
    };

    if (req.query.vaccine_id && (!Number.isInteger(vaccineIdFilter) || vaccineIdFilter <= 0)) {
      dateFilterErrors.vaccine_id = 'vaccine_id must be a positive integer';
    }

    if (dateView && !['all', 'present', 'upcoming', 'past'].includes(dateView)) {
      dateFilterErrors.date_view = 'date_view must be one of all, present, upcoming, or past';
    }

    if (Object.keys(dateFilterErrors).length > 0) {
      return res.status(400).json({
        error: 'Invalid vaccination record filters',
        errors: dateFilterErrors,
      });
    }

    const { providerJoinsSql, providerValueExpression } = await getProviderSqlFragments();
    const resolvedBatchNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'batch_number');
    const resolvedLotNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'lot_number');
    const operationalDateExpression = 'COALESCE(ir.admin_date::date, ir.next_due_date::date, ir.created_at::date)';
    const scopeContext = resolveVaccinationScopeContext(req);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({ error: scopeContext.error });
    }

    const params = [];
    let whereClause = `
      WHERE ir.is_active = true
        AND p.is_active = true
    `;

    if (scopeContext.useScope) {
      whereClause += ` AND p.facility_id = ANY($${params.length + 1}::int[])`;
      params.push(scopeContext.scopeIds);
    }

    if (searchTerm) {
      whereClause += `
        AND (
          COALESCE(p.first_name, '') ILIKE $${params.length + 1}
          OR COALESCE(p.last_name, '') ILIKE $${params.length + 1}
          OR COALESCE(g.name, '') ILIKE $${params.length + 1}
          OR COALESCE(p.control_number, '') ILIKE $${params.length + 1}
          OR COALESCE(v.name, '') ILIKE $${params.length + 1}
          OR COALESCE(ir.status::text, '') ILIKE $${params.length + 1}
          OR COALESCE(${providerValueExpression}, '') ILIKE $${params.length + 1}
        )
      `;
      params.push(`%${searchTerm}%`);
    }

    if (Number.isInteger(vaccineIdFilter) && vaccineIdFilter > 0) {
      whereClause += ` AND ir.vaccine_id = $${params.length + 1}`;
      params.push(vaccineIdFilter);
    }

    if (vaccineNameFilter && vaccineNameFilter.toLowerCase() !== 'all') {
      const normalizedAliases = resolveOperationalVaccineAliases(vaccineNameFilter)
        .map((name) => String(name).trim().toLowerCase())
        .filter(Boolean);

      if (normalizedAliases.length > 0) {
        whereClause += ` AND LOWER(TRIM(COALESCE(v.name, ''))) = ANY($${params.length + 1}::text[])`;
        params.push(normalizedAliases);
      } else {
        whereClause += ` AND LOWER(TRIM(COALESCE(v.name, ''))) = $${params.length + 1}`;
        params.push(vaccineNameFilter.toLowerCase());
      }
    }

    if (statusFilter && statusFilter.toLowerCase() !== 'all') {
      whereClause += ` AND LOWER(TRIM(COALESCE(ir.status::text, ''))) = $${params.length + 1}`;
      params.push(statusFilter.toLowerCase());
    }

    appendDateRangeFilter({
      whereParts: {
        push: (clause) => {
          whereClause += ` AND ${clause}`;
        },
      },
      params,
      expression: 'ir.admin_date::date',
      startDate: administeredStart.value,
      endDate: administeredEnd.value,
    });

    appendDateRangeFilter({
      whereParts: {
        push: (clause) => {
          whereClause += ` AND ${clause}`;
        },
      },
      params,
      expression: 'ir.next_due_date::date',
      startDate: nextDueStart.value,
      endDate: nextDueEnd.value,
    });

    if (dateView === 'present') {
      whereClause += `
        AND (
          ir.admin_date::date BETWEEN $${params.length + 1}::date AND $${params.length + 2}::date
          OR ir.next_due_date::date BETWEEN $${params.length + 1}::date AND $${params.length + 2}::date
        )
      `;
      params.push(OPERATIONAL_YEAR_START, OPERATIONAL_YEAR_END);
    } else if (dateView === 'upcoming') {
      whereClause += ` AND ${operationalDateExpression} > $${params.length + 1}::date`;
      params.push(OPERATIONAL_YEAR_END);
    } else if (dateView === 'past') {
      whereClause += ` AND ${operationalDateExpression} < $${params.length + 1}::date`;
      params.push(OPERATIONAL_YEAR_START);
    }

    const result = await pool.query(
      `
        SELECT
          ir.id,
          ir.patient_id,
          p.control_number,
          ir.vaccine_id,
          ir.dose_no,
          ir.admin_date,
          ir.administered_by,
          ir.health_care_provider,
          ir.site_of_injection,
          ir.reactions,
          ir.next_due_date,
          ir.notes,
          ir.status,
          ir.batch_id,
          ir.batch_number,
          ir.lot_number,
          ir.created_at,
          ir.updated_at,
          v.name as vaccine_name,
          v.code as vaccine_code,
          p.first_name as patient_first_name,
          p.last_name as patient_last_name,
          p.dob as patient_dob,
          g.name as guardian_name,
          g.phone as guardian_phone,
          ${resolvedBatchNumberExpression} as resolved_batch_number,
          ${resolvedLotNumberExpression} as resolved_lot_number,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN patients p ON p.id = ir.patient_id
        LEFT JOIN guardians g ON g.id = p.guardian_id
        LEFT JOIN vaccine_batches batch ON batch.id = ir.batch_id
        ${providerJoinsSql}
        ${whereClause}
        ORDER BY
          CASE
            WHEN (
              ir.admin_date::date BETWEEN DATE '${OPERATIONAL_YEAR_START}' AND DATE '${OPERATIONAL_YEAR_END}'
              OR ir.next_due_date::date BETWEEN DATE '${OPERATIONAL_YEAR_START}' AND DATE '${OPERATIONAL_YEAR_END}'
            ) THEN 0
            WHEN ${operationalDateExpression} < DATE '${OPERATIONAL_YEAR_START}' THEN 1
            ELSE 2
          END ASC,
          ${operationalDateExpression} DESC,
          ir.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, limit, offset],
    );
    const countResult = await pool.query(
      `
        SELECT
          COUNT(*)::INT AS total,
          COUNT(*) FILTER (
            WHERE COALESCE(LOWER(TRIM(ir.status::text)), '') IN ('completed', 'attended')
              OR ir.admin_date IS NOT NULL
          )::INT AS completed
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN patients p ON p.id = ir.patient_id
        LEFT JOIN guardians g ON g.id = p.guardian_id
        LEFT JOIN vaccine_batches batch ON batch.id = ir.batch_id
        ${providerJoinsSql}
        ${whereClause}
      `,
      params,
    );
    const metadata = countResult.rows[0] || {};

    res.json({
      records: result.rows.map(normalizeVaccinationProvider),
      metadata: {
        page,
        limit,
        offset,
        total: parseInt(metadata.total, 10) || 0,
        totalPages:
          limit > 0 ? Math.ceil((parseInt(metadata.total, 10) || 0) / limit) : 0,
        completed: parseInt(metadata.completed, 10) || 0,
        hasNext: offset + limit < (parseInt(metadata.total, 10) || 0),
        hasPrev: offset > 0,
      },
    });
  } catch (error) {
    console.error('Error fetching vaccination records:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination records' });
  }
});

// Get vaccines (both roles)
// Only returns approved vaccines by default for security
router.get('/vaccines', requirePermission('dashboard:view'), async (req, res) => {
  try {
    const vaccines = await getApprovedVaccines(true);
    res.json(vaccines);
  } catch (error) {
    console.error('Error fetching vaccines:', error);
    res.status(500).json({ error: 'Failed to fetch vaccines' });
  }
});

// Get vaccination schedules (both roles)
router.get('/schedules', requirePermission('dashboard:view'), async (req, res) => {
  try {
    const dateView = String(req.query.date_view || req.query.dateView || 'present')
      .trim()
      .toLowerCase();

    if (dateView && !['all', 'present', 'upcoming', 'past'].includes(dateView)) {
      return res.status(400).json({
        error: 'Invalid date_view parameter',
        message: 'date_view must be one of all, present, upcoming, or past',
      });
    }

    // Create cache key based on date view
    const cacheKey = `schedules:approved:${dateView}`;
    const cachedPayload = getRouteCacheEntry(cacheKey);
    if (cachedPayload) {
      res.setHeader('X-Immunicare-Cache', 'HIT');
      return res.json(cachedPayload);
    }

    await ensureVaccinationTrackingColumns();

    const whereClause = `
      WHERE is_active = true
        AND vaccine_name = ANY($1::text[])
    `;
    const params = [getOperationalVaccineSourceNames()];

    const result = await pool.query(
      `
        SELECT
          id,
          vaccine_id,
          vaccine_name,
          dose_number,
          total_doses,
          age_in_months,
          description,
          is_active,
          created_at,
          updated_at
        FROM vaccination_schedules
        ${whereClause}
        ORDER BY age_in_months ASC, vaccine_name ASC
      `,
      params,
    );

    setRouteCacheEntry(cacheKey, result.rows, SCHEDULES_CACHE_TTL_MS);
    res.setHeader('X-Immunicare-Cache', 'MISS');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vaccination schedules:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination schedules' });
  }
});

// Get vaccination batches (SYSTEM_ADMIN)
router.get('/batches', requirePermission('inventory:view'), async (_req, res) => {
  try {
    await ensureVaccinationTrackingColumns();

    const result = await pool.query(
      `
      SELECT
        vb.id,
        COALESCE(NULLIF(TRIM(vb.lot_no), ''), NULLIF(TRIM(vb.lot_number), '')) AS lot_no,
        vb.vaccine_id,
        vb.qty_current,
        vb.expiry_date,
        vb.manufacture_date as received_date,
        v.name as vaccine_name,
        v.code as vaccine_code,
        s.name as supplier_name
      FROM vaccine_batches vb
        JOIN vaccines v ON v.id = vb.vaccine_id
        LEFT JOIN suppliers s ON s.id = vb.supplier_id
        WHERE vb.is_active = true
          AND v.name = ANY($1::text[])
        ORDER BY vb.expiry_date ASC
      `,
      [getOperationalVaccineSourceNames()],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vaccination batches:', error);
    res.json([]);
  }
});

// Get vaccination inventory status for FEFO batch sources
router.get('/inventory-status/:vaccineId', requirePermission('vaccination:create'), async (req, res) => {
  try {
    await ensureVaccinationTrackingColumns();

    const vaccineId = parseInt(req.params.vaccineId, 10);
    if (Number.isNaN(vaccineId)) {
      return res.status(400).json({ error: 'Invalid vaccine ID' });
    }

    const scopedClinicIdRaw =
      req.user?.clinic_id || req.user?.facility_id || req.healthCenterFilter?.clinic_id || null;
    const scopedClinicId = scopedClinicIdRaw ? parseInt(scopedClinicIdRaw, 10) : null;

    if (!scopedClinicId) {
      return res.status(400).json({
        error: 'clinic_id scope is required to load vaccine inventory status',
      });
    }

    // Validate vaccine is approved
    const vaccineValidation = await validateApprovedVaccine(vaccineId, { fieldName: 'vaccine_id' });
    if (!vaccineValidation.valid) {
      return res.status(400).json({ error: vaccineValidation.error });
    }

    const result = await pool.query(
      `
        SELECT
          vb.id as batch_id,
          COALESCE(NULLIF(TRIM(vb.lot_no), ''), NULLIF(TRIM(vb.lot_number), '')) AS lot_no,
          vb.vaccine_id,
          vb.qty_current,
          vb.expiry_date,
          vb.manufacture_date as received_date,
          v.name as vaccine_name,
          v.code as vaccine_code,
          s.name as supplier_name,
          c.name as clinic_name
        FROM vaccine_batches vb
        JOIN vaccines v ON v.id = vb.vaccine_id
        LEFT JOIN suppliers s ON s.id = vb.supplier_id
        LEFT JOIN clinics c ON c.id = vb.clinic_id
        WHERE vb.is_active = true
          AND vb.status = 'active'
          AND vb.qty_current > 0
          AND vb.expiry_date > CURRENT_DATE
          AND vb.clinic_id = $1
          AND vb.vaccine_id = $2
        ORDER BY vb.expiry_date ASC
      `,
      [scopedClinicId, vaccineId],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vaccination inventory status:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination inventory status' });
  }
});

// Get valid vaccine inventory for dropdown (not expired, stock > 0, active)
router.get('/inventory/valid', requirePermission('vaccination:create'), async (req, res) => {
  try {
    await ensureVaccinationTrackingColumns();

    const { vaccine_id, clinic_id } = req.query;

    const scopedClinicIdRaw =
      req.user?.clinic_id || req.user?.facility_id || req.healthCenterFilter?.clinic_id || null;
    const scopedClinicId = scopedClinicIdRaw ? parseInt(scopedClinicIdRaw, 10) : null;

    const requestedClinicId = clinic_id !== undefined ? parseInt(clinic_id, 10) : null;
    if (clinic_id !== undefined && Number.isNaN(requestedClinicId)) {
      return res.status(400).json({ error: 'clinic_id must be a valid integer' });
    }

    if (requestedClinicId && scopedClinicId && requestedClinicId !== scopedClinicId) {
      return res.status(403).json({
        error:
          'Cross-facility vaccine inventory access is not allowed. Use your assigned facility scope.',
      });
    }

    const effectiveClinicId = requestedClinicId || scopedClinicId;
    if (!effectiveClinicId) {
      return res.status(400).json({
        error:
          'clinic_id scope is required to load valid vaccine inventory',
      });
    }

    let query = `
      SELECT
        vb.id as batch_id,
        COALESCE(NULLIF(TRIM(vb.lot_no), ''), NULLIF(TRIM(vb.lot_number), '')) AS lot_no,
        vb.vaccine_id,
        vb.qty_current,
        vb.expiry_date,
        v.name as vaccine_name,
        v.code as vaccine_code,
        c.name as clinic_name
      FROM vaccine_batches vb
        JOIN vaccines v ON v.id = vb.vaccine_id
        LEFT JOIN clinics c ON c.id = vb.clinic_id
      WHERE vb.is_active = true
        AND vb.status = 'active'
        AND vb.qty_current > 0
        AND vb.expiry_date > CURRENT_DATE
        AND vb.clinic_id = $1
        AND v.name = ANY($2::text[])
    `;

    const params = [effectiveClinicId, getOperationalVaccineSourceNames()];
    let paramCount = 3;

    // Filter by specific vaccine if provided
    if (vaccine_id !== undefined) {
      const parsedVaccineId = parseInt(vaccine_id, 10);
      if (Number.isNaN(parsedVaccineId)) {
        return res.status(400).json({ error: 'vaccine_id must be a valid integer' });
      }

      const vaccineValidation = await validateApprovedVaccine(parsedVaccineId, {
        fieldName: 'vaccine_id',
      });
      if (!vaccineValidation.valid) {
        return res.status(400).json({ error: vaccineValidation.error });
      }

      query += ` AND vb.vaccine_id = $${paramCount}`;
      params.push(vaccineValidation.vaccine.id);
      paramCount += 1;
    }

    query += ' ORDER BY vb.expiry_date ASC';

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching valid vaccine inventory:', error);
    res.status(500).json({ error: 'Failed to fetch valid vaccine inventory' });
  }
});

// Get vaccination schedules by infant
router.get('/schedules/infant/:infantId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    // Validate patient exists using canonical service
    const patient = await patientService.getPatientById(infantId);
    if (!patient) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    const dob = new Date(patient.dob);

    const recordsResult = await pool.query(
      `
        SELECT id, vaccine_id, dose_no, admin_date, status
        FROM immunization_records
        WHERE patient_id = $1
          AND is_active = true
        ORDER BY dose_no ASC, admin_date ASC NULLS LAST
      `,
      [infantId],
    );

    const completedVaccines = {};
    const completedDoseMap = new Map();
    recordsResult.rows.forEach((record) => {
      const normalizedStatus = String(record.status || '').trim().toLowerCase();
      const isCompleted = Boolean(record.admin_date) || normalizedStatus === 'completed';

      if (!isCompleted) {
        return;
      }

      const vaccineId = parseInt(record.vaccine_id, 10);
      const doseNumber = parseInt(record.dose_no, 10);
      completedVaccines[vaccineId] = Math.max(completedVaccines[vaccineId] || 0, doseNumber);
      completedDoseMap.set(`${vaccineId}:${doseNumber}`, record);
    });

    const scheduleResult = await pool.query(
      `SELECT *
       FROM vaccination_schedules
       WHERE is_active = true
         AND vaccine_name = ANY($1::text[])
       ORDER BY age_in_months ASC`,
      [getOperationalVaccineSourceNames()],
    );

    const schedules = scheduleResult.rows.map((schedule) => {
      const dosesCompleted = completedVaccines[schedule.vaccine_id] || 0;
      const doseNumber = parseInt(schedule.dose_number, 10);
      const matchingRecord = completedDoseMap.get(`${schedule.vaccine_id}:${doseNumber}`) || null;
      const isComplete = Boolean(matchingRecord);
      const isNextDueDose = doseNumber === dosesCompleted + 1;

      const dueDate = new Date(dob);
      dueDate.setMonth(dueDate.getMonth() + schedule.age_in_months);

      return {
        id: schedule.id,
        vaccineId: schedule.vaccine_id,
        vaccine_id: schedule.vaccine_id,
        vaccineName: schedule.vaccine_name,
        doseNumber: doseNumber,
        dose_number: doseNumber,
        totalDoses: schedule.total_doses,
        dosesCompleted,
        isComplete,
        isNextDueDose,
        ageMonths: schedule.age_in_months,
        description: schedule.description,
        dueDate: isComplete ? null : dueDate.toISOString(),
        due_date: isComplete ? null : dueDate.toISOString(),
        adminDate: matchingRecord?.admin_date || null,
        admin_date: matchingRecord?.admin_date || null,
        recordId: matchingRecord?.id || null,
        status: isComplete
          ? 'completed'
          : !isNextDueDose
            ? 'upcoming'
            : dueDate < new Date()
              ? 'overdue'
              : 'pending',
        isOverdue: !isComplete && isNextDueDose && dueDate < new Date(),
      };
    });

    res.json(schedules);
  } catch (error) {
    console.error('Error fetching infant schedules:', error);
    res.status(500).json({ error: 'Failed to fetch infant schedules' });
  }
});

// Create vaccination record (SYSTEM_ADMIN)
router.post('/records', requirePermission('vaccination:create'), async (req, res) => {
  try {
    await ensureVaccinationTrackingColumns();
    const {
      patient_id,
      vaccine_id,
      dose_no,
      admin_date,
      administered_by,
      health_care_provider,
      site_of_injection,
      reactions,
      next_due_date,
      notes,
      status,
      batch_id,
      lot_number,
      batch_number,
      lot_batch_number,
      schedule_id,
      manufacturer,
      brand_name,
    } = req.body;

    console.log('[VACCINATION CREATE] Received payload:', JSON.stringify(req.body));
    console.log('[VACCINATION CREATE] Parsed values - patient_id:', patient_id, 'vaccine_id:', vaccine_id, 'dose_no:', dose_no);

    if (!patient_id || !vaccine_id || !dose_no || !admin_date) {
      console.log('[VACCINATION CREATE] Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields: patient_id, vaccine_id, dose_no, and admin_date are required',
      });
    }

    const adminDateValidation = await validateAdministrationDateForPatient(patient_id, admin_date);
    if (!adminDateValidation.valid) {
      return res.status(400).json({ error: adminDateValidation.error });
    }

    const normalizedAdminDate = adminDateValidation.normalizedAdminDate;

    // Validate vaccine is approved
    console.log('[VACCINATION CREATE] Validating vaccine_id:', vaccine_id);
    const vaccineValidation = await validateApprovedVaccine(vaccine_id);
    console.log('[VACCINATION CREATE] Vaccine validation result:', JSON.stringify(vaccineValidation));
    if (!vaccineValidation.valid) {
      return res.status(400).json({ error: vaccineValidation.error });
    }

    const providedBrand = brand_name !== undefined ? brand_name : manufacturer;
    const brandFieldName = brand_name !== undefined ? 'brand_name' : 'manufacturer';
    const brandValidation = validateApprovedVaccineBrand(
      providedBrand,
      vaccineValidation.vaccine.name,
      { fieldName: brandFieldName },
    );

    if (!brandValidation.valid) {
      return res.status(400).json({ error: brandValidation.error });
    }

    const normalizedLotBatchNumber = resolveLotBatchValue(
      lot_batch_number,
      batch_number,
      lot_number,
    );
    const resolvedBatchId = await resolveBatchIdFromLotBatch({
      vaccineId: vaccineValidation.vaccine.id,
      batchId: batch_id,
      lotBatchNumber: normalizedLotBatchNumber,
      clinicId: req.user?.clinic_id || req.user?.facility_id || null,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const duplicateCheck = await client.query(
        `
           SELECT *
           FROM immunization_records
           WHERE patient_id = $1
              AND vaccine_id = $2
              AND dose_no = $3
              AND is_active = true
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
           LIMIT 1
         `,
        [patient_id, vaccine_id, dose_no],
      );

      if (duplicateCheck.rows.length > 0) {
        const existingRecord = duplicateCheck.rows[0];
        const existingStatus = String(existingRecord.status || '').trim().toLowerCase();

        if (
          isAutoAtBirthRecord(existingRecord) ||
          !existingRecord.admin_date ||
          existingStatus === 'pending' ||
          existingStatus === 'scheduled'
        ) {
          const updateResult = await client.query(
            `
              UPDATE immunization_records
              SET admin_date = $1,
                  administered_by = COALESCE($2, administered_by),
                  health_care_provider = $3,
                  site_of_injection = $4,
                  reactions = $5,
                  next_due_date = $6,
                  notes = $7,
                  status = 'completed',
                  batch_id = COALESCE($8, batch_id),
                  batch_number = COALESCE($9, batch_number),
                  lot_number = COALESCE($10, lot_number),
                  schedule_id = COALESCE(schedule_id, $11),
                  source_facility = CASE
                    WHEN source_facility = $12 THEN NULL
                    ELSE source_facility
                  END,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $13
              RETURNING *
            `,
            [
              normalizedAdminDate,
              administered_by || req.user.id,
              health_care_provider || null,
              site_of_injection || null,
              reactions || null,
              next_due_date || null,
              notes || null,
              resolvedBatchId || null,
              normalizedLotBatchNumber,
              normalizedLotBatchNumber,
              schedule_id || null,
              AUTO_AT_BIRTH_SOURCE,
              existingRecord.id,
            ],
          );

          await client.query('COMMIT');

          const updatedRecord = await getVaccinationRecord(existingRecord.id);
          invalidateVaccinationDashboardCaches();

          queueFirstVaccineNotification(patient_id, vaccine_id, normalizedAdminDate);

          socketService.broadcast('vaccination_updated', updatedRecord || updateResult.rows[0]);
          return res.status(200).json(updatedRecord || updateResult.rows[0]);
        }

        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Duplicate vaccination record for this infant and schedule',
        });
      }

      const insertResult = await client.query(
        `
           INSERT INTO immunization_records (
             patient_id,
             vaccine_id,
             dose_no,
             admin_date,
             administered_by,
             health_care_provider,
             site_of_injection,
             reactions,
             next_due_date,
             notes,
             status,
             batch_id,
             batch_number,
             lot_number,
             schedule_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING *
         `,
        [
          patient_id,
          vaccine_id,
          dose_no,
          normalizedAdminDate,
          administered_by || req.user.id,
          health_care_provider || null,
          site_of_injection || null,
          reactions || null,
          next_due_date || null,
          notes || null,
          status || 'completed',
          resolvedBatchId || null,
          normalizedLotBatchNumber,
          normalizedLotBatchNumber,
          schedule_id || null,
        ],
      );

      if (resolvedBatchId) {
        await client.query(
          `
             UPDATE vaccine_batches
             SET qty_current = qty_current - 1
             WHERE id = $1
           `,
          [resolvedBatchId],
        );
      }

      await client.query('COMMIT');

      const createdRecord = await getVaccinationRecord(insertResult.rows[0].id);
      invalidateVaccinationDashboardCaches();

      queueFirstVaccineNotification(patient_id, vaccine_id, normalizedAdminDate);

      socketService.broadcast('vaccination_created', createdRecord || insertResult.rows[0]);
      res.status(201).json(createdRecord || insertResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[VACCINATION CREATE] Full error:', error);
    console.error('[VACCINATION CREATE] Error message:', error.message);
    console.error('[VACCINATION CREATE] Error stack:', error.stack);
    console.error('[VACCINATION CREATE] Error name:', error.name);

    // Provide more specific error messages based on error type
    let errorMessage = 'Failed to create vaccination record';
    if (error.code === '23505') {
      errorMessage = 'A vaccination record with these details already exists';
    } else if (error.code === '23503') {
      errorMessage = 'Foreign key constraint failed - invalid patient_id or vaccine_id';
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

router.post('/records/guardian-complete', async (req, res) => {
  try {
    if (!isGuardian(req)) {
      return res.status(403).json({ error: 'Only guardians can record completed vaccinations here' });
    }

    await ensureVaccinationTrackingColumns();

    const patientId = parseInt(req.body?.patient_id || req.body?.infant_id, 10);
    const vaccineId = parseInt(req.body?.vaccine_id, 10);
    const doseNo = parseInt(req.body?.dose_no, 10);
    const guardianId = parseInt(req.user?.guardian_id, 10);

    if (Number.isNaN(patientId) || Number.isNaN(vaccineId) || Number.isNaN(doseNo)) {
      return res.status(400).json({
        error: 'patient_id, vaccine_id, and dose_no are required and must be valid numbers',
      });
    }

    if (!guardianId || !(await guardianOwnsInfant(guardianId, patientId))) {
      return res.status(403).json({ error: 'Access denied for this infant' });
    }

    const vaccineValidation = await validateApprovedVaccine(vaccineId, { fieldName: 'vaccine_id' });
    if (!vaccineValidation.valid) {
      return res.status(400).json({ error: vaccineValidation.error });
    }

    const completionValidation = await validateVaccinationCompletionForPatient({
      patientId,
      vaccineId,
      doseNo,
      adminDate: req.body?.admin_date,
    });

    if (!completionValidation.valid) {
      return res.status(400).json({ error: completionValidation.error });
    }

    const normalizedSourceFacility = sanitizeOptionalText(req.body?.source_facility);
    const normalizedProvider =
      sanitizeOptionalText(req.body?.health_care_provider) || normalizedSourceFacility || null;
    const normalizedNotes = buildGuardianVaccinationNotes({
      notes: req.body?.notes,
      vaccinationCardUrl: req.body?.vaccination_card_url,
    });

    const existingResult = await pool.query(
      `
        SELECT *
        FROM immunization_records
        WHERE patient_id = $1
          AND vaccine_id = $2
          AND dose_no = $3
          AND is_active = true
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1
      `,
      [patientId, vaccineId, doseNo],
    );

    let persistedRecord = null;

    if (existingResult.rows.length > 0) {
      const existingRecord = existingResult.rows[0];
      const existingStatus = String(existingRecord.status || '').trim().toLowerCase();
      if (existingRecord.admin_date || existingStatus === 'completed') {
        return res.status(409).json({
          error: 'This dose is already marked as completed. Use the date edit action instead.',
        });
      }

      const updatedNotes = buildGuardianVaccinationNotes({
        existingNotes: existingRecord.notes,
        notes: normalizedNotes,
      });

      const updateResult = await pool.query(
        `
          UPDATE immunization_records
          SET admin_date = $1,
              status = 'completed',
              health_care_provider = COALESCE($2, health_care_provider),
              source_facility = COALESCE($3, source_facility),
              notes = $4,
              schedule_id = COALESCE(schedule_id, $5, $6),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $7
            AND is_active = true
          RETURNING *
        `,
        [
          completionValidation.normalizedAdminDate,
          normalizedProvider,
          normalizedSourceFacility,
          updatedNotes,
          parseInt(req.body?.schedule_id, 10) || null,
          completionValidation.scheduleId,
          existingRecord.id,
        ],
      );

      persistedRecord = updateResult.rows[0] || null;
    } else {
      const insertResult = await pool.query(
        `
          INSERT INTO immunization_records (
            patient_id,
            vaccine_id,
            dose_no,
            admin_date,
            administered_by,
            health_care_provider,
            notes,
            status,
            schedule_id,
            source_facility
          )
          VALUES ($1, $2, $3, $4, NULL, $5, $6, 'completed', $7, $8)
          RETURNING *
        `,
        [
          patientId,
          vaccineId,
          doseNo,
          completionValidation.normalizedAdminDate,
          normalizedProvider,
          normalizedNotes,
          parseInt(req.body?.schedule_id, 10) || completionValidation.scheduleId || null,
          normalizedSourceFacility,
        ],
      );

      persistedRecord = insertResult.rows[0] || null;
    }

    if (!persistedRecord) {
      return res.status(500).json({ error: 'Failed to save vaccination record' });
    }

    const updatedRecord = await getVaccinationRecord(persistedRecord.id);
    invalidateVaccinationDashboardCaches();
    socketService.broadcast('vaccination_updated', updatedRecord || persistedRecord);

    return res.status(existingResult.rows.length > 0 ? 200 : 201).json(updatedRecord || persistedRecord);
  } catch (error) {
    console.error('Error marking guardian vaccination as completed:', error);
    return res.status(500).json({ error: 'Failed to mark vaccination as completed' });
  }
});

router.put('/records/:id/guardian-date', async (req, res) => {
  try {
    if (!isGuardian(req)) {
      return res.status(403).json({ error: 'Only guardians can update administered dates here' });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid vaccination ID' });
    }

    const record = await getVaccinationRecord(id);
    if (!record) {
      return res.status(404).json({ error: 'Vaccination record not found' });
    }

    const guardianId = parseInt(req.user.guardian_id, 10);
    if (!guardianId || guardianId !== parseInt(record.owner_guardian_id, 10)) {
      return res.status(403).json({ error: 'Access denied for this vaccination record' });
    }

    const completionValidation = await validateVaccinationCompletionForPatient({
      patientId: record.patient_id,
      vaccineId: record.vaccine_id,
      doseNo: record.dose_no,
      adminDate: req.body?.admin_date,
      currentRecordId: id,
    });
    if (!completionValidation.valid) {
      return res.status(400).json({ error: completionValidation.error });
    }

    const normalizedSourceFacility = sanitizeOptionalText(req.body?.source_facility);
    const normalizedProvider =
      sanitizeOptionalText(req.body?.health_care_provider) ||
      normalizedSourceFacility ||
      sanitizeOptionalText(record.health_care_provider);
    const updatedNotes = buildGuardianVaccinationNotes({
      existingNotes: record.notes,
      notes: req.body?.notes,
      vaccinationCardUrl: req.body?.vaccination_card_url,
    });

    const result = await pool.query(
      `
        UPDATE immunization_records
        SET admin_date = $1,
            status = 'completed',
            health_care_provider = COALESCE($2, health_care_provider),
            source_facility = CASE
              WHEN $3::text IS NOT NULL THEN $3::text
              WHEN source_facility = $4 THEN NULL
              ELSE source_facility
            END,
            notes = $5,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
          AND is_active = true
        RETURNING *
      `,
      [
        completionValidation.normalizedAdminDate,
        normalizedProvider,
        normalizedSourceFacility,
        AUTO_AT_BIRTH_SOURCE,
        updatedNotes,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccination record not found' });
    }

    const updatedRecord = await getVaccinationRecord(id);
    invalidateVaccinationDashboardCaches();
    socketService.broadcast('vaccination_updated', updatedRecord || result.rows[0]);
    return res.json(updatedRecord || result.rows[0]);
  } catch (error) {
    console.error('Error updating guardian vaccination administration date:', error);
    return res.status(500).json({ error: 'Failed to update vaccination administration date' });
  }
});

// Update vaccination record (SYSTEM_ADMIN)
router.put('/records/:id', requirePermission('vaccination:update'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid vaccination ID' });
    }

    const existingRecord = await getVaccinationRecord(id);
    if (!existingRecord) {
      return res.status(404).json({ error: 'Vaccination record not found' });
    }

    await ensureVaccinationTrackingColumns();

    if (Object.prototype.hasOwnProperty.call(req.body, 'admin_date')) {
      const adminDateValidation = await validateAdministrationDateForPatient(
        existingRecord.patient_id,
        req.body.admin_date,
      );

      if (!adminDateValidation.valid) {
        return res.status(400).json({ error: adminDateValidation.error });
      }

      req.body.admin_date = adminDateValidation.normalizedAdminDate;
      if (!Object.prototype.hasOwnProperty.call(req.body, 'status')) {
        req.body.status = 'completed';
      }
    }

    const hasLotBatchInput = ['lot_batch_number', 'lot_number', 'batch_number'].some((field) =>
      hasOwn(req.body, field),
    );

    if (hasLotBatchInput) {
      const normalizedLotBatchNumber = resolveLotBatchValue(
        req.body.lot_batch_number,
        req.body.batch_number,
        req.body.lot_number,
      );
      req.body.batch_number = normalizedLotBatchNumber;
      req.body.lot_number = normalizedLotBatchNumber;
    }

    if (hasLotBatchInput || hasOwn(req.body, 'batch_id')) {
      const resolvedBatchId = await resolveBatchIdFromLotBatch({
        vaccineId: existingRecord.vaccine_id,
        batchId: req.body.batch_id,
        lotBatchNumber: resolveLotBatchValue(
          req.body.lot_batch_number,
          req.body.batch_number,
          req.body.lot_number,
        ),
        clinicId: req.user?.clinic_id || req.user?.facility_id || null,
      });

      if (resolvedBatchId) {
        req.body.batch_id = resolvedBatchId;
      }
    }

    const allowedFields = [
      'dose_no',
      'admin_date',
      'administered_by',
      'health_care_provider',
      'site_of_injection',
      'reactions',
      'next_due_date',
      'notes',
      'status',
      'batch_id',
      'batch_number',
      'lot_number',
      'schedule_id',
    ];

    const updates = [];
    const values = [];
    let paramIndex = 1;

    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(req.body[field]);
        paramIndex += 1;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body, 'admin_date') &&
      !Object.prototype.hasOwnProperty.call(req.body, 'source_facility') &&
      isAutoAtBirthRecord(existingRecord)
    ) {
      updates.push('source_facility = NULL');
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await pool.query(
      `
        UPDATE immunization_records
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
          AND is_active = true
        RETURNING *
      `,
      values,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccination record not found' });
    }

    const updatedRecord = await getVaccinationRecord(id);
    invalidateVaccinationDashboardCaches();
    socketService.broadcast('vaccination_updated', updatedRecord || result.rows[0]);
    res.json(updatedRecord || result.rows[0]);
  } catch (error) {
    console.error('Error updating vaccination record:', error);
    res.status(500).json({ error: 'Failed to update vaccination record' });
  }
});

// Backward compatibility aliases
router.post('/', requirePermission('vaccination:create'), async (req, res, next) => {
  req.url = '/records';
  next();
});

router.put('/:id(\\d+)', requirePermission('vaccination:update'), async (req, res, next) => {
  req.url = `/records/${req.params.id}`;
  next();
});

// Get vaccination by ID (SYSTEM_ADMIN any, GUARDIAN own)
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid vaccination ID. ID must be a number.' });
    }

    const record = await getVaccinationRecord(id);
    if (!record) {
      return res.status(404).json({ error: 'Vaccination record not found' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      if (!guardianId || guardianId !== parseInt(record.owner_guardian_id, 10)) {
        return res.status(403).json({ error: 'Access denied for this vaccination record' });
      }
    }

    res.json(record);
  } catch (error) {
    console.error('Error fetching vaccination:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination record' });
  }
});

// Get vaccinations by patient ID
router.get('/patient/:patientId', async (req, res) => {
  try {
    await ensureVaccinationTrackingColumns();
    const patientId = parseInt(req.params.patientId, 10);
    if (Number.isNaN(patientId)) {
      return res.status(400).json({ error: 'Invalid patient ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, patientId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const { providerJoinsSql, providerValueExpression } = await getProviderSqlFragments();
    const resolvedBatchNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'batch_number');
    const resolvedLotNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'lot_number');

    const result = await pool.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          v.code as vaccine_code,
          ${resolvedBatchNumberExpression} as resolved_batch_number,
          ${resolvedLotNumberExpression} as resolved_lot_number,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN patients p ON p.id = ir.patient_id
        LEFT JOIN vaccine_batches batch ON batch.id = ir.batch_id
        ${providerJoinsSql}
        WHERE ir.patient_id = $1
          AND ir.is_active = true
          AND p.is_active = true
        ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC
      `,
      [patientId],
    );

    res.json(result.rows.map(normalizeVaccinationProvider));
  } catch (error) {
    console.error('Error fetching patient vaccinations:', error);
    res.status(500).json({ error: 'Failed to fetch patient vaccinations' });
  }
});

// Delete vaccination record (SYSTEM_ADMIN)
router.delete('/:id(\\d+)', requirePermission('vaccination:delete'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid vaccination ID' });
    }

    const result = await pool.query(
      `
        UPDATE immunization_records
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND is_active = true
        RETURNING id
      `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccination record not found' });
    }

    invalidateVaccinationDashboardCaches();
    socketService.broadcast('vaccination_deleted', { id });
    res.json({ message: 'Vaccination record deleted successfully' });
  } catch (error) {
    console.error('Error deleting vaccination:', error);
    res.status(500).json({ error: 'Failed to delete vaccination record' });
  }
});

// Get vaccination history for a patient
router.get('/patient/:patientId/history', async (req, res) => {
  try {
    await ensureVaccinationTrackingColumns();
    const patientId = parseInt(req.params.patientId, 10);
    if (Number.isNaN(patientId)) {
      return res.status(400).json({ error: 'Invalid patient ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, patientId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const { providerJoinsSql, providerValueExpression } = await getProviderSqlFragments();
    const resolvedBatchNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'batch_number');
    const resolvedLotNumberExpression = buildResolvedLotBatchExpression('ir', 'batch', 'lot_number');

    const records = await pool.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          v.code as vaccine_code,
          ${resolvedBatchNumberExpression} as resolved_batch_number,
          ${resolvedLotNumberExpression} as resolved_lot_number,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN patients p ON p.id = ir.patient_id
        LEFT JOIN vaccine_batches batch ON batch.id = ir.batch_id
        ${providerJoinsSql}
        WHERE ir.patient_id = $1
          AND ir.is_active = true
          AND p.is_active = true
        ORDER BY ir.admin_date ASC NULLS LAST, ir.created_at ASC
      `,
      [patientId],
    );

    const patient = await pool.query(
      `
        SELECT
          p.id,
          p.control_number,
          p.first_name,
          p.last_name,
          p.dob,
          g.name as guardian_name,
          g.phone as guardian_phone,
          g.email as guardian_email
        FROM patients p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE p.id = $1
          AND p.is_active = true
        LIMIT 1
      `,
      [patientId],
    );

    if (patient.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    let nextVaccine = null;
    try {
      nextVaccine = await reminderService.getNextScheduledVaccine(patientId);
    } catch {
      console.error('Error getting next vaccine:');
    }

    res.json({
      patient: patient.rows[0],
      vaccinationHistory: records.rows.map(normalizeVaccinationProvider),
      nextScheduledVaccine: nextVaccine,
    });
  } catch (error) {
    console.error('Error fetching vaccination history:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination history' });
  }
});

// Get vaccination schedule for a patient
router.get('/patient/:patientId/schedule', async (req, res) => {
  try {
    const patientId = parseInt(req.params.patientId, 10);
    if (Number.isNaN(patientId)) {
      return res.status(400).json({ error: 'Invalid patient ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, patientId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const records = await pool.query(
      `
        SELECT id, vaccine_id, dose_no, admin_date, status
        FROM immunization_records
        WHERE patient_id = $1
          AND is_active = true
      `,
      [patientId],
    );

    const patient = await pool.query(
      `
        SELECT dob
        FROM patients
        WHERE id = $1
          AND is_active = true
        LIMIT 1
      `,
      [patientId],
    );

    if (patient.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const dob = new Date(patient.rows[0].dob);
    const today = new Date();
    const ageInMonths =
      (today.getFullYear() - dob.getFullYear()) * 12 + (today.getMonth() - dob.getMonth());

    const completedVaccines = {};
    const completedDoseMap = new Map();
    records.rows.forEach((record) => {
      const normalizedStatus = String(record.status || '').trim().toLowerCase();
      const isCompleted = Boolean(record.admin_date) || normalizedStatus === 'completed';
      if (!isCompleted) {
        return;
      }

      const vaccineId = parseInt(record.vaccine_id, 10);
      const doseNumber = parseInt(record.dose_no, 10);
      completedVaccines[vaccineId] = Math.max(completedVaccines[vaccineId] || 0, doseNumber);
      completedDoseMap.set(`${vaccineId}:${doseNumber}`, record);
    });

    const schedule = await pool.query(
      `
        SELECT *
        FROM vaccination_schedules
        WHERE is_active = true
          AND vaccine_name = ANY($1::text[])
        ORDER BY age_in_months ASC
      `,
      [getOperationalVaccineSourceNames()],
    );

    const vaccinationStatus = schedule.rows.map((scheduleItem) => {
      const dosesCompleted = completedVaccines[scheduleItem.vaccine_id] || 0;
      const doseNumber = parseInt(scheduleItem.dose_number, 10);
      const matchingRecord = completedDoseMap.get(`${scheduleItem.vaccine_id}:${doseNumber}`) || null;
      const isComplete = Boolean(matchingRecord);
      const isNextDueDose = doseNumber === dosesCompleted + 1;

      const dueDate = new Date(dob);
      dueDate.setMonth(dueDate.getMonth() + scheduleItem.age_in_months);

      return {
        vaccineName: scheduleItem.vaccine_name,
        vaccineId: scheduleItem.vaccine_id,
        doseNumber: doseNumber,
        totalDoses: scheduleItem.total_doses,
        dosesCompleted,
        isComplete,
        isNextDueDose,
        ageMonths: scheduleItem.age_in_months,
        description: scheduleItem.description,
        dueDate: isComplete ? null : dueDate,
        adminDate: matchingRecord?.admin_date || null,
        recordId: matchingRecord?.id || null,
        status: isComplete
          ? 'completed'
          : !isNextDueDose
            ? 'upcoming'
            : dueDate < today
              ? 'overdue'
              : 'pending',
        isOverdue: !isComplete && isNextDueDose && dueDate < today,
      };
    });

    res.json({
      patientId,
      dateOfBirth: dob,
      ageInMonths,
      vaccinationStatus,
    });
  } catch (error) {
    console.error('Error fetching vaccination schedule:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination schedule' });
  }
});

// Get eligible vaccines for an infant
router.get('/eligible/:infantId', requirePermission('dashboard:view'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    // Check guardian ownership if guardian
    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const result = await vaccineEligibilityService.getEligibleVaccines(infantId);

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching eligible vaccines:', error);
    res.status(500).json({ error: 'Failed to fetch eligible vaccines' });
  }
});

// Get next dose info for a specific vaccine
router.get('/next-dose/:infantId/:vaccineId', requirePermission('dashboard:view'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    const vaccineId = parseInt(req.params.vaccineId, 10);

    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (Number.isNaN(vaccineId)) {
      return res.status(400).json({ error: 'Invalid vaccine ID' });
    }

    // Check guardian ownership if guardian
    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const result = await vaccineEligibilityService.getNextDoseInfo(infantId, vaccineId);

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching next dose info:', error);
    res.status(500).json({ error: 'Failed to fetch next dose info' });
  }
});

// Get vaccine readiness for a specific vaccine
router.get('/readiness/:infantId/:vaccineId', requirePermission('dashboard:view'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    const vaccineId = parseInt(req.params.vaccineId, 10);

    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (Number.isNaN(vaccineId)) {
      return res.status(400).json({ error: 'Invalid vaccine ID' });
    }

    // Check guardian ownership if guardian
    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const result = await vaccineEligibilityService.getVaccineReadiness(infantId, vaccineId);

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching vaccine readiness:', error);
    res.status(500).json({ error: 'Failed to fetch vaccine readiness' });
  }
});

// Check contraindications for a vaccine
router.get('/contraindications/:infantId/:vaccineId', requirePermission('dashboard:view'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    const vaccineId = parseInt(req.params.vaccineId, 10);

    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (Number.isNaN(vaccineId)) {
      return res.status(400).json({ error: 'Invalid vaccine ID' });
    }

    // Validate patient exists using canonical service
    const patient = await patientService.getPatientById(infantId);
    if (!patient) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    const result = await vaccineEligibilityService.checkContraindications(infantId, vaccineId);

    res.json(result);
  } catch (error) {
    console.error('Error checking contraindications:', error);
    res.status(500).json({ error: 'Failed to check contraindications' });
  }
});

// ============================================
// DYNAMIC IMMUNIZATION SCHEDULE ENDPOINTS
// ============================================

// Get dynamic schedule for infant
router.get('/schedule/:infantId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const result = await immunizationScheduleService.getInfantSchedule(infantId);

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching dynamic schedule:', error);
    res.status(500).json({ error: 'Failed to fetch dynamic schedule' });
  }
});

// Get overdue vaccines for infant
router.get('/overdue/:infantId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const result = await immunizationScheduleService.getOverdueVaccines(infantId);

    res.json(result);
  } catch (error) {
    console.error('Error fetching overdue vaccines:', error);
    res.status(500).json({ error: 'Failed to fetch overdue vaccines' });
  }
});

// Get upcoming vaccines for infant
router.get('/upcoming/:infantId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const days = req.query.days ? parseInt(req.query.days, 10) : 14;
    const result = await immunizationScheduleService.getUpcomingVaccines(infantId, days);

    res.json(result);
  } catch (error) {
    console.error('Error fetching upcoming vaccines:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming vaccines' });
  }
});

// Get catch-up schedule for behind infants
router.get('/catchup/:infantId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const result = await immunizationScheduleService.getCatchUpSchedule(infantId);

    res.json(result);
  } catch (error) {
    console.error('Error fetching catch-up schedule:', error);
    res.status(500).json({ error: 'Failed to fetch catch-up schedule' });
  }
});

// Get schedule status
router.get('/status/:infantId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const result = await immunizationScheduleService.getScheduleStatus(infantId);

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching schedule status:', error);
    res.status(500).json({ error: 'Failed to fetch schedule status' });
  }
});

// Get extended schedule (beyond 12 months)
router.get('/extended/:infantId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const result = await immunizationScheduleService.getExtendedSchedule(infantId);

    res.json(result);
  } catch (error) {
    console.error('Error fetching extended schedule:', error);
    res.status(500).json({ error: 'Failed to fetch extended schedule' });
  }
});

module.exports = router;
