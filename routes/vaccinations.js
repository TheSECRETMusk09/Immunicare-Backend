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

const reminderService = new VaccinationReminderService();

router.use(authenticateToken);

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
  const result = await pool.query(
    `
      SELECT
        ir.*,
        p.guardian_id AS owner_guardian_id,
        p.control_number AS control_number,
        p.first_name AS patient_first_name,
        p.last_name AS patient_last_name,
        v.name as vaccine_name,
        v.code as vaccine_code
      FROM immunization_records ir
      LEFT JOIN patients p ON p.id = ir.patient_id
      JOIN vaccines v ON v.id = ir.vaccine_id
      WHERE ir.id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] || null;
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

    const result = await pool.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          v.code as vaccine_code,
          u.username as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN users u ON u.id = ir.administered_by
        WHERE ir.patient_id = $1
          AND ir.is_active = true
        ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC
      `,
      [infantId],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching infant vaccination records:', error);
    res.status(500).json({ error: 'Failed to fetch infant vaccination records' });
  }
});

// Get all vaccination records (SYSTEM_ADMIN)
router.get('/records', requirePermission('vaccination:view'), async (req, res) => {
  try {
    const limit = sanitizeLimit(req.query.limit, 200, 500);
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
          g.phone as guardian_phone
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN patients p ON p.id = ir.patient_id
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE ir.is_active = true
        ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vaccination records:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination records' });
  }
});

// Get vaccines (both roles)
router.get('/vaccines', requirePermission('dashboard:view'), async (_req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          name,
          code,
          description,
          manufacturer,
          doses_required,
          recommended_age,
          is_active,
          created_at,
          updated_at
        FROM vaccines
        WHERE is_active = true
        ORDER BY name ASC
      `,
    );

    res.json(result.rows);
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
        ORDER BY age_in_months ASC, vaccine_name ASC
      `,
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
        ORDER BY vb.expiry_date ASC
      `,
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
    const { vaccine_id } = req.query;

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
    `;

    const params = [];
    let paramCount = 1;

    // Filter by specific vaccine if provided
    if (vaccine_id) {
      query += ` AND vb.vaccine_id = ${paramCount}`;
      params.push(parseInt(vaccine_id, 10));
    }

    query += ` ORDER BY vb.expiry_date ASC`;

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
      'SELECT * FROM vaccination_schedules WHERE is_active = true ORDER BY age_in_months ASC',
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
      site_of_injection,
      reactions,
      next_due_date,
      notes,
      status,
      batch_id,
      schedule_id,
    } = req.body;

    if (!patient_id || !vaccine_id || !dose_no || !admin_date) {
      return res.status(400).json({
        error: 'Missing required fields: patient_id, vaccine_id, dose_no, and admin_date are required',
      });
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
            site_of_injection,
            reactions,
            next_due_date,
            notes,
            status,
            batch_id,
            schedule_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *
        `,
        [
          patient_id,
          vaccine_id,
          dose_no,
          admin_date,
          administered_by || req.user.id,
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
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating vaccination record:', error);
    res.status(500).json({ error: 'Failed to create vaccination record' });
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

    const result = await pool.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          v.code as vaccine_code,
          u.username as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN users u ON u.id = ir.administered_by
        WHERE ir.patient_id = $1
          AND ir.is_active = true
        ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC
      `,
      [patientId],
    );

    res.json(result.rows);
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

    const records = await pool.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          v.code as vaccine_code
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
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
      vaccinationHistory: records.rows,
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
        ORDER BY age_in_months ASC
      `,
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

module.exports = router;
