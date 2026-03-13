const http = require('http');

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.setTimeout(5000);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function loginAsAdmin() {
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

  const result = await makeRequest(options, {
    username: 'admin',
    password: 'Admin2026!',
  });

  if (result.status === 200 && result.data.message === 'Login successful' && result.data.token) {
    console.log('✅ Successfully logged in');
    return result.data.token;
  } else {
    console.error('❌ Login failed:', result);
    return null;
  }
}

async function testProtectedEndpoint(token, endpoint) {
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: `/api/vaccination-management${endpoint}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  };

  const result = await makeRequest(options);

  if (result.status === 200 && result.data.success === true) {
    console.log(`✅ ${endpoint}`);
    return true;
  } else if (result.status === 401) {
    console.log(`⚠️ ${endpoint} - Unauthorized (token may have expired)`);
  } else {
    console.log(`❌ ${endpoint} - Status: ${result.status}`);
  }
  return false;
}

async function runTests() {
  console.log('=== ImmuniCare Backend Tests ===\n');

  const token = await loginAsAdmin();
  if (!token) {
    return;
  }

  console.log('\n=== Testing Vaccination Management Endpoints ===');
  const endpoints = [
    '/dashboard',
    '/patients',
    '/inventory',
    '/appointments?limit=10&offset=0',
    '/vaccinations',
  ];

  let allSuccess = true;
  for (const endpoint of endpoints) {
    const success = await testProtectedEndpoint(token, endpoint);
    if (!success) {
      allSuccess = false;
    }
  }

  console.log('\n=== Testing Reports Endpoints ===');
  const reportEndpoints = [
    '/reports/coverage',
    '/reports/inventory',
  ];

  for (const endpoint of reportEndpoints) {
    const success = await testProtectedEndpoint(token, endpoint);
    if (!success) {
      allSuccess = false;
    }
  }

  console.log('\n=== Tests Complete ===');
  if (allSuccess) {
    console.log('✅ All endpoints are working correctly');
  } else {
    console.log('⚠️ Some endpoints are not responding correctly');
  }
}

runTests().catch((error) => {
  console.error('❌ Test Error:', error);
  process.exit(1);
});
