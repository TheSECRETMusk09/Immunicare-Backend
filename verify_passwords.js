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
  console.log('=== Testing Correct Passwords ===\n');

  // Test admin login with Admin2026
  console.log('1. Admin Login (Admin2026):');
  const adminRes = await request(
    {
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    },
    { username: 'admin', password: 'Admin2026' }
  );

  console.log('   Status:', adminRes.status);
  if (adminRes.status === 200) {
    console.log('   SUCCESS - Admin login works with Admin2026');
    console.log('   User role:', adminRes.data.user?.role);
  } else {
    console.log('   FAILED - Admin login:', adminRes.data?.error);
  }

  // Test guardian login with Guardian123
  console.log('\n2. Guardian Login (Guardian123):');
  const guardianRes = await request(
    {
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    },
    { email: 'maria.santos@email.com', password: 'Guardian123' }
  );

  console.log('   Status:', guardianRes.status);
  if (guardianRes.status === 200) {
    console.log('   SUCCESS - Guardian login works with Guardian123');
    console.log('   User role:', guardianRes.data.user?.role);
  } else {
    console.log('   FAILED - Guardian login:', guardianRes.data?.error);
  }

  console.log('\n=== Test Complete ===');
}

test();
