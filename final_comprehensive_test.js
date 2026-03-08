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
  console.log('=== FINAL COMPREHENSIVE API TEST ===\n');

  // Get admin token
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

  const token = loginRes.data.token;
  console.log('Admin authenticated successfully\n');

  // Test all major API endpoints
  const endpoints = [
    { path: '/api/health', name: 'Health Check' },
    { path: '/api/dashboard/stats', name: 'Dashboard Stats' },
    { path: '/api/infants', name: 'Infants' },
    { path: '/api/vaccinations', name: 'Vaccinations' },
    { path: '/api/appointments', name: 'Appointments' },
    { path: '/api/inventory/vaccine-inventory', name: 'Vaccine Inventory' },
    { path: '/api/announcements', name: 'Announcements' },
    { path: '/api/notifications', name: 'Notifications' },
    { path: '/api/users', name: 'Users' },
    { path: '/api/settings', name: 'Settings' },
    { path: '/api/reports', name: 'Reports' },
    { path: '/api/analytics', name: 'Analytics' },
    { path: '/api/growth', name: 'Growth Records' },
    { path: '/api/monitoring/monitoring', name: 'Monitoring Metrics' }
  ];

  let passed = 0;
  let failed = 0;

  console.log('Testing API Endpoints:\n');
  for (const ep of endpoints) {
    try {
      const res = await request({
        hostname: 'localhost',
        port: 5000,
        path: ep.path,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
      });

      const statusIcon = res.status >= 200 && res.status < 300 ? '✓' : '✗';
      const statusText = res.status >= 200 && res.status < 300 ? 'OK' : `Error (${res.status})`;

      console.log(`${statusIcon} ${ep.name}: ${res.status} [${statusText}]`);

      if (res.status >= 200 && res.status < 300) {
        passed++;
      } else {
        failed++;
      }
    } catch (e) {
      console.log(`✗ ${ep.name}: ERROR - ${e.message}`);
      failed++;
    }
  }

  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
}

test();
