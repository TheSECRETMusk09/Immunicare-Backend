const pool = require('../db');
const immunizationScheduleService = require('./immunizationScheduleService');
const { ensureAtBirthVaccinationRecords } = require('./atBirthVaccinationService');

/**
 * PATIENT SERVICE - CANONICAL DATA LAYER
 * 
 * This service provides unified access to patient/infant data
 * Canonical source: patients table
 * Legacy fallback: infants table (for compatibility)
 * 
 * All modules should use this service instead of direct table access
 */

const normalizePatientData = (record) => {
  if (!record) return null;
  
  return {
    ...record,
    id: record.id,
    patientId: record.id, // Canonical ID
    firstName: record.first_name,
    lastName: record.last_name,
    middleName: record.middle_name || null,
    fullName: `${record.first_name} ${record.middle_name || ''} ${record.last_name}`.trim(),
    dob: record.dob,
    sex: record.sex,
    nationalId: record.national_id || null,
    address: record.address || null,
    contact: record.contact || record.cellphone_number || null,
    guardianId: record.guardian_id,
    facilityId: record.facility_id || null,
    birthHeight: record.birth_height || null,
    birthWeight: record.birth_weight || null,
    motherName: record.mother_name || null,
    fatherName: record.father_name || null,
    barangay: record.barangay || null,
    healthCenter: record.health_center || null,
    purok: record.purok || null,
    streetColor: record.street_color || null,
    familyNo: record.family_no || null,
    placeOfBirth: record.place_of_birth || null,
    timeOfDelivery: record.time_of_delivery || null,
    typeOfDelivery: record.type_of_delivery || null,
    doctorMidwifeNurse: record.doctor_midwife_nurse || null,
    nbsDone: record.nbs_done || false,
    nbsDate: record.nbs_date || null,
    cellphoneNumber: record.cellphone_number || record.contact || null,
    photoUrl: record.photo_url || null,
    isActive: record.is_active !== false,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    // Legacy compatibility fields
    controlNumber: record.control_number || null,
    healthCenterId: record.facility_id || null,
    contactNumber: record.contact || record.cellphone_number || null,
    guardianName: record.guardian_name || null,
    guardianPhone: record.guardian_phone || record.guardian_contact || null,
    completedVaccinations: Number(record.completed_vaccinations || 0),
    pendingVaccinations: Number(record.pending_vaccinations || 0),
    importedVaccinations: Number(record.imported_vaccinations || 0),
    latestTransferCaseId: record.latest_transfer_case_id || null,
    latestTransferCaseStatus: record.latest_transfer_case_status || null,
    latestTransferSourceFacility: record.latest_transfer_source_facility || null,
    latestTransferCaseUpdatedAt: record.latest_transfer_case_updated_at || null,
  };
};

let importedVaccinationPredicatePromise = null;

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

const sanitizeInteger = (value, fallback = null, { min = null, max = null } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (min !== null && parsed < min) {
    return fallback;
  }

  if (max !== null && parsed > max) {
    return max;
  }

  return parsed;
};

const sanitizeLimit = (value, fallback = 25, max = 1000) => {
  const parsed = sanitizeInteger(value, null, { min: 1 });
  if (parsed === null) {
    return fallback;
  }

  return Math.min(parsed, max);
};

const sanitizePage = (value, fallback = 1) => {
  const parsed = sanitizeInteger(value, null, { min: 1 });
  return parsed === null ? fallback : parsed;
};

const sanitizeOffset = (value, fallback = 0) => {
  const parsed = sanitizeInteger(value, null, { min: 0 });
  return parsed === null ? fallback : parsed;
};

const sanitizeOrderBy = (value, fallback = 'p.created_at') => {
  const normalized = String(value || '').trim().toLowerCase().replace(/^p\./, '');
  const allowed = new Set([
    'created_at',
    'updated_at',
    'dob',
    'first_name',
    'last_name',
    'control_number',
  ]);

  return allowed.has(normalized) ? `p.${normalized}` : fallback;
};

const sanitizeOrderDirection = (value, fallback = 'DESC') => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'ASC' ? 'ASC' : fallback;
};

const resolvePagination = (filters = {}, { defaultLimit = 25, maxLimit = 1000 } = {}) => {
  const limit = sanitizeLimit(filters.limit, defaultLimit, maxLimit);
  const page = sanitizePage(filters.page, 1);
  const explicitOffset = sanitizeInteger(filters.offset, null, { min: 0 });
  const offset = explicitOffset === null ? (page - 1) * limit : explicitOffset;

  return { page, limit, offset };
};

const mergePendingDoseCounts = (rows = [], scheduleSummaryMap = new Map()) =>
  rows.map((row) => {
    const scheduleSummary = scheduleSummaryMap.get(Number.parseInt(row?.id, 10));

    return {
      ...row,
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

const resolvePatientInputField = (source = {}, camelKey, snakeKey = camelKey) => {
  if (Object.prototype.hasOwnProperty.call(source, camelKey)) {
    return source[camelKey];
  }

  if (snakeKey !== camelKey && Object.prototype.hasOwnProperty.call(source, snakeKey)) {
    return source[snakeKey];
  }

  return undefined;
};

const normalizePatientInput = (patientData = {}) => ({
  firstName: resolvePatientInputField(patientData, 'firstName', 'first_name'),
  lastName: resolvePatientInputField(patientData, 'lastName', 'last_name'),
  middleName: resolvePatientInputField(patientData, 'middleName', 'middle_name'),
  dob: resolvePatientInputField(patientData, 'dob'),
  sex: resolvePatientInputField(patientData, 'sex'),
  nationalId: resolvePatientInputField(patientData, 'nationalId', 'national_id'),
  address: resolvePatientInputField(patientData, 'address'),
  contact: resolvePatientInputField(patientData, 'contact'),
  guardianId: resolvePatientInputField(patientData, 'guardianId', 'guardian_id'),
  facilityId: resolvePatientInputField(patientData, 'facilityId', 'facility_id'),
  birthHeight: resolvePatientInputField(patientData, 'birthHeight', 'birth_height'),
  birthWeight: resolvePatientInputField(patientData, 'birthWeight', 'birth_weight'),
  motherName: resolvePatientInputField(patientData, 'motherName', 'mother_name'),
  fatherName: resolvePatientInputField(patientData, 'fatherName', 'father_name'),
  barangay: resolvePatientInputField(patientData, 'barangay'),
  healthCenter: resolvePatientInputField(patientData, 'healthCenter', 'health_center'),
  purok: resolvePatientInputField(patientData, 'purok'),
  streetColor: resolvePatientInputField(patientData, 'streetColor', 'street_color'),
  familyNo: resolvePatientInputField(patientData, 'familyNo', 'family_no'),
  placeOfBirth: resolvePatientInputField(patientData, 'placeOfBirth', 'place_of_birth'),
  timeOfDelivery: resolvePatientInputField(patientData, 'timeOfDelivery', 'time_of_delivery'),
  typeOfDelivery: resolvePatientInputField(patientData, 'typeOfDelivery', 'type_of_delivery'),
  doctorMidwifeNurse: resolvePatientInputField(patientData, 'doctorMidwifeNurse', 'doctor_midwife_nurse'),
  nbsDone: resolvePatientInputField(patientData, 'nbsDone', 'nbs_done'),
  nbsDate: resolvePatientInputField(patientData, 'nbsDate', 'nbs_date'),
  cellphoneNumber: resolvePatientInputField(patientData, 'cellphoneNumber', 'cellphone_number'),
  photoUrl: resolvePatientInputField(patientData, 'photoUrl', 'photo_url'),
  isActive: resolvePatientInputField(patientData, 'isActive', 'is_active'),
});

const buildPatientFilterClause = (filters = {}) => {
  const params = [];
  let paramIndex = 1;
  let whereClause = 'WHERE 1=1';

  if (filters.isActive !== undefined) {
    whereClause += ` AND p.is_active = $${paramIndex}`;
    params.push(filters.isActive);
    paramIndex += 1;
  }

  const guardianId = sanitizeInteger(filters.guardianId, null, { min: 1 });
  if (guardianId) {
    whereClause += ` AND p.guardian_id = $${paramIndex}`;
    params.push(guardianId);
    paramIndex += 1;
  }

  const facilityId = sanitizeInteger(filters.facilityId, null, { min: 1 });
  if (facilityId) {
    whereClause += ` AND p.facility_id = $${paramIndex}`;
    params.push(facilityId);
    paramIndex += 1;
  }

  const searchTerm = String(filters.search || '').trim().replace(/\s+/g, ' ');
  if (searchTerm) {
    whereClause += ` AND (
      COALESCE(p.first_name, '') ILIKE $${paramIndex} OR
      COALESCE(p.last_name, '') ILIKE $${paramIndex} OR
      CONCAT_WS(
        ' ',
        NULLIF(BTRIM(p.first_name), ''),
        NULLIF(BTRIM(p.middle_name), ''),
        NULLIF(BTRIM(p.last_name), '')
      ) ILIKE $${paramIndex} OR
      CONCAT_WS(
        ' ',
        NULLIF(BTRIM(p.first_name), ''),
        NULLIF(BTRIM(p.last_name), '')
      ) ILIKE $${paramIndex} OR
      CONCAT_WS(
        ' ',
        NULLIF(BTRIM(p.last_name), ''),
        NULLIF(BTRIM(p.first_name), '')
      ) ILIKE $${paramIndex} OR
      COALESCE(p.control_number, '') ILIKE $${paramIndex} OR
      COALESCE(p.cellphone_number, '') ILIKE $${paramIndex} OR
      COALESCE(p.contact, '') ILIKE $${paramIndex} OR
      COALESCE(g.name, '') ILIKE $${paramIndex} OR
      COALESCE(g.phone, '') ILIKE $${paramIndex} OR
      CAST(p.dob AS TEXT) ILIKE $${paramIndex}
    )`;
    params.push(`%${searchTerm}%`);
    paramIndex += 1;
  }

  if (filters.sex) {
    whereClause += ` AND p.sex = $${paramIndex}`;
    params.push(filters.sex);
    paramIndex += 1;
  }

  if (filters.minAgeMonths !== undefined && filters.minAgeMonths !== null && filters.minAgeMonths !== '') {
    whereClause += ` AND EXTRACT(YEAR FROM AGE(p.dob)) * 12 + EXTRACT(MONTH FROM AGE(p.dob)) >= $${paramIndex}`;
    params.push(sanitizeInteger(filters.minAgeMonths, 0, { min: 0 }));
    paramIndex += 1;
  }

  if (filters.maxAgeMonths !== undefined && filters.maxAgeMonths !== null && filters.maxAgeMonths !== '') {
    whereClause += ` AND EXTRACT(YEAR FROM AGE(p.dob)) * 12 + EXTRACT(MONTH FROM AGE(p.dob)) <= $${paramIndex}`;
    params.push(sanitizeInteger(filters.maxAgeMonths, 0, { min: 0 }));
    paramIndex += 1;
  }

  if (filters.dateFrom) {
    whereClause += ` AND p.dob >= $${paramIndex}`;
    params.push(filters.dateFrom);
    paramIndex += 1;
  }

  if (filters.dateTo) {
    whereClause += ` AND p.dob <= $${paramIndex}`;
    params.push(filters.dateTo);
    paramIndex += 1;
  }

  if (filters.excludeFutureDob) {
    whereClause += ` AND p.dob <= CURRENT_DATE`;
  }

  return { whereClause, params };
};

/**
 * Get patients with pagination and filtering
 */
const getPatients = async (filters = {}) => {
  const pagination = resolvePagination(filters, { defaultLimit: 25, maxLimit: 1000 });
  const { whereClause, params } = buildPatientFilterClause(filters);
  const orderBy = sanitizeOrderBy(filters.orderBy, 'p.created_at');
  const orderDirection = sanitizeOrderDirection(filters.orderDirection, 'DESC');
  const importedVaccinationPredicate = await getImportedVaccinationPredicate();

  const listQuery = `
    SELECT
      p.*,
      p.control_number,
      g.name as guardian_name,
      g.phone as guardian_phone,
      (
        SELECT COUNT(*)::int
          FROM public.immunization_records ir
        WHERE ir.patient_id = p.id
          AND COALESCE(ir.is_active, true) = true
          AND (
            LOWER(COALESCE(ir.status, '')) = 'completed'
            OR ir.admin_date IS NOT NULL
          )
      ) AS completed_vaccinations,
      (
        SELECT COUNT(*)::int
          FROM public.immunization_records ir
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
        FROM public.transfer_in_cases tic
        WHERE tic.infant_id = p.id
        ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
        LIMIT 1
      ) AS latest_transfer_case_id,
      (
        SELECT tic.validation_status
        FROM public.transfer_in_cases tic
        WHERE tic.infant_id = p.id
        ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
        LIMIT 1
      ) AS latest_transfer_case_status,
      (
        SELECT tic.source_facility
        FROM public.transfer_in_cases tic
        WHERE tic.infant_id = p.id
        ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
        LIMIT 1
      ) AS latest_transfer_source_facility,
      (
        SELECT tic.updated_at
        FROM public.transfer_in_cases tic
        WHERE tic.infant_id = p.id
        ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
        LIMIT 1
      ) AS latest_transfer_case_updated_at
    FROM public.patients p
    LEFT JOIN public.guardians g ON g.id = p.guardian_id
    ${whereClause}
    ORDER BY ${orderBy} ${orderDirection}
    LIMIT $${params.length + 1}::bigint OFFSET $${params.length + 2}::bigint
  `;

  const countQuery = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE latest_transfer_case_id IS NOT NULL
      )::int AS with_imported_history,
      COUNT(*) FILTER (
        WHERE latest_transfer_case_status IN (
          'for_validation',
          'needs_clarification',
          'pending_validation'
        )
      )::int AS needs_review
    FROM (
      SELECT
        p.id,
        (
          SELECT tic.id
      FROM public.transfer_in_cases tic
          WHERE tic.infant_id = p.id
          ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
          LIMIT 1
        ) AS latest_transfer_case_id,
        (
          SELECT tic.validation_status
      FROM public.transfer_in_cases tic
          WHERE tic.infant_id = p.id
          ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
          LIMIT 1
        ) AS latest_transfer_case_status
      FROM public.patients p
      LEFT JOIN public.guardians g ON g.id = p.guardian_id
      ${whereClause}
    ) filtered_patients
  `;

  const [result, countResult] = await Promise.all([
    pool.query(listQuery, [...params, pagination.limit, pagination.offset]),
    pool.query(countQuery, params),
  ]);

  const scheduleSummaryMap = await immunizationScheduleService.getScheduleSummariesForPatients(
    result.rows || [],
  );
  const patients = mergePendingDoseCounts(result.rows || [], scheduleSummaryMap);

  const total = Number.parseInt(countResult.rows[0]?.total || 0, 10) || 0;
  const needsReview = Number.parseInt(countResult.rows[0]?.needs_review || 0, 10) || 0;
  const withImportedHistory =
    Number.parseInt(countResult.rows[0]?.with_imported_history || 0, 10) || 0;

  return {
    patients,
    total,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      offset: pagination.offset,
      total,
      totalPages: pagination.limit > 0 ? Math.ceil(total / pagination.limit) : 0,
      hasNext: pagination.page * pagination.limit < total,
      hasPrev: pagination.page > 1,
    },
    summary: {
      total,
      needsReview,
      withImportedHistory,
      pendingVaccinations: sumPendingDoseCounts(scheduleSummaryMap),
    },
  };
};

/**
 * Get single patient by ID
 */
const getPatientById = async (id) => {
  const buildQuery = ({ includeFacilityJoin = true, includeActiveFilter = true } = {}) => `
    SELECT 
      p.*,
      g.name as guardian_name,
      g.email as guardian_email,
      g.phone as guardian_phone${includeFacilityJoin ? ',\n      hf.name as facility_name' : ''}
    FROM public.patients p
    LEFT JOIN public.guardians g ON g.id = p.guardian_id
    ${includeFacilityJoin ? 'LEFT JOIN public.healthcare_facilities hf ON hf.id = p.facility_id' : ''}
    WHERE p.id = $1${includeActiveFilter ? ' AND p.is_active = true' : ''}
  `;

  const attemptQueries = [
    { includeFacilityJoin: true, includeActiveFilter: true },
    { includeFacilityJoin: false, includeActiveFilter: true },
    { includeFacilityJoin: true, includeActiveFilter: false },
    { includeFacilityJoin: false, includeActiveFilter: false },
  ];

  for (const options of attemptQueries) {
    try {
      const result = await pool.query(buildQuery(options), [id]);
      if (result.rows.length > 0) {
        return normalizePatientData(result.rows[0]);
      }
    } catch (error) {
      if (error?.code !== '42P01') {
        throw error;
      }
    }
  }

  return null;
};

/**
 * Get patients by guardian ID
 */
const getPatientsByGuardianId = async (guardianId, filters = {}) => {
  return getPatients({
    ...filters,
    guardianId,
    isActive: true,
  });
};

/**
 * Create new patient
 */
const createPatient = async (patientData) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const normalizedInput = normalizePatientInput(patientData);
    
    // Insert into canonical patients table
    const insertResult = await client.query(`
      INSERT INTO public.patients (
        first_name, last_name, middle_name, dob, sex, national_id, 
      address, contact, guardian_id, facility_id, birth_height, birth_weight,
      mother_name, father_name, barangay, health_center, purok, street_color,
      family_no, place_of_birth, time_of_delivery, type_of_delivery,
      doctor_midwife_nurse, nbs_done, nbs_date, cellphone_number, photo_url,
      is_active,
      created_at, updated_at
    ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `, [
      normalizedInput.firstName,
      normalizedInput.lastName,
      normalizedInput.middleName,
      normalizedInput.dob,
      normalizedInput.sex,
      normalizedInput.nationalId,
      normalizedInput.address,
      normalizedInput.contact,
      normalizedInput.guardianId,
      normalizedInput.facilityId,
      normalizedInput.birthHeight,
      normalizedInput.birthWeight,
      normalizedInput.motherName,
      normalizedInput.fatherName,
      normalizedInput.barangay,
      normalizedInput.healthCenter,
      normalizedInput.purok,
      normalizedInput.streetColor,
      normalizedInput.familyNo,
      normalizedInput.placeOfBirth,
      normalizedInput.timeOfDelivery,
      normalizedInput.typeOfDelivery,
      normalizedInput.doctorMidwifeNurse,
      normalizedInput.nbsDone,
      normalizedInput.nbsDate,
      normalizedInput.cellphoneNumber,
      normalizedInput.photoUrl,
      normalizedInput.isActive !== undefined ? normalizedInput.isActive : true,
    ]);

    const newPatient = normalizePatientData(insertResult.rows[0]);

    try {
      await ensureAtBirthVaccinationRecords(newPatient.id, {
        patientDob: newPatient.dob,
        client,
      });
    } catch (seedError) {
      console.warn(
        'At-birth vaccination seeding failed for new patient; continuing without blocking creation:',
        seedError?.message || seedError,
      );
    }

    await client.query('COMMIT');
    await syncToLegacyInfants(newPatient);
    return newPatient;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Update existing patient
 */
const updatePatient = async (id, patientData) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const normalizedInput = normalizePatientInput(patientData);
    
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    // Build dynamic update query
    if (normalizedInput.firstName !== undefined) {
      updateFields.push(`first_name = $${paramIndex}`);
      updateValues.push(normalizedInput.firstName);
      paramIndex++;
    }

    if (normalizedInput.lastName !== undefined) {
      updateFields.push(`last_name = $${paramIndex}`);
      updateValues.push(normalizedInput.lastName);
      paramIndex++;
    }

    if (normalizedInput.middleName !== undefined) {
      updateFields.push(`middle_name = $${paramIndex}`);
      updateValues.push(normalizedInput.middleName);
      paramIndex++;
    }

    if (normalizedInput.dob !== undefined) {
      updateFields.push(`dob = $${paramIndex}`);
      updateValues.push(normalizedInput.dob);
      paramIndex++;
    }

    if (normalizedInput.sex !== undefined) {
      updateFields.push(`sex = $${paramIndex}`);
      updateValues.push(normalizedInput.sex);
      paramIndex++;
    }

    if (normalizedInput.nationalId !== undefined) {
      updateFields.push(`national_id = $${paramIndex}`);
      updateValues.push(normalizedInput.nationalId);
      paramIndex++;
    }

    if (normalizedInput.address !== undefined) {
      updateFields.push(`address = $${paramIndex}`);
      updateValues.push(normalizedInput.address);
      paramIndex++;
    }

    if (normalizedInput.contact !== undefined) {
      updateFields.push(`contact = $${paramIndex}`);
      updateValues.push(normalizedInput.contact);
      paramIndex++;
    }

    if (normalizedInput.guardianId !== undefined) {
      updateFields.push(`guardian_id = $${paramIndex}`);
      updateValues.push(normalizedInput.guardianId);
      paramIndex++;
    }

    if (normalizedInput.facilityId !== undefined) {
      updateFields.push(`facility_id = $${paramIndex}`);
      updateValues.push(normalizedInput.facilityId);
      paramIndex++;
    }

    if (normalizedInput.birthHeight !== undefined) {
      updateFields.push(`birth_height = $${paramIndex}`);
      updateValues.push(normalizedInput.birthHeight);
      paramIndex++;
    }

    if (normalizedInput.birthWeight !== undefined) {
      updateFields.push(`birth_weight = $${paramIndex}`);
      updateValues.push(normalizedInput.birthWeight);
      paramIndex++;
    }

    if (normalizedInput.motherName !== undefined) {
      updateFields.push(`mother_name = $${paramIndex}`);
      updateValues.push(normalizedInput.motherName);
      paramIndex++;
    }

    if (normalizedInput.fatherName !== undefined) {
      updateFields.push(`father_name = $${paramIndex}`);
      updateValues.push(normalizedInput.fatherName);
      paramIndex++;
    }

    if (normalizedInput.barangay !== undefined) {
      updateFields.push(`barangay = $${paramIndex}`);
      updateValues.push(normalizedInput.barangay);
      paramIndex++;
    }

    if (normalizedInput.healthCenter !== undefined) {
      updateFields.push(`health_center = $${paramIndex}`);
      updateValues.push(normalizedInput.healthCenter);
      paramIndex++;
    }

    if (normalizedInput.purok !== undefined) {
      updateFields.push(`purok = $${paramIndex}`);
      updateValues.push(normalizedInput.purok);
      paramIndex++;
    }

    if (normalizedInput.streetColor !== undefined) {
      updateFields.push(`street_color = $${paramIndex}`);
      updateValues.push(normalizedInput.streetColor);
      paramIndex++;
    }

    if (normalizedInput.familyNo !== undefined) {
      updateFields.push(`family_no = $${paramIndex}`);
      updateValues.push(normalizedInput.familyNo);
      paramIndex++;
    }

    if (normalizedInput.placeOfBirth !== undefined) {
      updateFields.push(`place_of_birth = $${paramIndex}`);
      updateValues.push(normalizedInput.placeOfBirth);
      paramIndex++;
    }

    if (normalizedInput.timeOfDelivery !== undefined) {
      updateFields.push(`time_of_delivery = $${paramIndex}`);
      updateValues.push(normalizedInput.timeOfDelivery);
      paramIndex++;
    }

    if (normalizedInput.typeOfDelivery !== undefined) {
      updateFields.push(`type_of_delivery = $${paramIndex}`);
      updateValues.push(normalizedInput.typeOfDelivery);
      paramIndex++;
    }

    if (normalizedInput.doctorMidwifeNurse !== undefined) {
      updateFields.push(`doctor_midwife_nurse = $${paramIndex}`);
      updateValues.push(normalizedInput.doctorMidwifeNurse);
      paramIndex++;
    }

    if (normalizedInput.nbsDone !== undefined) {
      updateFields.push(`nbs_done = $${paramIndex}`);
      updateValues.push(normalizedInput.nbsDone);
      paramIndex++;
    }

    if (normalizedInput.nbsDate !== undefined) {
      updateFields.push(`nbs_date = $${paramIndex}`);
      updateValues.push(normalizedInput.nbsDate);
      paramIndex++;
    }

    if (normalizedInput.cellphoneNumber !== undefined) {
      updateFields.push(`cellphone_number = $${paramIndex}`);
      updateValues.push(normalizedInput.cellphoneNumber);
      paramIndex++;
    }

    if (normalizedInput.photoUrl !== undefined) {
      updateFields.push(`photo_url = $${paramIndex}`);
      updateValues.push(normalizedInput.photoUrl);
      paramIndex++;
    }

    if (normalizedInput.isActive !== undefined) {
      updateFields.push(`is_active = $${paramIndex}`);
      updateValues.push(normalizedInput.isActive);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      throw new Error('No fields to update');
    }

    const updateQuery = `
      UPDATE public.patients 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
    `;

    await client.query(updateQuery, [...updateValues, id]);

    // Get updated record
    const updatedResult = await client.query('SELECT * FROM public.patients WHERE id = $1', [id]);

    await client.query('COMMIT');

    return normalizePatientData(updatedResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Delete patient (soft delete)
 */
const deletePatient = async (id) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const result = await client.query(
      'UPDATE public.patients SET is_active = false WHERE id = $1 RETURNING *',
      [id]
    );

    await client.query('COMMIT');

    return normalizePatientData(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Check if patient exists
 */
const patientExists = async (id) => {
  const result = await pool.query(
    'SELECT id FROM public.patients WHERE id = $1 AND is_active = true',
    [id]
  );
  
  return result.rows.length > 0;
};

/**
 * Sync patient to legacy infants table
 */
const syncToLegacyInfants = async (patientData) => {
  try {
    // Create new record in infants table for compatibility
    await pool.query(`
      INSERT INTO public.infants (
        first_name, last_name, dob, sex, national_id, 
        address, contact, guardian_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      patientData.firstName,
      patientData.lastName,
      patientData.dob,
      patientData.sex,
      patientData.nationalId,
      patientData.address,
      patientData.contact,
      patientData.guardianId
    ]);
  } catch (error) {
    if (error?.code === '42P01') {
      return;
    }

    // Log error but don't fail the main operation
    console.warn('Failed to sync to legacy infants table:', error.message);
  }
};

/**
 * Get patients with vaccination filters
 */
const getPatientsWithVaccinationFilters = async (filters = {}) => {
  const {
    facilityId,
    guardianId,
    isActive = true,
    orderBy = 'created_at',
    orderDirection = 'DESC',
    customWhere = []
  } = filters;
  const pagination = resolvePagination(filters, { defaultLimit: 25, maxLimit: 1000 });
  const normalizedOrderBy = String(orderBy || '').trim().toLowerCase().replace(/^p\./, '').replace(/^vr\./, '');
  const orderByClause =
    normalizedOrderBy === 'next_due_date' || normalizedOrderBy === 'upcoming_vaccination_date'
      ? 'vr.next_due_date'
      : sanitizeOrderBy(orderBy, 'p.created_at');
  const orderDirectionClause = sanitizeOrderDirection(orderDirection, 'DESC');

  const params = [];
  let whereClause = 'WHERE p.is_active = $1';
  params.push(isActive);

  if (facilityId) {
    whereClause += ` AND p.facility_id = $${params.length + 1}`;
    params.push(facilityId);
  }

  if (guardianId) {
    whereClause += ` AND p.guardian_id = $${params.length + 1}`;
    params.push(guardianId);
  }

  // Add custom vaccination filters
  if (customWhere && customWhere.length > 0) {
    whereClause += ` AND ${customWhere.join(' AND ')}`;
  }

  const result = await pool.query(
    `
      SELECT DISTINCT
        p.*,
        p.control_number,
        g.name as guardian_name,
        g.phone as guardian_phone,
        vr.next_due_date as upcoming_vaccination_date
      FROM public.patients p
      LEFT JOIN public.guardians g ON g.id = p.guardian_id
      LEFT JOIN public.immunization_records vr ON vr.patient_id = p.id
      ${whereClause}
      ORDER BY ${orderByClause} ${orderDirectionClause}
      LIMIT $${params.length + 1}::bigint OFFSET $${params.length + 2}::bigint
    `,
    [...params, pagination.limit, pagination.offset]
  );

  return {
    patients: result.rows || []
  };
};

/**
 * Get patient statistics
 */
const getPatientStatistics = async (filters = {}) => {
  const {
    facilityId,
    guardianId,
    isActive = true,
    dateFrom,
    dateTo
  } = filters;

  const params = [];
  let whereClause = 'WHERE is_active = $1';
  params.push(isActive);

  if (facilityId) {
    whereClause += ` AND facility_id = $${params.length + 1}`;
    params.push(facilityId);
  }

  if (guardianId) {
    whereClause += ` AND guardian_id = $${params.length + 1}`;
    params.push(guardianId);
  }

  if (dateFrom) {
    whereClause += ` AND created_at >= $${params.length + 1}`;
    params.push(dateFrom);
  }

  if (dateTo) {
    whereClause += ` AND created_at <= $${params.length + 1}`;
    params.push(dateTo);
  }

  const [totalResult, thisMonthResult, bySexResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) as count FROM public.patients ${whereClause}`, params),
    pool.query(`
      SELECT COUNT(*) as count
      FROM public.patients 
      ${whereClause}
        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
    `, params),
    pool.query(`
      SELECT sex, COUNT(*) as count
      FROM public.patients 
      ${whereClause}
      GROUP BY sex
    `, params)
  ]);

  const sexStats = {};
  bySexResult.rows.forEach((row) => {
    sexStats[row.sex] = parseInt(row.count, 10);
  });

  return {
    totalInfants: parseInt(totalResult.rows[0].count, 10),
    thisMonth: parseInt(thisMonthResult.rows[0].count, 10),
    bySex: sexStats,
  };
};

module.exports = {
  getPatients,
  getPatientById,
  getPatientsByGuardianId,
  createPatient,
  updatePatient,
  deletePatient,
  patientExists,
  getPatientStatistics,
  getPatientsWithVaccinationFilters,
  syncToLegacyInfants,
};
