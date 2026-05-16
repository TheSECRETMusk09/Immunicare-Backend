require('path');
// Set NODE_ENV to 'hostinger' to ensure the correct .env files are loaded
process.env.NODE_ENV = 'hostinger';

// Forcing SSL to false to accommodate local testing environments.
process.env.DB_SSL = 'false';

const loadBackendEnv = require('./config/loadEnv');
loadBackendEnv();

// When running the audit against a local database, switch to the dev database
// as the production one might not exist.
if (process.env.DB_HOST === '127.0.0.1' || process.env.DB_HOST === 'localhost') {
  console.log(`
INFO: Local database host detected. Overriding DB_NAME to 'immunicare_dev' for audit.`);
  process.env.DB_NAME = 'immunicare_dev';
}

const { validateEnv } = require('./utils/envValidator');
const db = require('./db');

// --- Main Audit Function ---
async function runDeploymentAudit() {
  const report = {
    summary: {
      status: 'PENDING',
      errors: [],
    },
    checks: {
      envValidation: { status: 'PENDING', message: '' },
      dbConnection: { status: 'PENDING', message: '' },
      readQuery: { status: 'PENDING', message: '' },
      writePermissions: { status: 'PENDING', message: '' },
    },
    details: {
      host: process.env.DB_HOST || 'Not Set',
      port: process.env.DB_PORT || 'Not Set',
      database: process.env.DB_NAME || 'Not Set',
      user: process.env.DB_USER || 'Not Set',
      ssl: process.env.DB_SSL || 'Not Set',
      nodeEnv: process.env.NODE_ENV,
    },
  };

  console.log('--- Starting Backend Pre-Deployment Audit for Hostinger ---');
  console.log(`Auditing with NODE_ENV='${report.details.nodeEnv}'...`);
  console.log(
    `Database target: ${report.details.user}@${report.details.host}:${report.details.port}/${report.details.database}`
  );

  // 1. Environment Variable Validation
  console.log('\n[1/4] Validating environment variables...');
  try {
    validateEnv(true); // 'true' for isProduction check
    report.checks.envValidation = {
      status: 'SUCCESS',
      message: 'All required environment variables are present.',
    };
    console.log('  > SUCCESS: All required environment variables are present.');
  } catch (error) {
    report.checks.envValidation = { status: 'FAIL', message: error.message };
    report.summary.errors.push('Environment validation failed.');
    console.error('  > FAIL:', error.message);
  }

  // Abort if env validation failed
  if (report.summary.errors.length > 0) {
    finalizeReport(report);
    return;
  }

  // 2. Database Connectivity
  console.log('\n[2/4] Testing database connectivity...');
  let client;
  try {
    client = await db.connect();
    report.checks.dbConnection = {
      status: 'SUCCESS',
      message: 'Successfully connected to the database.',
    };
    console.log('  > SUCCESS: Database connection established.');
  } catch (error) {
    report.checks.dbConnection = {
      status: 'FAIL',
      message: `Failed to connect to the database. Reason: ${error.message}`,
    };
    report.summary.errors.push('Database connection failed.');
    console.error('  > FAIL: Could not connect to the database.');
    console.error(`     Reason: ${error.message}`);
    if (client) {
      client.release();
    }
    finalizeReport(report);
    return;
  }

  // 3. Read Query
  console.log('\n[3/4] Performing sample read query...');
  try {
    const result = await client.query('SELECT NOW() as currentTime;');
    const dbTime = result.rows[0].currenttime;
    report.checks.readQuery = {
      status: 'SUCCESS',
      message: `Successfully executed a read query. DB time: ${dbTime}`,
    };
    console.log(`  > SUCCESS: Sample read query completed. (Database time: ${dbTime})`);
  } catch (error) {
    report.checks.readQuery = {
      status: 'FAIL',
      message: `Read query failed. Reason: ${error.message}`,
    };
    report.summary.errors.push('Read query failed.');
    console.error('  > FAIL: Sample read query failed.');
    console.error(`     Reason: ${error.message}`);
  }

  // 4. Write Permissions
  console.log('\n[4/4] Verifying write permissions...');
  const testTableName = 'immunicare_audit_test_20260323';
  try {
    await client.query(`CREATE TABLE ${testTableName} (id INT, stamp TIMESTAMP);`);
    console.log(`  > Step 1/3: CREATE TABLE successful.`);
    await client.query(`INSERT INTO ${testTableName} (id, stamp) VALUES (1, NOW());`);
    console.log(`  > Step 2/3: INSERT successful.`);
    await client.query(`DROP TABLE ${testTableName};`);
    console.log(`  > Step 3/3: DROP TABLE successful.`);
    report.checks.writePermissions = {
      status: 'SUCCESS',
      message: 'User has CREATE, INSERT, and DROP permissions.',
    };
    console.log('  > SUCCESS: Write permissions are correctly configured.');
  } catch (error) {
    report.checks.writePermissions = {
      status: 'FAIL',
      message: `Write permission check failed. Reason: ${error.message}`,
    };
    report.summary.errors.push('Write permissions check failed.');
    console.error('  > FAIL: Write permission check failed.');
    console.error(`     Reason: ${error.message}`);
    // Attempt to clean up in case of partial failure
    try {
      await client.query(`DROP TABLE IF EXISTS ${testTableName};`);
      console.log('  > Cleanup: Successfully dropped test table.');
    } catch (cleanupError) {
      console.error(
        '  > Cleanup WARNING: Failed to drop test table after error. Manual cleanup may be required.'
      );
    }
  }

  client.release();
  finalizeReport(report);
}

function finalizeReport(report) {
  const hasFailures = Object.values(report.checks).some((c) => c.status === 'FAIL');
  report.summary.status = hasFailures ? 'FAIL' : 'SUCCESS';

  console.log('\n--- AUDIT COMPLETE ---');
  console.log(`
Overall Status: ${report.summary.status}`);

  if (hasFailures) {
    console.log('\nDeployment Readiness: NOT READY');
    console.log('Please fix the issues marked with [FAIL] below.');
  } else {
    console.log('\nDeployment Readiness: READY');
    console.log('All checks passed. The backend appears ready for deployment.');
  }

  console.log('\n--- DETAILED REPORT ---');
  for (const [key, check] of Object.entries(report.checks)) {
    console.log(`[${check.status}] ${key}: ${check.message}`);
  }
  console.log('\n-----------------------\n');

  if (hasFailures) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runDeploymentAudit();
