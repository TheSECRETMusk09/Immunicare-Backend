const path = require('path');

const requestedEnv =
  process.env.IMMUNICARE_RUNTIME_ENV ||
  process.argv[2] ||
  process.env.NODE_ENV ||
  'production';

process.env.NODE_ENV = requestedEnv;

const loadBackendEnv = require('../config/loadEnv');
loadBackendEnv();

const pool = require('../db');
const { initializeDatabase } = require('../setup_database');

const requiredCoreTables = [
  'roles',
  'clinics',
  'guardians',
  'users',
  'patients',
  'appointments',
  'vaccines',
  'vaccine_inventory',
];

const getDatabaseContext = async () => {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      current_schema() AS schema_name,
      current_user AS current_user,
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_type = 'BASE TABLE'
      )::int AS table_count
  `);

  return result.rows[0];
};

const getMissingCoreTables = async () => {
  const result = await pool.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
    `,
    [requiredCoreTables],
  );

  const existingTables = new Set(result.rows.map((row) => row.table_name));
  return requiredCoreTables.filter((tableName) => !existingTables.has(tableName));
};

const main = async () => {
  try {
    console.log('='.repeat(70));
    console.log('IMMUNICARE PRODUCTION DATABASE BOOTSTRAP');
    console.log('='.repeat(70));
    console.log(`Runtime environment: ${process.env.NODE_ENV}`);

    const beforeContext = await getDatabaseContext();
    const missingBefore = await getMissingCoreTables();

    console.log(`Connected database: ${beforeContext.database_name}`);
    console.log(`Active schema: ${beforeContext.schema_name}`);
    console.log(`Database user: ${beforeContext.current_user}`);
    console.log(`Existing base tables in schema: ${beforeContext.table_count}`);

    if (missingBefore.length === 0) {
      console.log('All required core tables already exist. Running idempotent bootstrap anyway.');
    } else {
      console.log(`Missing core tables before bootstrap: ${missingBefore.join(', ')}`);
    }

    await initializeDatabase({ closePool: false, silent: false });

    const afterContext = await getDatabaseContext();
    const missingAfter = await getMissingCoreTables();

    console.log();
    console.log('Post-bootstrap verification');
    console.log(`Base tables in schema: ${afterContext.table_count}`);

    if (missingAfter.length > 0) {
      console.error(`Bootstrap incomplete. Still missing: ${missingAfter.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    console.log('Core schema verified successfully.');
    console.log('You can now restart the backend and re-test guardian/admin flows.');
  } catch (error) {
    console.error('Production database bootstrap failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

main();
