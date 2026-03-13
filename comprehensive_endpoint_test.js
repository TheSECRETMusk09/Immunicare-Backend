const http = require('http');

const BASE_URL = 'http://localhost:5000';
const RESULTS = [];

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data),
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data.substring(0, 200),
          });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function login() {
  console.log('🔐 Logging in as admin...');
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const result = await makeRequest(options, JSON.stringify({
    username: 'admin',
    password: 'admin123',
  }));

  if (result.status === 200 && result.data.token) {
    console.log('✅ Login successful');
    return result.data.token;
  }
  throw new Error('Login failed');
}

async function testEndpoint(token, method, path, name, postData = null) {
  process.stdout.write(`Testing ${name}... `);

  const options = {
    hostname: 'localhost',
    port: 5000,
    path: path,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };

  try {
    const result = await makeRequest(options, postData ? JSON.stringify(postData) : null);

    if (result.status >= 200 && result.status < 300) {
      console.log(`✅ Status ${result.status}`);
      RESULTS.push({ name, status: result.status, success: true });
      return true;
    } else if (result.status === 401) {
      console.log(`⚠️ Status ${result.status} (auth issue)`);
      RESULTS.push({ name, status: result.status, success: false, error: 'Unauthorized' });
      return false;
    } else {
      console.log(`⚠️ Status ${result.status}`);
      RESULTS.push({ name, status: result.status, success: false, error: result.data.message || 'Error' });
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    RESULTS.push({ name, status: 0, success: false, error: error.message });
    return false;
  }
}

async function runTests() {
  console.log('\n=== ImmuniCare Admin Dashboard Endpoint Tests ===\n');

  try {
    const token = await login();

    console.log('\n--- Testing Admin Dashboard Endpoints ---\n');

    // Test key endpoints
    await testEndpoint(token, 'GET', '/api/vaccination-management/appointments', 'Appointments');
    await testEndpoint(token, 'GET', '/api/patients', 'Patients');
    await testEndpoint(token, 'GET', '/api/vaccines', 'Vaccines');
    await testEndpoint(token, 'GET', '/api/vaccine-batches', 'Vaccine Batches');
    await testEndpoint(token, 'GET', '/api/health-workers', 'Health Workers');
    await testEndpoint(token, 'GET', '/api/inventory', 'Inventory');
    await testEndpoint(token, 'GET', '/api/notifications', 'Notifications');
    await testEndpoint(token, 'GET', '/api/analytics/dashboard', 'Analytics Dashboard');
    await testEndpoint(token, 'GET', '/api/analytics/vaccination-rates', 'Vaccination Rates');
    await testEndpoint(token, 'GET', '/api/analytics/appointments-stats', 'Appointment Stats');
    await testEndpoint(token, 'GET', '/api/guardian/children', 'Guardian Children');

    // Print summary
    console.log('\n=== Test Summary ===');
    const passed = RESULTS.filter(r => r.success).length;
    const failed = RESULTS.filter(r => !r.success).length;
    console.log(`Total: ${RESULTS.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed endpoints:');
      RESULTS.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.name}: ${r.error || `Status ${r.status}`}`);
      });
    }

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTests();
