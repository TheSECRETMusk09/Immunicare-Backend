const http = require('http');

function request(options, body) {
  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function test() {
  console.log('=== Testing Admin Login ===');

  // Try admin login
  const loginRes = await request(
    {
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    },
    { username: 'admin', password: 'admin123' }
  );

  console.log('Status:', loginRes.status);
  if (loginRes.data) {
    console.log('Response:', JSON.stringify(loginRes.data, null, 2));
  }

  if (loginRes.status === 200 && loginRes.data && loginRes.data.token) {
    console.log('\n=== Admin Login SUCCESS ===');
    const token = loginRes.data.token;
    console.log('Token obtained');
    console.log('User role:', loginRes.data.user?.role);

    // Test dashboard endpoint
    console.log('\n=== Testing Dashboard Endpoint ===');
    const dashRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/dashboard/stats',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    });
    console.log('Dashboard Status:', dashRes.status);
    console.log('Dashboard Data:', JSON.stringify(dashRes.data, null, 2));
  } else {
    console.log('\n=== Admin Login FAILED ===');
    console.log('Response:', loginRes.data || loginRes.error);
  }
}

test();
