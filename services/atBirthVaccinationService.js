const pool = require('../db');
const { validateApprovedVaccineName } = require('../utils/approvedVaccines');

const AUTO_AT_BIRTH_SOURCE = 'AUTO_AT_BIRTH';
const AT_BIRTH_VACCINE_NAMES = Object.freeze(['BCG', 'Hepa B']);

const normalizeDateOnly = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().split('T')[0];
};

const isAutoAtBirthRecord = (record = {}) =>
  String(record?.source_facility || '').trim().toUpperCase() === AUTO_AT_BIRTH_SOURCE;

const resolveClient = (client) => client || pool;

const getPatientDob = async (client, patientId) => {
  const result = await resolveClient(client).query(
    `
      SELECT dob
      FROM patients
      WHERE id = $1
      LIMIT 1
    `,
    [patientId],
  );

  return normalizeDateOnly(result.rows?.[0]?.dob);
};

const getScheduleIdForDose = async (client, vaccineId, doseNo) => {
  const result = await resolveClient(client).query(
    `
      SELECT vs.id
      FROM vaccination_schedules vs
      WHERE vs.vaccine_id = $1
        AND COALESCE(vs.is_active, true) = true
        AND COALESCE(vs.dose_number, 1) = $2
      ORDER BY vs.id ASC
      LIMIT 1
    `,
    [vaccineId, doseNo],
  );

  return result.rows?.[0]?.id || null;
};

const findExistingDoseRecord = async (client, { patientId, vaccineId, doseNo, scheduleId = null }) => {
  const result = await resolveClient(client).query(
    `
      SELECT
        ir.id,
        ir.patient_id,
        ir.vaccine_id,
        ir.dose_no,
        ir.admin_date,
        ir.status,
        ir.source_facility,
        ir.is_imported,
        ir.transfer_case_id,
        ir.notes,
        ir.schedule_id,
        ir.is_active
      FROM immunization_records ir
      WHERE ir.patient_id = $1
        AND ir.vaccine_id = $2
        AND ir.dose_no = $3
        AND COALESCE(ir.is_active, true) = true
      ORDER BY
        CASE WHEN COALESCE(ir.schedule_id, 0) = COALESCE($4, 0) THEN 0 ELSE 1 END,
        ir.updated_at DESC NULLS LAST,
        ir.created_at DESC
      LIMIT 1
    `,
    [patientId, vaccineId, doseNo, scheduleId],
  );

  return result.rows?.[0] || null;
};

const resolveVaccineRecordTarget = async (client, vaccineName, doseNo = 1) => {
  const vaccineNameValidation = validateApprovedVaccineName(vaccineName, {
    fieldName: 'vaccine_name',
  });

  if (!vaccineNameValidation.valid) {
    throw new Error(vaccineNameValidation.error);
  }

  const vaccineResult = await resolveClient(client).query(
    `
      SELECT id, name
      FROM vaccines
      WHERE name = $1
        AND COALESCE(is_active, true) = true
      LIMIT 1
    `,
    [vaccineNameValidation.vaccineName],
  );

  if (vaccineResult.rows.length === 0) {
    throw new Error(`Approved vaccine "${vaccineNameValidation.vaccineName}" was not found in the database.`);
  }

  const vaccine = vaccineResult.rows[0];
  const scheduleId = await getScheduleIdForDose(client, vaccine.id, doseNo);

  return {
    vaccineId: vaccine.id,
    vaccineName: vaccine.name,
    scheduleId,
  };
};

const ensureAtBirthVaccinationRecords = async (patientId, { patientDob = null, client = null } = {}) => {
  const dbClient = resolveClient(client);
  const normalizedDob = normalizeDateOnly(patientDob) || (await getPatientDob(dbClient, patientId));

  if (!normalizedDob) {
    throw new Error(`Unable to resolve date of birth for patient ${patientId}`);
  }

  const results = [];

  for (const vaccineName of AT_BIRTH_VACCINE_NAMES) {
    const target = await resolveVaccineRecordTarget(dbClient, vaccineName, 1);
    const existingRecord = await findExistingDoseRecord(dbClient, {
      patientId,
      vaccineId: target.vaccineId,
      doseNo: 1,
      scheduleId: target.scheduleId,
    });

    if (!existingRecord) {
      const insertResult = await dbClient.query(
        `
          INSERT INTO immunization_records (
            patient_id,
            vaccine_id,
            dose_no,
            admin_date,
            status,
            source_facility,
            is_imported,
            schedule_id,
            notes,
            batch_id
          )
          VALUES ($1, $2, $3, $4, 'completed', $5, false, $6, NULL, NULL)
          RETURNING *
        `,
        [patientId, target.vaccineId, 1, normalizedDob, AUTO_AT_BIRTH_SOURCE, target.scheduleId],
      );

      results.push({ action: 'created', record: insertResult.rows[0] });
      continue;
    }

    const normalizedExistingDate = normalizeDateOnly(existingRecord.admin_date);
    const normalizedExistingStatus = String(existingRecord.status || '').trim().toLowerCase();

    if (normalizedExistingStatus === 'completed' && normalizedExistingDate) {
      results.push({ action: 'preserved', record: existingRecord });
      continue;
    }

    const updateResult = await dbClient.query(
      `
        UPDATE immunization_records
        SET admin_date = COALESCE(admin_date, $1),
            status = 'completed',
            source_facility = COALESCE(source_facility, $2),
            schedule_id = COALESCE(schedule_id, $3),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
      `,
      [normalizedDob, AUTO_AT_BIRTH_SOURCE, target.scheduleId, existingRecord.id],
    );

    results.push({ action: 'normalized', record: updateResult.rows[0] });
  }

  return results;
};

const importVaccinationRecord = async ({
  patientId,
  vaccineName,
  doseNo = 1,
  adminDate,
  sourceFacility = null,
  transferCaseId = null,
  notes = null,
  client = null,
}) => {
  const dbClient = resolveClient(client);
  const normalizedAdminDate = normalizeDateOnly(adminDate);

  if (!normalizedAdminDate) {
    throw new Error(`A valid administration date is required for ${vaccineName} dose ${doseNo}.`);
  }

  const target = await resolveVaccineRecordTarget(dbClient, vaccineName, doseNo);
  const existingRecord = await findExistingDoseRecord(dbClient, {
    patientId,
    vaccineId: target.vaccineId,
    doseNo,
    scheduleId: target.scheduleId,
  });

  if (!existingRecord) {
    const insertResult = await dbClient.query(
      `
        INSERT INTO immunization_records (
          patient_id,
          vaccine_id,
          dose_no,
          admin_date,
          status,
          is_imported,
          source_facility,
          transfer_case_id,
          notes,
          schedule_id,
          batch_id
        )
        VALUES ($1, $2, $3, $4, 'completed', true, $5, $6, $7, $8, NULL)
        RETURNING *
      `,
      [
        patientId,
        target.vaccineId,
        doseNo,
        normalizedAdminDate,
        sourceFacility || null,
        transferCaseId || null,
        notes || null,
        target.scheduleId,
      ],
    );

    return {
      action: 'created',
      record: insertResult.rows[0],
      message: 'Imported successfully',
    };
  }

  const existingAdminDate = normalizeDateOnly(existingRecord.admin_date);
  const existingStatus = String(existingRecord.status || '').trim().toLowerCase();

  if (existingAdminDate === normalizedAdminDate && existingStatus === 'completed') {
    return {
      action: 'skipped',
      record: existingRecord,
      message: 'Duplicate record',
    };
  }

  if (
    isAutoAtBirthRecord(existingRecord) ||
    !existingAdminDate ||
    existingStatus === 'pending' ||
    existingStatus === 'scheduled'
  ) {
    const updateResult = await dbClient.query(
      `
        UPDATE immunization_records
        SET admin_date = $1,
            status = 'completed',
            is_imported = true,
            source_facility = $2,
            transfer_case_id = $3,
            notes = $4,
            schedule_id = COALESCE(schedule_id, $5),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
        RETURNING *
      `,
      [
        normalizedAdminDate,
        sourceFacility || existingRecord.source_facility || null,
        transferCaseId || existingRecord.transfer_case_id || null,
        notes || null,
        target.scheduleId,
        existingRecord.id,
      ],
    );

    return {
      action: 'updated',
      record: updateResult.rows[0],
      message: 'Imported successfully',
    };
  }

  return {
    action: 'skipped',
    record: existingRecord,
    message: 'Existing record preserved',
  };
};

module.exports = {
  AT_BIRTH_VACCINE_NAMES,
  AUTO_AT_BIRTH_SOURCE,
  isAutoAtBirthRecord,
  normalizeDateOnly,
  ensureAtBirthVaccinationRecords,
  importVaccinationRecord,
};
