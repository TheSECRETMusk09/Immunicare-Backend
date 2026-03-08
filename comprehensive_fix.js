#!/usr/bin/env node

/**
 * COMPREHENSIVE FIX SCRIPT FOR IMMUNICARE
 *
 * This script diagnoses and fixes:
 * 1. Routing connections
 * 2. Database connections
 * 3. API connections
 * 4. Guardian dashboard UI rendering issues
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60));
}

// Load environment variables
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = {};
    envContent.split('\n').forEach((line) => {
      const [key, ...valueParts] = line.split('=');
      if (key && !key.startsWith('#')) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    });
    return envVars;
  }
  return {};
}

// Test database connection
async function testDatabaseConnection() {
  logSection('TESTING DATABASE CONNECTION');

  const env = loadEnv();
  const pool = new Pool({
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT) || 5432,
    database: env.DB_NAME || 'immunicare_dev',
    user: env.DB_USER || 'immunicare_dev',
    password: env.DB_PASSWORD || 'ImmunicareDev2024!'
  });

  try {
    log('Connecting to database...', 'cyan');
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    log('✓ Database connection successful!', 'green');
    log(`  Server time: ${result.rows[0].current_time}`, 'cyan');
    log(`  PostgreSQL version: ${result.rows[0].pg_version.split(' ')[1]}`, 'cyan');

    // Check critical tables
    const tablesToCheck = [
      'users',
      'guardians',
      'patients',
      'infants',
      'roles',
      'clinics',
      'immunization_records',
      'appointments',
      'vaccines',
      'notifications'
    ];

    log('\nChecking critical tables...', 'cyan');
    const tableResults = await pool.query(
      `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = ANY($1)
    `,
      [tablesToCheck]
    );

    const existingTables = tableResults.rows.map((r) => r.table_name);
    const missingTables = tablesToCheck.filter((t) => !existingTables.includes(t));

    if (missingTables.length > 0) {
      log(`✗ Missing tables: ${missingTables.join(', ')}`, 'red');
    } else {
      log('✓ All critical tables exist', 'green');
    }

    // Check for test guardian user
    log('\nChecking for test guardian user...', 'cyan');
    const guardianResult = await pool.query(`
      SELECT u.id, u.username, u.email, u.is_active, u.force_password_change, g.id as guardian_id
      FROM users u
      LEFT JOIN guardians g ON u.guardian_id = g.id
      WHERE u.role_id = (SELECT id FROM roles WHERE name = 'guardian' LIMIT 1)
      LIMIT 5
    `);

    if (guardianResult.rows.length > 0) {
      log(`✓ Found ${guardianResult.rows.length} guardian user(s)`, 'green');
      guardianResult.rows.forEach((user) => {
        log(
          `  - ${user.username} (${user.email}) - Active: ${user.is_active}, Force Password Change: ${user.force_password_change}`,
          'cyan'
        );
      });
    } else {
      log('✗ No guardian users found', 'yellow');
    }

    await pool.end();
    return { success: true, missingTables };
  } catch (error) {
    log(`✗ Database connection failed: ${error.message}`, 'red');
    await pool.end().catch(() => {});
    return { success: false, error: error.message };
  }
}

// Fix infants.js routing order issue
function fixInfantsRouting() {
  logSection('FIXING INFANTS ROUTING ORDER');

  const infantsPath = path.join(__dirname, 'routes', 'infants.js');

  if (!fs.existsSync(infantsPath)) {
    log('✗ infants.js not found', 'red');
    return false;
  }

  let content = fs.readFileSync(infantsPath, 'utf8');

  // Check if the route order is already correct
  const guardianRouteIndex = content.indexOf('router.get(\'/guardian/:guardianId\'');
  const searchRouteIndex = content.indexOf('router.get(\'/search/:query\'');
  const ageRangeRouteIndex = content.indexOf('router.get(\'/age-range/:minAge/:maxAge\'');

  if (guardianRouteIndex === -1) {
    log('✗ Guardian route not found in infants.js', 'red');
    return false;
  }

  // The guardian route should come BEFORE search and age-range routes
  // because Express matches routes in order
  if (guardianRouteIndex > searchRouteIndex || guardianRouteIndex > ageRangeRouteIndex) {
    log(
      '⚠ Route order issue detected - guardian route should come before search and age-range routes',
      'yellow'
    );

    // Extract the guardian route
    const guardianRouteMatch = content.match(
      /\/\/ Get infants by guardian[\s\S]*?router\.get\('\/guardian\/:guardianId'[\s\S]*?\n\}\);/
    );

    if (guardianRouteMatch) {
      const guardianRoute = guardianRouteMatch[0];

      // Remove the guardian route from its current position
      content = content.replace(guardianRoute, '');

      // Find the position after the DELETE route and before the search route
      const deleteRouteEnd = content.indexOf('module.exports = router;');

      if (deleteRouteEnd !== -1) {
        // Insert guardian route before the module.exports
        content =
          content.slice(0, deleteRouteEnd) +
          '\n' +
          guardianRoute +
          '\n' +
          content.slice(deleteRouteEnd);

        fs.writeFileSync(infantsPath, content, 'utf8');
        log('✓ Fixed infants.js routing order', 'green');
        return true;
      }
    }
  } else {
    log('✓ Infants routing order is correct', 'green');
    return true;
  }

  return false;
}

// Check and fix API client configuration
function checkApiClientConfig() {
  logSection('CHECKING FRONTEND API CLIENT');

  const apiPath = path.join(__dirname, '..', 'frontend', 'src', 'utils', 'api.js');

  if (!fs.existsSync(apiPath)) {
    log('✗ Frontend api.js not found', 'red');
    return false;
  }

  const content = fs.readFileSync(apiPath, 'utf8');

  // Check API_BASE_URL
  const urlMatch = content.match(/const API_BASE_URL\s*=\s*([^;]+);/);
  if (urlMatch) {
    log(`API_BASE_URL: ${urlMatch[1].trim()}`, 'cyan');
  }

  // Check if withCredentials is enabled
  if (content.includes('withCredentials: true')) {
    log('✓ withCredentials is enabled (required for cookie-based auth)', 'green');
  } else {
    log('⚠ withCredentials is not enabled - cookie-based auth may not work', 'yellow');
  }

  // Check timeout configuration
  if (content.includes('timeout:')) {
    const timeoutMatch = content.match(/timeout:\s*(\d+)/);
    if (timeoutMatch) {
      log(`Request timeout: ${timeoutMatch[1]}ms`, 'cyan');
    }
  }

  return true;
}

// Check GuardianLayout component
function checkGuardianLayout() {
  logSection('CHECKING GUARDIAN LAYOUT COMPONENT');

  const layoutPath = path.join(
    __dirname,
    '..',
    'frontend',
    'src',
    'components',
    'GuardianLayout.jsx'
  );

  if (!fs.existsSync(layoutPath)) {
    log('✗ GuardianLayout.jsx not found', 'red');
    return false;
  }

  const content = fs.readFileSync(layoutPath, 'utf8');

  // Check for critical imports
  const criticalImports = ['useAuth', 'apiClient', 'GuardianSidebar'];

  let allImportsPresent = true;
  criticalImports.forEach((imp) => {
    if (!content.includes(imp)) {
      log(`✗ Missing import: ${imp}`, 'red');
      allImportsPresent = false;
    }
  });

  if (allImportsPresent) {
    log('✓ All critical imports present', 'green');
  }

  // Check for data fetching
  if (content.includes('fetchDashboardData') || content.includes('useEffect')) {
    log('✓ Data fetching logic present', 'green');
  } else {
    log('⚠ Data fetching logic may be missing', 'yellow');
  }

  // Check for error handling
  if (content.includes('try') && content.includes('catch')) {
    log('✓ Error handling present', 'green');
  } else {
    log('⚠ Error handling may be missing', 'yellow');
  }

  return true;
}

// Check App.js routing
function checkAppRouting() {
  logSection('CHECKING APP.JS ROUTING');

  const appPath = path.join(__dirname, '..', 'frontend', 'src', 'App.js');

  if (!fs.existsSync(appPath)) {
    log('✗ App.js not found', 'red');
    return false;
  }

  const content = fs.readFileSync(appPath, 'utf8');

  // Check for guardian routes
  if (content.includes('/guardian')) {
    log('✓ Guardian routes defined', 'green');

    // Check for GuardianLayout
    if (content.includes('GuardianLayout')) {
      log('✓ GuardianLayout component used', 'green');
    } else {
      log('⚠ GuardianLayout component may not be properly imported', 'yellow');
    }

    // Check for GuardianDashboard
    if (content.includes('GuardianDashboard')) {
      log('✓ GuardianDashboard route defined', 'green');
    } else {
      log('⚠ GuardianDashboard route may be missing', 'yellow');
    }
  } else {
    log('✗ Guardian routes not found', 'red');
  }

  return true;
}

// Create test guardian user if needed
async function createTestGuardian() {
  logSection('CREATING TEST GUARDIAN USER');

  const env = loadEnv();
  const pool = new Pool({
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT) || 5432,
    database: env.DB_NAME || 'immunicare_dev',
    user: env.DB_USER || 'immunicare_dev',
    password: env.DB_PASSWORD || 'ImmunicareDev2024!'
  });

  try {
    // Check if test guardian already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = \'testguardian\' OR email = \'testguardian@immunicare.com\''
    );

    if (existingUser.rows.length > 0) {
      log('✓ Test guardian user already exists', 'green');
      await pool.end();
      return true;
    }

    // Get guardian role
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = \'guardian\' LIMIT 1');

    if (roleResult.rows.length === 0) {
      log('✗ Guardian role not found', 'red');
      await pool.end();
      return false;
    }

    const guardianRoleId = roleResult.rows[0].id;

    // Get or create Guardian Portal clinic
    let clinicResult = await pool.query(
      'SELECT id FROM clinics WHERE name = \'Guardian Portal\' LIMIT 1'
    );

    let clinicId;
    if (clinicResult.rows.length === 0) {
      clinicResult = await pool.query(
        `INSERT INTO clinics (name, region, address, contact)
         VALUES ('Guardian Portal', 'Virtual', 'Online Portal', 'portal@immunicare.com')
         RETURNING id`
      );
      clinicId = clinicResult.rows[0].id;
      log('✓ Created Guardian Portal clinic', 'green');
    } else {
      clinicId = clinicResult.rows[0].id;
    }

    // Create guardian record
    const guardianResult = await pool.query(
      `INSERT INTO guardians (name, phone, email, address, relationship, is_password_set, must_change_password)
       VALUES ('Test Guardian', '+1234567890', 'testguardian@immunicare.com', '123 Test St', 'Parent', true, false)
       RETURNING id`
    );

    const guardianId = guardianResult.rows[0].id;
    log('✓ Created guardian record', 'green');

    // Create user account with default password
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash('Guardian123!', 10);

    const userResult = await pool.query(
      `INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, guardian_id, is_active, force_password_change)
       VALUES ('testguardian', $1, $2, $3, 'testguardian@immunicare.com', '+1234567890', $4, true, false)
       RETURNING id, username, email`,
      [passwordHash, guardianRoleId, clinicId, guardianId]
    );

    log('✓ Created test guardian user', 'green');
    log('  Username: testguardian', 'cyan');
    log('  Email: testguardian@immunicare.com', 'cyan');
    log('  Password: Guardian123!', 'cyan');
    log('  Role: guardian', 'cyan');

    // Create a test infant
    const infantResult = await pool.query(
      `INSERT INTO patients (first_name, last_name, dob, sex, guardian_id, clinic_id)
       VALUES ('Test', 'Baby', '2024-01-01', 'M', $1, $2)
       RETURNING id`,
      [guardianId, clinicId]
    );

    log('✓ Created test infant for guardian', 'green');

    await pool.end();
    return true;
  } catch (error) {
    log(`✗ Failed to create test guardian: ${error.message}`, 'red');
    await pool.end().catch(() => {});
    return false;
  }
}

// Generate summary report
function generateReport(results) {
  logSection('SUMMARY REPORT');

  const report = {
    timestamp: new Date().toISOString(),
    database: results.database,
    routing: results.routing,
    apiClient: results.apiClient,
    guardianLayout: results.guardianLayout,
    appRouting: results.appRouting,
    testGuardian: results.testGuardian
  };

  // Print summary
  log('\nDatabase Connection:', 'bright');
  log(
    `  Status: ${results.database.success ? '✓ Connected' : '✗ Failed'}`,
    results.database.success ? 'green' : 'red'
  );
  if (results.database.missingTables && results.database.missingTables.length > 0) {
    log(`  Missing Tables: ${results.database.missingTables.join(', ')}`, 'yellow');
  }

  log('\nRouting Fixes:', 'bright');
  log(`  Status: ${results.routing ? '✓ Fixed' : '✗ Failed'}`, results.routing ? 'green' : 'red');

  log('\nAPI Client:', 'bright');
  log(`  Status: ${results.apiClient ? '✓ OK' : '✗ Issues'}`, results.apiClient ? 'green' : 'red');

  log('\nGuardian Layout:', 'bright');
  log(
    `  Status: ${results.guardianLayout ? '✓ OK' : '✗ Issues'}`,
    results.guardianLayout ? 'green' : 'red'
  );

  log('\nApp Routing:', 'bright');
  log(
    `  Status: ${results.appRouting ? '✓ OK' : '✗ Issues'}`,
    results.appRouting ? 'green' : 'red'
  );

  log('\nTest Guardian:', 'bright');
  log(
    `  Status: ${results.testGuardian ? '✓ Created/Exists' : '✗ Failed'}`,
    results.testGuardian ? 'green' : 'red'
  );

  // Save report to file
  const reportPath = path.join(__dirname, 'FIX_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`\n✓ Detailed report saved to: ${reportPath}`, 'green');

  // Print recommendations
  logSection('RECOMMENDATIONS');

  if (!results.database.success) {
    log('1. Start PostgreSQL server and verify connection settings in .env', 'yellow');
  }

  if (results.database.missingTables && results.database.missingTables.length > 0) {
    log('2. Run database migrations to create missing tables', 'yellow');
  }

  if (!results.routing) {
    log('3. Manually review and fix infants.js routing order', 'yellow');
  }

  if (!results.apiClient) {
    log('4. Review frontend API client configuration', 'yellow');
  }

  if (!results.guardianLayout) {
    log('5. Review GuardianLayout component for missing imports or logic', 'yellow');
  }

  if (!results.appRouting) {
    log('6. Review App.js routing configuration', 'yellow');
  }

  log('\nNext steps:', 'bright');
  log('1. Start the backend server: npm start (from backend directory)', 'cyan');
  log('2. Start the frontend server: npm start (from frontend directory)', 'cyan');
  log('3. Login with test guardian credentials:', 'cyan');
  log('   - Username: testguardian', 'cyan');
  log('   - Password: Guardian123!', 'cyan');
  log('4. Navigate to: http://localhost:3000/guardian/dashboard', 'cyan');

  return report;
}

// Main execution
async function main() {
  log('\n' + '='.repeat(60));
  log('IMMUNICARE COMPREHENSIVE FIX SCRIPT', 'bright');
  log('='.repeat(60));

  const results = {
    database: null,
    routing: false,
    apiClient: false,
    guardianLayout: false,
    appRouting: false,
    testGuardian: false
  };

  // Test database connection
  results.database = await testDatabaseConnection();

  // Fix routing issues
  results.routing = fixInfantsRouting();

  // Check API client
  results.apiClient = checkApiClientConfig();

  // Check GuardianLayout
  results.guardianLayout = checkGuardianLayout();

  // Check App routing
  results.appRouting = checkAppRouting();

  // Create test guardian if database is connected
  if (results.database.success) {
    results.testGuardian = await createTestGuardian();
  }

  // Generate report
  generateReport(results);

  log('\n' + '='.repeat(60));
  log('FIX SCRIPT COMPLETED', 'bright');
  log('='.repeat(60) + '\n');
}

// Run the script
main().catch((error) => {
  log(`\n✗ Script failed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
