const pool = require('../db');
const logger = require('../config/logger');
const { validateApprovedVaccineName } = require('../utils/approvedVaccines');
const { toClinicDateKey } = require('../utils/clinicCalendar');

const AUTO_AT_BIRTH_SOURCE = 'AUTO_AT_BIRTH';
const AT_BIRTH_VACCINE_NAMES = Object.freeze(['BCG', 'Hepa B']);
let immunizationRecordSchemaPromise = null;
let globalAtBirthBackfillPromise = null;

const normalizeDateOnly = (value) => {
  if (!value) {
    return null;
  }

  return toClinicDateKey(value) || null;
};

const isAutoAtBirthRecord = (record = {}) =>
  String(record?.source_facility || '').trim().toUpperCase() === AUTO_AT_BIRTH_SOURCE;

const isPoolUnavailableError = (error) =>
  (typeof pool.isPoolEndedError === 'function' && pool.isPoolEndedError(error)) ||
  String(error?.message || '').toLowerCase().includes('cannot use a pool after calling end on the pool');

const isDatabaseClientAvailable = (context, client = null) => {
  if (client && client !== pool) {
    if (client._ending || client._queryable === false) {
      logger.warn('Skipping at-birth vaccination database operation because client is unavailable', {
        context,
      });
      return false;
    }
    return true;
  }

  if (typeof pool.warnIfPoolUnavailable === 'function') {
    return !pool.warnIfPoolUnavailable(context);
  }

  if (pool.ended) {
    logger.warn('Skipping at-birth vaccination database operation because pool is closed', {
      context,
    });
    return false;
  }

  return true;
};

const resolveClient = (client, context) => {
  if (!isDatabaseClientAvailable(context, client)) {
    return null;
  }
  return client || pool;
};

const resolveImmunizationRecordSchema = async () => {
  try {
    const dbClient = resolveClient(null, 'atBirth.resolveImmunizationRecordSchema');
    if (!dbClient) {
      return {
        hasSourceFacilityColumn: false,
        hasIsImportedColumn: false,
        hasTransferCaseIdColumn: false,
      };
    }

    const result = await dbClient.query(
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
    if (isPoolUnavailableError(error)) {
      logger.warn('Skipped at-birth vaccination schema lookup because database pool is unavailable', {
        message: error.message,
      });
    } else {
      console.error('Error resolving at-birth vaccination schema:', error);
    }
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
  const dbClient = resolveClient(client, 'atBirth.getPatientDob');
  if (!dbClient) {
    return null;
  }

  try {
    const result = await dbClient.query(
      `
        SELECT dob
        FROM patients
        WHERE id = $1
        LIMIT 1
      `,
      [patientId],
    );

    return normalizeDateOnly(result.rows?.[0]?.dob);
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      logger.warn('Skipped patient DOB lookup because database pool is unavailable', {
        patientId,
        message: error.message,
      });
      return null;
    }
    throw error;
  }
};

const getScheduleIdForDose = async (client, vaccineId, doseNo) => {
  const dbClient = resolveClient(client, 'atBirth.getScheduleIdForDose');
  if (!dbClient) {
    return null;
  }

  try {
    const result = await dbClient.query(
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
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      logger.warn('Skipped schedule lookup because database pool is unavailable', {
        vaccineId,
        doseNo,
        message: error.message,
      });
      return null;
    }
    throw error;
  }
};

const findExistingDoseRecord = async (client, { patientId, vaccineId, doseNo, scheduleId = null }) => {
  const schema = await getImmunizationRecordSchema();
  const dbClient = resolveClient(client, 'atBirth.findExistingDoseRecord');
  if (!dbClient) {
    return null;
  }

  try {
    const result = await dbClient.query(
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
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      logger.warn('Skipped existing dose lookup because database pool is unavailable', {
        patientId,
        vaccineId,
        doseNo,
        message: error.message,
      });
      return null;
    }
    throw error;
  }
};

const resolveVaccineRecordTarget = async (client, vaccineName, doseNo = 1) => {
  const dbClient = resolveClient(client, 'atBirth.resolveVaccineRecordTarget');
  if (!dbClient) {
    return null;
  }

  const vaccineNameValidation = validateApprovedVaccineName(vaccineName, {
    fieldName: 'vaccine_name',
  });

  if (!vaccineNameValidation.valid) {
    throw new Error(vaccineNameValidation.error);
  }

  let vaccineResult;
  try {
    vaccineResult = await dbClient.query(
      `
        SELECT id, name
        FROM vaccines
        WHERE name = $1
          AND COALESCE(is_active, true) = true
        LIMIT 1
      `,
      [vaccineNameValidation.vaccineName],
    );
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      logger.warn('Skipped vaccine lookup because database pool is unavailable', {
        vaccineName: vaccineNameValidation.vaccineName,
        doseNo,
        message: error.message,
      });
      return null;
    }
    throw error;
  }

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
  const dbClient = resolveClient(client, 'atBirth.ensureAtBirthVaccinationRecords');
  if (!dbClient) {
    return [];
  }

  const results = [];
  const schema = await getImmunizationRecordSchema();
  const normalizedDob = normalizeDateOnly(patientDob) || (await getPatientDob(dbClient, patientId));

  if (!normalizedDob) {
    if (!isDatabaseClientAvailable('atBirth.ensureAtBirthVaccinationRecords.missingDob', dbClient)) {
      return results;
    }
    throw new Error(`Unable to resolve date of birth for patient ${patientId}`);
  }

  for (const vaccineName of AT_BIRTH_VACCINE_NAMES) {
    const target = await resolveVaccineRecordTarget(dbClient, vaccineName, 1);
    if (!target) {
      continue;
    }
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

      if (!isDatabaseClientAvailable('atBirth.ensureAtBirthVaccinationRecords.insert', dbClient)) {
        return results;
      }

      let insertResult;
      try {
        insertResult = await dbClient.query(
          `
            INSERT INTO immunization_records (${insertColumns.join(', ')})
            VALUES (${insertValues.map((_, index) => `$${index + 1}`).join(', ')})
            RETURNING *
          `,
          insertValues,
        );
      } catch (error) {
        if (isPoolUnavailableError(error)) {
          logger.warn('Stopped creating at-birth vaccination record because database pool is unavailable', {
            patientId,
            vaccineName,
            message: error.message,
          });
          return results;
        }
        throw error;
      }

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

    if (!isDatabaseClientAvailable('atBirth.ensureAtBirthVaccinationRecords.update', dbClient)) {
      return results;
    }

    let updateResult;
    try {
      updateResult = await dbClient.query(
        `
          UPDATE immunization_records
          SET ${setClauses.join(', ')},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $${updateParams.length}
          RETURNING *
        `,
        updateParams,
      );
    } catch (error) {
      if (isPoolUnavailableError(error)) {
        logger.warn('Stopped normalizing at-birth vaccination record because database pool is unavailable', {
          patientId,
          vaccineName,
          recordId: existingRecord.id,
          message: error.message,
        });
        return results;
      }
      throw error;
    }

    results.push({ action: 'normalized', record: updateResult.rows[0] });
  }

  return results;
};

const backfillAtBirthVaccinationRecordsForAllPatients = async ({
  client = null,
} = {}) => {
  const dbClient = resolveClient(client, 'atBirth.backfillAllPatients');
  if (!dbClient) {
    return 0;
  }

  let processedCount = 0;

  try {
    const patientResult = await dbClient.query(
      `
        SELECT id, dob
        FROM patients
        WHERE is_active = true
        ORDER BY id ASC
      `,
    );

    for (const patient of patientResult.rows || []) {
      if (!isDatabaseClientAvailable('atBirth.backfillAllPatients.loop', dbClient)) {
        logger.warn('Stopped at-birth vaccination backfill because database pool is unavailable', {
          processedCount,
        });
        return processedCount;
      }

      try {
        // Keep the same normalization logic used during create/transfer/readiness,
        // but apply it uniformly to all active infants.
        // Sequential processing avoids spiking DB load on startup.
        // eslint-disable-next-line no-await-in-loop
        await ensureAtBirthVaccinationRecords(patient.id, {
          patientDob: patient.dob,
          client: dbClient,
        });
        processedCount += 1;
      } catch (error) {
        if (isPoolUnavailableError(error)) {
          logger.warn('Stopped at-birth vaccination backfill because database pool was closed', {
            processedCount,
            message: error.message,
          });
          return processedCount;
        }
        throw error;
      }
    }

    return processedCount;
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      logger.warn('Skipped at-birth vaccination backfill because database pool is unavailable', {
        processedCount,
        message: error.message,
      });
      return processedCount;
    }
    throw error;
  }
};

const ensureGlobalAtBirthVaccinationBackfillInitialized = async () => {
  if (!globalAtBirthBackfillPromise) {
    globalAtBirthBackfillPromise = backfillAtBirthVaccinationRecordsForAllPatients().catch((error) => {
      globalAtBirthBackfillPromise = null;
      if (isPoolUnavailableError(error)) {
        logger.warn('At-birth vaccination backfill exited because database pool is unavailable', {
          message: error.message,
        });
        return 0;
      }
      throw error;
    });
  }

  return globalAtBirthBackfillPromise;
};

const startGlobalAtBirthVaccinationBackfill = async () => {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  return ensureGlobalAtBirthVaccinationBackfillInitialized();
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
  const dbClient = resolveClient(client, 'atBirth.importVaccinationRecord');
  if (!dbClient) {
    return {
      action: 'skipped',
      record: null,
      message: 'Database pool unavailable',
    };
  }

  const schema = await getImmunizationRecordSchema();
  const normalizedAdminDate = normalizeDateOnly(adminDate);

  if (!normalizedAdminDate) {
    throw new Error(`A valid administration date is required for ${vaccineName} dose ${doseNo}.`);
  }

  const target = await resolveVaccineRecordTarget(dbClient, vaccineName, doseNo);
  if (!target) {
    return {
      action: 'skipped',
      record: null,
      message: 'Database pool unavailable',
    };
  }
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

    if (!isDatabaseClientAvailable('atBirth.importVaccinationRecord.insert', dbClient)) {
      return {
        action: 'skipped',
        record: null,
        message: 'Database pool unavailable',
      };
    }

    let insertResult;
    try {
      insertResult = await dbClient.query(
        `
          INSERT INTO immunization_records (${insertColumns.join(', ')})
          VALUES (${insertValues.map((_, index) => `$${index + 1}`).join(', ')})
          RETURNING *
        `,
        insertValues,
      );
    } catch (error) {
      if (isPoolUnavailableError(error)) {
        logger.warn('Skipped vaccination import insert because database pool is unavailable', {
          patientId,
          vaccineName,
          doseNo,
          message: error.message,
        });
        return {
          action: 'skipped',
          record: null,
          message: 'Database pool unavailable',
        };
      }
      throw error;
    }

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

    if (!isDatabaseClientAvailable('atBirth.importVaccinationRecord.update', dbClient)) {
      return {
        action: 'skipped',
        record: existingRecord,
        message: 'Database pool unavailable',
      };
    }

    let updateResult;
    try {
      updateResult = await dbClient.query(
        `
          UPDATE immunization_records
          SET ${setClauses.join(', ')},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $${updateParams.length}
          RETURNING *
        `,
        updateParams,
      );
    } catch (error) {
      if (isPoolUnavailableError(error)) {
        logger.warn('Skipped vaccination import update because database pool is unavailable', {
          patientId,
          vaccineName,
          doseNo,
          recordId: existingRecord.id,
          message: error.message,
        });
        return {
          action: 'skipped',
          record: existingRecord,
          message: 'Database pool unavailable',
        };
      }
      throw error;
    }

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
  startGlobalAtBirthVaccinationBackfill,
  importVaccinationRecord,
};
