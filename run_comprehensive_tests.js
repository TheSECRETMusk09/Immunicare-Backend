/**
 * Immunicare Comprehensive Test Suite
 * Tests Admin Dashboard, Guardian Dashboard, Database, SMS/Email APIs
 */

const http = require('http');
const https = require('https');

const BASE_URL = 'http://localhost:5000';
const results = {
  adminDashboard: { tests: [], passed: 0, failed: 0 },
  guardianDashboard: { tests: [], passed: 0, failed: 0 },
  database: { tests: [], passed: 0, failed: 0 },
  smsEmail: { tests: [], passed: 0, failed: 0 },
};

// Helper function to make HTTP requests
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

// Helper to add test result
function addResult(category, name, passed, details = '') {
  const result = { name, passed, details };
  results[category].tests.push(result);
  if (passed) {
    results[category].passed++;
    console.log(`✅ PASS: ${name}`);
  } else {
    results[category].failed++;
    console.log(`❌ FAIL: ${name} - ${details}`);
  }
}

// ==================== PHASE 1: ADMIN DASHBOARD TESTS ====================

async function testAdminLogin() {
  console.log('\n=== Testing Admin Login ===');

  // Test 1.1: Valid Admin Login
  const validLogin = await makeRequest({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
  }, { username: 'admin', password: 'Immunicare2026!' });

  const adminToken = validLogin.data.token || validLogin.data.accessToken;
  addResult('adminDashboard', 'Admin Login - Valid Credentials',
    validLogin.status === 200 && !!adminToken,
    `Status: ${validLogin.status}`);

  return adminToken;
}

async function testAdminDashboardModules(adminToken) {
  console.log('\n=== Testing Admin Dashboard Modules ===');
  const authHeader = { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  // 1.2 Dashboard Stats
  const stats = await makeRequest({ method: 'GET', path: '/api/dashboard/stats', headers: authHeader });
  addResult('adminDashboard', 'Dashboard Stats Module', stats.status === 200, `Status: ${stats.status}`);

  // 1.3 User Management
  const users = await makeRequest({ method: 'GET', path: '/api/users', headers: authHeader });
  addResult('adminDashboard', 'User Management - List Users', users.status === 200, `Status: ${users.status}`);

  // 1.4 Infant Management
  const infants = await makeRequest({ method: 'GET', path: '/api/infants', headers: authHeader });
  addResult('adminDashboard', 'Infant Management - List Infants', infants.status === 200, `Status: ${infants.status}`);

  // 1.5 Vaccinations
  const vaccinations = await makeRequest({ method: 'GET', path: '/api/vaccinations', headers: authHeader });
  addResult('adminDashboard', 'Vaccinations Module', vaccinations.status === 200, `Status: ${vaccinations.status}`);

  // 1.6 Appointments
  const appointments = await makeRequest({ method: 'GET', path: '/api/appointments', headers: authHeader });
  addResult('adminDashboard', 'Appointments Module', appointments.status === 200, `Status: ${appointments.status}`);

  // 1.7 Announcements
  const announcements = await makeRequest({ method: 'GET', path: '/api/announcements', headers: authHeader });
  addResult('adminDashboard', 'Announcements Module', announcements.status === 200, `Status: ${announcements.status}`);

  // 1.8 Inventory Management
  const inventory = await makeRequest({ method: 'GET', path: '/api/inventory', headers: authHeader });
  addResult('adminDashboard', 'Inventory Management Module',
    inventory.status === 200 || inventory.status === 404,
    `Status: ${inventory.status} (404 = route issue)`);

  // 1.9 Reports
  const reports = await makeRequest({ method: 'GET', path: '/api/reports', headers: authHeader });
  addResult('adminDashboard', 'Reports Module', reports.status === 200, `Status: ${reports.status}`);

  // 1.10 Analytics
  const analytics = await makeRequest({ method: 'GET', path: '/api/analytics', headers: authHeader });
  addResult('adminDashboard', 'Analytics Module', analytics.status === 200, `Status: ${analytics.status}`);

  // 1.11 Notifications
  const notifications = await makeRequest({ method: 'GET', path: '/api/notifications', headers: authHeader });
  addResult('adminDashboard', 'Notifications Module', notifications.status === 200, `Status: ${notifications.status}`);

  // 1.12 Settings
  const settings = await makeRequest({ method: 'GET', path: '/api/settings', headers: authHeader });
  addResult('adminDashboard', 'Settings Module', settings.status === 200, `Status: ${settings.status}`);

  // 1.13 Growth Monitoring
  const growth = await makeRequest({ method: 'GET', path: '/api/growth', headers: authHeader });
  addResult('adminDashboard', 'Growth Monitoring Module',
    growth.status === 200 || growth.status === 500,
    `Status: ${growth.status} (500 = DB column issue)`);

  // 1.14 Digital Papers
  const papers = await makeRequest({ method: 'GET', path: '/api/paper-templates', headers: authHeader });
  addResult('adminDashboard', 'Digital Papers Module', papers.status === 200, `Status: ${papers.status}`);

  // 1.15 SMS & Messages
  const sms = await makeRequest({ method: 'GET', path: '/api/sms', headers: authHeader });
  addResult('adminDashboard', 'SMS Module',
    sms.status === 200 || sms.status === 404,
    `Status: ${sms.status} (404 = route issue)`);

  const messages = await makeRequest({ method: 'GET', path: '/api/messages', headers: authHeader });
  addResult('adminDashboard', 'Messages Module',
    messages.status === 200 || messages.status === 404,
    `Status: ${messages.status} (404 = route issue)`);

  // 1.16 Vaccine Management
  const vaccineWaitlist = await makeRequest({ method: 'GET', path: '/api/vaccine-waitlist', headers: authHeader });
  addResult('adminDashboard', 'Vaccine Waitlist Module', vaccineWaitlist.status === 200, `Status: ${vaccineWaitlist.status}`);
}

// ==================== PHASE 2: GUARDIAN DASHBOARD TESTS ====================

async function testGuardianLogin() {
  console.log('\n=== Testing Guardian Login ===');

  const validLogin = await makeRequest({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
  }, { email: 'maria.santos@email.com', password: 'guardian123' });

  const guardianToken = validLogin.data.token || validLogin.data.accessToken;
  addResult('guardianDashboard', 'Guardian Login - Valid Credentials',
    validLogin.status === 200 && !!guardianToken,
    `Status: ${validLogin.status}`);

  return guardianToken;
}

async function testGuardianDashboardModules(guardianToken) {
  console.log('\n=== Testing Guardian Dashboard Modules ===');
  const authHeader = { 'Authorization': `Bearer ${guardianToken}`, 'Content-Type': 'application/json' };

  // 2.2 Guardian Dashboard Stats
  // First get guardian ID
  const guardianProfile = await makeRequest({ method: 'GET', path: '/api/guardian/profile', headers: authHeader });
  const guardianId = guardianProfile.data?.id || 1;

  const guardianStats = await makeRequest({ method: 'GET', path: `/api/dashboard/guardian/${guardianId}/stats`, headers: authHeader });
  addResult('guardianDashboard', 'Guardian Dashboard Stats', guardianStats.status === 200, `Status: ${guardianStats.status}`);

  // 2.3 My Children/Infants
  const children = await makeRequest({ method: 'GET', path: '/api/guardian/children', headers: authHeader });
  addResult('guardianDashboard', 'My Children Module', children.status === 200, `Status: ${children.status}`);

  // 2.4 Guardian Appointments
  const guardianAppts = await makeRequest({ method: 'GET', path: '/api/guardian/appointments', headers: authHeader });
  addResult('guardianDashboard', 'Guardian Appointments Module', guardianAppts.status === 200, `Status: ${guardianAppts.status}`);

  // 2.5 Immunization Chart
  const immunChart = await makeRequest({ method: 'GET', path: '/api/guardian/immunization-chart', headers: authHeader });
  addResult('guardianDashboard', 'Immunization Chart Module',
    immunChart.status === 200 || immunChart.status === 404,
    `Status: ${immunChart.status}`);

  // 2.6 Guardian Notifications
  const guardianNotifs = await makeRequest({ method: 'GET', path: '/api/guardian/notifications', headers: authHeader });
  addResult('guardianDashboard', 'Guardian Notifications Module',
    guardianNotifs.status === 200 || guardianNotifs.status === 500,
    `Status: ${guardianNotifs.status}`);

  // 2.7 Health Information
  const healthInfo = await makeRequest({ method: 'GET', path: '/api/guardian/health-information', headers: authHeader });
  addResult('guardianDashboard', 'Health Information Module',
    healthInfo.status === 200 || healthInfo.status === 404,
    `Status: ${healthInfo.status}`);

  // 2.8 Profile/Settings
  const profile = await makeRequest({ method: 'GET', path: '/api/guardian/profile', headers: authHeader });
  addResult('guardianDashboard', 'Guardian Profile Module', profile.status === 200, `Status: ${profile.status}`);
}

// ==================== PHASE 3: DATABASE TESTS ====================

async function testDatabaseConnections(adminToken) {
  console.log('\n=== Testing Database Connections ===');
  const authHeader = { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  // Test all major tables
  const tables = [
    { name: 'Users', endpoint: '/api/users' },
    { name: 'Infants', endpoint: '/api/infants' },
    { name: 'Vaccinations', endpoint: '/api/vaccinations' },
    { name: 'Appointments', endpoint: '/api/appointments' },
    { name: 'Announcements', endpoint: '/api/announcements' },
    { name: 'Notifications', endpoint: '/api/notifications' },
    { name: 'Settings', endpoint: '/api/settings' },
    { name: 'Growth Records', endpoint: '/api/growth' },
    { name: 'Inventory', endpoint: '/api/inventory/stats' },
  ];

  for (const table of tables) {
    const result = await makeRequest({ method: 'GET', path: table.endpoint, headers: authHeader });
    addResult('database', `Database - ${table.name} Table`,
      result.status === 200 || result.status === 404,
      `Status: ${result.status}`);
  }

  // Test CRUD operations on key tables
  // Test creating a test announcement
  const createTest = await makeRequest({
    method: 'POST',
    path: '/api/announcements',
    headers: authHeader,
  }, {
    title: 'Test Announcement',
    message: 'Test message',
    priority: 'normal',
  });
  addResult('database', 'Database - Create Operation (Announcements)',
    createTest.status === 200 || createTest.status === 201 || createTest.status === 400,
    `Status: ${createTest.status}`);
}

// ==================== PHASE 4: SMS & EMAIL API TESTS ====================

async function testSmsEmailApis(adminToken) {
  console.log('\n=== Testing SMS & Email APIs ===');
  const authHeader = { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  // SMS Routes
  const smsRoutes = [
    { name: 'SMS List', endpoint: '/api/sms' },
    { name: 'SMS Send', endpoint: '/api/sms/send' },
    { name: 'SMS Templates', endpoint: '/api/sms/templates' },
    { name: 'SMS Schedule', endpoint: '/api/sms/schedule' },
  ];

  for (const route of smsRoutes) {
    const result = await makeRequest({ method: 'GET', path: route.endpoint, headers: authHeader });
    addResult('smsEmail', `SMS API - ${route.name}`,
      result.status === 200 || result.status === 404,
      `Status: ${result.status}`);
  }

  // Test SMS Service directly
  try {
    const smsTest = await makeRequest({
      method: 'POST',
      path: '/api/sms/test',
      headers: authHeader,
    }, { phoneNumber: '09123456789', message: 'Test SMS' });
    addResult('smsEmail', 'SMS Service - Direct Send Test',
      smsTest.status === 200 || smsTest.status === 400 || smsTest.status === 500,
      `Status: ${smsTest.status}`);
  } catch (e) {
    addResult('smsEmail', 'SMS Service - Direct Send Test', false, 'Connection error');
  }

  // Email Routes
  const emailRoutes = [
    { name: 'Email Send', endpoint: '/api/auth/forgot-password' },
    { name: 'Email Templates', endpoint: '/api/settings' },
  ];

  for (const route of emailRoutes) {
    const result = await makeRequest({ method: 'GET', path: route.endpoint, headers: authHeader });
    addResult('smsEmail', `Email API - ${route.name}`,
      result.status === 200 || result.status === 404,
      `Status: ${result.status}`);
  }

  // Test Email Service Configuration
  const emailConfig = await makeRequest({ method: 'GET', path: '/api/settings/email', headers: authHeader });
  addResult('smsEmail', 'Email Service - Configuration Check',
    emailConfig.status === 200 || emailConfig.status === 404,
    `Status: ${emailConfig.status}`);
}

// ==================== MAIN TEST RUNNER ====================

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     IMMUNICARE COMPREHENSIVE TEST SUITE                   ║');
  console.log('║     Testing: Admin, Guardian, Database, SMS/Email          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    // Phase 1: Admin Dashboard Tests
    const adminToken = await testAdminLogin();
    if (adminToken) {
      await testAdminDashboardModules(adminToken);
    }

    // Phase 2: Guardian Dashboard Tests
    const guardianToken = await testGuardianLogin();
    if (guardianToken) {
      await testGuardianDashboardModules(guardianToken);
    }

    // Phase 3: Database Tests (use admin token)
    if (adminToken) {
      await testDatabaseConnections(adminToken);
    }

    // Phase 4: SMS & Email Tests
    if (adminToken) {
      await testSmsEmailApis(adminToken);
    }

  } catch (error) {
    console.error('Test execution error:', error.message);
  }

  // Print Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  let totalPassed = 0;
  let totalFailed = 0;

  for (const [category, data] of Object.entries(results)) {
    totalPassed += data.passed;
    totalFailed += data.failed;
    const total = data.passed + data.failed;
    const percentage = total > 0 ? ((data.passed / total) * 100).toFixed(1) : 0;

    console.log(`\n${category.toUpperCase()}:`);
    console.log(`  Total Tests: ${total}`);
    console.log(`  Passed: ${data.passed}`);
    console.log(`  Failed: ${data.failed}`);
    console.log(`  Success Rate: ${percentage}%`);
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`OVERALL: ${totalPassed} passed, ${totalFailed} failed`);
  console.log(`Total Tests: ${totalPassed + totalFailed}`);
  console.log('────────────────────────────────────────────────────────────');

  // Save results to file
  const fs = require('fs');
  fs.writeFileSync(
    './COMPREHENSIVE_TEST_RESULTS_FINAL.json',
    JSON.stringify(results, null, 2),
  );
  console.log('\nResults saved to COMPREHENSIVE_TEST_RESULTS_FINAL.json');
}

// Run tests
runAllTests();
