const pool = require('../db');

let initializationPromise = null;

const quoteIdentifier = (value) => `"${String(value || '').replace(/"/g, '""')}"`;

const queryExistingColumns = async (tableName, columnNames) => {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = ANY($2::text[])
    `,
    [tableName, columnNames],
  );

  return new Set((result.rows || []).map((row) => row.column_name));
};

const queryAppointmentsInfantForeignKeys = async () => {
  const result = await pool.query(
    `
      SELECT DISTINCT
        con.conname,
        target_table.relname AS target_table
      FROM pg_constraint con
      INNER JOIN pg_class source_table
        ON source_table.oid = con.conrelid
      INNER JOIN pg_namespace source_namespace
        ON source_namespace.oid = source_table.relnamespace
      INNER JOIN pg_class target_table
        ON target_table.oid = con.confrelid
      INNER JOIN pg_attribute source_attribute
        ON source_attribute.attrelid = source_table.oid
       AND source_attribute.attnum = ANY(con.conkey)
      WHERE source_namespace.nspname = 'public'
        AND source_table.relname = 'appointments'
        AND con.contype = 'f'
        AND source_attribute.attname = 'infant_id'
    `,
  );

  return result.rows || [];
};

const initializeAppointmentRuntimeSchema = async () => {
  const appointmentColumns = await queryExistingColumns('appointments', ['infant_id']);
  if (!appointmentColumns.has('infant_id')) {
    return true;
  }

  const foreignKeys = await queryAppointmentsInfantForeignKeys();
  const hasPatientsForeignKey = foreignKeys.some((row) => row.target_table === 'patients');
  if (hasPatientsForeignKey) {
    return true;
  }

  const dropClauses = foreignKeys
    .map((row) => row.conname)
    .filter(Boolean)
    .map((constraintName) => `DROP CONSTRAINT IF EXISTS ${quoteIdentifier(constraintName)}`);

  const alterClauses = [
    ...dropClauses,
    'ADD CONSTRAINT appointments_infant_id_fkey FOREIGN KEY (infant_id) REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE NOT VALID',
  ];

  await pool.query(
    `
      ALTER TABLE appointments
      ${alterClauses.join(',\n      ')}
    `,
  );

  try {
    await pool.query('ALTER TABLE appointments VALIDATE CONSTRAINT appointments_infant_id_fkey');
  } catch (validationError) {
    console.warn(
      'Appointment infant foreign key now points to patients(id), but existing legacy rows could not be validated immediately:',
      validationError.message,
    );
  }

  console.info('Appointment runtime schema compatibility ensured.');
  return true;
};

const ensureAppointmentRuntimeSchemaInitialized = async () => {
  if (!initializationPromise) {
    initializationPromise = initializeAppointmentRuntimeSchema().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
};

if (process.env.NODE_ENV !== 'test') {
  ensureAppointmentRuntimeSchemaInitialized().catch((error) => {
    console.error('Failed to initialize appointment runtime schema:', error);
  });
}

module.exports = {
  ensureAppointmentRuntimeSchemaInitialized,
};
