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
  APPROVED_VACCINE_NAMES,
  getApprovedVaccines,
  validateApprovedVaccine,
  validateApprovedVaccineBrand,
} = require('../utils/approvedVaccines');
const vaccineEligibilityService = require('../services/vaccineEligibilityService');
const immunizationScheduleService = require('../services/immunizationScheduleService');

const reminderService = new VaccinationReminderService();

router.use(authenticateToken);

const PROVIDER_FALLBACK_LABEL = 'Provider unavailable';
const PROVIDER_FALLBACK_LABEL_SQL = PROVIDER_FALLBACK_LABEL.replace(/'/g, '\'\'');
const PROVIDER_NAME_COLUMNS = ['full_name', 'name', 'username', 'email'];

let providerSchemaPromise = null;

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

  const finalProviderName = manualProviderName || userProviderName;

  return {
    ...record,
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

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

const guardianOwnsInfant = async (guardianId, infantId) => {
  const result = await pool.query(
    `
      SELECT id
      FROM patients
      WHERE id = $1 AND guardian_id = $2 AND is_active = true
      LIMIT 1
    `,
    [infantId, guardianId],
  );

  return result.rows.length > 0;
};

const getVaccinationRecord = async (id) => {
  const { providerJoinsSql, providerValueExpression } = await getProviderSqlFragments();

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
        ${providerValueExpression} AS provider_name,
        ${providerValueExpression} AS administered_by_name
      FROM immunization_records ir
      LEFT JOIN patients p ON p.id = ir.patient_id
      JOIN vaccines v ON v.id = ir.vaccine_id
      ${providerJoinsSql}
      WHERE ir.id = $1
      LIMIT 1
    `,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return normalizeVaccinationProvider(result.rows[0]);
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

    const result = await pool.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          v.code as vaccine_code,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        ${providerJoinsSql}
        WHERE ir.patient_id = $1
          AND ir.is_active = true
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
router.get('/records', requirePermission('vaccination:view'), async (req, res) => {
  try {
    const limit = sanitizeLimit(req.query.limit, 200, 500);
    const { providerJoinsSql, providerValueExpression } = await getProviderSqlFragments();

    const result = await pool.query(
      `
        SELECT
          ir.id,
          ir.patient_id,
          p.control_number,
          ir.vaccine_id,
          ir.dose_no,
          ir.admin_date,
          ir.site_of_injection,
          ir.reactions,
          ir.next_due_date,
          ir.notes,
          ir.status,
          ir.created_at,
          ir.updated_at,
          v.name as vaccine_name,
          v.code as vaccine_code,
          p.first_name as patient_first_name,
          p.last_name as patient_last_name,
          p.dob as patient_dob,
          g.name as guardian_name,
          g.phone as guardian_phone,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN patients p ON p.id = ir.patient_id
        LEFT JOIN guardians g ON g.id = p.guardian_id
        ${providerJoinsSql}
        WHERE ir.is_active = true
        ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    res.json(result.rows.map(normalizeVaccinationProvider));
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
router.get('/schedules', requirePermission('dashboard:view'), async (_req, res) => {
  try {
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
        WHERE is_active = true
          AND vaccine_name = ANY($1::text[])
        ORDER BY age_in_months ASC, vaccine_name ASC
      `,
      [APPROVED_VACCINE_NAMES],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vaccination schedules:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination schedules' });
  }
});

// Get vaccination batches (SYSTEM_ADMIN)
router.get('/batches', requirePermission('inventory:view'), async (_req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        vb.id,
        vb.lot_no,
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
      [APPROVED_VACCINE_NAMES],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vaccination batches:', error);
    res.json([]);
  }
});

// Get valid vaccine inventory for dropdown (not expired, stock > 0, active)
router.get('/inventory/valid', requirePermission('vaccination:create'), async (req, res) => {
  try {
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
          'Cross-facility vaccine inventory access is not allowed. Use your assigned Barangay San Nicolas Health Center scope.',
      });
    }

    const effectiveClinicId = requestedClinicId || scopedClinicId;
    if (!effectiveClinicId) {
      return res.status(400).json({
        error:
          'clinic_id scope is required to load valid vaccine inventory for Barangay San Nicolas Health Center',
      });
    }

    let query = `
      SELECT
        vb.id as batch_id,
        vb.lot_no,
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

    const params = [effectiveClinicId, APPROVED_VACCINE_NAMES];
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

    const infantResult = await pool.query(
      `
        SELECT dob
        FROM patients
        WHERE id = $1 AND is_active = true
        LIMIT 1
      `,
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    const dob = new Date(infantResult.rows[0].dob);

    const recordsResult = await pool.query(
      `
        SELECT vaccine_id, MAX(dose_no) as dose_no
        FROM immunization_records
        WHERE patient_id = $1
          AND is_active = true
        GROUP BY vaccine_id
      `,
      [infantId],
    );

    const completedVaccines = {};
    recordsResult.rows.forEach((record) => {
      completedVaccines[record.vaccine_id] = parseInt(record.dose_no, 10);
    });

    const scheduleResult = await pool.query(
      `SELECT *
       FROM vaccination_schedules
       WHERE is_active = true
         AND vaccine_name = ANY($1::text[])
       ORDER BY age_in_months ASC`,
      [APPROVED_VACCINE_NAMES],
    );

    const schedules = scheduleResult.rows.map((schedule) => {
      const dosesCompleted = completedVaccines[schedule.vaccine_id] || 0;
      const isComplete = dosesCompleted >= schedule.total_doses;

      const dueDate = new Date(dob);
      dueDate.setMonth(dueDate.getMonth() + schedule.age_in_months);

      return {
        id: schedule.id,
        vaccineId: schedule.vaccine_id,
        vaccineName: schedule.vaccine_name,
        doseNumber: schedule.dose_number,
        totalDoses: schedule.total_doses,
        dosesCompleted,
        isComplete,
        ageMonths: schedule.age_in_months,
        description: schedule.description,
        dueDate: isComplete ? null : dueDate.toISOString(),
        isOverdue: !isComplete && dueDate < new Date(),
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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const duplicateCheck = await client.query(
        `
           SELECT id
           FROM immunization_records
           WHERE patient_id = $1
             AND vaccine_id = $2
             AND dose_no = $3
             AND COALESCE(schedule_id, 0) = COALESCE($4, 0)
             AND is_active = true
           LIMIT 1
         `,
        [patient_id, vaccine_id, dose_no, schedule_id || null],
      );

      if (duplicateCheck.rows.length > 0) {
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
             schedule_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING *
         `,
        [
          patient_id,
          vaccine_id,
          dose_no,
          admin_date,
          administered_by || req.user.id,
          health_care_provider || null,
          site_of_injection || null,
          reactions || null,
          next_due_date || null,
          notes || null,
          status || 'completed',
          batch_id || null,
          schedule_id || null,
        ],
      );

      if (batch_id) {
        await client.query(
          `
             UPDATE vaccine_batches
             SET qty_current = qty_current - 1
             WHERE id = $1
           `,
          [batch_id],
        );
      }

      await client.query('COMMIT');

      try {
        await reminderService.sendFirstVaccineNotification(patient_id, vaccine_id, admin_date);
      } catch (notificationError) {
        console.error('Error sending vaccine notification:', notificationError);
      }

      socketService.broadcast('vaccination_created', insertResult.rows[0]);
      res.status(201).json(insertResult.rows[0]);
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

// Update vaccination record (SYSTEM_ADMIN)
router.put('/records/:id', requirePermission('vaccination:update'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid vaccination ID' });
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

    socketService.broadcast('vaccination_updated', result.rows[0]);
    res.json(result.rows[0]);
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

    const result = await pool.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          v.code as vaccine_code,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        ${providerJoinsSql}
        WHERE ir.patient_id = $1
          AND ir.is_active = true
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

    const records = await pool.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          v.code as vaccine_code,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        ${providerJoinsSql}
        WHERE ir.patient_id = $1
          AND ir.is_active = true
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
        SELECT vaccine_id, dose_no
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
    records.rows.forEach((record) => {
      if (!completedVaccines[record.vaccine_id]) {
        completedVaccines[record.vaccine_id] = 0;
      }
      if (record.dose_no > completedVaccines[record.vaccine_id]) {
        completedVaccines[record.vaccine_id] = record.dose_no;
      }
    });

    const schedule = await pool.query(
      `
        SELECT *
        FROM vaccination_schedules
        WHERE is_active = true
          AND vaccine_name = ANY($1::text[])
        ORDER BY age_in_months ASC
      `,
      [APPROVED_VACCINE_NAMES],
    );

    const vaccinationStatus = schedule.rows.map((scheduleItem) => {
      const dosesCompleted = completedVaccines[scheduleItem.vaccine_id] || 0;
      const isComplete = dosesCompleted >= scheduleItem.total_doses;

      const dueDate = new Date(dob);
      dueDate.setMonth(dueDate.getMonth() + scheduleItem.age_in_months);

      return {
        vaccineName: scheduleItem.vaccine_name,
        doseNumber: scheduleItem.dose_number,
        totalDoses: scheduleItem.total_doses,
        dosesCompleted,
        isComplete,
        ageMonths: scheduleItem.age_in_months,
        description: scheduleItem.description,
        dueDate: isComplete ? null : dueDate,
        isOverdue: !isComplete && dueDate < today,
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
