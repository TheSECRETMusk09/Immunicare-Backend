const pool = require('../db');
const { validateApprovedVaccineName } = require('../utils/approvedVaccines');

const AUTO_AT_BIRTH_SOURCE = 'AUTO_AT_BIRTH';
const AT_BIRTH_VACCINE_NAMES = Object.freeze(['BCG', 'Hepa B']);
let immunizationRecordSchemaPromise = null;
let globalAtBirthBackfillPromise = null;

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

const resolveImmunizationRecordSchema = async () => {
  try {
    const result = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'immunization_records'
          AND column_name = ANY($1::text[])
      `,
      [['source_facility', 'is_imported', 'transfer_case_id']],
    );

    const availableColumns = new Set((result.rows || []).map((row) => row.column_name));
    return {
      hasSourceFacilityColumn: availableColumns.has('source_facility'),
      hasIsImportedColumn: availableColumns.has('is_imported'),
      hasTransferCaseIdColumn: availableColumns.has('transfer_case_id'),
    };
  } catch (error) {
    console.error('Error resolving at-birth vaccination schema:', error);
    return {
      hasSourceFacilityColumn: false,
      hasIsImportedColumn: false,
      hasTransferCaseIdColumn: false,
    };
  }
};

const getImmunizationRecordSchema = async () => {
  if (!immunizationRecordSchemaPromise) {
    immunizationRecordSchemaPromise = resolveImmunizationRecordSchema();
  }

  return immunizationRecordSchemaPromise;
};

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
  const schema = await getImmunizationRecordSchema();
  const result = await resolveClient(client).query(
    `
      SELECT
        ir.id,
        ir.patient_id,
        ir.vaccine_id,
        ir.dose_no,
        ir.admin_date,
        ir.status,
        ${schema.hasSourceFacilityColumn ? 'ir.source_facility' : 'NULL::text AS source_facility'},
        ${schema.hasIsImportedColumn ? 'ir.is_imported' : 'false AS is_imported'},
        ${schema.hasTransferCaseIdColumn ? 'ir.transfer_case_id' : 'NULL::int AS transfer_case_id'},
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
  const schema = await getImmunizationRecordSchema();
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
      const insertColumns = ['patient_id', 'vaccine_id', 'dose_no', 'admin_date', 'status'];
      const insertValues = [patientId, target.vaccineId, 1, normalizedDob, 'completed'];
      if (schema.hasSourceFacilityColumn) {
        insertColumns.push('source_facility');
        insertValues.push(AUTO_AT_BIRTH_SOURCE);
      }
      if (schema.hasIsImportedColumn) {
        insertColumns.push('is_imported');
        insertValues.push(false);
      }
      insertColumns.push('schedule_id', 'notes', 'batch_id');
      insertValues.push(target.scheduleId, null, null);

      const insertResult = await dbClient.query(
        `
          INSERT INTO immunization_records (${insertColumns.join(', ')})
          VALUES (${insertValues.map((_, index) => `$${index + 1}`).join(', ')})
          RETURNING *
        `,
        insertValues,
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

    const updateParams = [normalizedDob];
    const setClauses = [
      'admin_date = COALESCE(admin_date, $1)',
      "status = 'completed'",
    ];

    if (schema.hasSourceFacilityColumn) {
      updateParams.push(AUTO_AT_BIRTH_SOURCE);
      setClauses.push(`source_facility = COALESCE(source_facility, $${updateParams.length})`);
    }

    updateParams.push(target.scheduleId);
    setClauses.push(`schedule_id = COALESCE(schedule_id, $${updateParams.length})`);

    updateParams.push(existingRecord.id);

    const updateResult = await dbClient.query(
      `
        UPDATE immunization_records
        SET ${setClauses.join(', ')},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $${updateParams.length}
        RETURNING *
      `,
      updateParams,
    );

    results.push({ action: 'normalized', record: updateResult.rows[0] });
  }

  return results;
};

const backfillAtBirthVaccinationRecordsForAllPatients = async ({
  client = null,
} = {}) => {
  const dbClient = resolveClient(client);
  const patientResult = await dbClient.query(
    `
      SELECT id, dob
      FROM patients
      WHERE is_active = true
      ORDER BY id ASC
    `,
  );

  for (const patient of patientResult.rows || []) {
    // Keep the same normalization logic used during create/transfer/readiness,
    // but apply it uniformly to all active infants.
    // Sequential processing avoids spiking DB load on startup.
    // eslint-disable-next-line no-await-in-loop
    await ensureAtBirthVaccinationRecords(patient.id, {
      patientDob: patient.dob,
      client: dbClient,
    });
  }

  return patientResult.rows?.length || 0;
};

const ensureGlobalAtBirthVaccinationBackfillInitialized = async () => {
  if (!globalAtBirthBackfillPromise) {
    globalAtBirthBackfillPromise = backfillAtBirthVaccinationRecordsForAllPatients().catch((error) => {
      globalAtBirthBackfillPromise = null;
      throw error;
    });
  }

  return globalAtBirthBackfillPromise;
};

if (process.env.NODE_ENV !== 'test') {
  ensureGlobalAtBirthVaccinationBackfillInitialized().catch((error) => {
    console.error('Failed to initialize at-birth vaccination backfill:', error);
  });
}

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
  const schema = await getImmunizationRecordSchema();
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
    const insertColumns = ['patient_id', 'vaccine_id', 'dose_no', 'admin_date', 'status'];
    const insertValues = [patientId, target.vaccineId, doseNo, normalizedAdminDate, 'completed'];
    if (schema.hasIsImportedColumn) {
      insertColumns.push('is_imported');
      insertValues.push(true);
    }
    if (schema.hasSourceFacilityColumn) {
      insertColumns.push('source_facility');
      insertValues.push(sourceFacility || null);
    }
    if (schema.hasTransferCaseIdColumn) {
      insertColumns.push('transfer_case_id');
      insertValues.push(transferCaseId || null);
    }
    insertColumns.push('notes', 'schedule_id', 'batch_id');
    insertValues.push(notes || null, target.scheduleId, null);

    const insertResult = await dbClient.query(
      `
        INSERT INTO immunization_records (${insertColumns.join(', ')})
        VALUES (${insertValues.map((_, index) => `$${index + 1}`).join(', ')})
        RETURNING *
      `,
      insertValues,
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
    const updateParams = [normalizedAdminDate];
    const setClauses = [
      'admin_date = $1',
      "status = 'completed'",
    ];

    if (schema.hasIsImportedColumn) {
      setClauses.push('is_imported = true');
    }

    if (schema.hasSourceFacilityColumn) {
      updateParams.push(sourceFacility || existingRecord.source_facility || null);
      setClauses.push(`source_facility = $${updateParams.length}`);
    }

    if (schema.hasTransferCaseIdColumn) {
      updateParams.push(transferCaseId || existingRecord.transfer_case_id || null);
      setClauses.push(`transfer_case_id = $${updateParams.length}`);
    }

    updateParams.push(notes || null);
    setClauses.push(`notes = $${updateParams.length}`);

    updateParams.push(target.scheduleId);
    setClauses.push(`schedule_id = COALESCE(schedule_id, $${updateParams.length})`);

    updateParams.push(existingRecord.id);

    const updateResult = await dbClient.query(
      `
        UPDATE immunization_records
        SET ${setClauses.join(', ')},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $${updateParams.length}
        RETURNING *
      `,
      updateParams,
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
  backfillAtBirthVaccinationRecordsForAllPatients,
  ensureGlobalAtBirthVaccinationBackfillInitialized,
  importVaccinationRecord,
};
