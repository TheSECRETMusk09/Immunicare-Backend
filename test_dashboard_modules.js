/**
 * Comprehensive API Test for Admin and Guardian Dashboard Modules
 * Tests all API endpoints to identify errors or problems
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';

// Test results storage
const testResults = {
  admin: [],
  guardian: [],
  errors: [],
  warnings: [],
  public: []
};

let adminToken = null;
let guardianToken = null;

function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

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

async function login(credentials) {
  try {
    const response = await makeRequest('POST', '/api/auth/login', credentials);
    if (response.status === 200 && response.data.token) {
      return response.data.token;
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function testEndpoint(
  category,
  name,
  method,
  path,
  data = null,
  expectedStatus = 200,
  token = null
) {
  const result = { name, path, method, status: null, error: null, data: null };

  try {
    const response = await makeRequest(method, path, data, token);
    result.status = response.status;
    result.data = response.data;

    if (response.status >= 400) {
      result.error = response.data.error || response.data.message || 'Unknown error';
      testResults.errors.push({ category, ...result });
    } else if (response.status !== expectedStatus) {
      testResults.warnings.push({
        category,
        ...result,
        message: `Expected status ${expectedStatus}, got ${response.status}`
      });
    }
  } catch (err) {
    result.error = err.message;
    testResults.errors.push({ category, ...result });
  }

  testResults[category].push(result);
  return result;
}

// Public endpoints to test (no auth required)
const publicModules = [
  { name: 'Health Check', path: '/api/health', method: 'GET' },
  { name: 'Auth Test', path: '/api/auth/test', method: 'GET' },
  { name: 'Root', path: '/', method: 'GET' }
];

// Protected Admin Dashboard Modules
const adminModules = [
  // Dashboard
  { name: 'Dashboard Stats', path: '/api/dashboard/stats', method: 'GET' },
  { name: 'Dashboard Appointments', path: '/api/dashboard/appointments', method: 'GET' },
  { name: 'Dashboard Guardians Count', path: '/api/dashboard/guardians', method: 'GET' },
  { name: 'Dashboard Infants Count', path: '/api/dashboard/infants', method: 'GET' },
  { name: 'Dashboard Activity', path: '/api/dashboard/activity', method: 'GET' },

  // User Management
  { name: 'Get All Users', path: '/api/users', method: 'GET' },

  // Infants Management
  { name: 'Get All Infants', path: '/api/infants', method: 'GET' },

  // Vaccinations
  { name: 'Get All Vaccinations', path: '/api/vaccinations', method: 'GET' },

  // Appointments
  { name: 'Get All Appointments', path: '/api/appointments', method: 'GET' },

  // Inventory
  { name: 'Get Inventory', path: '/api/inventory', method: 'GET' },

  // Reports
  { name: 'Get Reports', path: '/api/reports', method: 'GET' },

  // Analytics
  { name: 'Get Analytics', path: '/api/analytics', method: 'GET' },

  // Announcements
  { name: 'Get Announcements', path: '/api/announcements', method: 'GET' },

  // Notifications
  { name: 'Get Notifications', path: '/api/notifications', method: 'GET' },

  // Growth Monitoring
  { name: 'Get Growth Data', path: '/api/growth', method: 'GET' },

  // Documents
  { name: 'Get Documents', path: '/api/documents', method: 'GET' },
  { name: 'Get Document Templates', path: '/api/paper-templates', method: 'GET' },

  // Settings
  { name: 'Get Settings', path: '/api/settings', method: 'GET' },

  // Messages
  { name: 'Get Messages', path: '/api/messages', method: 'GET' },

  // Health Info (for admin)
  { name: 'Get All Health Info', path: '/api/health-info', method: 'GET' }
];

// Guardian Dashboard Modules - these use guardian token
const guardianModules = [
  // Guardian Dashboard
  { name: 'Guardian Stats', path: '/api/dashboard/guardian/1/stats', method: 'GET' },
  { name: 'Guardian Appointments', path: '/api/dashboard/guardian/1/appointments', method: 'GET' },
  { name: 'Guardian Children', path: '/api/dashboard/guardian/1/children', method: 'GET' },
  { name: 'Guardian Vaccinations', path: '/api/dashboard/guardian/1/vaccinations', method: 'GET' },
  {
    name: 'Guardian Health Charts',
    path: '/api/dashboard/guardian/1/health-charts',
    method: 'GET'
  },
  {
    name: 'Guardian Notifications',
    path: '/api/dashboard/guardian/1/notifications',
    method: 'GET'
  },

  // Guardian direct API calls
  {
    name: 'Get Guardian Notifications (direct)',
    path: '/api/guardian/notifications',
    method: 'GET'
  },
  { name: 'Get User Profile', path: '/api/users/profile', method: 'GET' }
];

// Test routes that return 404 to verify which ones don't exist
const routesToVerify = [
  // These might not exist - will verify
  { name: 'Vaccination Management', path: '/api/vaccination-management', method: 'GET' },
  { name: 'Vaccine Supply', path: '/api/vaccine-supply', method: 'GET' },
  { name: 'Reports Enhanced', path: '/api/reports-enhanced', method: 'GET' },
  { name: 'Notifications Enhanced', path: '/api/notifications-enhanced', method: 'GET' },
  { name: 'Monitoring', path: '/api/monitoring', method: 'GET' },
  { name: 'Admin', path: '/api/admin', method: 'GET' },
  { name: 'SMS', path: '/api/sms', method: 'GET' },
  { name: 'Vaccine Tracking', path: '/api/vaccine-tracking', method: 'GET' },
  { name: 'Inventory Stats', path: '/api/inventory/stats', method: 'GET' },
  { name: 'Low Stock Items', path: '/api/inventory/low-stock', method: 'GET' },
  { name: 'Vaccine Supply Stats', path: '/api/vaccine-supply/stats', method: 'GET' },
  { name: 'Analytics Dashboard', path: '/api/analytics/dashboard', method: 'GET' },
  { name: 'Active Announcements', path: '/api/announcements/active', method: 'GET' }
];

async function runTests() {
  console.log('='.repeat(60));
  console.log('IMMUNICARE - Admin & Guardian Dashboard Module Testing');
  console.log('='.repeat(60));
  console.log(`\nTest started at: ${new Date().toISOString()}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log('\n');

  // First, check if server is running
  console.log('Checking server health...');
  try {
    const health = await makeRequest('GET', '/api/health');
    console.log(`Server Status: ${health.status === 200 ? '✓ ONLINE' : '✗ ERROR'}`);
    console.log(`Health Response: ${JSON.stringify(health.data)}\n`);
  } catch (err) {
    console.error('✗ Server is not running or not accessible!');
    console.error(`Error: ${err.message}`);
    console.log('\nPlease start the backend server first:');
    console.log('  cd backend && node server.js\n');
    process.exit(1);
  }

  // Test Public Endpoints
  console.log('-'.repeat(60));
  console.log('TESTING PUBLIC ENDPOINTS');
  console.log('-'.repeat(60));

  for (const module of publicModules) {
    const result = await testEndpoint(
      'public',
      module.name,
      module.method,
      module.path,
      null,
      200,
      null
    );

    const statusIcon = result.status === 200 ? '✓' : '✗';
    console.log(
      `${statusIcon} ${module.name}: ${result.status || 'ERROR'} ${result.error ? `(${result.error})` : ''}`
    );
  }

  // Try to get admin token
  console.log('\n' + '-'.repeat(60));
  console.log('ATTEMPTING AUTHENTICATION');
  console.log('-'.repeat(60));

  // Try common admin credentials
  const adminCredentials = [
    { username: 'admin', password: 'Admin2024!' },
    { username: 'admin', password: 'admin123' },
    { username: 'admin', password: 'admin' },
    { email: 'admin@immunicare.com', password: 'Admin2024!' }
  ];

  for (const creds of adminCredentials) {
    console.log(`Trying admin login with ${creds.username || creds.email}...`);
    adminToken = await login(creds);
    if (adminToken) {
      console.log('✓ Admin login successful!');
      break;
    }
  }

  if (!adminToken) {
    console.log('✗ Admin login failed - will test with unauthenticated requests');
  }

  // Test Admin Modules
  console.log('\n' + '-'.repeat(60));
  console.log('TESTING ADMIN DASHBOARD MODULES');
  console.log('-'.repeat(60));

  for (const module of adminModules) {
    const result = await testEndpoint(
      'admin',
      module.name,
      module.method,
      module.path,
      null,
      200,
      adminToken
    );

    const statusIcon = result.status >= 200 && result.status < 400 ? '✓' : '✗';
    console.log(
      `${statusIcon} ${module.name}: ${result.status || 'ERROR'} ${result.error ? `(${result.error})` : ''}`
    );
  }

  // Test Guardian Modules (using admin token as fallback since we couldn't get guardian token)
  console.log('\n' + '-'.repeat(60));
  console.log('TESTING GUARDIAN DASHBOARD MODULES');
  console.log('-'.repeat(60));

  // Try to get guardian token
  const guardianCredentials = [
    { username: 'maria.dela.cruz', password: 'Guardian123!' },
    { username: 'guardian', password: 'guardian123' },
    { username: 'guardian1', password: 'guardian123' },
    { email: 'carmen.lim@email.com', password: 'Guardian123!' }
  ];

  for (const creds of guardianCredentials) {
    console.log(`Trying guardian login with ${creds.username || creds.email}...`);
    guardianToken = await login(creds);
    if (guardianToken) {
      console.log('✓ Guardian login successful!');
      break;
    }
  }

  if (!guardianToken) {
    console.log('✗ Guardian login failed - using admin token for testing');
    guardianToken = adminToken; // Use admin token as fallback
  }

  for (const module of guardianModules) {
    const result = await testEndpoint(
      'guardian',
      module.name,
      module.method,
      module.path,
      null,
      200,
      guardianToken
    );

    const statusIcon = result.status >= 200 && result.status < 400 ? '✓' : '✗';
    console.log(
      `${statusIcon} ${module.name}: ${result.status || 'ERROR'} ${result.error ? `(${result.error})` : ''}`
    );
  }

  // Verify Routes (check which ones return 404)
  console.log('\n' + '-'.repeat(60));
  console.log('VERIFYING ROUTE EXISTENCE');
  console.log('-'.repeat(60));

  for (const route of routesToVerify) {
    const result = await testEndpoint(
      'admin',
      route.name,
      route.method,
      route.path,
      null,
      200,
      adminToken
    );

    const statusIcon =
      result.status === 404 ? '✗' : result.status >= 200 && result.status < 400 ? '✓' : '?';
    const statusText = result.status === 404 ? 'NOT FOUND' : result.status;
    console.log(`${statusIcon} ${route.name}: ${statusText}`);
  }

  // Print Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  const publicTotal = testResults.public.length;
  const publicPassed = testResults.public.filter((r) => r.status >= 200 && r.status < 400).length;

  const adminTotal = testResults.admin.length;
  const adminPassed = testResults.admin.filter((r) => r.status >= 200 && r.status < 400).length;
  const adminFailed = adminTotal - adminPassed;

  const guardianTotal = testResults.guardian.length;
  const guardianPassed = testResults.guardian.filter(
    (r) => r.status >= 200 && r.status < 400
  ).length;
  const guardianFailed = guardianTotal - guardianPassed;

  console.log('\nPublic Endpoints:');
  console.log(`  Total Tests: ${publicTotal}`);
  console.log(`  Passed: ${publicPassed}`);
  console.log(`  Failed: ${publicTotal - publicPassed}`);

  console.log('\nAdmin Dashboard:');
  console.log(`  Total Tests: ${adminTotal}`);
  console.log(`  Passed: ${adminPassed}`);
  console.log(`  Failed: ${adminFailed}`);

  console.log('\nGuardian Dashboard:');
  console.log(`  Total Tests: ${guardianTotal}`);
  console.log(`  Passed: ${guardianPassed}`);
  console.log(`  Failed: ${guardianFailed}`);

  // Print Errors
  if (testResults.errors.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('ERRORS FOUND');
    console.log('-'.repeat(60));

    // Group errors by category
    const adminErrors = testResults.errors.filter((e) => e.category === 'admin');
    const guardianErrors = testResults.errors.filter((e) => e.category === 'guardian');

    if (adminErrors.length > 0) {
      console.log('\nAdmin Dashboard Errors:');
      adminErrors.slice(0, 10).forEach((err, i) => {
        console.log(`  ${i + 1}. ${err.name}`);
        console.log(`     Path: ${err.method} ${err.path}`);
        console.log(`     Status: ${err.status}`);
        console.log(`     Error: ${err.error}`);
      });
      if (adminErrors.length > 10) {
        console.log(`  ... and ${adminErrors.length - 10} more errors`);
      }
    }

    if (guardianErrors.length > 0) {
      console.log('\nGuardian Dashboard Errors:');
      guardianErrors.slice(0, 10).forEach((err, i) => {
        console.log(`  ${i + 1}. ${err.name}`);
        console.log(`     Path: ${err.method} ${err.path}`);
        console.log(`     Status: ${err.status}`);
        console.log(`     Error: ${err.error}`);
      });
      if (guardianErrors.length > 10) {
        console.log(`  ... and ${guardianErrors.length - 10} more errors`);
      }
    }
  }

  // Print Warnings
  if (testResults.warnings.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('WARNINGS');
    console.log('-'.repeat(60));
    testResults.warnings.slice(0, 5).forEach((warn, i) => {
      console.log(`  ${i + 1}. ${warn.name}: ${warn.message}`);
    });
    if (testResults.warnings.length > 5) {
      console.log(`  ... and ${testResults.warnings.length - 5} more warnings`);
    }
  }

  // Final verdict
  console.log('\n' + '='.repeat(60));
  const totalErrors = testResults.errors.length;
  if (totalErrors === 0) {
    console.log('✓ ALL TESTS PASSED - No errors found!');
  } else {
    console.log(`✗ ${totalErrors} ERRORS FOUND - See details above`);
  }
  console.log('='.repeat(60));

  // Return exit code based on test results
  process.exit(totalErrors > 0 ? 1 : 0);
}

// Run tests
runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
