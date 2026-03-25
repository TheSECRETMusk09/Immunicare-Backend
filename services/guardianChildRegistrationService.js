const pool = require('../db');
const {
  resolveOrCreateInfantPatient,
} = require('./infantControlNumberService');
const { ensureAtBirthVaccinationRecords } = require('./atBirthVaccinationService');
const {
  isValidPurok,
  isValidStreetColorForPurok,
} = require('../utils/purokOptions');

let ensurePatientLocationColumnsPromise = null;

const ensurePatientLocationColumnsExist = async (client = pool) => {
  if (!ensurePatientLocationColumnsPromise || client !== pool) {
    const runner = async () => {
      await client.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS purok VARCHAR(50)');
      await client.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS street_color VARCHAR(255)');
      await client.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS allergy_information TEXT');
      await client.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS health_care_provider VARCHAR(255)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS infant_allergies (
          id SERIAL PRIMARY KEY,
          infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
          allergy_type VARCHAR(100),
          allergen VARCHAR(255),
          severity VARCHAR(50),
          reaction_description TEXT,
          onset_date DATE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS transfer_in_cases (
          id SERIAL PRIMARY KEY,
          infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
          validation_status VARCHAR(50),
          source_facility VARCHAR(255),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    };

    if (client === pool) {
      ensurePatientLocationColumnsPromise = runner().catch((error) => {
        ensurePatientLocationColumnsPromise = null;
        throw error;
      });
      return ensurePatientLocationColumnsPromise;
    }

    return runner();
  }

  return ensurePatientLocationColumnsPromise;
};

const toNullableString = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
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
  const { requirePurokFields = false } = options;
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

const buildValidationError = (errors, message = 'Please correct the highlighted child registration fields.') => {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.fields = errors;
  return error;
};

const createGuardianChildRecord = async ({
  guardianId,
  payload,
  client = pool,
  requirePurokFields = true,
}) => {
  await ensurePatientLocationColumnsExist(client);

  if (!guardianId || Number.isNaN(parseInt(guardianId, 10))) {
    const error = new Error('Guardian account mapping is missing. Please sign in again.');
    error.code = 'GUARDIAN_MAPPING_MISSING';
    throw error;
  }

  const validationResult = validateInfantPayload(payload, { requirePurokFields });
  if (!validationResult.isValid) {
    throw buildValidationError(validationResult.errors);
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
          purok: infantData.purok,
          street_color: infantData.street_color,
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
      client,
    );
  } catch (error) {
    throw error;
  }

  let result;

  if (resolved.existed) {
    const existingResult = await client.query(
      `
        SELECT *
        FROM patients
        WHERE id = $1
        LIMIT 1
      `,
      [resolved.id],
    );

    if (existingResult.rows.length === 0) {
      const error = new Error('Failed to resolve child record');
      error.code = 'CHILD_RESOLUTION_FAILED';
      throw error;
    }

    const existingInfant = existingResult.rows[0];
    if (parseInt(existingInfant.guardian_id, 10) !== parseInt(guardianId, 10)) {
      const error = new Error('Matched child record is not owned by this guardian account.');
      error.code = 'FOREIGN_CHILD_MATCH';
      throw error;
    }

    const {
      updates: backfillUpdates,
      values: backfillValues,
      nextParamIndex: backfillParamIndex,
    } = buildBackfillAssignments({
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
      purok: infantData.purok,
      street_color: infantData.street_color,
      family_no: infantData.family_no,
      time_of_delivery: infantData.time_of_delivery,
      type_of_delivery: infantData.type_of_delivery,
      doctor_midwife_nurse: infantData.doctor_midwife_nurse,
      nbs_done: infantData.nbs_done,
      nbs_date: infantData.nbs_date,
      cellphone_number: infantData.cellphone_number,
      facility_id: infantData.facility_id,
    });

    if (backfillUpdates.length > 0) {
      result = await client.query(
        `
          UPDATE patients
          SET ${backfillUpdates.join(', ')},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $${backfillParamIndex}
            AND guardian_id = $${backfillParamIndex + 1}
          RETURNING *
        `,
        [...backfillValues, resolved.id, guardianId],
      );
    } else {
      result = existingResult;
    }
  } else {
    result = await client.query(
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
    const error = new Error('Failed to resolve child record');
    error.code = 'CHILD_RESOLUTION_FAILED';
    throw error;
  }

  await ensureAtBirthVaccinationRecords(resolved.id, {
    patientDob: result.rows[0].dob,
    client,
  });

  return {
    patient: result.rows[0],
    controlNumber: resolved.control_number,
    existed: resolved.existed,
  };
};

module.exports = {
  createGuardianChildRecord,
  ensurePatientLocationColumnsExist,
};
