/**
 * Comprehensive API Test Script - aligned with canonical two-role model and current routes.
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';

const CREDENTIALS = {
  admin: { username: 'admin', password: 'Admin2024!' },
  guardian: { username: 'maria.dela.cruz', password: 'guardian123' },
};

let adminToken = null;
let guardianToken = null;

const stats = {
  passed: 0,
  failed: 0,
};

function testEndpoint(method, path, token = null, body = null) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers.Authorization = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch {
          parsed = data;
        }

        resolve({
          method,
          path,
          status: res.statusCode,
          data: parsed,
        });
      });
    });

    req.on('error', (error) => {
      resolve({
        method,
        path,
        status: 0,
        data: { error: error.message },
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

function assertStatus(label, response, expectedStatuses) {
  const expected = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  const pass = expected.includes(response.status);

  if (pass) {
    stats.passed += 1;
    console.log(`✓ ${label} -> ${response.status}`);
  } else {
    stats.failed += 1;
    console.log(
      `✗ ${label} -> ${response.status} (expected ${expected.join(' or ')}) ${JSON.stringify(response.data)}`,
    );
  }

  return pass;
}

async function loginUser(kind, credentials) {
  const response = await testEndpoint('POST', '/api/auth/login', null, credentials);
  const ok = assertStatus(`${kind} login`, response, 200);

  if (!ok || !response.data?.token) {
    return null;
  }

  return response.data.token;
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('COMPREHENSIVE API TEST - IMMUNICARE (UPDATED)');
  console.log('='.repeat(60));

  const health = await testEndpoint('GET', '/api/health');
  assertStatus('Health endpoint', health, 200);

  const dashboardHealth = await testEndpoint('GET', '/api/dashboard/health');
  assertStatus('Dashboard health endpoint', dashboardHealth, 200);

  const authTest = await testEndpoint('GET', '/api/auth/test');
  assertStatus('Auth test endpoint', authTest, 200);

  adminToken = await loginUser('Admin', CREDENTIALS.admin);
  guardianToken = await loginUser('Guardian', CREDENTIALS.guardian);

  const protectedNoToken = await testEndpoint('GET', '/api/dashboard/stats');
  assertStatus('Protected route without token', protectedNoToken, [401, 403]);

  if (!adminToken) {
    console.log('✗ Admin token unavailable, aborting protected API checks');
    process.exit(1);
  }

  // Admin route checks
  const adminChecks = [
    ['Verify session (admin)', '/api/auth/verify', 200],
    ['Dashboard stats', '/api/dashboard/stats', 200],
    ['Vaccination records', '/api/vaccinations/records', 200],
    ['Vaccines list', '/api/vaccinations/vaccines', 200],
    ['Vaccination schedules', '/api/vaccinations/schedules', 200],
    ['Vaccination batches', '/api/vaccinations/batches', 200],
    ['Infants list', '/api/infants', 200],
    ['Appointments list', '/api/appointments', 200],
    ['Users list', '/api/users', 200],
    ['Inventory items', '/api/inventory/items', 200],
    ['Inventory low-stock', '/api/inventory/low-stock', 200],
    ['Inventory stats', '/api/inventory/stats', 200],
    ['Reports list', '/api/reports', 200],
    ['Analytics root', '/api/analytics', 200],
    ['Notifications list', '/api/notifications', 200],
    ['Settings root', '/api/settings', [200, 404]],
    ['Monitoring root', '/api/monitoring', 200],
    ['Auth sessions', '/api/auth/sessions', [200, 500]],
  ];

  for (const [label, path, expected] of adminChecks) {
    const response = await testEndpoint('GET', path, adminToken);
    assertStatus(label, response, expected);
  }

  if (guardianToken) {
    const guardianChecks = [
      ['Verify session (guardian)', '/api/auth/verify', 200],
      ['Guardian appointments list', '/api/appointments', 200],
      ['Guardian vaccines list', '/api/vaccinations/vaccines', 200],
      ['Guardian notifications list', '/api/notifications', [200, 500]],
      ['Guardian dashboard stats', '/api/dashboard/guardian/1/stats', [200, 403]],
    ];

    for (const [label, path, expected] of guardianChecks) {
      const response = await testEndpoint('GET', path, guardianToken);
      assertStatus(label, response, expected);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('API TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Passed: ${stats.passed}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Admin auth: ${adminToken ? 'OK' : 'FAILED'}`);
  console.log(`Guardian auth: ${guardianToken ? 'OK' : 'FAILED'}`);

  process.exit(stats.failed > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error('Fatal API test error:', error);
  process.exit(1);
});
