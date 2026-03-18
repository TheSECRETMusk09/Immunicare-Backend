const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');

router.use(authenticateToken);

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

// Base route - SYSTEM_ADMIN summary view
router.get('/', requirePermission('dashboard:analytics'), async (_req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          pg.id,
          pg.patient_id,
          p.control_number,
          pg.measurement_date,
          pg.age_in_days,
          pg.weight_kg,
          pg.length_cm,
          pg.head_circumference_cm,
          p.first_name,
          p.last_name
        FROM patient_growth pg
        LEFT JOIN patients p ON p.id = pg.patient_id
        WHERE pg.is_active = true
        ORDER BY pg.measurement_date DESC
        LIMIT 100
      `,
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching growth records:', error);
    res.json([]);
  }
});

// Get growth records for a patient
router.get('/infant/:patientId', async (req, res) => {
  try {
    const patientId = parseInt(req.params.patientId, 10);
    if (Number.isNaN(patientId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
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
          pg.*,
          p.control_number,
          u.username as measured_by_username
        FROM patient_growth pg
        LEFT JOIN patients p ON p.id = pg.patient_id
        LEFT JOIN users u ON u.id = pg.measured_by
        WHERE pg.patient_id = $1
          AND pg.is_active = true
        ORDER BY pg.measurement_date DESC, pg.created_at DESC
      `,
      [patientId],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching growth records:', error);
    res.status(500).json({ error: 'Failed to fetch growth records' });
  }
});

// Get specific growth record
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid growth record ID' });
    }

    const result = await pool.query(
      `
        SELECT
          pg.*,
          p.first_name,
          p.last_name,
          p.control_number,
          p.guardian_id,
          u.username as measured_by_username
        FROM patient_growth pg
        JOIN patients p ON p.id = pg.patient_id
        LEFT JOIN users u ON u.id = pg.measured_by
        WHERE pg.id = $1
          AND pg.is_active = true
      `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Growth record not found' });
    }

    const record = result.rows[0];
    if (isGuardian(req) && parseInt(req.user.guardian_id, 10) !== parseInt(record.guardian_id, 10)) {
      return res.status(403).json({ error: 'Access denied for this growth record' });
    }

    res.json(record);
  } catch (error) {
    console.error('Error fetching growth record:', error);
    res.status(500).json({ error: 'Failed to fetch growth record' });
  }
});

// Create new growth record (SYSTEM_ADMIN)
router.post('/', requirePermission('patient:update'), async (req, res) => {
  try {
    const {
      patient_id,
      measurement_date,
      age_in_days,
      weight_kg,
      length_cm,
      head_circumference_cm,
      bmi,
      weight_for_age_percentile,
      length_for_age_percentile,
      weight_for_length_percentile,
      head_circumference_percentile,
      weight_z_score,
      length_z_score,
      bmi_z_score,
      head_circumference_z_score,
      measurement_method,
      measured_by,
      measurement_location,
      notes,
      clothing_weight_kg,
      diaper_weight_kg,
      measurement_time,
      feeding_status,
      health_status,
      temperature_celsius,
      heart_rate,
      respiratory_rate,
      development_milestones,
      parent_concerns,
      healthcare_worker_notes,
      follow_up_required,
      follow_up_date,
      follow_up_reason,
    } = req.body;

    if (!patient_id || !measurement_date || age_in_days === undefined) {
      return res.status(400).json({
        error: 'patient_id, measurement_date, and age_in_days are required',
      });
    }

    let calculatedBMI = bmi;
    if (!calculatedBMI && weight_kg && length_cm) {
      const heightInMeters = length_cm / 100;
      calculatedBMI = weight_kg / (heightInMeters * heightInMeters);
    }

    let calculatedWeightZ = weight_z_score;
    let calculatedLengthZ = length_z_score;
    let calculatedBMI_Z = bmi_z_score;
    const calculatedHeadZ = head_circumference_z_score;

    if (!calculatedWeightZ && weight_kg) {
      calculatedWeightZ = (weight_kg - 7.0) / 1.0;
    }

    if (!calculatedLengthZ && length_cm) {
      calculatedLengthZ = (length_cm - 70.0) / 3.0;
    }

    if (!calculatedBMI_Z && calculatedBMI) {
      calculatedBMI_Z = (calculatedBMI - 16.5) / 1.5;
    }

    const insertResult = await pool.query(
      `
        INSERT INTO patient_growth (
          patient_id,
          measurement_date,
          age_in_days,
          weight_kg,
          length_cm,
          head_circumference_cm,
          bmi,
          weight_for_age_percentile,
          length_for_age_percentile,
          weight_for_length_percentile,
          head_circumference_percentile,
          weight_z_score,
          length_z_score,
          bmi_z_score,
          head_circumference_z_score,
          measurement_method,
          measured_by,
          measurement_location,
          notes,
          clothing_weight_kg,
          diaper_weight_kg,
          measurement_time,
          feeding_status,
          health_status,
          temperature_celsius,
          heart_rate,
          respiratory_rate,
          development_milestones,
          parent_concerns,
          healthcare_worker_notes,
          follow_up_required,
          follow_up_date,
          follow_up_reason,
          created_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
        )
        RETURNING *
      `,
      [
        patient_id,
        measurement_date,
        age_in_days,
        weight_kg,
        length_cm,
        head_circumference_cm,
        calculatedBMI,
        weight_for_age_percentile,
        length_for_age_percentile,
        weight_for_length_percentile,
        head_circumference_percentile,
        calculatedWeightZ,
        calculatedLengthZ,
        calculatedBMI_Z,
        calculatedHeadZ,
        measurement_method || 'digital_scale',
        measured_by || req.user.id,
        measurement_location || 'Health Center',
        notes,
        clothing_weight_kg || 0,
        diaper_weight_kg || 0,
        measurement_time || new Date().toTimeString().split(' ')[0],
        feeding_status,
        health_status || 'well',
        temperature_celsius,
        heart_rate,
        respiratory_rate,
        JSON.stringify(development_milestones || []),
        parent_concerns,
        healthcare_worker_notes,
        follow_up_required || false,
        follow_up_date,
        follow_up_reason,
        req.user.id,
      ],
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (error) {
    console.error('Error creating growth record:', error);
    res.status(500).json({ error: 'Failed to create growth record' });
  }
});

// Update growth record (SYSTEM_ADMIN)
router.put('/:id(\\d+)', requirePermission('patient:update'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid growth record ID' });
    }

    const updateData = req.body;

    const allowedFields = [
      'measurement_date',
      'weight_kg',
      'length_cm',
      'head_circumference_cm',
      'bmi',
      'weight_for_age_percentile',
      'length_for_age_percentile',
      'weight_for_length_percentile',
      'head_circumference_percentile',
      'weight_z_score',
      'length_z_score',
      'bmi_z_score',
      'head_circumference_z_score',
      'measurement_method',
      'measurement_location',
      'notes',
      'clothing_weight_kg',
      'diaper_weight_kg',
      'measurement_time',
      'feeding_status',
      'health_status',
      'temperature_celsius',
      'heart_rate',
      'respiratory_rate',
      'development_milestones',
      'parent_concerns',
      'healthcare_worker_notes',
      'follow_up_required',
      'follow_up_date',
      'follow_up_reason',
    ];

    const updates = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updateData).forEach((key) => {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = $${paramIndex}`);
        values.push(key === 'development_milestones' ? JSON.stringify(updateData[key]) : updateData[key]);
        paramIndex += 1;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.push(`updated_by = $${paramIndex}`);
    values.push(req.user.id);
    paramIndex += 1;

    updates.push('updated_at = CURRENT_TIMESTAMP');

    values.push(id);
    const query = `
      UPDATE patient_growth
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
        AND is_active = true
      RETURNING *
    `;

    const updateResult = await pool.query(query, values);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Growth record not found' });
    }

    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error('Error updating growth record:', error);
    res.status(500).json({ error: 'Failed to update growth record' });
  }
});

// Delete growth record (SYSTEM_ADMIN soft delete)
router.delete('/:id(\\d+)', requirePermission('patient:update'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid growth record ID' });
    }

    const result = await pool.query(
      `
        UPDATE patient_growth
        SET is_active = false,
            updated_by = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
          AND is_active = true
        RETURNING id
      `,
      [req.user.id, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Growth record not found' });
    }

    res.json({ message: 'Growth record deleted successfully' });
  } catch (error) {
    console.error('Error deleting growth record:', error);
    res.status(500).json({ error: 'Failed to delete growth record' });
  }
});

// Get growth statistics for a patient
router.get('/infant/:patientId/stats', async (req, res) => {
  try {
    const patientId = parseInt(req.params.patientId, 10);
    if (Number.isNaN(patientId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
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
          COUNT(*) as total_records,
          MAX(measurement_date) as latest_measurement,
          MIN(measurement_date) as first_measurement,
          AVG(weight_kg) as avg_weight,
          AVG(length_cm) as avg_length,
          AVG(head_circumference_cm) as avg_head_circ,
          MAX(weight_kg) as max_weight,
          MIN(weight_kg) as min_weight,
          MAX(length_cm) as max_length,
          MIN(length_cm) as min_length
        FROM patient_growth
        WHERE patient_id = $1
          AND is_active = true
      `,
      [patientId],
    );

    const stats = result.rows[0];

    const ageResult = await pool.query('SELECT dob FROM patients WHERE id = $1 LIMIT 1', [patientId]);

    if (ageResult.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const dob = new Date(ageResult.rows[0].dob);
    const now = new Date();
    const ageInDays = Math.floor((now - dob) / (1000 * 60 * 60 * 24));
    const ageInMonths = Math.floor(ageInDays / 30.44);

    res.json({
      ...stats,
      current_age_days: ageInDays,
      current_age_months: ageInMonths,
      total_records: parseInt(stats.total_records, 10),
      avg_weight: stats.avg_weight ? parseFloat(stats.avg_weight).toFixed(2) : null,
      avg_length: stats.avg_length ? parseFloat(stats.avg_length).toFixed(1) : null,
      avg_head_circ: stats.avg_head_circ ? parseFloat(stats.avg_head_circ).toFixed(1) : null,
      max_weight: stats.max_weight ? parseFloat(stats.max_weight).toFixed(2) : null,
      min_weight: stats.min_weight ? parseFloat(stats.min_weight).toFixed(2) : null,
      max_length: stats.max_length ? parseFloat(stats.max_length).toFixed(1) : null,
      min_length: stats.min_length ? parseFloat(stats.min_length).toFixed(1) : null,
    });
  } catch (error) {
    console.error('Error fetching growth statistics:', error);
    res.status(500).json({ error: 'Failed to fetch growth statistics' });
  }
});

// Get growth chart data for plotting
router.get('/infant/:patientId/chart', async (req, res) => {
  try {
    const patientId = parseInt(req.params.patientId, 10);
    if (Number.isNaN(patientId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
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
          measurement_date,
          age_in_days,
          weight_kg,
          length_cm,
          head_circumference_cm,
          bmi,
          weight_z_score,
          length_z_score,
          bmi_z_score
        FROM patient_growth
        WHERE patient_id = $1
          AND is_active = true
        ORDER BY measurement_date ASC
      `,
      [patientId],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching growth chart data:', error);
    res.status(500).json({ error: 'Failed to fetch growth chart data' });
  }
});

// Backward compatibility aliases - map /records routes to the existing handlers
// This ensures the frontend API calls work correctly

// GET /records - List all growth records
router.get('/records', requirePermission('dashboard:analytics'), async (_req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          pg.id,
          pg.patient_id,
          p.control_number,
          pg.measurement_date,
          pg.age_in_days,
          pg.weight_kg,
          pg.length_cm,
          pg.head_circumference_cm,
          p.first_name,
          p.last_name
        FROM patient_growth pg
        LEFT JOIN patients p ON p.id = pg.patient_id
        WHERE pg.is_active = true
        ORDER BY pg.measurement_date DESC
        LIMIT 100
      `,
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching growth records:', error);
    res.json([]);
  }
});

// POST /records - Create new growth record
router.post('/records', requirePermission('patient:update'), async (req, res) => {
  try {
    const {
      patient_id,
      infant_id, // Support both patient_id and infant_id from frontend
      measurement_date,
      age_in_days,
      weight_kg,
      length_cm,
      head_circumference_cm,
      bmi,
      weight_for_age_percentile,
      length_for_age_percentile,
      weight_for_length_percentile,
      head_circumference_percentile,
      weight_z_score,
      length_z_score,
      bmi_z_score,
      head_circumference_z_score,
      measurement_method,
      measured_by,
      measurement_location,
      notes,
      clothing_weight_kg,
      diaper_weight_kg,
      measurement_time,
      feeding_status,
      health_status,
      temperature_celsius,
      heart_rate,
      respiratory_rate,
      development_milestones,
      parent_concerns,
      healthcare_worker_notes,
      follow_up_required,
      follow_up_date,
      follow_up_reason,
    } = req.body;

    // Use infant_id if patient_id is not provided
    const effectivePatientId = patient_id || infant_id;

    if (!effectivePatientId || !measurement_date || age_in_days === undefined) {
      return res.status(400).json({
        error: 'patient_id (or infant_id), measurement_date, and age_in_days are required',
      });
    }

    let calculatedBMI = bmi;
    if (!calculatedBMI && weight_kg && length_cm) {
      const heightInMeters = length_cm / 100;
      calculatedBMI = weight_kg / (heightInMeters * heightInMeters);
    }

    let calculatedWeightZ = weight_z_score;
    let calculatedLengthZ = length_z_score;
    let calculatedBMI_Z = bmi_z_score;
    const calculatedHeadZ = head_circumference_z_score;

    if (!calculatedWeightZ && weight_kg) {
      calculatedWeightZ = (weight_kg - 7.0) / 1.0;
    }

    if (!calculatedLengthZ && length_cm) {
      calculatedLengthZ = (length_cm - 70.0) / 3.0;
    }

    if (!calculatedBMI_Z && calculatedBMI) {
      calculatedBMI_Z = (calculatedBMI - 16.5) / 1.5;
    }

    const insertResult = await pool.query(
      `
        INSERT INTO patient_growth (
          patient_id,
          measurement_date,
          age_in_days,
          weight_kg,
          length_cm,
          head_circumference_cm,
          bmi,
          weight_for_age_percentile,
          length_for_age_percentile,
          weight_for_length_percentile,
          head_circumference_percentile,
          weight_z_score,
          length_z_score,
          bmi_z_score,
          head_circumference_z_score,
          measurement_method,
          measured_by,
          measurement_location,
          notes,
          clothing_weight_kg,
          diaper_weight_kg,
          measurement_time,
          feeding_status,
          health_status,
          temperature_celsius,
          heart_rate,
          respiratory_rate,
          development_milestones,
          parent_concerns,
          healthcare_worker_notes,
          follow_up_required,
          follow_up_date,
          follow_up_reason,
          created_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
        )
        RETURNING *
      `,
      [
        effectivePatientId,
        measurement_date,
        age_in_days,
        weight_kg,
        length_cm,
        head_circumference_cm,
        calculatedBMI,
        weight_for_age_percentile,
        length_for_age_percentile,
        weight_for_length_percentile,
        head_circumference_percentile,
        calculatedWeightZ,
        calculatedLengthZ,
        calculatedBMI_Z,
        calculatedHeadZ,
        measurement_method || 'digital_scale',
        measured_by || req.user.id,
        measurement_location || 'Health Center',
        notes,
        clothing_weight_kg || 0,
        diaper_weight_kg || 0,
        measurement_time || new Date().toTimeString().split(' ')[0],
        feeding_status,
        health_status || 'well',
        temperature_celsius,
        heart_rate,
        respiratory_rate,
        JSON.stringify(development_milestones || []),
        parent_concerns,
        healthcare_worker_notes,
        follow_up_required || false,
        follow_up_date,
        follow_up_reason,
        req.user.id,
      ],
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (error) {
    console.error('Error creating growth record:', error);
    res.status(500).json({ error: 'Failed to create growth record' });
  }
});

// GET /records/:id - Get specific growth record
router.get('/records/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid growth record ID' });
    }

    const result = await pool.query(
      `
        SELECT
          pg.*,
          p.first_name,
          p.last_name,
          p.control_number,
          p.guardian_id,
          u.username as measured_by_username
        FROM patient_growth pg
        JOIN patients p ON p.id = pg.patient_id
        LEFT JOIN users u ON u.id = pg.measured_by
        WHERE pg.id = $1
          AND pg.is_active = true
      `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Growth record not found' });
    }

    const record = result.rows[0];
    if (isGuardian(req) && parseInt(req.user.guardian_id, 10) !== parseInt(record.guardian_id, 10)) {
      return res.status(403).json({ error: 'Access denied for this growth record' });
    }

    res.json(record);
  } catch (error) {
    console.error('Error fetching growth record:', error);
    res.status(500).json({ error: 'Failed to fetch growth record' });
  }
});

// PUT /records/:id - Update growth record
router.put('/records/:id', requirePermission('patient:update'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid growth record ID' });
    }

    const updateData = req.body;

    const allowedFields = [
      'measurement_date',
      'weight_kg',
      'length_cm',
      'head_circumference_cm',
      'bmi',
      'weight_for_age_percentile',
      'length_for_age_percentile',
      'weight_for_length_percentile',
      'head_circumference_percentile',
      'weight_z_score',
      'length_z_score',
      'bmi_z_score',
      'head_circumference_z_score',
      'measurement_method',
      'measurement_location',
      'notes',
      'clothing_weight_kg',
      'diaper_weight_kg',
      'measurement_time',
      'feeding_status',
      'health_status',
      'temperature_celsius',
      'heart_rate',
      'respiratory_rate',
      'development_milestones',
      'parent_concerns',
      'healthcare_worker_notes',
      'follow_up_required',
      'follow_up_date',
      'follow_up_reason',
    ];

    const updates = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updateData).forEach((key) => {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = $${paramIndex}`);
        values.push(key === 'development_milestones' ? JSON.stringify(updateData[key]) : updateData[key]);
        paramIndex += 1;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.push(`updated_by = $${paramIndex}`);
    values.push(req.user.id);
    paramIndex += 1;

    updates.push('updated_at = CURRENT_TIMESTAMP');

    values.push(id);
    const query = `
      UPDATE patient_growth
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
        AND is_active = true
      RETURNING *
    `;

    const updateResult = await pool.query(query, values);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Growth record not found' });
    }

    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error('Error updating growth record:', error);
    res.status(500).json({ error: 'Failed to update growth record' });
  }
});

// DELETE /records/:id - Delete growth record
router.delete('/records/:id', requirePermission('patient:update'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid growth record ID' });
    }

    const result = await pool.query(
      `
        UPDATE patient_growth
        SET is_active = false,
            updated_by = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
          AND is_active = true
        RETURNING id
      `,
      [req.user.id, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Growth record not found' });
    }

    res.json({ message: 'Growth record deleted successfully' });
  } catch (error) {
    console.error('Error deleting growth record:', error);
    res.status(500).json({ error: 'Failed to delete growth record' });
  }
});

module.exports = router;
