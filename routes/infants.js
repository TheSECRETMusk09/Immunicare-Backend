const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');
const appointmentSchedulingService = require('../services/appointmentSchedulingService');
const { resolveOrCreateInfantPatient } = require('../services/infantControlNumberService');
const socketService = require('../services/socketService');

const router = express.Router();

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

// Get infants by guardian
router.get('/guardian/:guardianId', async (req, res) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    if (Number.isNaN(guardianId)) {
      return res.status(400).json({ success: false, error: 'Invalid guardian ID', data: [] });
    }

    if (isGuardian(req) && parseInt(req.user.guardian_id, 10) !== guardianId) {
      return res.status(403).json({ success: false, error: 'Access denied', data: [] });
    }

    const result = await pool.query(
      `
        SELECT
          p.*,
          p.control_number,
          (
            SELECT json_agg(
              json_build_object(
                'id', ia.id,
                'allergy_type', ia.allergy_type,
                'allergen', ia.allergen,
                'severity', ia.severity,
                'reaction_description', ia.reaction_description,
                'onset_date', ia.onset_date
              )
            )
            FROM infant_allergies ia
            WHERE ia.infant_id = p.id AND ia.is_active = true
          ) as allergies
        FROM patients p
        WHERE p.guardian_id = $1
          AND p.is_active = true
        ORDER BY p.created_at DESC
      `,
      [guardianId],
    );

    res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    console.error('Error fetching infants by guardian:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch infants', data: [] });
  }
});

// Get all infants
router.get('/', requirePermission('patient:view'), async (req, res) => {
  try {
    console.log('[Infants API] Fetching all infants - User:', req.user?.id, 'Role:', req.user?.role, 'Role Type:', req.user?.role_type);

    const result = await pool.query(
      `
        SELECT
          p.*,
          g.name as guardian_name,
          g.phone as guardian_phone,
          g.email as guardian_email,
          p.mother_name,
          p.father_name,
          p.cellphone_number,
          p.control_number,
          COALESCE(p.mother_name, p.father_name, g.name) as primary_parent_name,
          COALESCE(p.cellphone_number, g.phone) as primary_contact,
          (
            SELECT json_agg(
              json_build_object(
                'id', ia.id,
                'allergy_type', ia.allergy_type,
                'allergen', ia.allergen,
                'severity', ia.severity,
                'reaction_description', ia.reaction_description
              )
            )
            FROM infant_allergies ia
            WHERE ia.infant_id = p.id AND ia.is_active = true
          ) as allergies
        FROM patients p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE p.is_active = true
        ORDER BY p.created_at DESC
      `,
    );

    console.log(`[Infants API] Found ${result.rows.length} infants`);
    if (result.rows.length > 0) {
      console.log('[Infants API] First infant sample:', { id: result.rows[0].id, name: result.rows[0].first_name + ' ' + result.rows[0].last_name });
    }

    res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    console.error('[Infants API] Error fetching infants:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch infants', data: [] });
  }
});

// Get infant statistics
router.get('/stats/overview', requirePermission('patient:view'), async (_req, res) => {
  try {
    const [totalInfants, thisMonth, bySex] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM patients WHERE is_active = true'),
      pool.query(
        `
          SELECT COUNT(*) as count
          FROM patients
          WHERE is_active = true
            AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
        `,
      ),
      pool.query(
        `
          SELECT sex, COUNT(*) as count
          FROM patients
          WHERE is_active = true
          GROUP BY sex
        `,
      ),
    ]);

    const sexStats = {};
    bySex.rows.forEach((row) => {
      sexStats[row.sex] = parseInt(row.count, 10);
    });

    res.json({
      success: true,
      data: {
        totalInfants: parseInt(totalInfants.rows[0].count, 10),
        thisMonth: parseInt(thisMonth.rows[0].count, 10),
        bySex: sexStats,
      },
    });
  } catch (error) {
    console.error('Error fetching infant stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch infant stats' });
  }
});

// Get infants with upcoming vaccinations
router.get('/upcoming-vaccinations', requirePermission('patient:view'), async (_req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT DISTINCT
          p.*,
          p.control_number,
          g.name as guardian_name,
          g.phone as guardian_phone,
          vr.next_due_date as upcoming_vaccination_date
        FROM patients p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        LEFT JOIN immunization_records vr ON vr.patient_id = p.id
        WHERE p.is_active = true
          AND vr.next_due_date IS NOT NULL
          AND vr.next_due_date <= CURRENT_DATE + INTERVAL '30 days'
          AND vr.is_active = true
        ORDER BY vr.next_due_date ASC
      `,
    );

    res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    console.error('Error fetching upcoming vaccinations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch upcoming vaccinations' });
  }
});

// Get infant by ID
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const infantId = parseInt(req.params.id, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ success: false, error: 'Invalid infant ID' });
    }

    if (isGuardian(req)) {
      const isOwner = await guardianOwnsInfant(parseInt(req.user.guardian_id, 10), infantId);
      if (!isOwner) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
    }

    const result = await pool.query(
      `
        SELECT
          p.*,
          p.control_number,
          g.name as guardian_name,
          g.phone as guardian_phone,
          g.email as guardian_email,
          (
            SELECT json_agg(
              json_build_object(
                'id', ia.id,
                'allergy_type', ia.allergy_type,
                'allergen', ia.allergen,
                'severity', ia.severity,
                'reaction_description', ia.reaction_description,
                'onset_date', ia.onset_date
              )
            )
            FROM infant_allergies ia
            WHERE ia.infant_id = p.id AND ia.is_active = true
          ) as allergies
        FROM patients p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE p.id = $1
          AND p.is_active = true
      `,
      [infantId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Infant not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching infant:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch infant' });
  }
});

// Create infant (SYSTEM_ADMIN)
router.post('/', requirePermission('patient:create'), async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      middle_name,
      dob,
      sex,
      national_id,
      address,
      contact,
      guardian_id,
      photo_url,
      mother_name,
      father_name,
      birth_weight,
      birth_height,
      place_of_birth,
      barangay,
      health_center,
      family_no,
      time_of_delivery,
      type_of_delivery,
      doctor_midwife_nurse,
      nbs_done,
      nbs_date,
      cellphone_number,
      facility_id,
    } = req.body;

    if (!first_name || !last_name || !dob || !sex) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: first_name, last_name, dob, and sex are required',
      });
    }

    const dobDate = new Date(dob);
    if (Number.isNaN(dobDate.getTime()) || dobDate > new Date()) {
      return res.status(400).json({ success: false, error: 'Invalid date of birth' });
    }

    const maxDob = new Date();
    maxDob.setFullYear(maxDob.getFullYear() - 20);
    if (dobDate < maxDob) {
      return res.status(400).json({ success: false, error: 'Date of birth seems invalid' });
    }

    let normalizedSex = sex;
    if (sex === 'M') {
      normalizedSex = 'male';
    }
    if (sex === 'F') {
      normalizedSex = 'female';
    }

    if (!['male', 'female', 'other'].includes(normalizedSex)) {
      return res.status(400).json({ success: false, error: 'Invalid sex value' });
    }

    const optionalFields = {
      middle_name: middle_name || null,
      national_id: national_id || null,
      address: address || null,
      contact: contact || null,
      photo_url: photo_url || null,
      mother_name: mother_name || null,
      father_name: father_name || null,
      birth_weight: birth_weight || null,
      birth_height: birth_height || null,
      place_of_birth: place_of_birth || null,
      barangay: barangay || null,
      health_center: health_center || null,
      family_no: family_no || null,
      time_of_delivery: time_of_delivery || null,
      type_of_delivery: type_of_delivery || null,
      doctor_midwife_nurse: doctor_midwife_nurse || null,
      nbs_done: nbs_done === undefined ? null : Boolean(nbs_done),
      nbs_date: nbs_date || null,
      cellphone_number: cellphone_number || null,
      facility_id: facility_id || null,
    };

    let resolved;

    try {
      resolved = await resolveOrCreateInfantPatient(
        {
          guardianId: guardian_id || null,
          firstName: first_name,
          lastName: last_name,
          dob,
          sex: normalizedSex,
          initialValues: optionalFields,
        },
        pool,
      );
    } catch (resolveError) {
      if (resolveError.code === 'AMBIGUOUS_INFANT_MATCH') {
        return res.status(409).json({
          success: false,
          error:
            'Multiple infant records already match this guardian, name, and date of birth. Resolve duplicates before creating a new profile.',
          matches: resolveError.matches || [],
        });
      }

      throw resolveError;
    }

    let result;

    if (resolved.existed) {
      const backfillUpdates = [];
      const backfillValues = [];
      let backfillParamIndex = 1;

      Object.entries(optionalFields).forEach(([columnName, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          backfillUpdates.push(`${columnName} = COALESCE(${columnName}, $${backfillParamIndex})`);
          backfillValues.push(value);
          backfillParamIndex += 1;
        }
      });

      backfillValues.push(resolved.id);

      if (backfillUpdates.length > 0) {
        result = await pool.query(
          `
            UPDATE patients
            SET ${backfillUpdates.join(', ')},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $${backfillParamIndex}
            RETURNING *
          `,
          backfillValues,
        );
      } else {
        result = await pool.query(
          `
            SELECT *
            FROM patients
            WHERE id = $1
            LIMIT 1
          `,
          [resolved.id],
        );
      }
    } else {
      result = await pool.query(
        `
          SELECT *
          FROM patients
          WHERE id = $1
          LIMIT 1
        `,
        [resolved.id],
      );
    }

    if (result.rows.length === 0) {
      return res.status(500).json({ success: false, error: 'Failed to resolve infant record' });
    }

    socketService.broadcast('infant_created', result.rows[0]);
    res.status(resolved.existed ? 200 : 201).json({
      success: true,
      data: result.rows[0],
      control_number: resolved.control_number,
      message: resolved.existed
        ? 'Existing infant record reused successfully'
        : 'Infant registered successfully',
    });
  } catch (error) {
    console.error('Error creating infant:', error);
    res.status(500).json({ success: false, error: 'Failed to create infant' });
  }
});

// Update infant (SYSTEM_ADMIN)
router.put('/:id(\\d+)', requirePermission('patient:update'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.id, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ success: false, error: 'Invalid infant ID' });
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'control_number')) {
      return res.status(400).json({
        success: false,
        error: 'control_number is immutable and cannot be edited',
      });
    }

    const {
      first_name,
      last_name,
      middle_name,
      dob,
      sex,
      national_id,
      address,
      contact,
      guardian_id,
      mother_name,
      father_name,
      birth_weight,
      birth_height,
      place_of_birth,
      barangay,
      health_center,
      family_no,
      time_of_delivery,
      type_of_delivery,
      doctor_midwife_nurse,
      nbs_done,
      nbs_date,
      cellphone_number,
    } = req.body;

    let normalizedSex = sex;
    if (sex === 'M') {
      normalizedSex = 'male';
    }
    if (sex === 'F') {
      normalizedSex = 'female';
    }

    const result = await pool.query(
      `
        UPDATE patients
        SET first_name = $1,
            last_name = $2,
            middle_name = $3,
            dob = $4,
            sex = $5,
            national_id = $6,
            address = $7,
            contact = $8,
            guardian_id = $9,
            mother_name = $10,
            father_name = $11,
            birth_weight = $12,
            birth_height = $13,
            place_of_birth = $14,
            barangay = $15,
            health_center = $16,
            family_no = $17,
            time_of_delivery = $18,
            type_of_delivery = $19,
            doctor_midwife_nurse = $20,
            nbs_done = $21,
            nbs_date = $22,
            cellphone_number = $23,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $24
          AND is_active = true
        RETURNING *
      `,
      [
        first_name,
        last_name,
        middle_name,
        dob,
        normalizedSex,
        national_id,
        address,
        contact,
        guardian_id,
        mother_name,
        father_name,
        birth_weight,
        birth_height,
        place_of_birth,
        barangay,
        health_center,
        family_no,
        time_of_delivery,
        type_of_delivery,
        doctor_midwife_nurse,
        nbs_done,
        nbs_date,
        cellphone_number,
        infantId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Infant not found' });
    }

    socketService.broadcast('infant_updated', result.rows[0]);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating infant:', error);
    res.status(500).json({ success: false, error: 'Failed to update infant' });
  }
});

// Delete infant (SYSTEM_ADMIN soft delete)
router.delete('/:id(\\d+)', requirePermission('patient:delete'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.id, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ success: false, error: 'Invalid infant ID' });
    }

    const result = await pool.query(
      `
        UPDATE patients
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND is_active = true
        RETURNING id
      `,
      [infantId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Infant not found' });
    }

    socketService.broadcast('infant_deleted', { id: infantId });
    res.json({ success: true, message: 'Infant deactivated successfully' });
  } catch (error) {
    console.error('Error deleting infant:', error);
    res.status(500).json({ success: false, error: 'Failed to delete infant' });
  }
});

// Search infants (SYSTEM_ADMIN)
router.get('/search/:query', requirePermission('patient:view'), async (req, res) => {
  try {
    const { query } = req.params;
    const result = await pool.query(
      `
        SELECT
          p.*,
          p.control_number,
          g.name as guardian_name,
          g.phone as guardian_phone,
          (
            SELECT json_agg(
              json_build_object(
                'id', ia.id,
                'allergy_type', ia.allergy_type,
                'allergen', ia.allergen,
                'severity', ia.severity
              )
            )
            FROM infant_allergies ia
            WHERE ia.infant_id = p.id AND ia.is_active = true
          ) as allergies
        FROM patients p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE p.is_active = true
          AND (
            p.first_name ILIKE $1 OR
            p.last_name ILIKE $1 OR
            p.national_id ILIKE $1 OR
            p.control_number ILIKE $1 OR
            g.name ILIKE $1
          )
        ORDER BY p.created_at DESC
      `,
      [`%${query}%`],
    );

    res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    console.error('Error searching infants:', error);
    res.status(500).json({ success: false, error: 'Failed to search infants' });
  }
});

// Get infants by age range (SYSTEM_ADMIN)
router.get('/age-range/:minAge/:maxAge', requirePermission('patient:view'), async (req, res) => {
  try {
    const minAge = parseInt(req.params.minAge, 10);
    const maxAge = parseInt(req.params.maxAge, 10);

    if (Number.isNaN(minAge) || Number.isNaN(maxAge)) {
      return res.status(400).json({ success: false, error: 'Invalid age range values' });
    }

    const result = await pool.query(
      `
        SELECT
          p.*,
          p.control_number,
          g.name as guardian_name,
          g.phone as guardian_phone
        FROM patients p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE p.is_active = true
          AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, p.dob)) BETWEEN $1 AND $2
        ORDER BY p.dob DESC
      `,
      [minAge, maxAge],
    );

    res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    console.error('Error fetching infants by age range:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch infants by age range' });
  }
});

module.exports = router;
