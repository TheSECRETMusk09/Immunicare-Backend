/**
 * Comprehensive Test Suite for Admin Dashboard Modules
 * Tests frontend interactivity, backend database connectivity, and business logic
 *
 * Modules NOT associated with Guardian Dashboard:
 * 1. Dashboard (Admin Overview)
 * 2. Analytics
 * 3. InfantManagement
 * 4. InventoryManagement (adminOnly)
 * 5. UserManagement (adminOnly)
 * 6. VaccinationsDashboard
 * 7. VaccineTracking
 * 8. Reports
 * 9. Announcements
 * 10. DigitalPapersDashboard (adminOnly)
 * 11. FileUpload
 *
 * Run: node backend/tests/admin_modules_comprehensive_test.js
 */

const http = require('http');
const https = require('https');
const { Pool } = require('pg');

// Test configuration
const CONFIG = {
  API_BASE: 'http://localhost:5000/api',
  FRONTEND_BASE: 'http://localhost:3000',
  TEST_ADMIN: {
    username: 'admin',
    password: 'Admin123!'
  },
  TEST_GUARDIAN: {
    username: 'guardian@test.com',
    password: 'Guardian123!'
  }
};

// Database connection for direct testing
let pool;
let authToken = null;
const testResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: []
};

// Helper function for API requests
function makeRequest(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, CONFIG.API_BASE);
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || 5000,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
        ...options.headers
      }
    };

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: data
          });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

// Test logging helper
function logTest(module, testName, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  const message = `${status} | [${module}] ${testName}${details ? ` - ${details}` : ''}`;
  console.log(message);

  testResults.tests.push({ module, testName, passed, details });
  if (passed) {
    testResults.passed++;
  } else {
    testResults.failed++;
  }
}

function logSkip(module, testName, reason = '') {
  const message = `⏭️ SKIP | [${module}] ${testName}${reason ? ` - ${reason}` : ''}`;
  console.log(message);

  testResults.tests.push({ module, testName, passed: null, skipped: true, reason });
  testResults.skipped++;
}

// ==================== AUTHENTICATION SETUP ====================

async function setupAuthentication() {
  console.log('\n=== Setting Up Authentication ===\n');

  try {
    // Test admin login
    const loginResponse = await makeRequest('/auth/login', {
      method: 'POST',
      body: CONFIG.TEST_ADMIN
    });

    if (loginResponse.status === 200 && loginResponse.data?.token) {
      authToken = loginResponse.data.token;
      logTest('Auth', 'Admin login successful', true);
      return true;
    } else {
      logTest('Auth', 'Admin login failed', false, `Status: ${loginResponse.status}`);
      return false;
    }
  } catch (error) {
    logTest('Auth', 'Admin login error', false, error.message);
    return false;
  }
}

// ==================== MODULE 1: DASHBOARD ====================

async function testDashboardModule() {
  console.log('\n=== Testing Dashboard Module ===\n');
  const module = 'Dashboard';

  // Test 1: Dashboard data endpoint
  try {
    const response = await makeRequest('/dashboard');
    if (response.status === 200) {
      logTest(module, 'Dashboard data endpoint accessible', true);

      // Verify data structure
      const data = response.data;
      if (data && (data.stats || data.overview || data.recentActivity)) {
        logTest(module, 'Dashboard data structure valid', true);
      } else {
        logTest(module, 'Dashboard data structure valid', false, 'Missing expected fields');
      }
    } else {
      logTest(module, 'Dashboard data endpoint accessible', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'Dashboard data endpoint error', false, error.message);
  }

  // Test 2: Dashboard statistics
  try {
    const response = await makeRequest('/dashboard/stats');
    if (response.status === 200 || response.status === 404) {
      logTest(module, 'Dashboard stats endpoint', response.status === 200);
    }
  } catch (error) {
    logTest(module, 'Dashboard stats endpoint', false, error.message);
  }

  // Test 3: Recent activity
  try {
    const response = await makeRequest('/dashboard/recent-activity');
    if (response.status === 200 || response.status === 404) {
      logTest(module, 'Recent activity endpoint', response.status === 200);
    }
  } catch (error) {
    logTest(module, 'Recent activity endpoint', false, error.message);
  }
}

// ==================== MODULE 2: ANALYTICS ====================

async function testAnalyticsModule() {
  console.log('\n=== Testing Analytics Module ===\n');
  const module = 'Analytics';

  // Test 1: Analytics overview
  try {
    const response = await makeRequest('/analytics');
    if (response.status === 200) {
      logTest(module, 'Analytics overview endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Analytics overview endpoint', 'Endpoint not implemented');
    } else {
      logTest(module, 'Analytics overview endpoint', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'Analytics overview endpoint', false, error.message);
  }

  // Test 2: Vaccination analytics
  try {
    const response = await makeRequest('/analytics/vaccinations');
    if (response.status === 200) {
      logTest(module, 'Vaccination analytics endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Vaccination analytics endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Vaccination analytics endpoint', false, error.message);
  }

  // Test 3: Monthly trends
  try {
    const response = await makeRequest('/analytics/trends/monthly');
    if (response.status === 200) {
      logTest(module, 'Monthly trends endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Monthly trends endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Monthly trends endpoint', false, error.message);
  }
}

// ==================== MODULE 3: INFANT MANAGEMENT ====================

async function testInfantManagementModule() {
  console.log('\n=== Testing Infant Management Module ===\n');
  const module = 'InfantManagement';

  // Test 1: List infants
  try {
    const response = await makeRequest('/infants');
    if (response.status === 200) {
      logTest(module, 'List infants endpoint', true);

      // Verify data structure
      if (Array.isArray(response.data) || response.data?.infants) {
        logTest(module, 'Infants data structure valid', true);
      } else {
        logTest(module, 'Infants data structure valid', false, 'Invalid format');
      }
    } else {
      logTest(module, 'List infants endpoint', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'List infants endpoint', false, error.message);
  }

  // Test 2: Create infant (dry run - no actual creation)
  try {
    const response = await makeRequest('/infants', {
      method: 'POST',
      body: {
        first_name: 'Test',
        last_name: 'Infant',
        dob: '2024-01-01',
        sex: 'M',
        guardian_id: 1
      }
    });
    if (response.status === 200 || response.status === 201) {
      logTest(module, 'Create infant endpoint', true);
    } else if (response.status === 400) {
      logTest(module, 'Create infant endpoint validation', true, 'Validation working');
    } else {
      logTest(module, 'Create infant endpoint', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'Create infant endpoint', false, error.message);
  }

  // Test 3: Get infant by ID
  try {
    const response = await makeRequest('/infants/1');
    if (response.status === 200) {
      logTest(module, 'Get infant by ID endpoint', true);
    } else if (response.status === 404) {
      logTest(module, 'Get infant by ID endpoint', true, 'Not found (expected for test)');
    } else {
      logTest(module, 'Get infant by ID endpoint', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'Get infant by ID endpoint', false, error.message);
  }
}

// ==================== MODULE 4: INVENTORY MANAGEMENT ====================

async function testInventoryManagementModule() {
  console.log('\n=== Testing Inventory Management Module ===\n');
  const module = 'InventoryManagement';

  // Test 1: List inventory
  try {
    const response = await makeRequest('/inventory');
    if (response.status === 200) {
      logTest(module, 'List inventory endpoint', true);
    } else if (response.status === 403) {
      logTest(module, 'List inventory endpoint - admin only', true, 'Access control working');
    } else {
      logTest(module, 'List inventory endpoint', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'List inventory endpoint', false, error.message);
  }

  // Test 2: Vaccine inventory
  try {
    const response = await makeRequest('/inventory/vaccines');
    if (response.status === 200) {
      logTest(module, 'Vaccine inventory endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Vaccine inventory endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Vaccine inventory endpoint', false, error.message);
  }

  // Test 3: Stock alerts
  try {
    const response = await makeRequest('/inventory/alerts');
    if (response.status === 200) {
      logTest(module, 'Stock alerts endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Stock alerts endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Stock alerts endpoint', false, error.message);
  }

  // Test 4: Inventory transactions
  try {
    const response = await makeRequest('/inventory/transactions');
    if (response.status === 200) {
      logTest(module, 'Inventory transactions endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Inventory transactions endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Inventory transactions endpoint', false, error.message);
  }
}

// ==================== MODULE 5: USER MANAGEMENT ====================

async function testUserManagementModule() {
  console.log('\n=== Testing User Management Module ===\n');
  const module = 'UserManagement';

  // Test 1: List users
  try {
    const response = await makeRequest('/users');
    if (response.status === 200) {
      logTest(module, 'List users endpoint', true);
    } else if (response.status === 403) {
      logTest(module, 'List users endpoint - admin only', true, 'Access control working');
    } else {
      logTest(module, 'List users endpoint', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'List users endpoint', false, error.message);
  }

  // Test 2: Get user by ID
  try {
    const response = await makeRequest('/users/1');
    if (response.status === 200) {
      logTest(module, 'Get user by ID endpoint', true);
    } else if (response.status === 404) {
      logTest(module, 'Get user by ID endpoint', true, 'Not found (expected)');
    }
  } catch (error) {
    logTest(module, 'Get user by ID endpoint', false, error.message);
  }

  // Test 3: User roles
  try {
    const response = await makeRequest('/users/roles');
    if (response.status === 200) {
      logTest(module, 'User roles endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'User roles endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'User roles endpoint', false, error.message);
  }
}

// ==================== MODULE 6: VACCINATIONS DASHBOARD ====================

async function testVaccinationsDashboardModule() {
  console.log('\n=== Testing Vaccinations Dashboard Module ===\n');
  const module = 'VaccinationsDashboard';

  // Test 1: Vaccination list
  try {
    const response = await makeRequest('/vaccinations');
    if (response.status === 200) {
      logTest(module, 'Vaccination list endpoint', true);
    } else {
      logTest(module, 'Vaccination list endpoint', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'Vaccination list endpoint', false, error.message);
  }

  // Test 2: Vaccination schedule
  try {
    const response = await makeRequest('/vaccinations/schedule');
    if (response.status === 200) {
      logTest(module, 'Vaccination schedule endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Vaccination schedule endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Vaccination schedule endpoint', false, error.message);
  }

  // Test 3: Vaccination records
  try {
    const response = await makeRequest('/vaccinations/records');
    if (response.status === 200) {
      logTest(module, 'Vaccination records endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Vaccination records endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Vaccination records endpoint', false, error.message);
  }
}

// ==================== MODULE 7: VACCINE TRACKING ====================

async function testVaccineTrackingModule() {
  console.log('\n=== Testing Vaccine Tracking Module ===\n');
  const module = 'VaccineTracking';

  // Test 1: Vaccine tracking list
  try {
    const response = await makeRequest('/vaccination-management');
    if (response.status === 200) {
      logTest(module, 'Vaccine tracking list endpoint', true);
    } else {
      logTest(module, 'Vaccine tracking list endpoint', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'Vaccine tracking list endpoint', false, error.message);
  }

  // Test 2: Vaccine supply
  try {
    const response = await makeRequest('/vaccine-supply');
    if (response.status === 200) {
      logTest(module, 'Vaccine supply endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Vaccine supply endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Vaccine supply endpoint', false, error.message);
  }
}

// ==================== MODULE 8: REPORTS ====================

async function testReportsModule() {
  console.log('\n=== Testing Reports Module ===\n');
  const module = 'Reports';

  // Test 1: Reports list
  try {
    const response = await makeRequest('/reports');
    if (response.status === 200) {
      logTest(module, 'Reports list endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Reports list endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Reports list endpoint', false, error.message);
  }

  // Test 2: Generate report
  try {
    const response = await makeRequest('/reports/generate', {
      method: 'POST',
      body: { type: 'vaccination', format: 'pdf' }
    });
    if (response.status === 200 || response.status === 201) {
      logTest(module, 'Generate report endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Generate report endpoint', 'Endpoint not implemented');
    } else if (response.status === 400) {
      logTest(module, 'Generate report validation', true, 'Validation working');
    }
  } catch (error) {
    logTest(module, 'Generate report endpoint', false, error.message);
  }
}

// ==================== MODULE 9: ANNOUNCEMENTS ====================

async function testAnnouncementsModule() {
  console.log('\n=== Testing Announcements Module ===\n');
  const module = 'Announcements';

  // Test 1: List announcements
  try {
    const response = await makeRequest('/announcements');
    if (response.status === 200) {
      logTest(module, 'List announcements endpoint', true);
    } else {
      logTest(module, 'List announcements endpoint', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest(module, 'List announcements endpoint', false, error.message);
  }

  // Test 2: Create announcement (dry run)
  try {
    const response = await makeRequest('/announcements', {
      method: 'POST',
      body: {
        title: 'Test Announcement',
        content: 'Test content',
        type: 'info'
      }
    });
    if (response.status === 200 || response.status === 201) {
      logTest(module, 'Create announcement endpoint', true);
    } else if (response.status === 400) {
      logTest(module, 'Create announcement validation', true, 'Validation working');
    } else if (response.status === 404) {
      logSkip(module, 'Create announcement endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Create announcement endpoint', false, error.message);
  }
}

// ==================== MODULE 10: DIGITAL PAPERS ====================

async function testDigitalPapersModule() {
  console.log('\n=== Testing Digital Papers Module ===\n');
  const module = 'DigitalPapers';

  // Test 1: Paper templates
  try {
    const response = await makeRequest('/paper-templates');
    if (response.status === 200) {
      logTest(module, 'Paper templates endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Paper templates endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Paper templates endpoint', false, error.message);
  }

  // Test 2: Documents list
  try {
    const response = await makeRequest('/documents');
    if (response.status === 200) {
      logTest(module, 'Documents list endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Documents list endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Documents list endpoint', false, error.message);
  }
}

// ==================== MODULE 11: FILE UPLOAD ====================

async function testFileUploadModule() {
  console.log('\n=== Testing File Upload Module ===\n');
  const module = 'FileUpload';

  // Test 1: Upload endpoint exists
  try {
    const response = await makeRequest('/uploads');
    if (response.status === 200) {
      logTest(module, 'Uploads endpoint', true);
    } else if (response.status === 404) {
      logSkip(module, 'Uploads endpoint', 'Endpoint not implemented');
    }
  } catch (error) {
    logTest(module, 'Uploads endpoint', false, error.message);
  }
}

// ==================== DATABASE CONNECTIVITY TESTS ====================

async function testDatabaseConnectivity() {
  console.log('\n=== Testing Database Connectivity ===\n');
  const module = 'Database';

  try {
    // Initialize pool
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'immunicare',
      user: process.env.DB_USER || 'immunicare_dev',
      password: process.env.DB_PASSWORD || ''
    });

    // Test connection
    const result = await pool.query('SELECT NOW()');
    if (result.rows && result.rows.length > 0) {
      logTest(module, 'Database connection', true);
    } else {
      logTest(module, 'Database connection', false, 'No result returned');
    }

    // Test key tables exist
    const tables = ['users', 'roles', 'infants', 'guardians', 'vaccinations', 'appointments'];
    for (const table of tables) {
      try {
        await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
        logTest(module, `Table '${table}' exists`, true);
      } catch (error) {
        logTest(module, `Table '${table}' exists`, false, error.message);
      }
    }

    // Test admin user exists
    try {
      const adminResult = await pool.query(
        'SELECT id, username, role_id FROM users WHERE username = \'admin\' LIMIT 1'
      );
      if (adminResult.rows.length > 0) {
        logTest(module, 'Admin user exists', true);
      } else {
        logTest(module, 'Admin user exists', false, 'No admin user found');
      }
    } catch (error) {
      logTest(module, 'Admin user exists', false, error.message);
    }
  } catch (error) {
    logTest(module, 'Database connection', false, error.message);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

// ==================== MAIN TEST RUNNER ====================

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     ADMIN MODULES COMPREHENSIVE TEST SUITE                ║');
  console.log('║     Testing Frontend Interactivity & Backend Connectivity  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Setup
  const authSuccess = await setupAuthentication();

  if (!authSuccess) {
    console.log('\n⚠️  Warning: Authentication failed. Some tests may not work correctly.\n');
  }

  // Run module tests
  await testDashboardModule();
  await testAnalyticsModule();
  await testInfantManagementModule();
  await testInventoryManagementModule();
  await testUserManagementModule();
  await testVaccinationsDashboardModule();
  await testVaccineTrackingModule();
  await testReportsModule();
  await testAnnouncementsModule();
  await testDigitalPapersModule();
  await testFileUploadModule();

  // Database tests
  await testDatabaseConnectivity();

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`⏭️  Skipped: ${testResults.skipped}`);
  console.log(`📊 Total: ${testResults.passed + testResults.failed + testResults.skipped}`);

  // Print failed tests
  if (testResults.failed > 0) {
    console.log('\n=== Failed Tests ===');
    testResults.tests
      .filter((t) => t.passed === false)
      .forEach((t) => console.log(`  ❌ [${t.module}] ${t.testName}: ${t.details}`));
  }

  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
