/**
 * Comprehensive API Endpoint and Dashboard Route Test Script
 * Tests all API endpoints, authentication flows, and dashboard functionality
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';
const API_BASE = `${BASE_URL}/api`;

const testResults = {
  authRoutes: [],
  dashboardRoutes: [],
  apiEndpoints: [],
  errors: [],
  summary: {
    total: 0,
    passed: 0,
    failed: 0
  }
};

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
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
          const json = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Test authentication routes
async function testAuthRoutes() {
  console.log('\n' + '='.repeat(60));
  console.log('AUTHENTICATION ROUTES TESTS');
  console.log('='.repeat(60));

  // Test 1: Auth test endpoint
  console.log('\n[TEST 1] Auth Test Endpoint');
  try {
    const response = await makeRequest('GET', `${API_BASE}/auth/test`);
    const passed = response.status === 200;
    testResults.authRoutes.push({ test: 'Auth Test', status: response.status, passed });
    console.log(`Status: ${response.status} - ${passed ? '✅ PASS' : '❌ FAIL'}`);
  } catch (error) {
    testResults.authRoutes.push({
      test: 'Auth Test',
      status: 'ERROR',
      passed: false,
      error: error.message
    });
    testResults.errors.push({ test: 'Auth Test', error: error.message });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // Test 2: Verify without token (should return 401)
  console.log('\n[TEST 2] Verify Without Token');
  try {
    const response = await makeRequest('GET', `${API_BASE}/auth/verify`);
    const passed = response.status === 401 && response.data.authenticated === false;
    testResults.authRoutes.push({ test: 'Verify No Token', status: response.status, passed });
    console.log(`Status: ${response.status} - ${passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
  } catch (error) {
    testResults.authRoutes.push({
      test: 'Verify No Token',
      status: 'ERROR',
      passed: false,
      error: error.message
    });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // Test 3: Login with invalid credentials
  console.log('\n[TEST 3] Login with Invalid Credentials');
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/login`, {
      username: 'nonexistent_user',
      password: 'wrongpassword'
    });
    const passed = response.status === 401;
    testResults.authRoutes.push({ test: 'Invalid Login', status: response.status, passed });
    console.log(`Status: ${response.status} - ${passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
  } catch (error) {
    testResults.authRoutes.push({
      test: 'Invalid Login',
      status: 'ERROR',
      passed: false,
      error: error.message
    });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // Test 4: SQL Injection Prevention
  console.log('\n[TEST 4] SQL Injection Prevention');
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/login`, {
      username: 'admin\' OR \'1\'=\'1',
      password: 'anything'
    });
    const passed = response.status === 401 || response.status === 400;
    testResults.authRoutes.push({ test: 'SQL Injection Block', status: response.status, passed });
    console.log(
      `Status: ${response.status} - ${passed ? '✅ PASS (Blocked)' : '❌ FAIL (Not Blocked)'}`
    );
  } catch (error) {
    testResults.authRoutes.push({
      test: 'SQL Injection Block',
      status: 'ERROR',
      passed: false,
      error: error.message
    });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // Test 5: XSS Prevention
  console.log('\n[TEST 5] XSS Prevention');
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/login`, {
      username: '<script>alert("xss")</script>',
      password: 'password'
    });
    const passed = response.status === 401;
    testResults.authRoutes.push({ test: 'XSS Prevention', status: response.status, passed });
    console.log(`Status: ${response.status} - ${passed ? '✅ PASS' : '❌ FAIL'}`);
  } catch (error) {
    testResults.authRoutes.push({
      test: 'XSS Prevention',
      status: 'ERROR',
      passed: false,
      error: error.message
    });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // Test 6: Forgot Password (non-existent email)
  console.log('\n[TEST 6] Forgot Password Request');
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/forgot-password`, {
      email: 'nonexistent@test.com'
    });
    const passed = response.status === 200;
    testResults.authRoutes.push({ test: 'Forgot Password', status: response.status, passed });
    console.log(`Status: ${response.status} - ${passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
  } catch (error) {
    testResults.authRoutes.push({
      test: 'Forgot Password',
      status: 'ERROR',
      passed: false,
      error: error.message
    });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // Test 7: Empty login request
  console.log('\n[TEST 7] Empty Login Request');
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/login`, {});
    const passed = response.status === 400;
    testResults.authRoutes.push({ test: 'Empty Login', status: response.status, passed });
    console.log(`Status: ${response.status} - ${passed ? '✅ PASS' : '❌ FAIL'}`);
  } catch (error) {
    testResults.authRoutes.push({
      test: 'Empty Login',
      status: 'ERROR',
      passed: false,
      error: error.message
    });
    console.log(`❌ ERROR: ${error.message}`);
  }
}

// Test dashboard routes
async function testDashboardRoutes() {
  console.log('\n' + '='.repeat(60));
  console.log('DASHBOARD ROUTES TESTS');
  console.log('='.repeat(60));

  const dashboardEndpoints = [
    { path: '/api/dashboard/stats', method: 'GET', description: 'Dashboard Stats' },
    { path: '/api/dashboard/infants', method: 'GET', description: 'Dashboard Infants' },
    { path: '/api/dashboard/guardians', method: 'GET', description: 'Dashboard Guardians' },
    { path: '/api/dashboard/appointments', method: 'GET', description: 'Dashboard Appointments' },
    { path: '/api/dashboard/activity', method: 'GET', description: 'Dashboard Activity' },
    {
      path: '/api/dashboard/analytics/vaccinations',
      method: 'GET',
      description: 'Vaccination Analytics'
    },
    {
      path: '/api/dashboard/analytics/appointments',
      method: 'GET',
      description: 'Appointment Analytics'
    }
  ];

  for (const endpoint of dashboardEndpoints) {
    console.log(`\n[TEST] ${endpoint.description} (${endpoint.method} ${endpoint.path})`);
    try {
      // Test without authentication (should return 401)
      const unauthResponse = await makeRequest(endpoint.method, endpoint.path);
      const unauthPassed = unauthResponse.status === 401;
      testResults.dashboardRoutes.push({
        test: `${endpoint.description} (No Auth)`,
        status: unauthResponse.status,
        passed: unauthPassed
      });
      console.log(
        `  Without Auth: ${unauthResponse.status} - ${unauthPassed ? '✅ PASS' : '❌ FAIL'}`
      );

      // Test with invalid token
      const invalidResponse = await makeRequest(endpoint.method, endpoint.path, null, {
        Authorization: 'Bearer invalid_token'
      });
      const invalidPassed = invalidResponse.status === 401;
      testResults.dashboardRoutes.push({
        test: `${endpoint.description} (Invalid Token)`,
        status: invalidResponse.status,
        passed: invalidPassed
      });
      console.log(
        `  With Invalid Token: ${invalidResponse.status} - ${invalidPassed ? '✅ PASS' : '❌ FAIL'}`
      );
    } catch (error) {
      testResults.dashboardRoutes.push({
        test: endpoint.description,
        status: 'ERROR',
        passed: false,
        error: error.message
      });
      testResults.errors.push({ test: endpoint.description, error: error.message });
      console.log(`  ❌ ERROR: ${error.message}`);
    }
  }

  // Test guardian-specific routes
  console.log('\n[TEST] Guardian-Specific Routes');
  const guardianEndpoints = [
    { path: '/api/dashboard/guardian/1/stats', method: 'GET', description: 'Guardian Stats' },
    {
      path: '/api/dashboard/guardian/1/appointments',
      method: 'GET',
      description: 'Guardian Appointments'
    }
  ];

  for (const endpoint of guardianEndpoints) {
    try {
      const response = await makeRequest(endpoint.method, endpoint.path, null, {
        Authorization: 'Bearer invalid_token'
      });
      const passed = response.status === 401;
      testResults.dashboardRoutes.push({
        test: endpoint.description,
        status: response.status,
        passed
      });
      console.log(
        `  ${endpoint.description}: ${response.status} - ${passed ? '✅ PASS' : '❌ FAIL'}`
      );
    } catch (error) {
      testResults.dashboardRoutes.push({
        test: endpoint.description,
        status: 'ERROR',
        passed: false,
        error: error.message
      });
      console.log(`  ❌ ERROR: ${error.message}`);
    }
  }
}

// Test API endpoints
async function testAPIEndpoints() {
  console.log('\n' + '='.repeat(60));
  console.log('API ENDPOINTS TESTS');
  console.log('='.repeat(60));

  const apiEndpoints = [
    { path: '/api/health', method: 'GET', description: 'Health Check' },
    { path: '/api/', method: 'GET', description: 'Root Endpoint' },
    { path: '/api/nonexistent', method: 'GET', description: '404 Test' }
  ];

  for (const endpoint of apiEndpoints) {
    console.log(`\n[TEST] ${endpoint.description} (${endpoint.method} ${endpoint.path})`);
    try {
      const response = await makeRequest(endpoint.method, endpoint.path);
      const passed = response.status >= 200 && response.status < 500;
      testResults.apiEndpoints.push({
        test: endpoint.description,
        status: response.status,
        passed
      });
      console.log(`Status: ${response.status} - ${passed ? '✅ PASS' : '❌ FAIL'}`);
      if (response.data && typeof response.data === 'object') {
        console.log(`Response: ${JSON.stringify(response.data).substring(0, 200)}`);
      }
    } catch (error) {
      testResults.apiEndpoints.push({
        test: endpoint.description,
        status: 'ERROR',
        passed: false,
        error: error.message
      });
      testResults.errors.push({ test: endpoint.description, error: error.message });
      console.log(`❌ ERROR: ${error.message}`);
    }
  }
}

// Generate summary report
function generateReport() {
  const allTests = [
    ...testResults.authRoutes,
    ...testResults.dashboardRoutes,
    ...testResults.apiEndpoints
  ];

  testResults.summary.total = allTests.length;
  testResults.summary.passed = allTests.filter((t) => t.passed).length;
  testResults.summary.failed = allTests.filter((t) => !t.passed).length;

  console.log('\n' + '='.repeat(60));
  console.log('COMPREHENSIVE TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${testResults.summary.total}`);
  console.log(`Passed: ${testResults.summary.passed} ✅`);
  console.log(`Failed: ${testResults.summary.failed} ❌`);
  console.log(
    `Success Rate: ${((testResults.summary.passed / testResults.summary.total) * 100).toFixed(2)}%`
  );

  if (testResults.errors.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('ERRORS ENCOUNTERED');
    console.log('='.repeat(60));
    testResults.errors.forEach((err, i) => {
      console.log(`${i + 1}. ${err.test}: ${err.error}`);
    });
  }

  // Authentication Routes Summary
  console.log('\n' + '='.repeat(60));
  console.log('AUTHENTICATION ROUTES RESULTS');
  console.log('='.repeat(60));
  const authPassed = testResults.authRoutes.filter((t) => t.passed).length;
  const authTotal = testResults.authRoutes.length;
  console.log(
    `Passed: ${authPassed}/${authTotal} (${((authPassed / authTotal) * 100).toFixed(2)}%)`
  );

  // Dashboard Routes Summary
  console.log('\n' + '='.repeat(60));
  console.log('DASHBOARD ROUTES RESULTS');
  console.log('='.repeat(60));
  const dashPassed = testResults.dashboardRoutes.filter((t) => t.passed).length;
  const dashTotal = testResults.dashboardRoutes.length;
  console.log(
    `Passed: ${dashPassed}/${dashTotal} (${((dashPassed / dashTotal) * 100).toFixed(2)}%)`
  );

  // API Endpoints Summary
  console.log('\n' + '='.repeat(60));
  console.log('API ENDPOINTS RESULTS');
  console.log('='.repeat(60));
  const apiPassed = testResults.apiEndpoints.filter((t) => t.passed).length;
  const apiTotal = testResults.apiEndpoints.length;
  console.log(`Passed: ${apiPassed}/${apiTotal} (${((apiPassed / apiTotal) * 100).toFixed(2)}%)`);

  return testResults;
}

// Run all tests
async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     IMMUNICARE SYSTEM - COMPREHENSIVE FUNCTIONALITY TEST    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nServer: ${BASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  await testAuthRoutes();
  await testDashboardRoutes();
  await testAPIEndpoints();

  const report = generateReport();

  // Save report to file
  const fs = require('fs');
  fs.writeFileSync('backend/TEST_RESULTS.json', JSON.stringify(report, null, 2));
  console.log('\n✅ Detailed report saved to: backend/TEST_RESULTS.json');

  return report;
}

// Run if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, testResults };
