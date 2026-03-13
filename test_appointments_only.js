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
    req.setTimeout(30000); // 30 second timeout

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function loginAsAdmin() {
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
    return result.data.token;
  }
  return null;
}

async function testAppointmentsEndpoint(token) {
  console.log('Testing appointments endpoint...');

  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/vaccination-management/appointments?limit=5&offset=0',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  };

  const result = await makeRequest(options);

  console.log(`Status: ${result.status}`);
  console.log('Response:', JSON.stringify(result.data, null, 2));

  return result.status === 200 && result.data.success === true;
}

async function runTest() {
  console.log('=== ImmuniCare Appointments Endpoint Test ===\n');

  const token = await loginAsAdmin();
  if (!token) {
    console.error('❌ Login failed');
    return;
  }

  console.log('✅ Login successful\n');

  try {
    const success = await testAppointmentsEndpoint(token);
    if (success) {
      console.log('\n✅ Appointments endpoint is working correctly');
    } else {
      console.log('\n❌ Appointments endpoint is not responding correctly');
    }
  } catch (error) {
    console.error('❌ Test Error:', error);
  }
}

runTest().catch((error) => {
  console.error('❌ Test Error:', error);
  process.exit(1);
});
