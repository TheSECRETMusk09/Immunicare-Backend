/**
 * Immunicare Comprehensive End-to-End Testing Script
 * Tests all API endpoints, authentication, CRUD operations, and database connectivity
 */

const https = require('https');
const http = require('http');
const { Pool } = require('pg');

const API_BASE_URL = 'http://localhost:5000';

// Test configuration
const TEST_CONFIG = {
  adminCredentials: {
    username: 'admin',
    password: 'Admin2024!',
  },
  guardianCredentials: {
    email: 'maria.santos@email.com',
    password: 'guardian123',
  },
  database: {
    host: 'localhost',
    port: 5432,
    database: 'immunicare_dev',
    user: 'immunicare_dev',
    password: '',
  },
};

// Test results storage
const testResults = {
  passed: [],
  failed: [],
  warnings: [],
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name, passed, details = '') {
  const status = passed ? '✓ PASS' : '✗ FAIL';
  const color = passed ? 'green' : 'red';
  log(`${status}: ${name}${details ? ` - ${details}` : ''}`, color);

  if (passed) {
    testResults.passed.push(name);
  } else {
    testResults.failed.push({ name, details });
  }
}

// HTTP Request helper
function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : null;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: jsonData,
            raw: data,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: null,
            raw: data,
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Database connection test
async function testDatabaseConnection() {
  log('\n--- DATABASE CONNECTIVITY TESTS ---', 'cyan');

  const pool = new Pool(TEST_CONFIG.database);

  try {
    const client = await pool.connect();
    logTest('Database Connection', true, 'Successfully connected to PostgreSQL');

    // Test tables exist
    const tables = [
      'admins',
      'guardians',
      'infants',
      'vaccinations',
      'appointments',
      'vaccine_inventory',
      'notifications',
      'announcements',
      'growth_records',
      'vaccine_supply',
      'vaccine_transactions',
      'security_events',
    ];

    for (const table of tables) {
      try {
        const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
        logTest(`Table: ${table}`, true, `${result.rows[0].count} records`);
      } catch (e) {
        logTest(`Table: ${table}`, false, e.message);
      }
    }

    client.release();
    await pool.end();
  } catch (e) {
    logTest('Database Connection', false, e.message);
    await pool.end();
  }
}

// Test 1: Server Health Check
async function testServerHealth() {
  log('\n--- SERVER HEALTH TESTS ---', 'cyan');

  try {
    const response = await makeRequest('GET', '/api/health');
    logTest('Server Health Endpoint', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Server Health Endpoint', false, e.message);
  }
}

// Test 2: Authentication
async function testAuthentication() {
  log('\n--- AUTHENTICATION TESTS ---', 'cyan');

  // Test Admin Login
  try {
    const response = await makeRequest('POST', '/api/auth/login', TEST_CONFIG.adminCredentials);
    const loginSuccess = response.status === 200 || response.status === 201;
    logTest('Admin Login', loginSuccess, `Status: ${response.status}`);

    if (loginSuccess && response.data) {
      // Store tokens for subsequent tests
      global.adminToken = response.data.accessToken;
      global.adminRefreshToken = response.data.refreshToken;
      global.adminUser = response.data.user;

      if (global.adminToken) {
        logTest('Admin Token Received', true, 'Access token obtained');

        // Test protected route with token
        const protectedResponse = await makeRequest('GET', '/api/dashboard/stats', null, {
          Authorization: `Bearer ${global.adminToken}`,
        });
        logTest(
          'Admin Protected Route Access',
          protectedResponse.status === 200,
          `Status: ${protectedResponse.status}`
        );
      }
    }
  } catch (e) {
    logTest('Admin Login', false, e.message);
  }

  // Test Guardian Login
  try {
    const response = await makeRequest('POST', '/api/auth/login', TEST_CONFIG.guardianCredentials);
    const loginSuccess = response.status === 200 || response.status === 201;
    logTest('Guardian Login', loginSuccess, `Status: ${response.status}`);

    if (loginSuccess && response.data) {
      global.guardianToken = response.data.accessToken;
      global.guardianUser = response.data.user;

      if (global.guardianToken) {
        logTest('Guardian Token Received', true, 'Access token obtained');

        // Test guardian dashboard access
        const dashboardResponse = await makeRequest('GET', '/api/guardians/dashboard', null, {
          Authorization: `Bearer ${global.guardianToken}`,
        });
        logTest(
          'Guardian Dashboard Access',
          dashboardResponse.status === 200,
          `Status: ${dashboardResponse.status}`
        );
      }
    }
  } catch (e) {
    logTest('Guardian Login', false, e.message);
  }

  // Test Invalid Login
  try {
    const response = await makeRequest('POST', '/api/auth/login', {
      email: 'invalid@test.com',
      password: 'wrongpassword',
    });
    logTest('Invalid Login Rejection', response.status === 401, `Status: ${response.status}`);
  } catch (e) {
    logTest('Invalid Login Rejection', false, e.message);
  }
}

// Test 3: API Endpoints
async function testAPIEndpoints() {
  log('\n--- API ENDPOINTS TESTS ---', 'cyan');

  const adminHeaders = global.adminToken
    ? {
        Authorization: `Bearer ${global.adminToken}`,
      }
    : {};

  const guardianHeaders = global.guardianToken
    ? {
        Authorization: `Bearer ${global.guardianToken}`,
      }
    : {};

  // Dashboard endpoints
  const dashboardEndpoints = [
    { path: '/api/dashboard/stats', method: 'GET', headers: adminHeaders, name: 'Dashboard Stats' },
    {
      path: '/api/dashboard/activity',
      method: 'GET',
      headers: adminHeaders,
      name: 'Recent Activity',
    },
  ];

  // User management endpoints
  const userEndpoints = [
    { path: '/api/users', method: 'GET', headers: adminHeaders, name: 'Get All Users' },
    {
      path: '/api/users/system-users',
      method: 'GET',
      headers: adminHeaders,
      name: 'Get System Users',
    },
    { path: '/api/users/guardians', method: 'GET', headers: adminHeaders, name: 'Get Guardians' },
  ];

  // Infant endpoints
  const infantEndpoints = [
    { path: '/api/infants', method: 'GET', headers: adminHeaders, name: 'Get All Infants' },
    {
      path: '/api/infants/stats/overview',
      method: 'GET',
      headers: adminHeaders,
      name: 'Infant Statistics',
    },
  ];

  // Vaccination endpoints
  const vaccinationEndpoints = [
    {
      path: '/api/vaccinations',
      method: 'GET',
      headers: adminHeaders,
      name: 'Get All Vaccinations',
    },
  ];

  // Appointment endpoints
  const appointmentEndpoints = [
    {
      path: '/api/appointments',
      method: 'GET',
      headers: adminHeaders,
      name: 'Get All Appointments',
    },
    {
      path: '/api/appointments/stats',
      method: 'GET',
      headers: adminHeaders,
      name: 'Appointment Stats',
    },
  ];

  // Inventory endpoints
  const inventoryEndpoints = [
    { path: '/api/inventory', method: 'GET', headers: adminHeaders, name: 'Get Inventory' },
    { path: '/api/inventory/stats', method: 'GET', headers: adminHeaders, name: 'Inventory Stats' },
    {
      path: '/api/inventory/alerts',
      method: 'GET',
      headers: adminHeaders,
      name: 'Inventory Alerts',
    },
  ];

  // Announcement endpoints
  const announcementEndpoints = [
    { path: '/api/announcements', method: 'GET', headers: adminHeaders, name: 'Get Announcements' },
  ];

  // Notification endpoints
  const notificationEndpoints = [
    {
      path: '/api/notifications',
      method: 'GET',
      headers: adminHeaders,
      name: 'Get Admin Notifications',
    },
    {
      path: '/api/notifications/guardian',
      method: 'GET',
      headers: guardianHeaders,
      name: 'Get Guardian Notifications',
    },
  ];

  // Analytics endpoints
  const analyticsEndpoints = [
    {
      path: '/api/analytics/overview',
      method: 'GET',
      headers: adminHeaders,
      name: 'Analytics Overview',
    },
    {
      path: '/api/analytics/vaccination-rates',
      method: 'GET',
      headers: adminHeaders,
      name: 'Vaccination Rates',
    },
  ];

  // Reports endpoints
  const reportEndpoints = [
    { path: '/api/reports', method: 'GET', headers: adminHeaders, name: 'Get Reports' },
    {
      path: '/api/reports/vaccination',
      method: 'GET',
      headers: adminHeaders,
      name: 'Vaccination Reports',
    },
  ];

  // Growth tracking endpoints
  const growthEndpoints = [
    { path: '/api/growth', method: 'GET', headers: adminHeaders, name: 'Get Growth Records' },
  ];

  // Settings endpoints
  const settingsEndpoints = [
    { path: '/api/settings', method: 'GET', headers: adminHeaders, name: 'Get Settings' },
  ];

  // Guardian-specific endpoints
  const guardianEndpoints = [
    {
      path: '/api/guardians/infants',
      method: 'GET',
      headers: guardianHeaders,
      name: 'Guardian Infants',
    },
    {
      path: '/api/guardians/vaccinations',
      method: 'GET',
      headers: guardianHeaders,
      name: 'Guardian Vaccinations',
    },
    {
      path: '/api/guardians/appointments',
      method: 'GET',
      headers: guardianHeaders,
      name: 'Guardian Appointments',
    },
  ];

  // Combine all endpoints
  const allEndpoints = [
    ...dashboardEndpoints,
    ...userEndpoints,
    ...infantEndpoints,
    ...vaccinationEndpoints,
    ...appointmentEndpoints,
    ...inventoryEndpoints,
    ...announcementEndpoints,
    ...notificationEndpoints,
    ...analyticsEndpoints,
    ...reportEndpoints,
    ...growthEndpoints,
    ...settingsEndpoints,
    ...guardianEndpoints,
  ];

  // Test each endpoint
  for (const endpoint of allEndpoints) {
    try {
      const response = await makeRequest(endpoint.method, endpoint.path, null, endpoint.headers);
      const isSuccess = response.status >= 200 && response.status < 300;
      logTest(endpoint.name, isSuccess, `Status: ${response.status}`);
    } catch (e) {
      logTest(endpoint.name, false, e.message);
    }
  }
}

// Test 4: CRUD Operations
async function testCRUDOperations() {
  log('\n--- CRUD OPERATIONS TESTS ---', 'cyan');

  const adminHeaders = {
    Authorization: `Bearer ${global.adminToken}`,
  };

  // Test CREATE operations
  log('\nTesting CREATE operations:', 'yellow');

  // Create announcement
  try {
    const response = await makeRequest(
      'POST',
      '/api/announcements',
      {
        title: 'Test Announcement',
        content: 'This is a test announcement',
        priority: 'normal',
        target_audience: 'all',
      },
      adminHeaders
    );
    logTest(
      'Create Announcement',
      response.status === 201 || response.status === 200,
      `Status: ${response.status}`
    );
    global.testAnnouncementId = response.data?.id;
  } catch (e) {
    logTest('Create Announcement', false, e.message);
  }

  // Test READ operations
  log('\nTesting READ operations:', 'yellow');

  try {
    const response = await makeRequest('GET', '/api/announcements', null, adminHeaders);
    logTest(
      'Read Announcements',
      response.status === 200,
      `Status: ${response.status}, Count: ${response.data?.length || 0}`
    );
  } catch (e) {
    logTest('Read Announcements', false, e.message);
  }

  // Test UPDATE operations
  if (global.testAnnouncementId) {
    log('\nTesting UPDATE operations:', 'yellow');

    try {
      const response = await makeRequest(
        'PUT',
        `/api/announcements/${global.testAnnouncementId}`,
        {
          title: 'Updated Test Announcement',
          content: 'This is an updated test announcement',
        },
        adminHeaders
      );
      logTest('Update Announcement', response.status === 200, `Status: ${response.status}`);
    } catch (e) {
      logTest('Update Announcement', false, e.message);
    }
  }

  // Test DELETE operations
  if (global.testAnnouncementId) {
    log('\nTesting DELETE operations:', 'yellow');

    try {
      const response = await makeRequest(
        'DELETE',
        `/api/announcements/${global.testAnnouncementId}`,
        null,
        adminHeaders
      );
      logTest(
        'Delete Announcement',
        response.status === 200 || response.status === 204,
        `Status: ${response.status}`
      );
    } catch (e) {
      logTest('Delete Announcement', false, e.message);
    }
  }
}

// Test 5: Role-Based Access Control
async function testRoleBasedAccess() {
  log('\n--- ROLE-BASED ACCESS CONTROL TESTS ---', 'cyan');

  // Test admin accessing admin routes
  if (global.adminToken) {
    const adminHeaders = { Authorization: `Bearer ${global.adminToken}` };

    try {
      const response = await makeRequest('GET', '/api/users', null, adminHeaders);
      logTest('Admin Access to Users', response.status === 200, `Status: ${response.status}`);
    } catch (e) {
      logTest('Admin Access to Users', false, e.message);
    }
  }

  // Test guardian accessing guardian-only routes
  if (global.guardianToken) {
    const guardianHeaders = { Authorization: `Bearer ${global.guardianToken}` };

    try {
      const response = await makeRequest('GET', '/api/guardians/dashboard', null, guardianHeaders);
      logTest(
        'Guardian Access to Dashboard',
        response.status === 200,
        `Status: ${response.status}`
      );
    } catch (e) {
      logTest('Guardian Access to Dashboard', false, e.message);
    }
  }

  // Test guardian trying to access admin routes
  if (global.guardianToken) {
    const guardianHeaders = { Authorization: `Bearer ${global.guardianToken}` };

    try {
      const response = await makeRequest('GET', '/api/users', null, guardianHeaders);
      // Should be forbidden or unauthorized
      const isForbidden = response.status === 403 || response.status === 401;
      logTest('Guardian Blocked from Admin Routes', isForbidden, `Status: ${response.status}`);
    } catch (e) {
      logTest('Guardian Blocked from Admin Routes', false, e.message);
    }
  }
}

// Test 6: Session Management
async function testSessionManagement() {
  log('\n--- SESSION MANAGEMENT TESTS ---', 'cyan');

  // Test token refresh
  if (global.adminRefreshToken) {
    try {
      const response = await makeRequest('POST', '/api/auth/refresh', {
        refreshToken: global.adminRefreshToken,
      });
      const refreshSuccess = response.status === 200 || response.status === 201;
      logTest('Token Refresh', refreshSuccess, `Status: ${response.status}`);

      if (refreshSuccess && response.data?.accessToken) {
        global.adminToken = response.data.accessToken;
      }
    } catch (e) {
      logTest('Token Refresh', false, e.message);
    }
  }

  // Test logout
  if (global.adminToken) {
    try {
      const response = await makeRequest(
        'POST',
        '/api/auth/logout',
        {},
        {
          Authorization: `Bearer ${global.adminToken}`,
        }
      );
      logTest(
        'Logout',
        response.status === 200 || response.status === 204,
        `Status: ${response.status}`
      );
    } catch (e) {
      logTest('Logout', false, e.message);
    }
  }
}

// Test 7: Form Validation
async function testFormValidation() {
  log('\n--- FORM VALIDATION TESTS ---', 'cyan');

  // Test invalid email format
  try {
    const response = await makeRequest('POST', '/api/auth/login', {
      email: 'not-an-email',
      password: 'password123',
    });
    logTest(
      'Invalid Email Validation',
      response.status === 400 || response.status === 422,
      `Status: ${response.status}`
    );
  } catch (e) {
    logTest('Invalid Email Validation', false, e.message);
  }

  // Test empty password
  try {
    const response = await makeRequest('POST', '/api/auth/login', {
      email: 'test@test.com',
      password: '',
    });
    logTest(
      'Empty Password Validation',
      response.status === 400 || response.status === 422,
      `Status: ${response.status}`
    );
  } catch (e) {
    logTest('Empty Password Validation', false, e.message);
  }

  // Test missing required fields
  try {
    const response = await makeRequest(
      'POST',
      '/api/announcements',
      {
        title: 'Test',
        // Missing content
      },
      { Authorization: `Bearer ${global.adminToken}` }
    );
    logTest(
      'Missing Required Fields',
      response.status === 400 || response.status === 422,
      `Status: ${response.status}`
    );
  } catch (e) {
    logTest('Missing Required Fields', false, e.message);
  }
}

// Test 8: Error Handling
async function testErrorHandling() {
  log('\n--- ERROR HANDLING TESTS ---', 'cyan');

  // Test 404 Not Found
  try {
    const response = await makeRequest('GET', '/api/nonexistent-endpoint');
    logTest('404 Not Found', response.status === 404, `Status: ${response.status}`);
  } catch (e) {
    logTest('404 Not Found', false, e.message);
  }

  // Test Method Not Allowed
  try {
    const response = await makeRequest('DELETE', '/api/dashboard/stats');
    const isMethodNotAllowed = response.status === 405 || response.status === 404;
    logTest('405 Method Not Allowed', isMethodNotAllowed, `Status: ${response.status}`);
  } catch (e) {
    logTest('405 Method Not Allowed', false, e.message);
  }

  // Test unauthorized access without token
  try {
    const response = await makeRequest('GET', '/api/dashboard/stats');
    logTest(
      '401 Unauthorized Without Token',
      response.status === 401,
      `Status: ${response.status}`
    );
  } catch (e) {
    logTest('401 Unauthorized Without Token', false, e.message);
  }
}

// Test 9: Vaccination Tracking
async function testVaccinationTracking() {
  log('\n--- VACCINATION TRACKING TESTS ---', 'cyan');

  const adminHeaders = { Authorization: `Bearer ${global.adminToken}` };

  // Get all vaccinations
  try {
    const response = await makeRequest('GET', '/api/vaccinations', null, adminHeaders);
    const isSuccess = response.status === 200;
    logTest(
      'Get All Vaccinations',
      isSuccess,
      `Status: ${response.status}, Count: ${response.data?.length || 0}`
    );
  } catch (e) {
    logTest('Get All Vaccinations', false, e.message);
  }

  // Get vaccination schedule
  try {
    const response = await makeRequest('GET', '/api/vaccinations/schedule', null, adminHeaders);
    logTest('Get Vaccination Schedule', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Vaccination Schedule', false, e.message);
  }

  // Get infant vaccinations
  try {
    const response = await makeRequest('GET', '/api/vaccinations/infant/1', null, adminHeaders);
    logTest('Get Infant Vaccinations', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Infant Vaccinations', false, e.message);
  }
}

// Test 10: Inventory Management
async function testInventoryManagement() {
  log('\n--- INVENTORY MANAGEMENT TESTS ---', 'cyan');

  const adminHeaders = { Authorization: `Bearer ${global.adminToken}` };

  // Get inventory
  try {
    const response = await makeRequest('GET', '/api/inventory', null, adminHeaders);
    logTest(
      'Get Inventory',
      response.status === 200,
      `Status: ${response.status}, Count: ${response.data?.length || 0}`
    );
  } catch (e) {
    logTest('Get Inventory', false, e.message);
  }

  // Get inventory stats
  try {
    const response = await makeRequest('GET', '/api/inventory/stats', null, adminHeaders);
    logTest('Get Inventory Stats', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Inventory Stats', false, e.message);
  }

  // Get stock alerts
  try {
    const response = await makeRequest('GET', '/api/inventory/alerts', null, adminHeaders);
    logTest('Get Stock Alerts', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Stock Alerts', false, e.message);
  }

  // Get vaccine supply
  try {
    const response = await makeRequest('GET', '/api/vaccine-supply', null, adminHeaders);
    logTest('Get Vaccine Supply', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Vaccine Supply', false, e.message);
  }
}

// Print test summary
function printSummary() {
  log('\n========================================', 'cyan');
  log('          TEST SUMMARY', 'cyan');
  log('========================================', 'cyan');

  log(`\n${colors.green}Passed: ${testResults.passed.length}${colors.reset}`);
  log(`${colors.red}Failed: ${testResults.failed.length}${colors.reset}`);
  log(`${colors.yellow}Warnings: ${testResults.warnings.length}${colors.reset}`);

  if (testResults.failed.length > 0) {
    log('\n--- FAILED TESTS ---', 'red');
    testResults.failed.forEach((test, index) => {
      log(`${index + 1}. ${test.name}: ${test.details}`, 'red');
    });
  }

  if (testResults.warnings.length > 0) {
    log('\n--- WARNINGS ---', 'yellow');
    testResults.warnings.forEach((warning, index) => {
      log(`${index + 1}. ${warning.name}: ${warning.details}`, 'yellow');
    });
  }

  const passRate = (
    (testResults.passed.length / (testResults.passed.length + testResults.failed.length)) *
    100
  ).toFixed(2);
  log(`\nPass Rate: ${passRate}%`, passRate > 70 ? 'green' : 'red');
}

// Main execution
async function runTests() {
  log('========================================', 'cyan');
  log('IMMUNICARE E2E TEST SUITE', 'cyan');
  log('========================================', 'cyan');
  log(`API Base URL: ${API_BASE_URL}`, 'blue');
  log(`Time: ${new Date().toISOString()}`, 'blue');

  try {
    // Run all tests
    await testDatabaseConnection();
    await testServerHealth();
    await testAuthentication();
    await testAPIEndpoints();
    await testCRUDOperations();
    await testRoleBasedAccess();
    await testSessionManagement();
    await testFormValidation();
    await testErrorHandling();
    await testVaccinationTracking();
    await testInventoryManagement();

    // Print summary
    printSummary();
  } catch (e) {
    log(`\nFATAL ERROR: ${e.message}`, 'red');
    console.error(e);
  }
}

// Run tests
runTests();
