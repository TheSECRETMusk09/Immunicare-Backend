const pool = require('../db');

const DEFAULT_SAMPLE_SIZE = 10;

const normalizeText = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const toIsoDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().split('T')[0];
};

const toOptionalInteger = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseArgs = (argv = []) => {
  const sampleArg = argv.find((entry) => entry.startsWith('--sample='));
  const sample = sampleArg
    ? Math.max(Number.parseInt(sampleArg.split('=')[1], 10) || DEFAULT_SAMPLE_SIZE, 1)
    : DEFAULT_SAMPLE_SIZE;

  return {
    apply: argv.includes('--apply'),
    sample,
  };
};

const buildPatientLookupKey = (record = {}) =>
  [
    normalizeText(record.first_name),
    normalizeText(record.middle_name),
    normalizeText(record.last_name),
    toIsoDate(record.dob),
    toOptionalInteger(record.guardian_id) || '',
  ].join('|');

const compareCanonicalAndLegacyRecord = (patient = {}, legacyInfant = {}) => {
  const reasons = [];

  if (toOptionalInteger(patient.id) !== toOptionalInteger(legacyInfant.id)) {
    reasons.push('id');
  }

  if (normalizeText(patient.first_name) !== normalizeText(legacyInfant.first_name)) {
    reasons.push('first_name');
  }

  if (normalizeText(patient.middle_name) !== normalizeText(legacyInfant.middle_name)) {
    reasons.push('middle_name');
  }

  if (normalizeText(patient.last_name) !== normalizeText(legacyInfant.last_name)) {
    reasons.push('last_name');
  }

  if (toIsoDate(patient.dob) !== toIsoDate(legacyInfant.dob)) {
    reasons.push('dob');
  }

  if (toOptionalInteger(patient.guardian_id) !== toOptionalInteger(legacyInfant.guardian_id)) {
    reasons.push('guardian_id');
  }

  if (
    normalizeText(patient.control_number) !==
    normalizeText(legacyInfant.patient_control_number)
  ) {
    reasons.push('control_number');
  }

  return reasons;
};

const diffPatientAndInfantSources = (patients = [], legacyInfants = []) => {
  const legacyInfantById = new Map();
  const legacyInfantByControlNumber = new Map();
  const legacyInfantByLookupKey = new Map();
  const patientById = new Map();
  const patientByControlNumber = new Map();
  const patientByLookupKey = new Map();

  legacyInfants.forEach((legacyInfant) => {
    const lookupKey = buildPatientLookupKey(legacyInfant);
    const controlNumber = normalizeText(legacyInfant.patient_control_number);

    legacyInfantById.set(toOptionalInteger(legacyInfant.id), legacyInfant);
    if (controlNumber) {
      legacyInfantByControlNumber.set(controlNumber, legacyInfant);
    }
    if (lookupKey) {
      legacyInfantByLookupKey.set(lookupKey, legacyInfant);
    }
  });

  patients.forEach((patient) => {
    const lookupKey = buildPatientLookupKey(patient);
    const controlNumber = normalizeText(patient.control_number);

    patientById.set(toOptionalInteger(patient.id), patient);
    if (controlNumber) {
      patientByControlNumber.set(controlNumber, patient);
    }
    if (lookupKey) {
      patientByLookupKey.set(lookupKey, patient);
    }
  });

  const missingInLegacyInfants = [];
  const mismatchedRecords = [];

  patients.forEach((patient) => {
    const lookupKey = buildPatientLookupKey(patient);
    const controlNumber = normalizeText(patient.control_number);
    const matchingLegacyInfant =
      legacyInfantById.get(toOptionalInteger(patient.id)) ||
      (controlNumber ? legacyInfantByControlNumber.get(controlNumber) : null) ||
      (lookupKey ? legacyInfantByLookupKey.get(lookupKey) : null);

    if (!matchingLegacyInfant) {
      missingInLegacyInfants.push(patient);
      return;
    }

    const reasons = compareCanonicalAndLegacyRecord(patient, matchingLegacyInfant);
    if (reasons.length > 0) {
      mismatchedRecords.push({
        patient,
        legacyInfant: matchingLegacyInfant,
        reasons,
      });
    }
  });

  const orphanLegacyInfants = legacyInfants.filter((legacyInfant) => {
    const lookupKey = buildPatientLookupKey(legacyInfant);
    const controlNumber = normalizeText(legacyInfant.patient_control_number);

    return !(
      patientById.get(toOptionalInteger(legacyInfant.id)) ||
      (controlNumber ? patientByControlNumber.get(controlNumber) : null) ||
      (lookupKey ? patientByLookupKey.get(lookupKey) : null)
    );
  });

  return {
    patientCount: patients.length,
    legacyInfantCount: legacyInfants.length,
    missingInLegacyInfants,
    mismatchedRecords,
    orphanLegacyInfants,
  };
};

const mapPatientToLegacyInfantRecord = (patient = {}, legacyInfantColumns = []) => {
  const availableColumns = new Set(legacyInfantColumns);
  const legacyInfantRecord = {
    id: patient.id,
    first_name: patient.first_name,
    last_name: patient.last_name,
    middle_name: patient.middle_name,
    dob: toIsoDate(patient.dob),
    sex: patient.sex,
    national_id: patient.national_id,
    address: patient.address,
    contact: patient.contact || patient.cellphone_number || null,
    guardian_id: patient.guardian_id,
    clinic_id: patient.clinic_id ?? patient.facility_id ?? null,
    birth_height: patient.birth_height,
    birth_weight: patient.birth_weight,
    mother_name: patient.mother_name,
    father_name: patient.father_name,
    barangay: patient.barangay,
    health_center: patient.health_center,
    family_no: patient.family_no,
    place_of_birth: patient.place_of_birth,
    time_of_delivery: patient.time_of_delivery,
    type_of_delivery: patient.type_of_delivery,
    doctor_midwife_nurse: patient.doctor_midwife_nurse,
    nbs_done: patient.nbs_done,
    nbs_date: toIsoDate(patient.nbs_date),
    cellphone_number: patient.cellphone_number,
    is_active: patient.is_active === undefined ? true : patient.is_active,
    created_at: patient.created_at,
    updated_at: patient.updated_at,
    patient_control_number: patient.control_number,
  };

  return Object.entries(legacyInfantRecord).reduce((payload, [columnName, value]) => {
    if (!availableColumns.has(columnName) || value === undefined) {
      return payload;
    }

    payload[columnName] = value;
    return payload;
  }, {});
};

const buildInsertStatement = (tableName, row = {}) => {
  const columns = Object.keys(row);
  const values = Object.values(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);

  return {
    text: `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO NOTHING
    `,
    values,
  };
};

const buildUpdateStatement = (tableName, row = {}, id) => {
  const columns = Object.keys(row).filter((columnName) => columnName !== 'id');
  const values = columns.map((columnName) => row[columnName]);
  const assignments = columns.map(
    (columnName, index) => `${columnName} = $${index + 1}`,
  );

  return {
    text: `
      UPDATE ${tableName}
      SET ${assignments.join(', ')}
      WHERE id = $${columns.length + 1}
    `,
    values: [...values, id],
  };
};

const getLegacyInfantColumns = async (client) => {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'infants'
      ORDER BY ordinal_position
    `,
  );

  return result.rows.map((row) => row.column_name);
};

const loadCanonicalPatients = async (client) => {
  const result = await client.query(
    `
      SELECT
        id,
        first_name,
        last_name,
        middle_name,
        dob,
        sex,
        national_id,
        address,
        contact,
        guardian_id,
        facility_id,
        birth_height,
        birth_weight,
        mother_name,
        father_name,
        barangay,
        health_center,
        family_no,
        place_of_birth,
        time_of_delivery,
        type_of_delivery,
        doctor_midwife_nurse,
        nbs_done,
        nbs_date,
        cellphone_number,
        is_active,
        created_at,
        updated_at,
        control_number
      FROM patients
      ORDER BY id ASC
    `,
  );

  return result.rows || [];
};

const loadLegacyInfants = async (client) => {
  const result = await client.query(
    `
      SELECT
        id,
        first_name,
        last_name,
        middle_name,
        dob,
        guardian_id,
        patient_control_number,
        is_active,
        created_at,
        updated_at
      FROM infants
      ORDER BY id ASC
    `,
  );

  return result.rows || [];
};

const auditPatientInfantSources = async (client) => {
  const hasLegacyInfantsResult = await client.query(
    `SELECT to_regclass('public.infants') AS table_name`,
  );

  if (!hasLegacyInfantsResult.rows?.[0]?.table_name) {
    return {
      legacyInfantsTableExists: false,
      patientCount: 0,
      legacyInfantCount: 0,
      missingInLegacyInfants: [],
      mismatchedRecords: [],
      orphanLegacyInfants: [],
      legacyInfantColumns: [],
    };
  }

  const [patients, legacyInfants, legacyInfantColumns] = await Promise.all([
    loadCanonicalPatients(client),
    loadLegacyInfants(client),
    getLegacyInfantColumns(client),
  ]);
  const diff = diffPatientAndInfantSources(patients, legacyInfants);

  return {
    legacyInfantsTableExists: true,
    legacyInfantColumns,
    ...diff,
  };
};

const syncMissingPatientsIntoLegacyInfants = async (
  client,
  auditResult = {},
) => {
  if (!auditResult.legacyInfantsTableExists) {
    return { inserted: 0 };
  }

  const legacyInfantColumns =
    auditResult.legacyInfantColumns || (await getLegacyInfantColumns(client));
  let inserted = 0;
  let updated = 0;
  let skippedMismatches = 0;

  for (const patient of auditResult.missingInLegacyInfants || []) {
    const payload = mapPatientToLegacyInfantRecord(patient, legacyInfantColumns);
    const statement = buildInsertStatement('infants', payload);
    const result = await client.query(statement.text, statement.values);
    inserted += result.rowCount || 0;
  }

  for (const mismatch of auditResult.mismatchedRecords || []) {
    if ((mismatch.reasons || []).includes('id')) {
      skippedMismatches += 1;
      continue;
    }

    const payload = mapPatientToLegacyInfantRecord(
      mismatch.patient,
      legacyInfantColumns,
    );
    const statement = buildUpdateStatement(
      'infants',
      payload,
      mismatch.legacyInfant?.id,
    );
    const result = await client.query(statement.text, statement.values);
    updated += result.rowCount || 0;
  }

  try {
    await client.query(
      `
        SELECT setval(
          'infants_id_seq',
          GREATEST((SELECT COALESCE(MAX(id), 1) FROM infants), 1),
          true
        )
      `,
    );
  } catch (_error) {
    // Ignore sequence repair failures when the legacy table uses a different sequence setup.
  }

  return {
    inserted,
    updated,
    skippedMismatches,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const client = await pool.connect();

  try {
    if (args.apply) {
      await client.query('BEGIN');
    }

    const auditResult = await auditPatientInfantSources(client);
    const summary = {
      legacyInfantsTableExists: auditResult.legacyInfantsTableExists,
      patientCount: auditResult.patientCount,
      legacyInfantCount: auditResult.legacyInfantCount,
      missingInLegacyInfants: auditResult.missingInLegacyInfants.length,
      mismatchedRecords: auditResult.mismatchedRecords.length,
      orphanLegacyInfants: auditResult.orphanLegacyInfants.length,
      sampleMissing: auditResult.missingInLegacyInfants.slice(0, args.sample).map((patient) => ({
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        dob: toIsoDate(patient.dob),
        guardian_id: patient.guardian_id,
        control_number: patient.control_number,
      })),
      sampleMismatched: auditResult.mismatchedRecords.slice(0, args.sample).map((entry) => ({
        patient_id: entry.patient?.id,
        legacy_infant_id: entry.legacyInfant?.id,
        reasons: entry.reasons,
        patient_control_number: entry.patient?.control_number,
        legacy_control_number: entry.legacyInfant?.patient_control_number,
      })),
    };

    console.log(JSON.stringify(summary, null, 2));

    if (args.apply) {
      const syncResult = await syncMissingPatientsIntoLegacyInfants(client, auditResult);
      await client.query('COMMIT');
      console.log(JSON.stringify({
        mode: 'apply',
        inserted: syncResult.inserted,
        updated: syncResult.updated,
        skippedMismatches: syncResult.skippedMismatches,
      }, null, 2));
    }
  } catch (error) {
    if (args.apply) {
      await client.query('ROLLBACK').catch(() => {});
    }

    console.error('[reconcile_patient_infant_sources] Failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.close();
  }
};

if (require.main === module) {
  void main();
}

module.exports = {
  auditPatientInfantSources,
  buildPatientLookupKey,
  diffPatientAndInfantSources,
  mapPatientToLegacyInfantRecord,
  parseArgs,
  syncMissingPatientsIntoLegacyInfants,
};
