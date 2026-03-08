#!/usr/bin/env node

/**
 * COMPREHENSIVE API TEST SCRIPT
 *
 * Tests all critical API endpoints for:
 * - Authentication
 * - Guardian dashboard
 * - Database connections
 * - Routing
 */

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
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60));
}

// Test configuration
const BASE_URL = 'http://localhost:5000';
const API_BASE = `${BASE_URL}/api`;

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// Make HTTP request
function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 5000,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : null;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Run a test
async function runTest(name, method, path, data = null, headers = {}, expectedStatus = 200) {
  try {
    log(`Testing: ${name}`, 'cyan');
    const response = await makeRequest(method, path, data, headers);

    const passed = response.status === expectedStatus;
    if (passed) {
      log(`  ✓ PASS - Status: ${response.status}`, 'green');
      results.passed++;
    } else {
      log(`  ✗ FAIL - Expected ${expectedStatus}, got ${response.status}`, 'red');
      if (response.body) {
        log(`    Response: ${JSON.stringify(response.body).substring(0, 200)}`, 'yellow');
      }
      results.failed++;
    }

    results.tests.push({
      name,
      method,
      path,
      expectedStatus,
      actualStatus: response.status,
      passed,
      response: response.body
    });

    return passed;
  } catch (error) {
    log(`  ✗ FAIL - Error: ${error.message}`, 'red');
    results.failed++;
    results.tests.push({
      name,
      method,
      path,
      expectedStatus,
      actualStatus: 'ERROR',
      passed: false,
      error: error.message
    });
    return false;
  }
}

// Check if server is running
async function checkServer() {
  logSection('CHECKING SERVER STATUS');

  try {
    const response = await makeRequest('GET', '/');
    if (response.status === 200) {
      log('✓ Backend server is running', 'green');
      log(`  Response: ${JSON.stringify(response.body)}`, 'cyan');
      return true;
    } else {
      log(`✗ Server returned status ${response.status}`, 'red');
      return false;
    }
  } catch (error) {
    log('✗ Cannot connect to backend server', 'red');
    log(`  Error: ${error.message}`, 'yellow');
    log(`  Make sure the server is running on ${BASE_URL}`, 'yellow');
    log('  Run: cd backend && npm start', 'yellow');
    return false;
  }
}

// Test health endpoint
async function testHealth() {
  logSection('TESTING HEALTH ENDPOINT');
  await runTest('Health Check', 'GET', '/api/health', null, {}, 200);
}

// Test authentication endpoints
async function testAuth() {
  logSection('TESTING AUTHENTICATION ENDPOINTS');

  // Test login with existing guardian
  await runTest(
    'Login (Guardian)',
    'POST',
    '/api/auth/login',
    {
      username: 'guardian_639182345678',
      password: 'Guardian123!'
    },
    {},
    200
  );

  // Test login with invalid credentials
  await runTest(
    'Login (Invalid Credentials)',
    'POST',
    '/api/auth/login',
    {
      username: 'invalid',
      password: 'invalid'
    },
    {},
    401
  );
}

// Test dashboard endpoints (will fail without auth token, but we can check if routes exist)
async function testDashboard() {
  logSection('TESTING DASHBOARD ENDPOINTS');

  // These will return 401 without auth, but we can verify the routes exist
  await runTest('Dashboard Stats', 'GET', '/api/dashboard/stats', null, {}, 401);
  await runTest('Dashboard Health', 'GET', '/api/dashboard/health', null, {}, 200);
}

// Test infants endpoints
async function testInfants() {
  logSection('TESTING INFANTS ENDPOINTS');

  await runTest('Get All Infants', 'GET', '/api/infants', null, {}, 401);
  await runTest('Infants Stats', 'GET', '/api/infants/stats/overview', null, {}, 401);
}

// Test guardian-specific endpoints
async function testGuardianEndpoints() {
  logSection('TESTING GUARDIAN-SPECIFIC ENDPOINTS');

  // Test guardian infants route (this was the routing issue we fixed)
  await runTest('Get Infants by Guardian', 'GET', '/api/infants/guardian/1', null, {}, 401);

  // Test guardian dashboard stats
  await runTest(
    'Guardian Dashboard Stats',
    'GET',
    '/api/dashboard/guardian/1/stats',
    null,
    {},
    401
  );
}

// Test CORS
async function testCORS() {
  logSection('TESTING CORS CONFIGURATION');

  try {
    const response = await makeRequest('OPTIONS', '/api/health');
    if (response.headers['access-control-allow-origin']) {
      log('✓ CORS headers present', 'green');
      log(
        `  Access-Control-Allow-Origin: ${response.headers['access-control-allow-origin']}`,
        'cyan'
      );
    } else {
      log('⚠ CORS headers may be missing', 'yellow');
    }
  } catch (error) {
    log(`✗ CORS test failed: ${error.message}`, 'red');
  }
}

// Generate report
function generateReport() {
  logSection('TEST RESULTS SUMMARY');

  const total = results.passed + results.failed;
  const percentage = total > 0 ? ((results.passed / total) * 100).toFixed(1) : 0;

  log(`\nTotal Tests: ${total}`, 'bright');
  log(`Passed: ${results.passed}`, 'green');
  log(`Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'green');
  log(`Success Rate: ${percentage}%`, percentage >= 80 ? 'green' : 'yellow');

  if (results.failed > 0) {
    log('\nFailed Tests:', 'red');
    results.tests
      .filter((t) => !t.passed)
      .forEach((t) => {
        log(`  ✗ ${t.name}`, 'red');
        log(`    ${t.method} ${t.path}`, 'yellow');
        if (t.error) {
          log(`    Error: ${t.error}`, 'yellow');
        }
      });
  }

  // Save report to file
  const reportPath = './API_TEST_REPORT.json';
  const fs = require('fs');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  log(`\n✓ Detailed report saved to: ${reportPath}`, 'green');

  // Recommendations
  logSection('RECOMMENDATIONS');

  if (results.failed === 0) {
    log('✓ All tests passed! The system is working correctly.', 'green');
  } else {
    const authFailures = results.tests.filter((t) => !t.passed && t.path.includes('/auth/')).length;
    const dashboardFailures = results.tests.filter(
      (t) => !t.passed && t.path.includes('/dashboard/')
    ).length;
    const infantsFailures = results.tests.filter(
      (t) => !t.passed && t.path.includes('/infants/')
    ).length;

    if (authFailures > 0) {
      log('• Check authentication configuration and user credentials', 'yellow');
    }
    if (dashboardFailures > 0) {
      log('• Verify dashboard routes and database connections', 'yellow');
    }
    if (infantsFailures > 0) {
      log('• Check infants routing order and database tables', 'yellow');
    }
  }

  log('\nNext steps:', 'bright');
  log('1. Start the backend server: cd backend && npm start', 'cyan');
  log('2. Start the frontend server: cd frontend && npm start', 'cyan');
  log('3. Open browser to: http://localhost:3000', 'cyan');
  log('4. Login with guardian credentials', 'cyan');
}

// Main execution
async function main() {
  log('\n' + '='.repeat(60));
  log('IMMUNICARE API TEST SUITE', 'bright');
  log('='.repeat(60));

  // Check if server is running
  const serverRunning = await checkServer();
  if (!serverRunning) {
    log('\n✗ Cannot proceed with tests - server is not running', 'red');
    process.exit(1);
  }

  // Run tests
  await testHealth();
  await testAuth();
  await testDashboard();
  await testInfants();
  await testGuardianEndpoints();
  await testCORS();

  // Generate report
  generateReport();

  log('\n' + '='.repeat(60));
  log('TEST SUITE COMPLETED', 'bright');
  log('='.repeat(60) + '\n');

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run the tests
main().catch((error) => {
  log(`\n✗ Test suite failed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
