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
const patientService = require('../services/patientService');
const {
  createGuardianChildRecord,
} = require('../services/guardianChildRegistrationService');
const immunizationScheduleService = require('../services/immunizationScheduleService');
const {
  isScopeRequestAllowed,
  parsePositiveInt,
  resolveEffectiveScope,
  resolvePatientFacilityId,
} = require('../services/entityScopeService');
require('../services/infantRuntimeSchemaService');
const socketService = require('../services/socketService');
const adminNotificationService = require('../services/adminNotificationService');
const { calculateAgeInMonths } = require('../utils/ageCalculation');
const {
  isValidPurok,
  isValidStreetColorForPurok,
} = require('../utils/purokOptions');
const { resolvePatientColumn } = require('../utils/schemaHelpers');

const router = express.Router();

router.use(authenticateToken);

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

const guardianOwnsInfant = async (guardianId, infantId) => {
  const patient = await patientService.getPatientById(infantId);
  return patient && patient.guardianId === guardianId;
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

const toNullableString = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

let importedVaccinationPredicatePromise = null;

const mergePendingDoseCounts = (rows = [], scheduleSummaryMap = new Map()) =>
  rows.map((row) => {
    const scheduleSummary = scheduleSummaryMap.get(Number.parseInt(row?.id, 10));

    return {
      ...row,
      completed_vaccinations: scheduleSummary?.completedCount || 0,
      pending_vaccinations: scheduleSummary?.pendingCount || 0,
      overdue_vaccinations: scheduleSummary?.overdueCount || 0,
      upcoming_vaccinations: scheduleSummary?.upcomingCount || 0,
    };
  });

const sumPendingDoseCounts = (scheduleSummaryMap = new Map()) =>
  Array.from(scheduleSummaryMap.values()).reduce(
    (total, summary) => total + Number(summary?.pendingCount || 0),
    0,
  );

const requirePatientReadAccess = (req, res, next) => {
  const canonicalRole = getCanonicalRole(req);
  if (canonicalRole === CANONICAL_ROLES.GUARDIAN) {
    return next();
  }

  return requirePermission('patient:view')(req, res, next);
};

const sanitizeLimit = (value, fallback = 10000, max = 10000) => {
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    return fallback;
  }

  return Math.min(parsed, max);
};

const sanitizeOffset = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

const sanitizePage = (value, fallback = 1) => {
  const parsed = parsePositiveInt(value);
  return parsed || fallback;
};

const resolveScopedFacilityContext = (req) => {
  const canonicalRole = getCanonicalRole(req);
  const scope = resolveEffectiveScope({
    query: req.query,
    user: req.user,
    canonicalRole,
  });

  if (
    canonicalRole !== CANONICAL_ROLES.GUARDIAN &&
    !isScopeRequestAllowed(scope)
  ) {
    return {
      error: 'Cross-facility patient access is not allowed. Use your assigned facility scope.',
      status: 403,
    };
  }

  return scope;
};

const getImportedVaccinationPredicate = async () => {
  if (!importedVaccinationPredicatePromise) {
    importedVaccinationPredicatePromise = pool
      .query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'immunization_records'
            AND column_name = 'is_imported'
          LIMIT 1
        `,
      )
      .then((result) =>
        result.rows.length > 0 ? 'COALESCE(ir.is_imported, false) = true' : 'false',
      )
      .catch((error) => {
        importedVaccinationPredicatePromise = null;
        throw error;
      });
  }

  return importedVaccinationPredicatePromise;
};

const buildBackfillAssignments = (columnValues = {}) => {
  const updates = [];
  const values = [];
  let nextParamIndex = 1;

  Object.entries(columnValues).forEach(([columnName, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      updates.push(`${columnName} = COALESCE(${columnName}, $${nextParamIndex})`);
      values.push(value);
      nextParamIndex += 1;
    }
  });

  return {
    updates,
    values,
    nextParamIndex,
  };
};

const validatePurokSelection = (
  { purok, street_color },
  errors,
  { requireSelection = false } = {},
) => {
  if (requireSelection && !purok) {
    errors.purok = 'Purok is required';
  }

  if (requireSelection && !street_color) {
    errors.street_color = 'Purok-Street-Color is required';
  }

  if (purok && !isValidPurok(purok)) {
    errors.purok = 'Please select a valid Purok';
  }

  if (street_color && !purok) {
    errors.street_color = 'Select a Purok before choosing Purok-Street-Color';
  }

  if (purok && street_color && !isValidStreetColorForPurok(purok, street_color)) {
    errors.street_color = 'Selected Purok-Street-Color does not match the selected Purok';
  }
};

const validateInfantPayload = (payload = {}, options = {}) => {
  const { requirePurokFields = true } = options;
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
    purok: toNullableString(payload.purok),
    street_color: toNullableString(payload.street_color),
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

  validatePurokSelection(normalized, errors, {
    requireSelection: requirePurokFields,
  });

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    data: normalized,
  };
};

// Extended validation with allergy_information and health_care_provider
const validateInfantPayloadExtended = (payload = {}, options = {}) => {
  const baseValidation = validateInfantPayload(payload, options);
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

// Get infants by guardian
router.get('/guardian/:guardianId', requirePatientReadAccess, async (req, res) => {
  try {
    const importedVaccinationPredicate = await getImportedVaccinationPredicate();

    const guardianId = parseInt(req.params.guardianId, 10);
    if (Number.isNaN(guardianId)) {
      return res.status(400).json({ error: 'Invalid guardian ID' });
    }

    if (isGuardian(req) && parseInt(req.user.guardian_id, 10) !== guardianId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const scopedFacilityContext = resolveScopedFacilityContext(req);
    if (scopedFacilityContext.error) {
      return res.status(scopedFacilityContext.status).json({ error: scopedFacilityContext.error });
    }

    const params = [guardianId];
    let facilityFilterClause = '';
    if (!isGuardian(req) && scopedFacilityContext.useScope) {
      facilityFilterClause = ` AND p.facility_id = ANY($${params.length + 1}::int[])`;
      params.push(scopedFacilityContext.scopeIds);
    }

    const result = await pool.query(
      `
        SELECT
          p.*,
          p.control_number,
          p.allergy_information,
          p.health_care_provider,
          (
            SELECT COUNT(*)
            FROM immunization_records ir
            WHERE ir.patient_id = p.id
              AND ir.is_active = true
              AND (
                ir.status = 'completed'
                OR ir.admin_date IS NOT NULL
              )
          ) AS completed_vaccinations,
          (
            SELECT COUNT(*)
            FROM immunization_records ir
            WHERE ir.patient_id = p.id
              AND COALESCE(ir.is_active, true) = true
              AND ${importedVaccinationPredicate}
              AND (
                LOWER(COALESCE(ir.status, '')) = 'completed'
                OR ir.admin_date IS NOT NULL
              )
          ) AS imported_vaccinations,
          (
            SELECT tic.id
            FROM transfer_in_cases tic
            WHERE tic.infant_id = p.id
            ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
            LIMIT 1
          ) AS latest_transfer_case_id,
          (
            SELECT tic.validation_status
            FROM transfer_in_cases tic
            WHERE tic.infant_id = p.id
            ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
            LIMIT 1
          ) AS latest_transfer_case_status,
          (
            SELECT tic.source_facility
            FROM transfer_in_cases tic
            WHERE tic.infant_id = p.id
            ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
            LIMIT 1
          ) AS latest_transfer_source_facility,
          (
            SELECT tic.updated_at
            FROM transfer_in_cases tic
            WHERE tic.infant_id = p.id
            ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
            LIMIT 1
          ) AS latest_transfer_case_updated_at,
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
          ${facilityFilterClause}
        ORDER BY p.created_at DESC
      `,
      params,
    );

    const scheduleSummaryMap = await immunizationScheduleService.getScheduleSummariesForPatients(
      result.rows || [],
    );

    res.json({
      success: true,
      data: mergePendingDoseCounts(result.rows || [], scheduleSummaryMap),
    });
  } catch (error) {
    console.error('Error fetching infants by guardian:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch infants' });
  }
});

// Get all infants (redirected to canonical patient service)
router.get('/', requirePermission('patient:view'), async (req, res) => {
  try {
    const scopedFacilityContext = resolveScopedFacilityContext(req);
    if (scopedFacilityContext.error) {
      return res.status(scopedFacilityContext.status).json({ success: false, error: scopedFacilityContext.error });
    }

    // Performance: Cap limits to prevent large queries
    const limit = sanitizeLimit(req.query.limit, 25, 1000);
    const page = sanitizePage(req.query.page, 1);
    const offset = sanitizeOffset(req.query.offset, (page - 1) * limit);
    
    // Build filters for canonical patient service
    const filters = {
      search: req.query.search || req.query.query,
      facilityId: scopedFacilityContext.useScope && scopedFacilityContext.scopeIds.length > 0 ? scopedFacilityContext.scopeIds[0] : undefined,
      dateFrom: req.query.start_date || req.query.dob_start || req.query.date_of_birth_start,
      dateTo: req.query.end_date || req.query.dob_end || req.query.date_of_birth_end,
      createdFrom: req.query.created_from || undefined,
      createdTo: req.query.created_to || undefined,
      orderBy: req.query.order_by || req.query.orderBy || 'created_at',
      orderDirection: req.query.order_direction || req.query.orderDirection || 'DESC',
      excludeFutureDob:
        ['true', '1', 'yes'].includes(
          String(req.query.exclude_future_dob || req.query.excludeFutureDob || '')
            .trim()
            .toLowerCase(),
        ),
      isActive: true,
      page,
      limit,
      offset,
    };

    // Guardian can only see their own patients
    if (isGuardian(req)) {
      filters.guardianId = req.user.id;
    }

    const result = await patientService.getPatients(filters);

    res.json({
      success: true,
      data: result.patients,
      pagination: result.pagination || {
        page,
        limit,
        offset,
        total: result.total,
      },
      summary: result.summary || null,
    });

  } catch (error) {
    console.error('Error fetching infants:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch infants',
      message: error.message
    });
  }
});

// Get infant statistics (redirected to canonical patient service)
router.get('/stats/overview', requirePermission('patient:view'), async (req, res) => {
  try {
    const scopedFacilityContext = resolveScopedFacilityContext(req);
    if (scopedFacilityContext.error) {
      return res.status(scopedFacilityContext.status).json({
        success: false,
        error: scopedFacilityContext.error,
      });
    }

    // Build filters for canonical patient service
    const filters = {
      facilityId: scopedFacilityContext.useScope && scopedFacilityContext.scopeIds.length > 0 ? scopedFacilityContext.scopeIds[0] : undefined,
      isActive: true,
      // No pagination needed for stats
    };

    // Guardian can only see their own patients
    if (isGuardian(req)) {
      filters.guardianId = req.user.id;
    }

    // Use canonical patient service for statistics
    const stats = await patientService.getPatientStatistics(filters);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching infant stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch infant stats' });
  }
});

// Get infants with upcoming vaccinations (redirected to canonical patient service)
router.get('/upcoming-vaccinations', requirePermission('patient:view'), async (req, res) => {
  try {
    const limit = sanitizeLimit(req.query.limit, 50, 200);
    const offset = sanitizeOffset(req.query.offset, 0);
    const scopedFacilityContext = resolveScopedFacilityContext(req);
    if (scopedFacilityContext.error) {
      return res.status(scopedFacilityContext.status).json({
        success: false,
        error: scopedFacilityContext.error,
      });
    }

    // Build filters for canonical patient service
    const filters = {
      facilityId: scopedFacilityContext.useScope ? scopedFacilityContext.scopeIds[0] : undefined,
      isActive: true,
      limit,
      offset,
      orderBy: 'next_due_date',
      orderDirection: 'ASC',
      // Custom filter for upcoming vaccinations
      customWhere: [
        'vr.next_due_date IS NOT NULL',
        'vr.next_due_date <= CURRENT_DATE + INTERVAL \'30 days\'',
        'vr.is_active = true'
      ]
    };

    // Guardian can only see their own patients
    if (isGuardian(req)) {
      filters.guardianId = req.user.id;
    }

    // Use canonical patient service with custom vaccination filter
    const result = await patientService.getPatientsWithVaccinationFilters(filters);

    res.json({ success: true, data: result.patients || [] });
  } catch (error) {
    console.error('Error fetching upcoming vaccinations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch upcoming vaccinations' });
  }
});

// Get infant by control number
router.get('/control-number/:controlNumber', requirePatientReadAccess, async (req, res) => {
  try {
    const canonicalRole = getCanonicalRole(req);
    if (
      canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN &&
      canonicalRole !== CANONICAL_ROLES.CLINIC_MANAGER &&
      canonicalRole !== CANONICAL_ROLES.GUARDIAN
    ) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const scopedFacilityContext = resolveScopedFacilityContext(req);
    if (scopedFacilityContext.error) {
      return res.status(scopedFacilityContext.status).json({ success: false, error: scopedFacilityContext.error });
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

      guardianFilterClause = ` AND p.guardian_id = $${params.length + 1}`;
      params.push(guardianId);
    }

    let facilityFilterClause = '';
    if (scopedFacilityContext.useScope) {
      facilityFilterClause = ` AND p.facility_id = ANY($${params.length + 1}::int[])`;
      params.push(scopedFacilityContext.scopeIds);
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
          ${facilityFilterClause}
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

// Get infant by ID (redirected to canonical patient service)
router.get('/:id(\\d+)', requirePatientReadAccess, async (req, res) => {
  try {
    const infantId = parseInt(req.params.id, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ success: false, error: 'Invalid infant ID' });
    }

    const canonicalRole = getCanonicalRole(req);
    const scopedFacilityContext = resolveScopedFacilityContext(req);
    if (scopedFacilityContext.error) {
      return res.status(scopedFacilityContext.status).json({ success: false, error: scopedFacilityContext.error });
    }

    // Check ownership for guardians
    if (isGuardian(req)) {
      const isOwner = await guardianOwnsInfant(parseInt(req.user.guardian_id, 10), infantId);
      if (!isOwner) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
    } else if (
      canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN &&
      canonicalRole !== CANONICAL_ROLES.CLINIC_MANAGER
    ) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Use canonical patient service
    const patient = await patientService.getPatientById(infantId);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Infant not found' });
    }

    // Apply facility scope filtering for non-guardians
    if (!isGuardian(req) && scopedFacilityContext.useScope) {
      const patientFacilityId = Number.parseInt(patient.facilityId, 10);
      if (
        Number.isFinite(patientFacilityId) &&
        patientFacilityId > 0 &&
        !scopedFacilityContext.scopeIds.includes(patientFacilityId)
      ) {
        return res.status(403).json({ success: false, error: 'Access denied - facility scope mismatch' });
      }
    }

    // Get vaccination schedule summary for the patient
    const scheduleSummaryMap = await immunizationScheduleService.getScheduleSummariesForPatients([patient]);
    const patientWithSchedule = mergePendingDoseCounts([patient], scheduleSummaryMap)[0];

    res.json({
      success: true,
      data: patientWithSchedule,
    });
  } catch (error) {
    console.error('Error fetching infant:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch infant' });
  }
});

// Create infant (SYSTEM_ADMIN) - redirected to canonical patient service
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
      purok,
      street_color,
    } = req.body;

    // Validate required fields
    const validationResult = validateInfantPayload(req.body, { requirePurokFields: false });
    if (!validationResult.isValid) {
      return respondInfantValidationError(res, validationResult.errors);
    }

    const patientData = {
      ...validationResult.data,
      guardian_id:
        guardian_id !== undefined && guardian_id !== null && guardian_id !== ''
          ? parseInt(guardian_id, 10)
          : validationResult.data.guardian_id,
    };
    
    // Use canonical patient service to create patient
    const newPatient = await patientService.createPatient(patientData, req.user.id);

    socketService.broadcast('infant_created', newPatient);
    res.status(201).json({
      success: true,
      data: newPatient,
      control_number: newPatient.control_number,
      message: 'Infant registered successfully',
    });
  } catch (error) {
    console.error('Error creating infant:', error);
    res.status(500).json({ success: false, error: 'Failed to create infant' });
  }
});

// Create infant (GUARDIAN own) - redirected to canonical patient service
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

    // Validate required fields
    const validationResult = validateInfantPayload(payload, { requirePurokFields: true });
    if (!validationResult.isValid) {
      return respondInfantValidationError(res, validationResult.errors);
    }

    const childResult = await createGuardianChildRecord({
      guardianId,
      payload: {
        ...validationResult.data,
        guardian_id: guardianId,
      },
    });
    const newPatient = {
      ...childResult.patient,
      control_number: childResult.patient.control_number || childResult.controlNumber,
    };

    socketService.broadcast('infant_created', newPatient);

    return res.status(201).json({
      success: true,
      data: newPatient,
      control_number: newPatient.control_number,
      existed: Boolean(childResult.existed),
      message: 'Child registered successfully.',
    });
  } catch (error) {
    if (error.code === 'VALIDATION_ERROR') {
      return respondInfantValidationError(res, error.fields || {});
    }

    if (error.code === 'AMBIGUOUS_INFANT_MATCH') {
      return res.status(409).json({
        success: false,
        error:
          'Multiple child records already match this name and date of birth. Please contact support to resolve duplicates.',
        matches: error.matches || [],
      });
    }

    if (error.code === 'FOREIGN_CHILD_MATCH' || error.code === 'GUARDIAN_MAPPING_MISSING') {
      return res.status(403).json({
        success: false,
        error: error.message,
      });
    }

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
    const validationResult = validateInfantPayloadExtended(updatePayload, { requirePurokFields: false });
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
            facility_id = COALESCE($24, facility_id),
            allergy_information = $25,
            health_care_provider = $26,
            purok = COALESCE($27, purok),
            street_color = COALESCE($28, street_color),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $29
          AND guardian_id = $30
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
        infantData.purok,
        infantData.street_color,
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

// Delete infant (GUARDIAN own soft delete with cascading deletion and admin notification)
router.delete('/:id(\\d+)/guardian', requirePermission('patient:delete:own'), async (req, res) => {
  const client = await pool.connect();
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

    // Start transaction for cascading deletion
    await client.query('BEGIN');

    // Get infant details before deletion
    const infantResult = await client.query(
      'SELECT id, first_name, last_name, control_number, dob FROM patients WHERE id = $1 AND guardian_id = $2 AND is_active = true',
      [infantId, guardianId],
    );

    if (infantResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Child not found' });
    }

    const infant = infantResult.rows[0];

    // Get guardian details for notification
    const guardianResult = await client.query(
      'SELECT id, name, email, phone FROM guardians WHERE id = $1',
      [guardianId],
    );
    const guardian = guardianResult.rows[0];

    const appointmentPatientColumn = await resolvePatientColumn();

    // Get count of appointments to be deleted
    const appointmentCountResult = await client.query(
      `SELECT COUNT(*) as count FROM appointments WHERE ${appointmentPatientColumn} = $1 AND COALESCE(is_active, true) = true`,
      [infantId],
    );
    const appointmentCount = parseInt(appointmentCountResult.rows[0].count, 10);

    // Preserve appointment history by soft-deactivating linked appointments.
    await client.query(
      `
        UPDATE appointments
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE ${appointmentPatientColumn} = $1
          AND COALESCE(is_active, true) = true
      `,
      [infantId],
    );

    // Soft delete the infant (set is_active = false)
    const deleteResult = await client.query(
      'UPDATE patients SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND guardian_id = $2 AND is_active = true RETURNING id',
      [infantId, guardianId],
    );

    if (deleteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Child not found' });
    }

    await client.query('COMMIT');

    // Send admin notification about the deletion
    const deletionTimestamp = new Date().toISOString();
    const adminNotificationTitle = 'Child Profile Deleted by Guardian';
    const adminNotificationMessage = `Guardian "${guardian.name}" (ID: ${guardian.id}) has deleted a child profile. Child: ${infant.first_name} ${infant.last_name} (Control Number: ${infant.control_number || 'N/A'}). ${appointmentCount} associated appointment record(s) were archived. Deletion timestamp: ${deletionTimestamp}. Guardian contact: ${guardian.phone || 'N/A'}, ${guardian.email || 'N/A'}`;

    // Send notification to admins
    try {
      await adminNotificationService.sendAdminNotification({
        title: adminNotificationTitle,
        message: adminNotificationMessage,
        type: 'child_deletion',
        priority: 'high',
        targetRole: 'system_admin',
        channel: 'both',
      });
    } catch (notificationError) {
      console.error('Failed to send admin notification for child deletion:', notificationError);
    }

    // Also broadcast via socket for real-time admin updates
    socketService.broadcast('infant_deleted', {
      id: infantId,
      deletedBy: 'guardian',
      guardianId: guardianId,
      guardianName: guardian.name,
      deletedAt: deletionTimestamp,
      appointmentsRemoved: appointmentCount,
    });

    return res.json({
      success: true,
      message: 'Child removed successfully. Associated appointments were archived.',
      deletedInfant: {
        id: infant.id,
        name: `${infant.first_name} ${infant.last_name}`,
        controlNumber: infant.control_number,
        deletedByGuardian: guardian.id,
        guardianName: guardian.name,
        deletedAt: deletionTimestamp,
        appointmentsArchived: appointmentCount,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error deleting infant for guardian:', error);
    return res.status(500).json({ success: false, error: 'Failed to remove child record' });
  } finally {
    client.release();
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
      allergy_information,
      health_care_provider,
      facility_id,
      purok,
      street_color,
    } = updatePayload;

    const normalizedPurok = toNullableString(purok);
    const normalizedStreetColor = toNullableString(street_color);
    const purokErrors = {};
    validatePurokSelection(
      {
        purok: normalizedPurok,
        street_color: normalizedStreetColor,
      },
      purokErrors,
    );

    if (Object.keys(purokErrors).length > 0) {
      return respondInfantValidationError(
        res,
        purokErrors,
        'Please correct the highlighted infant update fields.',
      );
    }

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
            allergy_information = $24,
            health_care_provider = $25,
            facility_id = COALESCE($26, facility_id),
            purok = COALESCE($27, purok),
            street_color = COALESCE($28, street_color),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $29
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
        allergy_information || null,
        health_care_provider || null,
        facility_id || null,
        normalizedPurok,
        normalizedStreetColor,
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

// Delete infant (SYSTEM_ADMIN soft delete with cascading deletion and admin notification)
router.delete('/:id(\\d+)', requirePermission('patient:delete'), async (req, res) => {
  const client = await pool.connect();
  try {
    const infantId = parseInt(req.params.id, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ success: false, error: 'Invalid infant ID' });
    }

    // Start transaction for cascading deletion
    await client.query('BEGIN');

    // Get infant details before deletion
    const infantResult = await client.query(
      'SELECT id, first_name, last_name, control_number, dob, guardian_id FROM patients WHERE id = $1 AND is_active = true',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Infant not found' });
    }

    const infant = infantResult.rows[0];

    // Get guardian details for notification
    let guardian = null;
    if (infant.guardian_id) {
      const guardianResult = await client.query(
        'SELECT id, name, email, phone FROM guardians WHERE id = $1',
        [infant.guardian_id],
      );
      guardian = guardianResult.rows[0];
    }

    const appointmentPatientColumn = await resolvePatientColumn();

    // Get count of appointments to be deleted
    const appointmentCountResult = await client.query(
      `SELECT COUNT(*) as count FROM appointments WHERE ${appointmentPatientColumn} = $1 AND COALESCE(is_active, true) = true`,
      [infantId],
    );
    const appointmentCount = parseInt(appointmentCountResult.rows[0].count, 10);

    // Preserve appointment history by soft-deactivating linked appointments.
    await client.query(
      `
        UPDATE appointments
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE ${appointmentPatientColumn} = $1
          AND COALESCE(is_active, true) = true
      `,
      [infantId],
    );

    // Soft delete the infant (set is_active = false)
    const deleteResult = await client.query(
      'UPDATE patients SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = true RETURNING id',
      [infantId],
    );

    if (deleteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Infant not found' });
    }

    await client.query('COMMIT');

    // Send admin notification about the deletion
    const deletionTimestamp = new Date().toISOString();
    const adminNotificationTitle = 'Child Profile Deleted by System Admin';
    const adminNotificationMessage = `System Admin has deleted a child profile. Child: ${infant.first_name} ${infant.last_name} (Control Number: ${infant.control_number || 'N/A'}). ${appointmentCount} associated appointment record(s) were archived. Deletion timestamp: ${deletionTimestamp}. ${guardian ? `Guardian: ${guardian.name} (ID: ${guardian.id}), Contact: ${guardian.phone || 'N/A'}, ${guardian.email || 'N/A'}` : 'No guardian information available'}`;

    // Send notification to admins
    try {
      await adminNotificationService.sendAdminNotification({
        title: adminNotificationTitle,
        message: adminNotificationMessage,
        type: 'child_deletion',
        priority: 'high',
        targetRole: 'system_admin',
        channel: 'both',
      });
    } catch (notificationError) {
      console.error('Failed to send admin notification for child deletion:', notificationError);
    }

    // Also broadcast via socket for real-time admin updates
    socketService.broadcast('infant_deleted', {
      id: infantId,
      deletedBy: 'system_admin',
      guardianId: infant.guardian_id,
      guardianName: guardian?.name,
      deletedAt: deletionTimestamp,
      appointmentsRemoved: appointmentCount,
    });

    res.json({
      success: true,
      message: 'Infant deactivated successfully. Associated appointments were archived.',
      deletedInfant: {
        id: infant.id,
        name: `${infant.first_name} ${infant.last_name}`,
        controlNumber: infant.control_number,
        deletedBy: 'system_admin',
        guardianId: infant.guardian_id,
        guardianName: guardian?.name,
        deletedAt: deletionTimestamp,
        appointmentsArchived: appointmentCount,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error deleting infant:', error);
    res.status(500).json({ success: false, error: 'Failed to delete infant' });
  } finally {
    client.release();
  }
});

// Search infants (SYSTEM_ADMIN)
router.get('/search/:query', requirePermission('patient:view'), async (req, res) => {
  try {
    const { query } = req.params;
    const limit = sanitizeLimit(req.query.limit, 50, 200);
    const offset = sanitizeOffset(req.query.offset, 0);
    const scopedFacilityContext = resolveScopedFacilityContext(req);
    if (scopedFacilityContext.error) {
      return res.status(scopedFacilityContext.status).json({
        success: false,
        error: scopedFacilityContext.error,
      });
    }

    const searchCondition = patientService.buildTokenizedSearchCondition({
      searchValue: query,
      expressions: [
        ...patientService.buildPatientNameSearchExpressions('p'),
        'p.national_id',
        'p.control_number',
        'g.name',
        `TO_CHAR(p.dob, 'YYYY-MM-DD')`,
        `TO_CHAR(p.dob, 'MM/DD/YYYY')`,
      ],
      startingParamIndex: 1,
    });
    const params = [...searchCondition.params];
    let whereClause = `
      WHERE p.is_active = true
        AND (
          ${searchCondition.clause}
        )
    `;

    if (scopedFacilityContext.useScope) {
      whereClause += ` AND p.facility_id = ANY($${params.length + 1}::int[])`;
      params.push(scopedFacilityContext.scopeIds);
    }

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
        ${whereClause}
        ORDER BY p.created_at DESC
        LIMIT $${params.length + 1}::bigint OFFSET $${params.length + 2}::bigint
      `,
      [...params, limit, offset],
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
    const scopedFacilityContext = resolveScopedFacilityContext(req);
    if (scopedFacilityContext.error) {
      return res.status(scopedFacilityContext.status).json({
        success: false,
        error: scopedFacilityContext.error,
      });
    }

    if (Number.isNaN(minAge) || Number.isNaN(maxAge)) {
      return res.status(400).json({ success: false, error: 'Invalid age range values' });
    }

    const params = [minAge, maxAge];
    let whereClause = `
      WHERE p.is_active = true
        AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, p.dob)) BETWEEN $1 AND $2
    `;

    if (scopedFacilityContext.useScope) {
      whereClause += ` AND p.facility_id = ANY($${params.length + 1}::int[])`;
      params.push(scopedFacilityContext.scopeIds);
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
        ${whereClause}
        ORDER BY p.dob DESC
      `,
      params,
    );

    res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    console.error('Error fetching infants by age range:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch infants by age range' });
  }
});

module.exports = router;
