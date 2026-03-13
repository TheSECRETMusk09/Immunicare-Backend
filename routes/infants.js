const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');
const {
  resolveOrCreateInfantPatient,
  INFANT_CONTROL_NUMBER_PATTERN,
} = require('../services/infantControlNumberService');
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

const normalizeInfantValidationErrors = (errors = {}) => {
  return Object.entries(errors).reduce((acc, [field, message]) => {
    if (typeof message === 'string' && message.trim()) {
      acc[field] = message;
    } else if (Array.isArray(message) && message.length > 0) {
      acc[field] = String(message[0]);
    } else {
      acc[field] = 'Invalid value';
    }
    return acc;
  }, {});
};

const respondInfantValidationError = (res, errors = {}, message = 'Please correct the highlighted child registration fields.') => {
  const fields = normalizeInfantValidationErrors(errors);
  return res.status(400).json({
    success: false,
    error: message,
    code: 'VALIDATION_ERROR',
    fields,
  });
};

const validateInfantPayload = (payload = {}) => {
  const errors = {};

  const firstName = String(payload.first_name || '').trim();
  const lastName = String(payload.last_name || '').trim();
  const dobRaw = payload.dob;
  const sexRaw = String(payload.sex || '').trim().toUpperCase();

  if (!firstName) {
    errors.first_name = 'First name is required';
  } else if (firstName.length < 2) {
    errors.first_name = 'First name must be at least 2 characters long';
  }

  if (!lastName) {
    errors.last_name = 'Last name is required';
  } else if (lastName.length < 2) {
    errors.last_name = 'Last name must be at least 2 characters long';
  }

  if (!dobRaw) {
    errors.dob = 'Date of birth is required';
  }

  let dob = null;
  if (dobRaw) {
    const parsedDob = new Date(dobRaw);
    if (Number.isNaN(parsedDob.getTime())) {
      errors.dob = 'Date of birth must be a valid date';
    } else {
      const today = new Date();
      const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const dobMidnight = new Date(
        parsedDob.getFullYear(),
        parsedDob.getMonth(),
        parsedDob.getDate(),
      );

      if (dobMidnight > todayMidnight) {
        errors.dob = 'Date of birth cannot be in the future';
      }

      const oldestAllowed = new Date(todayMidnight);
      oldestAllowed.setFullYear(oldestAllowed.getFullYear() - 20);
      if (dobMidnight < oldestAllowed) {
        errors.dob = 'Date of birth seems invalid';
      }

      dob = dobMidnight.toISOString().split('T')[0];
    }
  }

  if (!sexRaw) {
    errors.sex = 'Sex is required';
  }

  let normalizedSex = null;
  if (sexRaw) {
    if (sexRaw === 'M' || sexRaw === 'MALE') {
      normalizedSex = 'male';
    } else if (sexRaw === 'F' || sexRaw === 'FEMALE') {
      normalizedSex = 'female';
    } else if (sexRaw === 'OTHER') {
      normalizedSex = 'other';
    } else {
      errors.sex = 'Sex must be Male, Female, or Other';
    }
  }

  const toNullableString = (value) => {
    if (value === undefined || value === null) {
      return null;
    }
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  };

  // NEW: Extended validation with allergy_information and health_care_provider
  const validateInfantPayloadExtended = (payload = {}) => {
    const baseValidation = validateInfantPayload(payload);
    if (!baseValidation.isValid) {
      return baseValidation;
    }

    const normalized = { ...baseValidation.data };

    // Add new fields
    normalized.allergy_information = toNullableString(payload.allergy_information);
    normalized.health_care_provider = toNullableString(payload.health_care_provider);

    return {
      isValid: true,
      errors: {},
      data: normalized,
    };
  };

  const normalizeNullableNumber = (value, fieldName, { min = null, max = null } = {}) => {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      errors[fieldName] = `${fieldName.replace(/_/g, ' ')} must be a valid number`;
      return null;
    }

    if (min !== null && parsed < min) {
      errors[fieldName] = `${fieldName.replace(/_/g, ' ')} must be at least ${min}`;
      return null;
    }

    if (max !== null && parsed > max) {
      errors[fieldName] = `${fieldName.replace(/_/g, ' ')} must be at most ${max}`;
      return null;
    }

    return parsed;
  };

  const normalized = {
    first_name: firstName,
    last_name: lastName,
    middle_name: toNullableString(payload.middle_name),
    dob,
    sex: normalizedSex,
    national_id: toNullableString(payload.national_id),
    address: toNullableString(payload.address),
    contact: toNullableString(payload.contact),
    photo_url: toNullableString(payload.photo_url),
    mother_name: toNullableString(payload.mother_name),
    father_name: toNullableString(payload.father_name),
    birth_weight: normalizeNullableNumber(payload.birth_weight, 'birth_weight', { min: 0.3, max: 10 }),
    birth_height: normalizeNullableNumber(payload.birth_height, 'birth_height', { min: 10, max: 100 }),
    place_of_birth: toNullableString(payload.place_of_birth),
    barangay: toNullableString(payload.barangay),
    health_center: toNullableString(payload.health_center),
    family_no: toNullableString(payload.family_no),
    time_of_delivery: toNullableString(payload.time_of_delivery),
    type_of_delivery: toNullableString(payload.type_of_delivery),
    doctor_midwife_nurse: toNullableString(payload.doctor_midwife_nurse),
    nbs_done: payload.nbs_done === undefined ? null : Boolean(payload.nbs_done),
    nbs_date: toNullableString(payload.nbs_date),
    cellphone_number: toNullableString(payload.cellphone_number),
    facility_id: payload.facility_id === undefined || payload.facility_id === null || payload.facility_id === ''
      ? null
      : parseInt(payload.facility_id, 10),
    allergy_information: toNullableString(payload.allergy_information),
    health_care_provider: toNullableString(payload.health_care_provider),
  };

  if (
    payload.facility_id !== undefined &&
    payload.facility_id !== null &&
    payload.facility_id !== '' &&
    (Number.isNaN(normalized.facility_id) || normalized.facility_id <= 0)
  ) {
    errors.facility_id = 'facility_id must be a valid positive integer';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    data: normalized,
  };
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
          p.allergy_information,
          p.health_care_provider,
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

    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

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
        LIMIT $1 OFFSET $2
      `,
      [limit, offset],
    );

    const totalResult = await pool.query('SELECT COUNT(*) FROM patients WHERE is_active = true');
    const total = parseInt(totalResult.rows[0].count, 10);

    console.log(`[Infants API] Found ${result.rows.length} infants`);
    if (result.rows.length > 0) {
      console.log('[Infants API] First infant sample:', { id: result.rows[0].id, name: result.rows[0].first_name + ' ' + result.rows[0].last_name });
    }

    res.json({
      success: true,
      data: result.rows || [],
      pagination: {
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit),
      },
    });
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
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;

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
        LIMIT $1 OFFSET $2
      `,
      [limit, offset],
    );

    res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    console.error('Error fetching upcoming vaccinations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch upcoming vaccinations' });
  }
});

// Get infant by control number
router.get('/control-number/:controlNumber', async (req, res) => {
  try {
    const canonicalRole = getCanonicalRole(req);
    if (
      canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN &&
      canonicalRole !== CANONICAL_ROLES.GUARDIAN
    ) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const rawControlNumber = String(req.params.controlNumber || '').trim().toUpperCase();
    if (!rawControlNumber) {
      return res.status(400).json({ success: false, error: 'Control number is required' });
    }

    if (!INFANT_CONTROL_NUMBER_PATTERN.test(rawControlNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid control number format. Expected INF-YYYY-######',
      });
    }

    const params = [rawControlNumber];
    let guardianFilterClause = '';

    if (canonicalRole === CANONICAL_ROLES.GUARDIAN) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      if (Number.isNaN(guardianId) || guardianId <= 0) {
        return res
          .status(403)
          .json({ success: false, error: 'Guardian account mapping is missing' });
      }

      guardianFilterClause = ' AND p.guardian_id = $2';
      params.push(guardianId);
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
        WHERE p.control_number = $1
          AND p.is_active = true
          ${guardianFilterClause}
        LIMIT 1
      `,
      params,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Infant not found' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching infant by control number:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch infant' });
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
      const missingFields = [];
      if (!first_name) {
        missingFields.push('first_name');
      }
      if (!last_name) {
        missingFields.push('last_name');
      }
      if (!dob) {
        missingFields.push('dob');
      }
      if (!sex) {
        missingFields.push('sex');
      }

      const fieldErrors = {};
      if (!first_name) {
        fieldErrors.first_name = 'First name is required';
      }
      if (!last_name) {
        fieldErrors.last_name = 'Last name is required';
      }
      if (!dob) {
        fieldErrors.dob = 'Date of birth is required';
      }
      if (!sex) {
        fieldErrors.sex = 'Sex is required';
      }

      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')} are required`,
        fields: fieldErrors,
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

// Create infant (GUARDIAN own)
router.post('/guardian', requirePermission('patient:create:own'), async (req, res) => {
  try {
    if (!isGuardian(req)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Guardian role required.',
      });
    }

    const guardianId = parseInt(req.user.guardian_id, 10);
    if (Number.isNaN(guardianId) || guardianId <= 0) {
      return res.status(403).json({
        success: false,
        error: 'Guardian account mapping is missing. Please sign in again.',
      });
    }

    const payload = req.body || {};

    if (
      Object.prototype.hasOwnProperty.call(payload, 'guardian_id') &&
      payload.guardian_id !== undefined &&
      payload.guardian_id !== null &&
      payload.guardian_id !== '' &&
      parseInt(payload.guardian_id, 10) !== guardianId
    ) {
      return res.status(403).json({
        success: false,
        error: 'You can only register children under your own guardian account.',
      });
    }

    const validationResult = validateInfantPayload(payload);
    if (!validationResult.isValid) {
      return respondInfantValidationError(res, validationResult.errors);
    }

    const infantData = validationResult.data;

    let resolved;

    try {
      resolved = await resolveOrCreateInfantPatient(
        {
          guardianId,
          firstName: infantData.first_name,
          lastName: infantData.last_name,
          dob: infantData.dob,
          sex: infantData.sex,
          initialValues: {
            middle_name: infantData.middle_name,
            national_id: infantData.national_id,
            address: infantData.address,
            contact: infantData.contact,
            photo_url: infantData.photo_url,
            mother_name: infantData.mother_name,
            father_name: infantData.father_name,
            birth_weight: infantData.birth_weight,
            birth_height: infantData.birth_height,
            place_of_birth: infantData.place_of_birth,
            barangay: infantData.barangay,
            health_center: infantData.health_center,
            family_no: infantData.family_no,
            time_of_delivery: infantData.time_of_delivery,
            type_of_delivery: infantData.type_of_delivery,
            doctor_midwife_nurse: infantData.doctor_midwife_nurse,
            nbs_done: infantData.nbs_done,
            nbs_date: infantData.nbs_date,
            cellphone_number: infantData.cellphone_number,
            facility_id: infantData.facility_id,
          },
        },
        pool,
      );
    } catch (resolveError) {
      if (resolveError.code === 'AMBIGUOUS_INFANT_MATCH') {
        return res.status(409).json({
          success: false,
          error:
            'Multiple child records already match this name and date of birth. Please contact support to resolve duplicates.',
          matches: resolveError.matches || [],
        });
      }

      throw resolveError;
    }

    let result;

    if (resolved.existed) {
      const existingResult = await pool.query(
        `
          SELECT *
          FROM patients
          WHERE id = $1
          LIMIT 1
        `,
        [resolved.id],
      );

      if (existingResult.rows.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'Failed to resolve child record',
        });
      }

      const existingInfant = existingResult.rows[0];
      if (parseInt(existingInfant.guardian_id, 10) !== guardianId) {
        return res.status(403).json({
          success: false,
          error: 'Matched child record is not owned by this guardian account.',
        });
      }

      result = existingResult;
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
      return res.status(500).json({ success: false, error: 'Failed to resolve child record' });
    }

    socketService.broadcast('infant_created', result.rows[0]);

    return res.status(resolved.existed ? 200 : 201).json({
      success: true,
      data: result.rows[0],
      control_number: resolved.control_number,
      message: resolved.existed
        ? 'An existing child record under your account was reused.'
        : 'Child registered successfully.',
    });
  } catch (error) {
    console.error('Error creating infant for guardian:', error);
    return res.status(500).json({ success: false, error: 'Failed to register child' });
  }
});

// Update infant (GUARDIAN own)
router.put('/:id(\\d+)/guardian', requirePermission('patient:update:own'), async (req, res) => {
  try {
    if (!isGuardian(req)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Guardian role required.',
      });
    }

    const guardianId = parseInt(req.user.guardian_id, 10);
    if (Number.isNaN(guardianId) || guardianId <= 0) {
      return res.status(403).json({
        success: false,
        error: 'Guardian account mapping is missing. Please sign in again.',
      });
    }

    const infantId = parseInt(req.params.id, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ success: false, error: 'Invalid child ID' });
    }

    const isOwner = await guardianOwnsInfant(guardianId, infantId);
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: 'You can only update your own child records.',
      });
    }

    const updatePayload = { ...(req.body || {}) };
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'control_number')) {
      delete updatePayload.control_number;
    }

    // Use extended validation with allergy_information and health_care_provider
    const validationResult = validateInfantPayloadExtended(updatePayload);
    if (!validationResult.isValid) {
      return respondInfantValidationError(
        res,
        validationResult.errors,
        'Please correct the highlighted child update fields.',
      );
    }

    const infantData = validationResult.data;

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
            facility_id = $24,
            allergy_information = $25,
            health_care_provider = $26,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $27
          AND guardian_id = $28
          AND is_active = true
        RETURNING *
      `,
      [
        infantData.first_name,
        infantData.last_name,
        infantData.middle_name,
        infantData.dob,
        infantData.sex,
        infantData.national_id,
        infantData.address,
        infantData.contact,
        guardianId,
        infantData.mother_name,
        infantData.father_name,
        infantData.birth_weight,
        infantData.birth_height,
        infantData.place_of_birth,
        infantData.barangay,
        infantData.health_center,
        infantData.family_no,
        infantData.time_of_delivery,
        infantData.type_of_delivery,
        infantData.doctor_midwife_nurse,
        infantData.nbs_done,
        infantData.nbs_date,
        infantData.cellphone_number,
        infantData.facility_id,
        infantData.allergy_information,
        infantData.health_care_provider,
        infantId,
        guardianId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Child not found' });
    }

    socketService.broadcast('infant_updated', result.rows[0]);
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating infant for guardian:', error);
    return res.status(500).json({ success: false, error: 'Failed to update child record' });
  }
});

// Delete infant (GUARDIAN own soft delete)
router.delete('/:id(\\d+)/guardian', requirePermission('patient:delete:own'), async (req, res) => {
  try {
    if (!isGuardian(req)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Guardian role required.',
      });
    }

    const guardianId = parseInt(req.user.guardian_id, 10);
    if (Number.isNaN(guardianId) || guardianId <= 0) {
      return res.status(403).json({
        success: false,
        error: 'Guardian account mapping is missing. Please sign in again.',
      });
    }

    const infantId = parseInt(req.params.id, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ success: false, error: 'Invalid child ID' });
    }

    const result = await pool.query(
      `
        UPDATE patients
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND guardian_id = $2
          AND is_active = true
        RETURNING id
      `,
      [infantId, guardianId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Child not found' });
    }

    socketService.broadcast('infant_deleted', { id: infantId });
    return res.json({ success: true, message: 'Child removed successfully' });
  } catch (error) {
    console.error('Error deleting infant for guardian:', error);
    return res.status(500).json({ success: false, error: 'Failed to remove child record' });
  }
});

// Update infant (SYSTEM_ADMIN)
router.put('/:id(\\d+)', requirePermission('patient:update'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.id, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ success: false, error: 'Invalid infant ID' });
    }

    const updatePayload = { ...(req.body || {}) };
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'control_number')) {
      delete updatePayload.control_number;
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
    } = updatePayload;

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
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;

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
        LIMIT $2 OFFSET $3
      `,
      [`%${query}%`, limit, offset],
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

