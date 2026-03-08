/**
 * Immunicare Comprehensive API Test Suite
 * Tests all API endpoints, routes, authentication flows, and identifies issues
 *
 * Run: cd backend && node comprehensive_system_test.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');

// Configuration
const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const USE_HTTPS = BASE_URL.startsWith('https');
const baseUrlObj = new URL(BASE_URL);
const HOST = baseUrlObj.hostname;
const PORT = baseUrlObj.port || (USE_HTTPS ? 443 : 5000);

// Test credentials - Updated to use correct username-based authentication
const TEST_CREDENTIALS = {
  admin: {
    username: 'admin',
    password: 'Admin2024!',
  },
  guardian: {
    username: 'maria.dela.cruz',
    password: 'guardian123',
  },
};

// Results storage
const results = {
  tests: [],
  errors: [],
  warnings: [],
  missing: [],
  performance: {},
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
  },
};

// Utility functions
function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const options = {
      hostname: HOST,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const protocol = USE_HTTPS ? https : http;
    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const duration = Date.now() - startTime;
        try {
          const json = body ? JSON.parse(body) : null;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            duration,
            raw: body,
          });
        } catch {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
            duration,
            raw: body,
          });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

function logTest(name, passed, details = '', statusCode = null, duration = 0) {
  const test = {
    name,
    passed,
    details,
    statusCode,
    duration,
    timestamp: new Date().toISOString(),
  };
  results.tests.push(test);
  results.summary.total++;

  if (passed) {
    results.summary.passed++;
    console.log(`✅ PASS: ${name}${statusCode ? ` [${statusCode}]` : ''} (${duration}ms)`);
  } else {
    results.summary.failed++;
    results.errors.push({ name, details, statusCode });
    console.log(`❌ FAIL: ${name}${statusCode ? ` [${statusCode}]` : ''} - ${details}`);
  }
}

function logWarning(name, details) {
  results.warnings.push({ name, details });
  results.summary.warnings++;
  console.log(`⚠️  WARN: ${name} - ${details}`);
}

function logMissing(feature, details) {
  results.missing.push({ feature, details });
  console.log(`🔍 MISSING: ${feature} - ${details}`);
}

// Test categories and endpoints
const TEST_SUITES = [
  {
    name: 'Health & System',
    endpoints: [
      { method: 'GET', path: '/api/health', name: 'Health Check' },
      { method: 'GET', path: '/', name: 'Root API' },
      { method: 'GET', path: '/metrics', name: 'Prometheus Metrics' },
    ],
  },
  {
    name: 'Authentication',
    endpoints: [
      { method: 'GET', path: '/api/auth/test', name: 'Auth Test' },
      { method: 'POST', path: '/api/auth/login', name: 'Login', data: TEST_CREDENTIALS.admin },
      {
        method: 'POST',
        path: '/api/auth/forgot-password',
        name: 'Forgot Password',
        data: { email: 'admin@immunicare.com' },
      },
    ],
  },
  {
    name: 'Dashboard',
    endpoints: [
      { method: 'GET', path: '/api/dashboard/health', name: 'Dashboard Health' },
      { method: 'GET', path: '/api/dashboard/stats', name: 'Dashboard Stats', auth: true },
      {
        method: 'GET',
        path: '/api/dashboard/appointments',
        name: 'Dashboard Appointments',
        auth: true,
      },
      { method: 'GET', path: '/api/dashboard/guardians', name: 'Dashboard Guardians', auth: true },
      { method: 'GET', path: '/api/dashboard/infants', name: 'Dashboard Infants', auth: true },
      { method: 'GET', path: '/api/dashboard/activity', name: 'Dashboard Activity', auth: true },
    ],
  },
  {
    name: 'Users',
    endpoints: [
      { method: 'GET', path: '/api/users', name: 'Get All Users' },
      { method: 'GET', path: '/api/users/guardians', name: 'Get Guardians' },
      { method: 'GET', path: '/api/users/system-users', name: 'Get System Users' },
      { method: 'GET', path: '/api/users/stats', name: 'Get User Stats' },
      { method: 'GET', path: '/api/users/roles', name: 'Get Roles' },
      { method: 'GET', path: '/api/users/clinics', name: 'Get Clinics' },
    ],
  },
  {
    name: 'Infants/Patients',
    endpoints: [
      { method: 'GET', path: '/api/infants', name: 'Get All Infants' },
      { method: 'GET', path: '/api/infants/stats/overview', name: 'Get Infant Stats' },
      { method: 'GET', path: '/api/infants/upcoming-vaccinations', name: 'Upcoming Vaccinations' },
    ],
  },
  {
    name: 'Vaccinations',
    endpoints: [
      { method: 'GET', path: '/api/vaccinations', name: 'Get Vaccinations' },
      { method: 'GET', path: '/api/vaccinations/vaccines', name: 'Get Vaccines' },
      { method: 'GET', path: '/api/vaccinations/schedules', name: 'Get Schedules' },
      { method: 'GET', path: '/api/vaccinations/batches', name: 'Get Batches' },
      { method: 'GET', path: '/api/vaccinations/records', name: 'Get Vaccination Records' },
    ],
  },
  {
    name: 'Appointments',
    endpoints: [
      { method: 'GET', path: '/api/appointments', name: 'Get Appointments' },
      { method: 'GET', path: '/api/appointments/types', name: 'Get Appointment Types' },
      { method: 'GET', path: '/api/appointments/upcoming', name: 'Get Upcoming Appointments' },
      { method: 'GET', path: '/api/appointments/stats/overview', name: 'Get Appointment Stats' },
    ],
  },
  {
    name: 'Inventory',
    endpoints: [
      { method: 'GET', path: '/api/inventory/items', name: 'Get Inventory Items' },
      { method: 'GET', path: '/api/inventory/vaccine-batches', name: 'Get Vaccine Batches' },
      { method: 'GET', path: '/api/inventory/low-stock', name: 'Get Low Stock' },
      { method: 'GET', path: '/api/inventory/expiring', name: 'Get Expiring Items' },
      { method: 'GET', path: '/api/inventory/suppliers', name: 'Get Suppliers' },
      { method: 'GET', path: '/api/inventory/stats', name: 'Get Inventory Stats' },
      { method: 'GET', path: '/api/inventory/vaccine-inventory', name: 'Get Vaccine Inventory' },
      { method: 'GET', path: '/api/inventory/vaccine-stock-alerts', name: 'Get Stock Alerts' },
    ],
  },
  {
    name: 'Notifications',
    endpoints: [
      { method: 'GET', path: '/api/notifications', name: 'Get Notifications', auth: true },
      { method: 'GET', path: '/api/notifications/alerts', name: 'Get Alerts', auth: true },
      {
        method: 'GET',
        path: '/api/notifications/stats',
        name: 'Get Notification Stats',
        auth: true,
      },
      {
        method: 'GET',
        path: '/api/notifications/unread-count',
        name: 'Get Unread Count',
        auth: true,
      },
      {
        method: 'GET',
        path: '/api/notifications-enhanced',
        name: 'Get Enhanced Notifications',
        auth: true,
      },
      {
        method: 'GET',
        path: '/api/notifications-enhanced/stats',
        name: 'Get Enhanced Stats',
        auth: true,
      },
    ],
  },
  {
    name: 'Announcements',
    endpoints: [
      { method: 'GET', path: '/api/announcements', name: 'Get Announcements' },
      { method: 'GET', path: '/api/announcements/active/all', name: 'Get Active Announcements' },
      { method: 'GET', path: '/api/announcements/stats/overview', name: 'Get Announcement Stats' },
    ],
  },
  {
    name: 'Growth',
    endpoints: [{ method: 'GET', path: '/api/growth', name: 'Get Growth Records' }],
  },
  {
    name: 'Documents',
    endpoints: [
      { method: 'GET', path: '/api/documents', name: 'Get Documents' },
      { method: 'GET', path: '/api/documents/stats', name: 'Get Document Stats' },
      { method: 'GET', path: '/api/documents/analytics', name: 'Get Document Analytics' },
    ],
  },
  {
    name: 'Reports',
    endpoints: [
      { method: 'GET', path: '/api/reports', name: 'Get Reports' },
      { method: 'GET', path: '/api/reports/templates', name: 'Get Report Templates' },
      { method: 'GET', path: '/api/reports/stats', name: 'Get Report Stats' },
      { method: 'GET', path: '/api/reports-enhanced', name: 'Get Enhanced Reports' },
      {
        method: 'GET',
        path: '/api/reports-enhanced/vaccination-coverage',
        name: 'Get Vaccination Coverage Report',
      },
      {
        method: 'GET',
        path: '/api/reports-enhanced/inventory-status',
        name: 'Get Inventory Status Report',
      },
    ],
  },
  {
    name: 'Analytics',
    endpoints: [
      { method: 'GET', path: '/api/analytics', name: 'Get Analytics', auth: true },
      {
        method: 'GET',
        path: '/api/analytics/dashboard',
        name: 'Get Analytics Dashboard',
        auth: true,
      },
    ],
  },
  {
    name: 'Monitoring',
    endpoints: [{ method: 'GET', path: '/api/monitoring', name: 'Get Monitoring' }],
  },
  {
    name: 'Settings',
    endpoints: [
      { method: 'GET', path: '/api/settings', name: 'Get Settings', auth: true },
      { method: 'GET', path: '/api/settings/summary', name: 'Get Settings Summary', auth: true },
      { method: 'GET', path: '/api/settings/facility', name: 'Get Facility Settings', auth: true },
    ],
  },
  {
    name: 'Vaccine Management',
    endpoints: [
      { method: 'GET', path: '/api/vaccination-management', name: 'Get Vaccination Management' },
      {
        method: 'GET',
        path: '/api/vaccination-management/dashboard',
        name: 'Get Vaccination Dashboard',
        auth: true,
      },
      {
        method: 'GET',
        path: '/api/vaccination-management/patients',
        name: 'Get Patients',
        auth: true,
      },
      {
        method: 'GET',
        path: '/api/vaccination-management/inventory',
        name: 'Get Vaccination Inventory',
        auth: true,
      },
      {
        method: 'GET',
        path: '/api/vaccination-management/appointments',
        name: 'Get Vaccination Appointments',
        auth: true,
      },
      {
        method: 'GET',
        path: '/api/vaccination-management/vaccinations',
        name: 'Get Vaccination Records',
        auth: true,
      },
    ],
  },
  {
    name: 'Vaccine Supply',
    endpoints: [
      { method: 'GET', path: '/api/vaccine-supply', name: 'Get Vaccine Supply' },
      {
        method: 'GET',
        path: '/api/vaccine-supply/vaccines',
        name: 'Get Supply Vaccines',
        auth: true,
      },
      {
        method: 'GET',
        path: '/api/vaccine-supply/facilities/barangays',
        name: 'Get Facilities',
        auth: true,
      },
    ],
  },
  {
    name: 'Admin',
    endpoints: [
      { method: 'GET', path: '/api/admin/admins', name: 'Get Admins', auth: true },
      { method: 'GET', path: '/api/admin/me', name: 'Get Current Admin', auth: true },
      { method: 'GET', path: '/api/admin/stats', name: 'Get Admin Stats', auth: true },
    ],
  },
  {
    name: 'Messages',
    endpoints: [
      { method: 'GET', path: '/api/messages/conversations', name: 'Get Conversations' },
      { method: 'GET', path: '/api/messages/unread-count', name: 'Get Unread Messages' },
    ],
  },
  {
    name: 'SMS',
    endpoints: [
      { method: 'GET', path: '/api/sms', name: 'Get SMS Info' },
      { method: 'GET', path: '/api/sms/config-status', name: 'Get SMS Config', auth: true },
    ],
  },
  {
    name: 'Infant Allergies',
    endpoints: [{ method: 'GET', path: '/api/infant-allergies', name: 'Get Infant Allergies' }],
  },
  {
    name: 'Vaccine Waitlist',
    endpoints: [{ method: 'GET', path: '/api/vaccine-waitlist', name: 'Get Vaccine Waitlist' }],
  },
  {
    name: 'Vaccination Reminders',
    endpoints: [
      {
        method: 'GET',
        path: '/api/vaccination-reminders/upcoming',
        name: 'Get Upcoming Reminders',
      },
    ],
  },
  {
    name: 'Paper Templates',
    endpoints: [
      { method: 'GET', path: '/api/paper-templates', name: 'Get Paper Templates', auth: true },
    ],
  },
];

// Guardian dashboard endpoints
const GUARDIAN_TEST_SUITES = [
  {
    name: 'Guardian Dashboard',
    endpoints: [
      { method: 'GET', path: '/api/dashboard/guardian/123/stats', name: 'Guardian Stats' },
      {
        method: 'GET',
        path: '/api/dashboard/guardian/123/appointments',
        name: 'Guardian Appointments',
      },
      { method: 'GET', path: '/api/dashboard/guardian/123/children', name: 'Guardian Children' },
      {
        method: 'GET',
        path: '/api/dashboard/guardian/123/vaccinations',
        name: 'Guardian Vaccinations',
      },
      {
        method: 'GET',
        path: '/api/dashboard/guardian/123/notifications',
        name: 'Guardian Notifications',
      },
    ],
  },
  {
    name: 'Guardian Notifications',
    endpoints: [
      { method: 'GET', path: '/api/guardian/notifications', name: 'Get Guardian Notifications' },
      {
        method: 'GET',
        path: '/api/guardian/notifications/unread-count',
        name: 'Get Guardian Unread Count',
      },
      {
        method: 'GET',
        path: '/api/guardian/notifications/stats/summary',
        name: 'Get Guardian Stats',
      },
    ],
  },
];

let adminToken = null;
let guardianToken = null;
let guardianUserId = null;

async function bootstrapAuthTokens() {
  try {
    const adminLogin = await makeRequest('POST', '/api/auth/login', TEST_CREDENTIALS.admin);
    if (adminLogin.status === 200 && adminLogin.body?.token) {
      adminToken = adminLogin.body.token;
      console.log('🔐 Pre-authenticated admin token acquired');
    } else {
      console.log('⚠️  Admin pre-auth failed; protected endpoints may return 401');
    }
  } catch (error) {
    console.log(`⚠️  Admin pre-auth request failed: ${error.message}`);
  }

  try {
    const guardianLogin = await makeRequest('POST', '/api/auth/login', TEST_CREDENTIALS.guardian);
    if (guardianLogin.status === 200 && guardianLogin.body?.token) {
      guardianToken = guardianLogin.body.token;
      guardianUserId = guardianLogin.body?.user?.guardian_id || null;
      console.log('🔐 Pre-authenticated guardian token acquired');
    } else {
      console.log('⚠️  Guardian pre-auth failed; guardian suites may be skipped');
    }
  } catch (error) {
    console.log(`⚠️  Guardian pre-auth request failed: ${error.message}`);
  }
}

// Run tests
async function runTests() {
  console.log('\n===========================================');
  console.log('IMMUNICARE COMPREHENSIVE API TEST SUITE');
  console.log('===========================================\n');
  console.log(`Testing API: ${BASE_URL}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  await bootstrapAuthTokens();

  // Test 1: Public endpoints (no auth)
  console.log('\n--- Testing Public Endpoints ---\n');

  for (const suite of TEST_SUITES) {
    console.log(`\nTesting: ${suite.name}`);

    for (const endpoint of suite.endpoints) {
      try {
        let headers = {};

        // Add auth token if needed
        if (endpoint.auth && adminToken) {
          headers = {
            ...headers,
            Authorization: `Bearer ${adminToken}`,
          };
        }

        let response = await makeRequest(
          endpoint.method,
          endpoint.path,
          endpoint.data || null,
          headers,
        );

        // Auto-retry likely protected endpoints with admin token to reduce false negatives
        if (
          response.status === 401 &&
          !headers.Authorization &&
          adminToken &&
          endpoint.path !== '/api/auth/login'
        ) {
          const retryHeaders = {
            ...headers,
            Authorization: `Bearer ${adminToken}`,
          };

          response = await makeRequest(
            endpoint.method,
            endpoint.path,
            endpoint.data || null,
            retryHeaders,
          );
        }

        const passed = response.status >= 200 && response.status < 400;
        const details = passed
          ? 'OK'
          : response.body?.error || response.body?.message || 'Unknown error';

        logTest(
          `${suite.name}: ${endpoint.name}`,
          passed,
          details,
          response.status,
          response.duration,
        );

        // Track performance
        results.performance[endpoint.path] = {
          status: response.status,
          duration: response.duration,
          success: passed,
        };

        // Check for specific issues
        if (response.status === 401) {
          logWarning(`${endpoint.name}`, 'Requires authentication');
        } else if (response.status === 403) {
          logWarning(`${endpoint.name}`, 'Forbidden - insufficient permissions');
        } else if (response.status === 404) {
          logMissing(`${endpoint.name}`, 'Endpoint not found');
        } else if (response.status === 500) {
          logWarning(`${endpoint.name}`, 'Internal server error');
        }
      } catch (err) {
        logTest(`${suite.name}: ${endpoint.name}`, false, err.message);
      }
    }
  }

  // Test 2: Try admin login
  console.log('\n--- Testing Authentication ---\n');

  try {
    const loginResponse = await makeRequest('POST', '/api/auth/login', TEST_CREDENTIALS.admin);

    if (loginResponse.status === 200 && loginResponse.body?.token) {
      adminToken = loginResponse.body.token;
      logTest('Admin Login', true, 'Token received', loginResponse.status, loginResponse.duration);

      // Test with token
      const verifyResponse = await makeRequest('GET', '/api/auth/verify', null, {
        Authorization: `Bearer ${adminToken}`,
      });
      logTest(
        'Token Verification',
        verifyResponse.status === 200,
        'Token valid',
        verifyResponse.status,
      );
    } else {
      logTest(
        'Admin Login',
        false,
        loginResponse.body?.error || 'Login failed',
        loginResponse.status,
      );
    }
  } catch (err) {
    logTest('Admin Login', false, err.message);
  }

  // Test 3: Try guardian login
  try {
    const guardianLoginResponse = await makeRequest('POST', '/api/auth/login', {
      username: TEST_CREDENTIALS.guardian.username,
      password: TEST_CREDENTIALS.guardian.password,
    });

    if (guardianLoginResponse.status === 200 && guardianLoginResponse.body?.token) {
      guardianToken = guardianLoginResponse.body.token;
      guardianUserId = guardianLoginResponse.body?.user?.guardian_id || guardianUserId;
      logTest(
        'Guardian Login',
        true,
        'Token received',
        guardianLoginResponse.status,
        guardianLoginResponse.duration,
      );
    } else {
      logTest(
        'Guardian Login',
        false,
        guardianLoginResponse.body?.error || 'Login failed',
        guardianLoginResponse.status,
      );
    }
  } catch (err) {
    logTest('Guardian Login', false, err.message);
  }

  // Test 4: Test authenticated endpoints with admin token
  console.log('\n--- Testing Authenticated Endpoints (Admin) ---\n');

  if (adminToken) {
    const authTests = [
      { method: 'GET', path: '/api/dashboard/stats', name: 'Dashboard Stats' },
      { method: 'GET', path: '/api/dashboard/appointments', name: 'Dashboard Appointments' },
      { method: 'GET', path: '/api/dashboard/guardians', name: 'Dashboard Guardians' },
      { method: 'GET', path: '/api/dashboard/infants', name: 'Dashboard Infants' },
      { method: 'GET', path: '/api/dashboard/activity', name: 'Dashboard Activity' },
      { method: 'GET', path: '/api/admin/me', name: 'Admin Profile' },
      { method: 'GET', path: '/api/admin/stats', name: 'Admin Stats' },
      { method: 'GET', path: '/api/analytics/dashboard', name: 'Analytics Dashboard' },
      { method: 'GET', path: '/api/notifications', name: 'Notifications' },
      { method: 'GET', path: '/api/notifications/stats', name: 'Notification Stats' },
      { method: 'GET', path: '/api/settings', name: 'Settings' },
      {
        method: 'GET',
        path: '/api/vaccination-management/dashboard',
        name: 'Vaccination Management Dashboard',
      },
    ];

    for (const test of authTests) {
      try {
        const response = await makeRequest(test.method, test.path, null, {
          Authorization: `Bearer ${adminToken}`,
        });

        const passed = response.status >= 200 && response.status < 400;
        logTest(
          `Admin Auth: ${test.name}`,
          passed,
          response.body?.error || 'OK',
          response.status,
          response.duration,
        );

        if (response.status === 403) {
          logWarning(test.name, 'Access denied - may need different role');
        }
      } catch (err) {
        logTest(`Admin Auth: ${test.name}`, false, err.message);
      }
    }
  }

  // Test 5: Test guardian endpoints
  console.log('\n--- Testing Guardian Endpoints ---\n');

  if (guardianToken) {
    const resolvedGuardianId = guardianUserId || 1;

    for (const suite of GUARDIAN_TEST_SUITES) {
      console.log(`Testing: ${suite.name}`);

      for (const endpoint of suite.endpoints) {
        try {
          const resolvedPath = endpoint.path.replace('/guardian/123/', `/guardian/${resolvedGuardianId}/`);

          const response = await makeRequest(endpoint.method, resolvedPath, null, {
            Authorization: `Bearer ${guardianToken}`,
          });

          const passed = response.status >= 200 && response.status < 400;
          logTest(
            `${suite.name}: ${endpoint.name}`,
            passed,
            response.body?.error || 'OK',
            response.status,
            response.duration,
          );
        } catch (err) {
          logTest(`${suite.name}: ${endpoint.name}`, false, err.message);
        }
      }
    }
  }

  // Test 6: Test infant/patient routes with guardian
  console.log('\n--- Testing Infant/Patient Routes ---\n');

  const infantTests = [
    { method: 'GET', path: '/api/infants', name: 'Get All Infants' },
    {
      method: 'GET',
      path: `/api/infants/guardian/${guardianUserId || 1}`,
      name: 'Get Infants by Guardian',
    },
  ];

  for (const test of infantTests) {
    const token = adminToken || guardianToken;
    if (!token) {
      continue;
    }

    try {
      const response = await makeRequest(test.method, test.path, null, {
        Authorization: `Bearer ${token}`,
      });

      const passed = response.status >= 200 && response.status < 400;
      logTest(test.name, passed, response.body?.error || 'OK', response.status, response.duration);

      // If we have infants, try to get specific infant
      if (passed && response.body?.infants?.length > 0) {
        const infantId = response.body.infants[0].id;
        const infantResponse = await makeRequest('GET', `/api/infants/${infantId}`, null, {
          Authorization: `Bearer ${token}`,
        });
        logTest(
          `Get Infant by ID (${infantId})`,
          infantResponse.status === 200,
          'OK',
          infantResponse.status,
        );
      }
    } catch (err) {
      logTest(test.name, false, err.message);
    }
  }

  // Test 7: Test vaccination routes
  console.log('\n--- Testing Vaccination Routes ---\n');

  const vaccinationTests = [
    { method: 'GET', path: '/api/vaccinations', name: 'Get All Vaccinations' },
    { method: 'GET', path: '/api/vaccinations/vaccines', name: 'Get Vaccines List' },
    { method: 'GET', path: '/api/vaccinations/schedules', name: 'Get Vaccination Schedules' },
    { method: 'GET', path: '/api/vaccinations/records', name: 'Get Vaccination Records' },
    { method: 'GET', path: '/api/vaccinations/batches', name: 'Get Vaccination Batches' },
  ];

  const token = adminToken || guardianToken;
  for (const test of vaccinationTests) {
    if (!token) {
      continue;
    }

    try {
      const response = await makeRequest(test.method, test.path, null, {
        Authorization: `Bearer ${token}`,
      });

      const passed = response.status >= 200 && response.status < 400;
      logTest(test.name, passed, response.body?.error || 'OK', response.status, response.duration);
    } catch (err) {
      logTest(test.name, false, err.message);
    }
  }

  // Test 8: Performance test
  console.log('\n--- Performance Summary ---\n');

  const slowEndpoints = Object.entries(results.performance)
    .filter(([_, data]) => data.duration > 1000)
    .sort((a, b) => b[1].duration - a[1].duration);

  if (slowEndpoints.length > 0) {
    console.log('Slow endpoints (>1s):');
    slowEndpoints.forEach(([path, data]) => {
      console.log(`  ${path}: ${data.duration}ms [${data.status}]`);
    });
  }

  // Print summary
  console.log('\n===========================================');
  console.log('TEST SUMMARY');
  console.log('===========================================');
  console.log(`Total Tests: ${results.summary.total}`);
  console.log(`Passed: ${results.summary.passed} ✅`);
  console.log(`Failed: ${results.summary.failed} ❌`);
  console.log(`Warnings: ${results.summary.warnings} ⚠️`);
  console.log(`Missing Features: ${results.missing.length} 🔍`);

  // Save results to file
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    summary: results.summary,
    errors: results.errors,
    warnings: results.warnings,
    missing: results.missing,
    performance: results.performance,
    tests: results.tests,
  };

  if (process.env.NO_FILE_OUTPUT !== '1') {
    fs.writeFileSync('./COMPREHENSIVE_API_TEST_REPORT.json', JSON.stringify(report, null, 2));
    console.log('\n📄 Detailed report saved to: ./COMPREHENSIVE_API_TEST_REPORT.json');
  } else {
    console.log('\n📄 Detailed report file output skipped (NO_FILE_OUTPUT=1)');
  }

  // Print missing features
  if (results.missing.length > 0) {
    console.log('\n===========================================');
    console.log('MISSING/NOT FOUND FEATURES');
    console.log('===========================================');
    results.missing.forEach((item) => {
      console.log(`- ${item.feature}: ${item.details}`);
    });
  }

  // Print errors
  if (results.errors.length > 0) {
    console.log('\n===========================================');
    console.log('ERRORS ENCOUNTERED');
    console.log('===========================================');
    results.errors.forEach((item) => {
      console.log(`- ${item.name}: ${item.details} [${item.statusCode}]`);
    });
  }

  return report;
}

// Run the tests
runTests()
  .then((report) => {
    console.log('\n✅ Test suite completed');
    process.exit(report.summary.failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('\n❌ Test suite failed:', err);
    process.exit(1);
  });
