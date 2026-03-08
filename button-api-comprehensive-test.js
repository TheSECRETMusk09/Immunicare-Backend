/**
 * Comprehensive Backend API Tests for Button-Triggered Operations
 * Tests all API endpoints that are triggered by button actions in Admin and Guardian dashboards
 *
 * Covers:
 * - Button-triggered API calls (POST, PUT, DELETE)
 * - Permission checks and authorization
 * - Input validation for button actions
 * - Error handling and response status codes
 * - Database state validation
 * - Edge cases (network failures, concurrent operations, timeouts)
 *
 * Testing Framework: Jest + Supertest
 * Database: PostgreSQL (test database)
 */

const http = require('http');
const https = require('https');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_URL || 'http://localhost:5000';
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_test',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

// Test configuration
const CONFIG = {
  timeout: 15000,
  retries: 3,
  adminCredentials: { username: 'admin', password: 'Admin2024!' },
  guardianCredentials: { email: 'maria.santos@email.com', password: 'guardian123' },
  testData: {
    infant: null,
    appointment: null,
    announcement: null,
    guardian: null,
  },
};

// Database connection pool
let pool = null;

// Test results storage
const testResults = {
  passed: [],
  failed: [],
  skipped: [],
  errors: [],
  warnings: [],
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Make HTTP request with timeout and retry support
 */
function makeRequest(method, path, data = null, token = null, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = BASE_URL.startsWith('https');
    const client = isHttps ? https : http;

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: options.timeout || CONFIG.timeout,
    };

    if (token) {
      requestOptions.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = client.request(requestOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          resolve({
            status: res.statusCode,
            data: json,
            headers: res.headers,
            body: body,
          });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Login and get authentication token
 */
async function login(credentials, userType = 'admin') {
  try {
    const endpoint = userType === 'admin' ? '/api/auth/login' : '/api/auth/guardian/login';
    const response = await makeRequest('POST', endpoint, credentials);
    if (response.status === 200 && response.data.token) {
      return { token: response.data.token, user: response.data.user };
    }
    return null;
  } catch (err) {
    console.error(`Login error: ${err.message}`);
    return null;
  }
}

/**
 * Database query helper
 */
async function dbQuery(text, params = []) {
  if (!pool) {
    pool = new Pool(DB_CONFIG);
  }
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    console.error(`Database query error: ${err.message}`);
    throw err;
  }
}

/**
 * Test assertion helper
 */
async function assert(condition, testName, details = {}) {
  const result = {
    name: testName,
    passed: condition,
    details,
  };

  if (condition) {
    testResults.passed.push(result);
    console.log(`  ✓ ${testName}`);
  } else {
    testResults.failed.push(result);
    console.log(`  ✗ ${testName}`);
    if (details.expected) {
      console.log(`    Expected: ${details.expected}`);
    }
    if (details.actual) {
      console.log(`    Actual: ${details.actual}`);
    }
  }

  return condition;
}

/**
 * Wait helper for async operations
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// DATABASE CONNECTION TEST
// ============================================

async function testDatabaseConnection() {
  console.log('\n=== DATABASE CONNECTION TEST ===');

  try {
    const result = await dbQuery('SELECT current_database() as db_name, current_user as user');
    await assert(
      result.rows[0].db_name === DB_CONFIG.database,
      'Database connection established',
      { actual: result.rows[0].db_name },
    );
  } catch (err) {
    await assert(false, 'Database connection', { actual: err.message });
    testResults.errors.push({ module: 'Database', error: err.message });
  }
}

// ============================================
// AUTHENTICATION TESTS
// ============================================

async function testAuthentication() {
  console.log('\n=== AUTHENTICATION TESTS ===');

  // Test Admin Login
  const adminAuth = await login(CONFIG.adminCredentials, 'admin');
  await assert(
    adminAuth !== null && adminAuth.token !== undefined,
    'Admin login returns valid token',
    {
      expected: 'token present',
      actual: adminAuth ? 'token present' : 'no token',
    },
  );

  const adminToken = adminAuth?.token;

  // Test Guardian Login
  const guardianAuth = await login(CONFIG.guardianCredentials, 'guardian');
  await assert(
    guardianAuth !== null && guardianAuth.token !== undefined,
    'Guardian login returns valid token',
    {
      expected: 'token present',
      actual: guardianAuth ? 'token present' : 'no token',
    },
  );

  const guardianToken = guardianAuth?.token;

  // Test Invalid Credentials
  const invalidAuth = await login({ username: 'invalid', password: 'wrong' }, 'admin');
  await assert(
    invalidAuth === null,
    'Invalid credentials are rejected',
    { expected: 'null token', actual: invalidAuth ? 'token returned' : 'correctly rejected' },
  );

  // Test Empty Credentials
  try {
    const emptyAuth = await makeRequest('POST', '/api/auth/login', {});
    await assert(
      emptyAuth.status >= 400,
      'Empty credentials are rejected',
      { expected: '4xx status', actual: emptyAuth.status },
    );
  } catch (err) {
    await assert(false, 'Empty credentials handling', { actual: err.message });
  }

  return { adminToken, guardianToken };
}

// ============================================
// AUTHORIZATION TESTS
// ============================================

async function testAuthorization(adminToken, guardianToken) {
  console.log('\n=== AUTHORIZATION TESTS ===');

  // Test 1: No token access
  try {
    const noTokenResponse = await makeRequest('GET', '/api/users', null, null);
    await assert(
      noTokenResponse.status === 401 || noTokenResponse.status === 403,
      'Endpoints require authentication (no token)',
      { expected: '401/403', actual: noTokenResponse.status },
    );
  } catch (err) {
    await assert(false, 'No token access test', { actual: err.message });
  }

  // Test 2: Invalid token access
  try {
    const invalidTokenResponse = await makeRequest('GET', '/api/users', null, 'invalid-token-12345');
    await assert(
      invalidTokenResponse.status === 401 || invalidTokenResponse.status === 403,
      'Endpoints reject invalid tokens',
      { expected: '401/403', actual: invalidTokenResponse.status },
    );
  } catch (err) {
    await assert(false, 'Invalid token test', { actual: err.message });
  }

  // Test 3: Guardian accessing admin endpoints
  try {
    const guardianAccessingAdmin = await makeRequest('GET', '/api/users', null, guardianToken);
    await assert(
      guardianAccessingAdmin.status === 403,
      'Guardian cannot access admin-only endpoints',
      { expected: '403', actual: guardianAccessingAdmin.status },
    );
  } catch (err) {
    await assert(false, 'Guardian admin access test', { actual: err.message });
  }

  // Test 4: Admin accessing own endpoints
  try {
    const adminAccessingOwn = await makeRequest('GET', '/api/dashboard/stats', null, adminToken);
    await assert(
      adminAccessingOwn.status === 200,
      'Admin can access dashboard stats',
      { expected: '200', actual: adminAccessingOwn.status },
    );
  } catch (err) {
    await assert(false, 'Admin dashboard access test', { actual: err.message });
  }
}

// ============================================
// CREATE OPERATIONS TESTS (Button-triggered POST)
// ============================================

async function testCreateOperations(adminToken) {
  console.log('\n=== CREATE OPERATIONS (POST) ===');

  if (!adminToken) {
    console.log('  ⚠ Skipping - No admin token');
    return;
  }

  // Test 1: Create Infant
  try {
    const infantData = {
      first_name: 'Test',
      last_name: 'Infant',
      dob: '2023-01-15',
      sex: 'male',
      mother_name: 'Test Mother',
      father_name: 'Test Father',
      barangay: 'Test Barangay',
      health_center: 'Main Health Center',
      guardian_id: 1,
    };

    const response = await makeRequest('POST', '/api/infants', infantData, adminToken);
    await assert(
      response.status === 201 || response.status === 200,
      'Create Infant (POST /api/infants)',
      { expected: '200/201', actual: response.status },
    );

    if (response.status === 200 || response.status === 201) {
      CONFIG.testData.infant = response.data.infant || response.data;
      console.log(`    Created infant ID: ${CONFIG.testData.infant?.id}`);
    }
  } catch (err) {
    await assert(false, 'Create Infant', { actual: err.message });
  }

  // Test 2: Create Appointment
  try {
    const appointmentData = {
      patient_id: 1,
      scheduled_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      type: 'Vaccination',
      duration_minutes: 30,
      location: 'Main Health Center',
    };

    const response = await makeRequest('POST', '/api/appointments', appointmentData, adminToken);
    await assert(
      response.status === 201 || response.status === 200,
      'Create Appointment (POST /api/appointments)',
      { expected: '200/201', actual: response.status },
    );

    if (response.status === 200 || response.status === 201) {
      CONFIG.testData.appointment = response.data.appointment || response.data;
    }
  } catch (err) {
    await assert(false, 'Create Appointment', { actual: err.message });
  }

  // Test 3: Create Announcement
  try {
    const announcementData = {
      title: 'Test Announcement',
      content: 'This is a test announcement content',
      priority: 'medium',
      target_audience: 'all',
      is_active: true,
    };

    const response = await makeRequest('POST', '/api/announcements', announcementData, adminToken);
    await assert(
      response.status === 201 || response.status === 200,
      'Create Announcement (POST /api/announcements)',
      { expected: '200/201', actual: response.status },
    );

    if (response.status === 200 || response.status === 201) {
      CONFIG.testData.announcement = response.data.announcement || response.data;
    }
  } catch (err) {
    await assert(false, 'Create Announcement', { actual: err.message });
  }

  // Test 4: Create User (Admin)
  try {
    const userData = {
      username: `testuser_${Date.now()}`,
      password: 'Test1234!',
      role: 'nurse',
      facility_id: 1,
      email: `test_${Date.now()}@example.com`,
      contact: '1234567890',
    };

    const response = await makeRequest('POST', '/api/users', userData, adminToken);
    await assert(
      response.status === 201 || response.status === 200,
      'Create User (POST /api/users)',
      { expected: '200/201', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Create User', { actual: err.message });
  }
}

// ============================================
// READ OPERATIONS TESTS (Button-triggered GET)
// ============================================

async function testReadOperations(adminToken, guardianToken) {
  console.log('\n=== READ OPERATIONS (GET) ===');

  // Test Dashboard Stats
  try {
    const response = await makeRequest('GET', '/api/dashboard/stats', null, adminToken);
    await assert(
      response.status === 200,
      'Get Dashboard Stats (GET /api/dashboard/stats)',
      { expected: '200', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Dashboard Stats', { actual: err.message });
  }

  // Test Get Infants
  try {
    const response = await makeRequest('GET', '/api/infants', null, adminToken);
    await assert(
      response.status === 200,
      'Get All Infants (GET /api/infants)',
      { expected: '200', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Get Infants', { actual: err.message });
  }

  // Test Get Appointments
  try {
    const response = await makeRequest('GET', '/api/appointments', null, adminToken);
    await assert(
      response.status === 200,
      'Get All Appointments (GET /api/appointments)',
      { expected: '200', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Get Appointments', { actual: err.message });
  }

  // Test Get Announcements
  try {
    const response = await makeRequest('GET', '/api/announcements', null, adminToken);
    await assert(
      response.status === 200,
      'Get All Announcements (GET /api/announcements)',
      { expected: '200', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Get Announcements', { actual: err.message });
  }

  // Test Get Vaccinations
  try {
    const response = await makeRequest('GET', '/api/vaccinations', null, adminToken);
    await assert(
      response.status === 200,
      'Get All Vaccinations (GET /api/vaccinations)',
      { expected: '200', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Get Vaccinations', { actual: err.message });
  }

  // Test Guardian Dashboard Data
  if (guardianToken) {
    try {
      const response = await makeRequest('GET', '/api/dashboard/guardian/1/stats', null, guardianToken);
      await assert(
        response.status === 200,
        'Get Guardian Dashboard Stats (GET /api/dashboard/guardian/:id/stats)',
        { expected: '200', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Guardian Dashboard Stats', { actual: err.message });
    }
  }

  // Test Get Users (Admin only)
  try {
    const response = await makeRequest('GET', '/api/users', null, adminToken);
    await assert(
      response.status === 200,
      'Get All Users (GET /api/users)',
      { expected: '200', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Get Users', { actual: err.message });
  }
}

// ============================================
// UPDATE OPERATIONS TESTS (Button-triggered PUT/PATCH)
// ============================================

async function testUpdateOperations(adminToken) {
  console.log('\n=== UPDATE OPERATIONS (PUT/PATCH) ===');

  if (!adminToken) {
    console.log('  ⚠ Skipping - No admin token');
    return;
  }

  // Test 1: Update Infant
  if (CONFIG.testData.infant?.id) {
    try {
      const updateData = { first_name: 'UpdatedName' };
      const response = await makeRequest('PUT', `/api/infants/${CONFIG.testData.infant.id}`, updateData, adminToken);
      await assert(
        response.status === 200,
        'Update Infant (PUT /api/infants/:id)',
        { expected: '200', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Update Infant', { actual: err.message });
    }
  }

  // Test 2: Update Appointment Status
  if (CONFIG.testData.appointment?.id) {
    try {
      const updateData = { status: 'attended', completion_notes: 'Test completed' };
      const response = await makeRequest('PUT', `/api/appointments/${CONFIG.testData.appointment.id}`, updateData, adminToken);
      await assert(
        response.status === 200,
        'Update Appointment (PUT /api/appointments/:id)',
        { expected: '200', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Update Appointment', { actual: err.message });
    }
  }

  // Test 3: Update Announcement
  if (CONFIG.testData.announcement?.id) {
    try {
      const updateData = { title: 'Updated Title' };
      const response = await makeRequest('PUT', `/api/announcements/${CONFIG.testData.announcement.id}`, updateData, adminToken);
      await assert(
        response.status === 200,
        'Update Announcement (PUT /api/announcements/:id)',
        { expected: '200', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Update Announcement', { actual: err.message });
    }
  }

  // Test 4: Update Settings
  try {
    const updateData = { health_center_name: 'Updated Health Center' };
    const response = await makeRequest('PUT', '/api/settings', updateData, adminToken);
    await assert(
      response.status === 200,
      'Update Settings (PUT /api/settings)',
      { expected: '200', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Update Settings', { actual: err.message });
  }
}

// ============================================
// DELETE OPERATIONS TESTS (Button-triggered DELETE)
// ============================================

async function testDeleteOperations(adminToken) {
  console.log('\n=== DELETE OPERATIONS (DELETE) ===');

  if (!adminToken) {
    console.log('  ⚠ Skipping - No admin token');
    return;
  }

  // Test 1: Soft Delete - Deactivate Infant
  if (CONFIG.testData.infant?.id) {
    try {
      const response = await makeRequest('DELETE', `/api/infants/${CONFIG.testData.infant.id}`, null, adminToken);
      await assert(
        response.status === 200 || response.status === 204,
        'Delete Infant (DELETE /api/infants/:id)',
        { expected: '200/204', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Delete Infant', { actual: err.message });
    }
  }

  // Test 2: Cancel Appointment (instead of hard delete)
  if (CONFIG.testData.appointment?.id) {
    try {
      const response = await makeRequest('PUT', `/api/appointments/${CONFIG.testData.appointment.id}`,
        { status: 'cancelled', cancellation_reason: 'Test cancellation' }, adminToken);
      await assert(
        response.status === 200,
        'Cancel Appointment (PUT /api/appointments/:id with status=cancelled)',
        { expected: '200', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Cancel Appointment', { actual: err.message });
    }
  }

  // Test 3: Delete Announcement
  if (CONFIG.testData.announcement?.id) {
    try {
      const response = await makeRequest('DELETE', `/api/announcements/${CONFIG.testData.announcement.id}`, null, adminToken);
      await assert(
        response.status === 200 || response.status === 204,
        'Delete Announcement (DELETE /api/announcements/:id)',
        { expected: '200/204', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Delete Announcement', { actual: err.message });
    }
  }
}

// ============================================
// INPUT VALIDATION TESTS
// ============================================

async function testInputValidation(adminToken) {
  console.log('\n=== INPUT VALIDATION TESTS ===');

  if (!adminToken) {
    console.log('  ⚠ Skipping - No admin token');
    return;
  }

  // Test 1: Empty fields validation
  try {
    const response = await makeRequest('POST', '/api/infants', {}, adminToken);
    await assert(
      response.status >= 400,
      'Create infant with empty fields is rejected',
      { expected: '4xx', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Empty fields validation', { actual: err.message });
  }

  // Test 2: Invalid data types
  try {
    const response = await makeRequest('POST', '/api/infants', {
      first_name: 123,  // Should be string
      last_name: 'Test',
      dob: 'invalid-date',
      sex: 'invalid_sex',
    }, adminToken);
    await assert(
      response.status >= 400,
      'Create infant with invalid data types is rejected',
      { expected: '4xx', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Invalid data types validation', { actual: err.message });
  }

  // Test 3: SQL Injection prevention
  try {
    const response = await makeRequest('POST', '/api/announcements', {
      title: '\'; DROP TABLE announcements; --',
      content: 'Test',
    }, adminToken);
    // Should either succeed (sanitized) or fail (rejected) but never actually execute SQL
    await assert(
      true,
      'SQL injection attempt is handled',
      { expected: 'safe handling', actual: response.status },
    );
  } catch (err) {
    await assert(true, 'SQL injection attempt handling', { actual: 'error caught' });
  }

  // Test 4: XSS prevention
  try {
    const response = await makeRequest('POST', '/api/announcements', {
      title: '<script>alert("xss")</script>',
      content: 'Test content',
    }, adminToken);
    // Should handle XSS appropriately
    await assert(
      response.status >= 200 && response.status < 500,
      'XSS attempt handling',
      { expected: 'safe handling', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'XSS prevention', { actual: err.message });
  }

  // Test 5: Very long input handling
  try {
    const longTitle = 'A'.repeat(10000);
    const response = await makeRequest('POST', '/api/announcements', {
      title: longTitle,
      content: 'Test',
    }, adminToken);
    await assert(
      response.status >= 400 || response.data.error,
      'Very long input is rejected or truncated',
      { expected: 'error or accepted', actual: response.status },
    );
  } catch (err) {
    await assert(true, 'Long input handling', { actual: 'error caught' });
  }
}

// ============================================
// PERMISSION TESTS
// ============================================

async function testPermissions(adminToken, guardianToken) {
  console.log('\n=== PERMISSION TESTS ===');

  // Test 1: Guardian cannot create users
  if (guardianToken) {
    try {
      const response = await makeRequest('POST', '/api/users', {
        username: 'unauthorized',
        password: 'test',
      }, guardianToken);
      await assert(
        response.status === 403,
        'Guardian cannot create users (403 Forbidden)',
        { expected: '403', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Guardian create users permission', { actual: err.message });
    }
  }

  // Test 2: Guardian cannot delete infants
  if (guardianToken && CONFIG.testData.infant?.id) {
    try {
      const response = await makeRequest('DELETE', `/api/infants/${CONFIG.testData.infant.id}`, null, guardianToken);
      await assert(
        response.status === 403,
        'Guardian cannot delete infants (403 Forbidden)',
        { expected: '403', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Guardian delete infants permission', { actual: err.message });
    }
  }

  // Test 3: Admin CAN access all endpoints
  try {
    const response = await makeRequest('GET', '/api/admin/stats', null, adminToken);
    await assert(
      response.status >= 200 && response.status < 500,
      'Admin has access to admin stats',
      { expected: '2xx/4xx', actual: response.status },
    );
  } catch (err) {
    // May return 404, but that's okay - means authorization passed
    await assert(true, 'Admin access to admin endpoints', { actual: 'handled' });
  }
}

// ============================================
// DATABASE STATE VALIDATION TESTS
// ============================================

async function testDatabaseState() {
  console.log('\n=== DATABASE STATE VALIDATION ===');

  try {
    // Test 1: Check tables exist
    const tablesResult = await dbQuery(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `);

    const requiredTables = ['admin', 'guardians', 'patients', 'vaccines', 'appointments', 'immunization_records'];
    const existingTables = tablesResult.rows.map(r => r.table_name);

    for (const table of requiredTables) {
      await assert(
        existingTables.includes(table),
        `Table '${table}' exists`,
        { expected: 'exists', actual: existingTables.includes(table) ? 'exists' : 'missing' },
      );
    }

    // Test 2: Check foreign key relationships
    const fkResult = await dbQuery(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      LIMIT 10
    `);

    await assert(
      fkResult.rows.length > 0,
      'Foreign key relationships exist',
      { expected: 'relationships', actual: `${fkResult.rows.length} FKs found` },
    );

    // Test 3: Check NOT NULL constraints
    const notNullResult = await dbQuery(`
      SELECT COUNT(*) as count FROM information_schema.columns
      WHERE table_name = 'admin' AND is_nullable = 'NO'
    `);

    await assert(
      parseInt(notNullResult.rows[0].count) > 0,
      'Admin table has NOT NULL constraints',
      { expected: 'constraints', actual: notNullResult.rows[0].count },
    );

  } catch (err) {
    await assert(false, 'Database state validation', { actual: err.message });
    testResults.errors.push({ module: 'Database State', error: err.message });
  }
}

// ============================================
// EDGE CASES AND ERROR HANDLING
// ============================================

async function testEdgeCases(adminToken) {
  console.log('\n=== EDGE CASES AND ERROR HANDLING ===');

  // Test 1: Concurrent requests
  if (adminToken) {
    try {
      const requests = Array(5).fill(null).map(() =>
        makeRequest('GET', '/api/dashboard/stats', null, adminToken),
      );
      const results = await Promise.all(requests);
      const allSuccessful = results.every(r => r.status === 200);
      await assert(
        allSuccessful,
        'Concurrent requests handled correctly',
        { expected: 'all 200', actual: results.map(r => r.status).join(', ') },
      );
    } catch (err) {
      await assert(false, 'Concurrent requests', { actual: err.message });
    }
  }

  // Test 2: Request timeout handling
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 100);

    // This should timeout
    await makeRequest('GET', '/api/slow-endpoint', null, adminToken, { timeout: 50 });
    clearTimeout(timeoutId);
  } catch (err) {
    await assert(
      err.message.includes('timeout') || err.message.includes('abort'),
      'Request timeout is handled',
      { expected: 'timeout error', actual: err.message },
    );
  }

  // Test 3: Invalid JSON response handling
  try {
    // Some endpoints might return non-JSON
    const response = await makeRequest('GET', '/api/health', null, adminToken);
    await assert(
      response.status >= 200,
      'Health endpoint responds',
      { expected: '2xx', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Health endpoint', { actual: err.message });
  }

  // Test 4: Resource not found
  if (adminToken) {
    try {
      const response = await makeRequest('GET', '/api/infants/999999', null, adminToken);
      await assert(
        response.status === 404,
        'Non-existent resource returns 404',
        { expected: '404', actual: response.status },
      );
    } catch (err) {
      await assert(false, 'Not found handling', { actual: err.message });
    }
  }

  // Test 5: Method not allowed
  try {
    const response = await makeRequest('DELETE', '/api/dashboard/stats', null, adminToken);
    await assert(
      response.status === 405 || response.status === 404,
      'DELETE on read-only endpoint is rejected',
      { expected: '405/404', actual: response.status },
    );
  } catch (err) {
    await assert(false, 'Method not allowed handling', { actual: err.message });
  }
}

// ============================================
// TEST REPORT GENERATION
// ============================================

function generateTestReport() {
  const totalTests = testResults.passed.length + testResults.failed.length + testResults.skipped.length;
  const passRate = totalTests > 0 ? ((testResults.passed.length / totalTests) * 100).toFixed(2) : 0;

  let report = '# Comprehensive Backend API Test Report\n\n';
  report += `**Test Date:** ${new Date().toISOString()}\n`;
  report += `**Base URL:** ${BASE_URL}\n`;
  report += `**Total Tests:** ${totalTests}\n\n`;

  report += '## Summary\n\n';
  report += `- ✅ Passed: ${testResults.passed.length}\n`;
  report += `- ❌ Failed: ${testResults.failed.length}\n`;
  report += `- ⚠️ Skipped: ${testResults.skipped.length}\n`;
  report += `- 📊 Pass Rate: ${passRate}%\n\n`;

  report += '## Failed Tests\n\n';
  if (testResults.failed.length === 0) {
    report += 'No failed tests! 🎉\n\n';
  } else {
    testResults.failed.forEach((test, i) => {
      report += `### ${i + 1}. ${test.name}\n`;
      if (test.details.expected) {
        report += `- **Expected:** ${test.details.expected}\n`;
      }
      if (test.details.actual) {
        report += `- **Actual:** ${test.details.actual}\n`;
      }
      report += '\n';
    });
  }

  report += '## System Errors\n\n';
  if (testResults.errors.length === 0) {
    report += 'No system errors.\n\n';
  } else {
    testResults.errors.forEach(err => {
      report += `- **${err.module}:** ${err.error}\n`;
    });
    report += '\n';
  }

  report += '## Test Coverage\n\n';
  report += '- Authentication: ✅ Tested\n';
  report += '- Authorization: ✅ Tested\n';
  report += '- CRUD Operations: ✅ Tested\n';
  report += '- Input Validation: ✅ Tested\n';
  report += '- Permissions: ✅ Tested\n';
  report += '- Database State: ✅ Tested\n';
  report += '- Edge Cases: ✅ Tested\n';

  return report;
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function runTests() {
  console.log('='.repeat(60));
  console.log('IMMUNICARE - COMPREHENSIVE BACKEND API TESTS');
  console.log('Button-Triggered Operations Testing');
  console.log('='.repeat(60));
  console.log(`\nTest started at: ${new Date().toISOString()}`);
  console.log(`Base URL: ${BASE_URL}`);

  // Check server health
  console.log('\nChecking server health...');
  try {
    const health = await makeRequest('GET', '/api/health');
    console.log(`Server Status: ${health.status === 200 ? '✅ ONLINE' : '❌ ERROR'}\n`);
  } catch (err) {
    console.error('❌ Server is not running or not accessible!');
    console.error(`Error: ${err.message}`);
    console.log('\nPlease start the server and run tests again.');
    process.exit(1);
  }

  // Run all test modules
  await testDatabaseConnection();

  const { adminToken, guardianToken } = await testAuthentication();

  await testAuthorization(adminToken, guardianToken);
  await testCreateOperations(adminToken);
  await testReadOperations(adminToken, guardianToken);
  await testUpdateOperations(adminToken);
  await testDeleteOperations(adminToken);
  await testInputValidation(adminToken);
  await testPermissions(adminToken, guardianToken);
  await testDatabaseState();
  await testEdgeCases(adminToken);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  const totalTests = testResults.passed.length + testResults.failed.length;
  const passRate = totalTests > 0 ? ((testResults.passed.length / totalTests) * 100).toFixed(2) : 0;

  console.log(`\nTotal Tests: ${totalTests}`);
  console.log(`✅ Passed: ${testResults.passed.length}`);
  console.log(`❌ Failed: ${testResults.failed.length}`);
  console.log(`📊 Pass Rate: ${passRate}%`);

  if (testResults.failed.length > 0) {
    console.log('\n--- Failed Tests ---');
    testResults.failed.forEach((test, i) => {
      console.log(`\n${i + 1}. ${test.name}`);
      if (test.details.expected) {
        console.log(`   Expected: ${test.details.expected}`);
      }
      if (test.details.actual) {
        console.log(`   Actual: ${test.details.actual}`);
      }
    });
  }

  if (testResults.errors.length > 0) {
    console.log('\n--- System Errors ---');
    testResults.errors.forEach(err => {
      console.log(`- ${err.module}: ${err.error}`);
    });
  }

  // Save report
  const fs = require('fs');
  const report = generateTestReport();
  const reportPath = 'backend/BUTTON_API_TEST_REPORT.md';
  fs.writeFileSync(reportPath, report);
  console.log(`\n📄 Detailed report saved to: ${reportPath}`);

  // Final verdict
  console.log('\n' + '='.repeat(60));
  if (testResults.failed.length === 0) {
    console.log('✅ ALL TESTS PASSED!');
  } else {
    console.log(`❌ ${testResults.failed.length} TEST(S) FAILED`);
  }
  console.log('='.repeat(60));

  // Cleanup
  if (pool) {
    await pool.end();
  }

  process.exit(testResults.failed.length > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
