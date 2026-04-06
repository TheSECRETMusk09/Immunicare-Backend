const pool = require('../db');

const allowRuntimeSchemaMutations =
  String(process.env.ALLOW_RUNTIME_SCHEMA_MUTATIONS || 'false').toLowerCase() === 'true';

let initializationPromise = null;

const queryTableExists = async (tableName) => {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName],
  );

  return Boolean(result.rows?.[0]?.exists);
};

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

const applyLegacyBootstrap = async () => {
  await pool.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS purok VARCHAR(50)');
  await pool.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS street_color VARCHAR(255)');
  await pool.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS allergy_information TEXT');
  await pool.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS health_care_provider VARCHAR(255)');
  await pool.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS age_months INTEGER');
  await pool.query(`
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
  await pool.query(`
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

const initializeInfantRuntimeSchema = async () => {
  const requiredPatientColumns = [
    'purok',
    'street_color',
    'allergy_information',
    'health_care_provider',
    'age_months',
  ];

  const [patientColumns, hasInfantAllergies, hasTransferInCases] = await Promise.all([
    queryExistingColumns('patients', requiredPatientColumns),
    queryTableExists('infant_allergies'),
    queryTableExists('transfer_in_cases'),
  ]);

  const missingColumns = requiredPatientColumns.filter((columnName) => !patientColumns.has(columnName));
  const missingTables = [];
  if (!hasInfantAllergies) {
    missingTables.push('infant_allergies');
  }
  if (!hasTransferInCases) {
    missingTables.push('transfer_in_cases');
  }

  if (missingColumns.length === 0 && missingTables.length === 0) {
    return true;
  }

  if (!allowRuntimeSchemaMutations) {
    console.error(
      [
        'Infant schema bootstrap requirements are missing.',
        missingColumns.length > 0 ? `Columns: ${missingColumns.join(', ')}` : null,
        missingTables.length > 0 ? `Tables: ${missingTables.join(', ')}` : null,
        'Run the database migrations before starting the server or enable ALLOW_RUNTIME_SCHEMA_MUTATIONS=true for one-time legacy bootstrap.',
      ]
        .filter(Boolean)
        .join(' '),
    );
    return false;
  }

  await applyLegacyBootstrap();
  console.info('Infant runtime schema bootstrap completed.');
  return true;
};

const ensureInfantRuntimeSchemaInitialized = async () => {
  if (!initializationPromise) {
    initializationPromise = initializeInfantRuntimeSchema().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
};

if (process.env.NODE_ENV !== 'test') {
  ensureInfantRuntimeSchemaInitialized().catch((error) => {
    console.error('Failed to initialize infant runtime schema:', error);
  });
}

module.exports = {
  ensureInfantRuntimeSchemaInitialized,
};
