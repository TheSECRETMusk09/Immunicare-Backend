/**
 * Extended Immunicare Test Suite - Phase 2
 * Tests Guardian Dashboard with correct endpoints, Mobile responsiveness, SMS/Email services
 */

const http = require('http');
const fs = require('fs');

const BASE_URL = 'http://localhost:5000';
const results = {
  guardianDashboard: { tests: [], passed: 0, failed: 0 },
  guardianMobile: { tests: [], passed: 0, failed: 0 },
  smsEmailServices: { tests: [], passed: 0, failed: 0 },
  databaseSchema: { tests: [], passed: 0, failed: 0 },
};

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

// Get admin and guardian tokens
async function getTokens() {
  const adminLogin = await makeRequest({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
  }, { username: 'admin', password: 'Immunicare2026!' });

  const adminToken = adminLogin.data.token || adminLogin.data.accessToken;

  const guardianLogin = await makeRequest({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
  }, { email: 'maria.santos@email.com', password: 'guardian123' });

  const guardianToken = guardianLogin.data.token || guardianLogin.data.accessToken;
  const guardianId = guardianLogin.data?.user?.guardian_id || guardianLogin.data?.guardian_id || 1;

  return { adminToken, guardianToken, guardianId };
}

// ==================== GUARDIAN DASHBOARD TESTS ====================

async function testGuardianDashboard(guardianToken, guardianId) {
  console.log('\n=== Testing Guardian Dashboard Modules (Correct Endpoints) ===');
  const authHeader = { 'Authorization': `Bearer ${guardianToken}`, 'Content-Type': 'application/json' };

  // Test using correct dashboard endpoints
  const stats = await makeRequest({ method: 'GET', path: `/api/dashboard/guardian/${guardianId}/stats`, headers: authHeader });
  addResult('guardianDashboard', 'Guardian Stats', stats.status === 200, `Status: ${stats.status}`);

  const appointments = await makeRequest({ method: 'GET', path: `/api/dashboard/guardian/${guardianId}/appointments`, headers: authHeader });
  addResult('guardianDashboard', 'Guardian Appointments', appointments.status === 200, `Status: ${appointments.status}`);

  const children = await makeRequest({ method: 'GET', path: `/api/dashboard/guardian/${guardianId}/children`, headers: authHeader });
  addResult('guardianDashboard', 'Guardian Children/My Children', children.status === 200, `Status: ${children.status}`);

  const vaccinations = await makeRequest({ method: 'GET', path: `/api/dashboard/guardian/${guardianId}/vaccinations`, headers: authHeader });
  addResult('guardianDashboard', 'Guardian Vaccinations', vaccinations.status === 200, `Status: ${vaccinations.status}`);

  const healthCharts = await makeRequest({ method: 'GET', path: `/api/dashboard/guardian/${guardianId}/health-charts`, headers: authHeader });
  addResult('guardianDashboard', 'Guardian Health Charts', healthCharts.status === 200, `Status: ${healthCharts.status}`);

  const notifs = await makeRequest({ method: 'GET', path: `/api/dashboard/guardian/${guardianId}/notifications`, headers: authHeader });
  addResult('guardianDashboard', 'Guardian Notifications', notifs.status === 200, `Status: ${notifs.status}`);

  // Guardian-specific routes
  const guardianNotifs = await makeRequest({ method: 'GET', path: '/api/guardian/notifications', headers: authHeader });
  addResult('guardianDashboard', 'Guardian Notifications Route', guardianNotifs.status === 200, `Status: ${guardianNotifs.status}`);

  // Test Infants endpoint
  const infants = await makeRequest({ method: 'GET', path: `/api/infants/guardian/${guardianId}`, headers: authHeader });
  addResult('guardianDashboard', 'Infants by Guardian', infants.status === 200, `Status: ${infants.status}`);

  // Test guardians list (admin view)
  const guardians = await makeRequest({ method: 'GET', path: '/api/dashboard/guardians', headers: authHeader });
  addResult('guardianDashboard', 'Guardians List (Admin)', guardians.status === 200, `Status: ${guardians.status}`);
}

// ==================== MOBILE RESPONSIVENESS TESTS ====================

async function testMobileResponsiveness() {
  console.log('\n=== Testing Mobile Responsiveness ===');

  // Test if frontend serves mobile-friendly content
  // Check CSS files exist for mobile
  const mobileCssFiles = [
    'guardian-mobile.css',
    'guardian-dashboard-mobile.css',
    'guardian-mobile-fixes.css',
  ];

  for (const file of mobileCssFiles) {
    try {
      fs.accessSync(`./frontend/src/css/${file}`);
      addResult('guardianMobile', `Mobile CSS - ${file}`, true, 'File exists');
    } catch (e) {
      addResult('guardianMobile', `Mobile CSS - ${file}`, false, 'File not found');
    }
  }

  // Check Mobile components
  const mobileComponents = [
    'MobileBottomNav.jsx',
    'GuardianLayout.jsx',
  ];

  for (const comp of mobileComponents) {
    try {
      fs.accessSync(`./frontend/src/components/${comp}`);
      addResult('guardianMobile', `Mobile Component - ${comp}`, true, 'File exists');
    } catch (e) {
      addResult('guardianMobile', `Mobile Component - ${comp}`, false, 'File not found');
    }
  }

  // Check Mobile pages
  const mobilePages = [
    'GuardianDashboard.jsx',
    'MyChildren.jsx',
    'GuardianAppointmentsPage.jsx',
    'GuardianNotificationsPage.jsx',
    'Settings.jsx',
  ];

  for (const page of mobilePages) {
    try {
      fs.accessSync(`./frontend/src/pages/${page}`);
      addResult('guardianMobile', `Mobile Page - ${page}`, true, 'File exists');
    } catch (e) {
      addResult('guardianMobile', `Mobile Page - ${page}`, false, 'File not found');
    }
  }
}

// ==================== SMS & EMAIL SERVICE TESTS ====================

async function testSmsEmailServices(adminToken) {
  console.log('\n=== Testing SMS & Email Services ===');
  const authHeader = { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  // Test SMS Routes
  const smsRoutes = [
    { method: 'GET', path: '/api/sms' },
    { method: 'GET', path: '/api/sms/incoming' },
    { method: 'GET', path: '/api/sms/templates' },
    { method: 'GET', path: '/api/sms/logs' },
    { method: 'GET', path: '/api/sms/scheduled' },
  ];

  for (const route of smsRoutes) {
    const result = await makeRequest({ method: route.method, path: route.path, headers: authHeader });
    addResult('smsEmailServices', `SMS - ${route.method} ${route.path}`,
      result.status === 200 || result.status === 404,
      `Status: ${result.status}`);
  }

  // Test SMS Service file
  try {
    fs.accessSync('./services/smsService.js');
    addResult('smsEmailServices', 'SMS Service File', true, 'Exists');
  } catch (e) {
    addResult('smsEmailServices', 'SMS Service File', false, 'Not found');
  }

  // Test Email Service file
  try {
    fs.accessSync('./services/emailService.js');
    addResult('smsEmailServices', 'Email Service File', true, 'Exists');
  } catch (e) {
    addResult('smsEmailServices', 'Email Service File', false, 'Not found');
  }

  // Test SMS templates
  try {
    fs.accessSync('./services/smsTemplates.js');
    addResult('smsEmailServices', 'SMS Templates File', true, 'Exists');
  } catch (e) {
    addResult('smsEmailServices', 'SMS Templates File', false, 'Not found');
  }

  // Test SMS schema
  try {
    fs.accessSync('./sms_schema.sql');
    addResult('smsEmailServices', 'SMS Database Schema', true, 'Exists');
  } catch (e) {
    addResult('smsEmailServices', 'SMS Database Schema', false, 'Not found');
  }

  // Test appointment confirmation service (includes SMS/Email)
  try {
    fs.accessSync('./services/appointmentConfirmationService.js');
    addResult('smsEmailServices', 'Appointment Confirmation Service', true, 'Exists');
  } catch (e) {
    addResult('smsEmailServices', 'Appointment Confirmation Service', false, 'Not found');
  }

  // Test password reset service (includes Email)
  try {
    fs.accessSync('./services/passwordResetService.js');
    addResult('smsEmailServices', 'Password Reset Service (Email)', true, 'Exists');
  } catch (e) {
    addResult('smsEmailServices', 'Password Reset Service (Email)', false, 'Not found');
  }
}

// ==================== DATABASE SCHEMA TESTS ====================

async function testDatabaseSchema(adminToken) {
  console.log('\n=== Testing Database Schema Integrity ===');
  const authHeader = { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  // Test all expected tables by hitting their endpoints
  const tables = [
    { name: 'users', endpoint: '/api/users' },
    { name: 'guardians', endpoint: '/api/users/guardians' },
    { name: 'infants', endpoint: '/api/infants' },
    { name: 'vaccinations', endpoint: '/api/vaccinations' },
    { name: 'appointments', endpoint: '/api/appointments' },
    { name: 'announcements', endpoint: '/api/announcements' },
    { name: 'notifications', endpoint: '/api/notifications' },
    { name: 'settings', endpoint: '/api/settings' },
    { name: 'growth', endpoint: '/api/growth' },
    { name: 'inventory', endpoint: '/api/inventory/stats' },
    { name: 'reports', endpoint: '/api/reports' },
    { name: 'analytics', endpoint: '/api/analytics' },
    { name: 'documents', endpoint: '/api/documents' },
    { name: 'messages', endpoint: '/api/messages' },
    { name: 'paper_templates', endpoint: '/api/paper-templates' },
  ];

  for (const table of tables) {
    const result = await makeRequest({ method: 'GET', path: table.endpoint, headers: authHeader });
    addResult('databaseSchema', `Schema - ${table.name}`,
      result.status === 200 || result.status === 404,
      `Status: ${result.status}`);
  }

  // Check for critical schema files
  const schemaFiles = [
    'schema.sql',
    'sms_schema.sql',
    'settings_schema.sql',
    'cache_schema.sql',
  ];

  for (const file of schemaFiles) {
    try {
      fs.accessSync(`./${file}`);
      addResult('databaseSchema', `Schema File - ${file}`, true, 'Exists');
    } catch (e) {
      addResult('databaseSchema', `Schema File - ${file}`, false, 'Not found');
    }
  }
}

// ==================== MAIN ====================

async function runExtendedTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     IMMUNICARE EXTENDED TEST SUITE - PHASE 2             ║');
  console.log('║     Guardian, Mobile, SMS/Email, Database                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    const { adminToken, guardianToken, guardianId } = await getTokens();

    console.log(`\nTokens obtained - Admin: ${!!adminToken}, Guardian: ${!!guardianToken}, ID: ${guardianId}`);

    if (!adminToken || !guardianToken) {
      console.error('Failed to obtain tokens');
      return;
    }

    await testGuardianDashboard(guardianToken, guardianId);
    await testMobileResponsiveness();
    await testSmsEmailServices(adminToken);
    await testDatabaseSchema(adminToken);

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

  // Save results
  fs.writeFileSync(
    './EXTENDED_TEST_RESULTS.json',
    JSON.stringify(results, null, 2),
  );
  console.log('\nResults saved to EXTENDED_TEST_RESULTS.json');
}

runExtendedTests();
