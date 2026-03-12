#!/usr/bin/env node

/**
 * FINAL VERIFICATION SCRIPT
 *
 * This script performs a comprehensive verification of all fixes applied to the Immunicare system.
 * It checks:
 * 1. Database connection and tables
 * 2. Route order in critical files
 * 3. API endpoint availability
 * 4. Guardian user availability
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const http = require('http');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, 'bright');
  console.log('='.repeat(70));
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

// Verification results
const results = {
  database: { status: 'pending', checks: [] },
  routing: { status: 'pending', checks: [] },
  api: { status: 'pending', checks: [] },
  users: { status: 'pending', checks: [] }
};

// Verify database connection and tables
async function verifyDatabase() {
  logSection('DATABASE VERIFICATION');

  const env = loadEnv();
  const pool = new Pool({
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT) || 5432,
    database: env.DB_NAME || 'immunicare_dev',
    user: env.DB_USER || 'immunicare_dev',
    password: env.DB_PASSWORD || ''
  });

  try {
    // Test connection
    log('Testing database connection...', 'cyan');
    await pool.query('SELECT NOW()');
    log('✓ Database connection successful', 'green');
    results.database.checks.push({ name: 'Connection', status: 'PASS' });

    // Check critical tables
    const tables = [
      'users',
      'guardians',
      'patients',
      'immunization_records',
      'patient_growth',
      'vaccine_batches',
      'vaccines',
      'appointments',
      'notifications'
    ];
    log('\nChecking critical tables...', 'cyan');

    for (const table of tables) {
      const result = await pool.query(
        'SELECT EXISTS(SELECT FROM pg_tables WHERE schemaname = \'public\' AND tablename = $1) as exists',
        [table]
      );
      const exists = result.rows[0].exists;
      if (exists) {
        log(`  ✓ ${table}`, 'green');
        results.database.checks.push({ name: `Table: ${table}`, status: 'PASS' });
      } else {
        log(`  ✗ ${table} - MISSING`, 'red');
        results.database.checks.push({ name: `Table: ${table}`, status: 'FAIL' });
      }
    }

    // Check guardian users
    log('\nChecking guardian users...', 'cyan');
    const guardianResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.name = 'guardian' AND u.is_active = true
    `);
    const guardianCount = parseInt(guardianResult.rows[0].count);
    log(`  ✓ Found ${guardianCount} active guardian users`, 'green');
    results.database.checks.push({ name: 'Guardian Users', status: 'PASS', count: guardianCount });

    // Check patients/infants
    log('\nChecking patients/infants...', 'cyan');
    const patientResult = await pool.query('SELECT COUNT(*) as count FROM patients');
    const patientCount = parseInt(patientResult.rows[0].count);
    log(`  ✓ Found ${patientCount} patients`, 'green');
    results.database.checks.push({ name: 'Patients', status: 'PASS', count: patientCount });

    results.database.status = 'PASS';
    await pool.end();
    return true;
  } catch (error) {
    log(`✗ Database verification failed: ${error.message}`, 'red');
    results.database.checks.push({ name: 'Connection', status: 'FAIL', error: error.message });
    results.database.status = 'FAIL';
    await pool.end().catch(() => {});
    return false;
  }
}

// Verify route order in critical files
function verifyRouting() {
  logSection('ROUTING VERIFICATION');

  const checks = [];

  // Check infants.js route order
  log('Checking infants.js route order...', 'cyan');
  const infantsPath = path.join(__dirname, 'routes', 'infants.js');
  const infantsContent = fs.readFileSync(infantsPath, 'utf8');

  const guardianRouteIndex = infantsContent.indexOf('router.get(\'/guardian/:guardianId\'');
  const searchRouteIndex = infantsContent.indexOf('router.get(\'/search/:query\'');
  const ageRangeRouteIndex = infantsContent.indexOf('router.get(\'/age-range/:minAge/:maxAge\'');

  if (
    guardianRouteIndex !== -1 &&
    guardianRouteIndex < searchRouteIndex &&
    guardianRouteIndex < ageRangeRouteIndex
  ) {
    log('  ✓ infants.js route order is correct', 'green');
    checks.push({ file: 'infants.js', status: 'PASS' });
  } else {
    log('  ✗ infants.js route order is incorrect', 'red');
    checks.push({ file: 'infants.js', status: 'FAIL' });
  }

  // Check dashboard.js route order
  log('\nChecking dashboard.js route order...', 'cyan');
  const dashboardPath = path.join(__dirname, 'routes', 'dashboard.js');
  const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

  const guardianStatsIndex = dashboardContent.indexOf('router.get(\'/guardian/:guardianId/stats\'');
  const guardiansIndex = dashboardContent.indexOf('router.get(\'/guardians\'');

  if (guardianStatsIndex !== -1 && guardianStatsIndex < guardiansIndex) {
    log('  ✓ dashboard.js route order is correct', 'green');
    checks.push({ file: 'dashboard.js', status: 'PASS' });
  } else {
    log('  ✗ dashboard.js route order is incorrect', 'red');
    checks.push({ file: 'dashboard.js', status: 'FAIL' });
  }

  results.routing.checks = checks;
  results.routing.status = checks.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
  return results.routing.status === 'PASS';
}

// Verify API endpoints
async function verifyAPI() {
  logSection('API VERIFICATION');

  const BASE_URL = 'http://localhost:5000';
  const checks = [];

  // Helper function to make request
  function makeRequest(method, path) {
    return new Promise((resolve) => {
      const url = new URL(path, BASE_URL);
      const options = {
        hostname: url.hostname,
        port: url.port || 5000,
        path: url.pathname,
        method: method
      };

      const req = http.request(options, (res) => {
        resolve({ status: res.statusCode });
      });

      req.on('error', () => resolve({ status: 'ERROR' }));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ status: 'TIMEOUT' });
      });
      req.end();
    });
  }

  // Test endpoints
  const endpoints = [
    { name: 'Root', path: '/', expected: 200 },
    { name: 'Health', path: '/api/health', expected: 200 },
    { name: 'Dashboard Health', path: '/api/dashboard/health', expected: 200 }
  ];

  for (const endpoint of endpoints) {
    log(`Testing ${endpoint.name} endpoint...`, 'cyan');
    const response = await makeRequest('GET', endpoint.path);

    if (response.status === endpoint.expected) {
      log(`  ✓ ${endpoint.name} - ${response.status}`, 'green');
      checks.push({ name: endpoint.name, status: 'PASS' });
    } else {
      log(`  ✗ ${endpoint.name} - ${response.status}`, 'red');
      checks.push({ name: endpoint.name, status: 'FAIL', actual: response.status });
    }
  }

  results.api.checks = checks;
  results.api.status = checks.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
  return results.api.status === 'PASS';
}

// Verify guardian users
async function verifyUsers() {
  logSection('GUARDIAN USER VERIFICATION');

  const env = loadEnv();
  const pool = new Pool({
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT) || 5432,
    database: env.DB_NAME || 'immunicare_dev',
    user: env.DB_USER || 'immunicare_dev',
    password: env.DB_PASSWORD || ''
  });

  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.email, u.is_active, u.force_password_change, g.id as guardian_id
      FROM users u
      LEFT JOIN guardians g ON u.guardian_id = g.id
      JOIN roles r ON u.role_id = r.id
      WHERE r.name = 'guardian' AND u.is_active = true
      ORDER BY u.username
      LIMIT 5
    `);

    if (result.rows.length > 0) {
      log(`✓ Found ${result.rows.length} active guardian users:`, 'green');
      result.rows.forEach((user) => {
        log(`  - ${user.username} (${user.email})`, 'cyan');
        log(
          `    Guardian ID: ${user.guardian_id}, Force Password Change: ${user.force_password_change}`,
          'cyan'
        );
      });
      results.users.checks = result.rows.map((u) => ({ username: u.username, status: 'PASS' }));
      results.users.status = 'PASS';
    } else {
      log('✗ No active guardian users found', 'red');
      results.users.checks = [{ name: 'Guardian Users', status: 'FAIL' }];
      results.users.status = 'FAIL';
    }

    await pool.end();
    return results.users.status === 'PASS';
  } catch (error) {
    log(`✗ User verification failed: ${error.message}`, 'red');
    results.users.checks = [{ name: 'User Verification', status: 'FAIL', error: error.message }];
    results.users.status = 'FAIL';
    await pool.end().catch(() => {});
    return false;
  }
}

// Generate final report
function generateReport() {
  logSection('FINAL VERIFICATION REPORT');

  const allChecks = [
    ...results.database.checks,
    ...results.routing.checks,
    ...results.api.checks,
    ...results.users.checks
  ];

  const passed = allChecks.filter((c) => c.status === 'PASS').length;
  const failed = allChecks.filter((c) => c.status === 'FAIL').length;
  const total = passed + failed;
  const percentage = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

  log('\nOverall Results:', 'bright');
  log(`  Total Checks: ${total}`, 'cyan');
  log(`  Passed: ${passed}`, 'green');
  log(`  Failed: ${failed}`, failed > 0 ? 'red' : 'green');
  log(`  Success Rate: ${percentage}%`, percentage >= 80 ? 'green' : 'yellow');

  log('\nCategory Results:', 'bright');
  log(
    `  Database: ${results.database.status}`,
    results.database.status === 'PASS' ? 'green' : 'red'
  );
  log(`  Routing: ${results.routing.status}`, results.routing.status === 'PASS' ? 'green' : 'red');
  log(`  API: ${results.api.status}`, results.api.status === 'PASS' ? 'green' : 'red');
  log(`  Users: ${results.users.status}`, results.users.status === 'PASS' ? 'green' : 'red');

  if (failed > 0) {
    log('\nFailed Checks:', 'red');
    allChecks
      .filter((c) => c.status === 'FAIL')
      .forEach((c) => {
        log(`  ✗ ${c.name || c.file || c.username}`, 'red');
      });
  }

  // Save report
  const reportPath = path.join(__dirname, 'VERIFICATION_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  log(`\n✓ Detailed report saved to: ${reportPath}`, 'green');

  // Recommendations
  logSection('RECOMMENDATIONS');

  if (results.database.status === 'FAIL') {
    log('• Run: node create_missing_tables.js', 'yellow');
  }

  if (results.routing.status === 'FAIL') {
    log('• Run: node fix_dashboard_routing.js', 'yellow');
  }

  if (results.api.status === 'FAIL') {
    log('• Ensure backend server is running: npm start', 'yellow');
  }

  if (results.users.status === 'FAIL') {
    log('• Create test guardian users', 'yellow');
  }

  if (
    results.database.status === 'PASS' &&
    results.routing.status === 'PASS' &&
    results.api.status === 'PASS' &&
    results.users.status === 'PASS'
  ) {
    log('\n✓ All verifications passed!', 'green');
    log('\nNext steps:', 'bright');
    log('1. Restart backend server: cd backend && npm start', 'cyan');
    log('2. Start frontend server: cd frontend && npm start', 'cyan');
    log('3. Open browser: http://localhost:3000', 'cyan');
    log('4. Login with guardian credentials', 'cyan');
    log('5. Navigate to: http://localhost:3000/guardian/dashboard', 'cyan');
  }

  return results;
}

// Main execution
async function main() {
  log('\n' + '='.repeat(70));
  log('IMMUNICARE FINAL VERIFICATION', 'bright');
  log('='.repeat(70));

  await verifyDatabase();
  verifyRouting();
  await verifyAPI();
  await verifyUsers();

  const finalResults = generateReport();

  log('\n' + '='.repeat(70));
  log('VERIFICATION COMPLETED', 'bright');
  log('='.repeat(70) + '\n');

  const allPassed =
    results.database.status === 'PASS' &&
    results.routing.status === 'PASS' &&
    results.api.status === 'PASS' &&
    results.users.status === 'PASS';

  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  log(`\n✗ Verification failed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
