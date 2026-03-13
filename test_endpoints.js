// Test script to verify backend endpoints
const http = require('http');

const BASE_URL = 'http://localhost:5000';
const TIMEOUT = 30000; // 30 second timeout

// Test credentials
const ADMIN_CREDENTIALS = JSON.stringify({
  username: 'admin',
  password: 'Admin2024!'
});

const GUARDIAN_CREDENTIALS = JSON.stringify({
  username: 'maria.santos@email.com',
  password: 'guardian123'
});

function makeRequest(method, path, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...extraHeaders
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
            raw: data
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: null,
            raw: data
          });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => {
      req.destroy();
      reject(new Error(`Request timeout after ${TIMEOUT}ms`));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function login(credentials) {
  console.log(`\n📝 Logging in...`);
  const res = await makeRequest('POST', '/api/auth/login', credentials);
  if (res.status === 200 && res.body && res.body.token) {
    console.log(`✅ Login successful`);
    return res.body.token;
  }
  console.log(`❌ Login failed: ${res.status}`, res.body || res.raw);
  return null;
}

async function testEndpoint(name, method, path, token, body = null) {
  console.log(`\n🔍 Testing ${method} ${path}...`);
  try {
    const startTime = Date.now();
    const res = await makeRequest(method, path, body, token);
    const duration = Date.now() - startTime;

    if (res.status === 200) {
      console.log(`✅ ${name}: ${res.status} OK (${duration}ms)`);
      if (res.body && Array.isArray(res.body.data)) {
        console.log(`   Returned ${res.body.data.length} records`);
      } else if (res.body && res.body.data) {
        console.log(`   Data:`, JSON.stringify(res.body.data).substring(0, 200));
      }
      return { success: true, status: res.status, duration, body: res.body };
    } else if (res.status === 401) {
      console.log(`🔒 ${name}: ${res.status} Unauthorized (requires authentication)`);
      return { success: true, status: res.status, duration, requiresAuth: true };
    } else if (res.status === 408) {
      console.log(`⏱️ ${name}: ${res.status} Request Timeout (${duration}ms) - HANGING ENDPOINT!`);
      return { success: false, status: res.status, duration, error: 'Timeout' };
    } else if (res.status === 500) {
      console.log(`❌ ${name}: ${res.status} Server Error (${duration}ms)`);
      console.log(`   Error:`, res.body?.error || res.raw?.substring(0, 300));
      return { success: false, status: res.status, duration, error: res.body?.error };
    } else {
      console.log(`⚠️ ${name}: ${res.status} (${duration}ms)`);
      console.log(`   Response:`, res.body || res.raw?.substring(0, 200));
      return { success: false, status: res.status, duration, body: res.body };
    }
  } catch (error) {
    console.log(`❌ ${name}: ERROR - ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('========================================');
  console.log('IMMUNICARE BACKEND ENDPOINT TESTS');
  console.log('========================================');
  console.log(`Testing against: ${BASE_URL}`);
  console.log(`Timeout per request: ${TIMEOUT}ms`);

  // Test health endpoint first
  await testEndpoint('Health Check', 'GET', '/api/health', null);

  // Login as admin
  const adminToken = await login(ADMIN_CREDENTIALS);
  if (!adminToken) {
    console.log('\n❌ Cannot proceed without admin login');
    return;
  }

  // Test admin endpoints
  const results = [];

  // Test all the failing endpoints
  results.push(await testEndpoint('Users/Guardians', 'GET', '/api/users/guardians', adminToken));
  results.push(await testEndpoint('Users/System Users', 'GET', '/api/users/system-users', adminToken));
  results.push(await testEndpoint('Users/Roles', 'GET', '/api/users/roles', adminToken));
  results.push(await testEndpoint('Users/Clinics', 'GET', '/api/users/clinics', adminToken));
  results.push(await testEndpoint('Dashboard/Appointments', 'GET', '/api/dashboard/appointments', adminToken));
  results.push(await testEndpoint('Inventory/Vaccine Inventory', 'GET', '/api/inventory/vaccine-inventory', adminToken));
  results.push(await testEndpoint('Dashboard/Admin/Vaccination Monitoring', 'GET', '/api/dashboard/admin/vaccination-monitoring', adminToken));

  // Summary
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const timeoutCount = results.filter(r => r.status === 408).length;
  const serverErrorCount = results.filter(r => r.status === 500).length;

  console.log(`Total: ${results.length}`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`⏱️ Timeouts: ${timeoutCount}`);
  console.log(`💥 Server Errors: ${serverErrorCount}`);

  if (failCount > 0) {
    console.log('\nFailed endpoints:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.error || r.status}`);
    });
  }
}

runTests().catch(console.error);

