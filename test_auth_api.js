const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
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
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function test() {
  console.log('=== Testing Authentication & API ===\n');

  // Test 1: Guardian Login
  console.log('1. Testing Guardian Login...');
  const loginRes = await request(
    {
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    },
    { email: 'maria.santos@email.com', password: 'guardian123' }
  );

  console.log('   Status:', loginRes.status);

  if (loginRes.status === 200 && loginRes.data && loginRes.data.token) {
    console.log('   Login SUCCESS!');
    const token = loginRes.data.token;
    console.log('   Token:', token.substring(0, 50) + '...');
    console.log('   User Role:', loginRes.data.user?.role);

    // Test authenticated endpoints
    console.log('\n2. Testing Authenticated Endpoints:');
    const endpoints = [
      { path: '/api/dashboard/stats', name: 'Dashboard Stats' },
      { path: '/api/infants', name: 'Infants' },
      { path: '/api/guardian/notifications', name: 'Guardian Notifications' },
      { path: '/api/auth/verify', name: 'Verify Token' },
      { path: '/api/appointments', name: 'Appointments' },
      { path: '/api/vaccinations', name: 'Vaccinations' }
    ];

    for (const ep of endpoints) {
      try {
        const res = await request({
          hostname: 'localhost',
          port: 5000,
          path: ep.path,
          method: 'GET',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
        const result = res.status >= 200 && res.status < 300 ? 'OK' : 'Error';
        console.log(`   ${ep.name}: ${res.status} [${result}]`);
      } catch (e) {
        console.log(`   ${ep.name}: ERROR - ${e.message}`);
      }
    }
  } else {
    console.log('   Login failed:', loginRes.data || loginRes.raw);
  }

  // Test 3: Token Refresh
  console.log('\n3. Testing Token Refresh...');
  if (loginRes.data && loginRes.data.refreshToken) {
    const refreshRes = await request(
      {
        hostname: 'localhost',
        port: 5000,
        path: '/api/auth/refresh',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      { refreshToken: loginRes.data.refreshToken }
    );
    console.log('   Refresh Status:', refreshRes.status);
  }

  // Test 4: Check database data
  console.log('\n4. Testing Database Queries...');
  const pool = require('./db');
  try {
    const infants = await pool.query('SELECT COUNT(*) as count FROM infants');
    console.log('   Infants count:', infants.rows[0].count);

    const guardians = await pool.query('SELECT COUNT(*) as count FROM guardians');
    console.log('   Guardians count:', guardians.rows[0].count);

    const vaccinations = await pool.query('SELECT COUNT(*) as count FROM vaccinations');
    console.log('   Vaccinations count:', vaccinations.rows[0].count);

    const appointments = await pool.query('SELECT COUNT(*) as count FROM appointments');
    console.log('   Appointments count:', appointments.rows[0].count);
  } catch (e) {
    console.log('   Database error:', e.message);
  }
  await pool.end();

  console.log('\n=== Test Complete ===');
}

test().catch(console.error);
