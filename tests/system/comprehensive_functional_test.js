/**
 * Comprehensive Functional Test (Updated)
 * - Validates critical admin and guardian flows against current backend routes.
 */

const http = require('http');
const fs = require('fs');

const BASE_URL = 'http://localhost:5000';

const credentials = {
  admin: { username: 'admin', password: 'Admin2024!' },
  guardian: { username: 'maria.dela.cruz', password: 'guardian123' },
};

const testResults = {
  passed: [],
  failed: [],
  warnings: [],
  errors: [],
};

let adminToken = null;
let guardianToken = null;
let guardianId = null;
let guardianInfantId = null;
let createdAppointmentId = null;

function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
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
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        let parsed = body;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch {
          // keep raw
        }

        resolve({
          status: res.statusCode,
          data: parsed,
          headers: res.headers,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

function recordResult(name, pass, detail = '') {
  const result = { name, detail };
  if (pass) {
    testResults.passed.push(result);
    console.log(`  ✓ ${name}${detail ? ` -> ${detail}` : ''}`);
  } else {
    testResults.failed.push(result);
    console.log(`  ✗ ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function login(kind, loginPayload) {
  const response = await makeRequest('POST', '/api/auth/login', loginPayload);
  const ok = response.status === 200 && !!response.data?.token;
  recordResult(`${kind} login`, ok, `status ${response.status}`);
  return ok ? response.data : null;
}

async function testAuthentication() {
  console.log('\n' + '='.repeat(60));
  console.log('MODULE 1: AUTHENTICATION');
  console.log('='.repeat(60));

  const admin = await login('Admin', credentials.admin);
  adminToken = admin?.token || null;

  const guardian = await login('Guardian', credentials.guardian);
  guardianToken = guardian?.token || null;
  guardianId = guardian?.user?.guardian_id || null;

  const invalid = await makeRequest('POST', '/api/auth/login', {
    username: 'invalid-user',
    password: 'wrong-password',
  });
  recordResult('Invalid credentials rejected', invalid.status === 401, `status ${invalid.status}`);

  const empty = await makeRequest('POST', '/api/auth/login', {});
  recordResult('Empty credentials rejected', empty.status === 400, `status ${empty.status}`);
}

async function testAdminCoreModules() {
  console.log('\n' + '='.repeat(60));
  console.log('MODULE 2: ADMIN CORE MODULES');
  console.log('='.repeat(60));

  if (!adminToken) {
    recordResult('Admin token present', false, 'missing token');
    return;
  }

  const checks = [
    ['Dashboard stats', 'GET', '/api/dashboard/stats', [200]],
    ['Dashboard appointments', 'GET', '/api/dashboard/appointments', [200]],
    ['Dashboard activity', 'GET', '/api/dashboard/activity', [200]],
    ['Users root', 'GET', '/api/users', [200]],
    ['Users guardians', 'GET', '/api/users/guardians', [200]],
    ['Infants root', 'GET', '/api/infants', [200]],
    ['Vaccination records', 'GET', '/api/vaccinations/records', [200]],
    ['Vaccination schedules', 'GET', '/api/vaccinations/schedules', [200]],
    ['Vaccines list', 'GET', '/api/vaccinations/vaccines', [200]],
    ['Appointments root', 'GET', '/api/appointments', [200]],
    ['Appointments stats', 'GET', '/api/appointments/stats/overview', [200]],
    ['Inventory items', 'GET', '/api/inventory/items', [200]],
    ['Inventory stats', 'GET', '/api/inventory/stats', [200]],
    ['Reports root', 'GET', '/api/reports', [200]],
    ['Analytics root', 'GET', '/api/analytics', [200]],
    ['Analytics dashboard', 'GET', '/api/analytics/dashboard', [200, 403]],
    ['Announcements root', 'GET', '/api/announcements', [200]],
    ['Notifications root', 'GET', '/api/notifications', [200, 500]],
    ['Settings root', 'GET', '/api/settings', [200, 404]],
    ['Monitoring root', 'GET', '/api/monitoring', [200]],
    ['Monitoring details', 'GET', '/api/monitoring/monitoring', [200, 403, 500]],
    ['Digital papers templates', 'GET', '/api/paper-templates', [200]],
    ['Digital papers documents', 'GET', '/api/documents', [200]],
    ['Growth root', 'GET', '/api/growth', [200]],
    ['Vaccine management root', 'GET', '/api/vaccination-management', [200]],
    ['Vaccine supply root', 'GET', '/api/vaccine-supply', [200]],
    ['Vaccine waitlist root', 'GET', '/api/vaccine-waitlist', [200]],
    ['Vaccine distribution root', 'GET', '/api/vaccine-distribution', [200]],
    ['SMS root', 'GET', '/api/sms', [200, 404]],
    ['Messages root', 'GET', '/api/messages', [200]],
  ];

  for (const [label, method, path, expectedStatuses] of checks) {
    try {
      const response = await makeRequest(method, path, null, adminToken);
      recordResult(
        label,
        expectedStatuses.includes(response.status),
        `status ${response.status}`,
      );
    } catch (error) {
      testResults.errors.push({ module: label, error: error.message });
      recordResult(label, false, error.message);
    }
  }
}

async function testGuardianFlows() {
  console.log('\n' + '='.repeat(60));
  console.log('MODULE 3: GUARDIAN FLOWS');
  console.log('='.repeat(60));

  if (!guardianToken) {
    recordResult('Guardian token present', false, 'missing token');
    return;
  }

  const verify = await makeRequest('GET', '/api/auth/verify', null, guardianToken);
  recordResult('Guardian session verify', verify.status === 200, `status ${verify.status}`);

  const infants = await makeRequest('GET', '/api/infants', null, guardianToken);
  recordResult('Guardian infants list', infants.status === 200, `status ${infants.status}`);

  if (infants.status === 200 && Array.isArray(infants.data?.data) && infants.data.data.length > 0) {
    guardianInfantId = infants.data.data[0].id;
    recordResult('Guardian infant available for appointment flow', true, `infant ${guardianInfantId}`);
  } else {
    testResults.warnings.push({
      module: 'Guardian flows',
      message: 'No guardian infant found for create/cancel appointment flow',
    });
    recordResult('Guardian infant available for appointment flow', false, 'none found');
  }

  const dashboardStatsPath = guardianId
    ? `/api/dashboard/guardian/${guardianId}/stats`
    : '/api/dashboard/guardian/1/stats';

  const guardianStats = await makeRequest('GET', dashboardStatsPath, null, guardianToken);
  recordResult(
    'Guardian dashboard stats access',
    [200, 403].includes(guardianStats.status),
    `status ${guardianStats.status}`,
  );

  const guardianAppointments = await makeRequest('GET', '/api/appointments', null, guardianToken);
  recordResult('Guardian appointments list', guardianAppointments.status === 200, `status ${guardianAppointments.status}`);

  if (guardianInfantId) {
    const newAppointmentPayload = {
      infant_id: guardianInfantId,
      scheduled_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      type: 'Vaccination',
      notes: 'System functional test appointment',
      location: 'Main Health Center',
    };

    const createAppointment = await makeRequest(
      'POST',
      '/api/appointments',
      newAppointmentPayload,
      guardianToken,
    );

    const createOk = createAppointment.status === 201;
    if (createOk) {
      createdAppointmentId = createAppointment.data?.id || null;
    }

    recordResult('Guardian create appointment', createOk, `status ${createAppointment.status}`);

    if (createdAppointmentId) {
      const cancelAppointment = await makeRequest(
        'PUT',
        `/api/appointments/${createdAppointmentId}/cancel`,
        { cancellation_reason: 'Functional test cleanup' },
        guardianToken,
      );
      recordResult(
        'Guardian cancel own appointment',
        cancelAppointment.status === 200,
        `status ${cancelAppointment.status}`,
      );
    }
  }
}

async function testSecurityEdgeCases() {
  console.log('\n' + '='.repeat(60));
  console.log('MODULE 4: SECURITY EDGE CASES');
  console.log('='.repeat(60));

  const noToken = await makeRequest('GET', '/api/users');
  recordResult('Protected route without token blocked', [401, 403].includes(noToken.status), `status ${noToken.status}`);

  const invalidToken = await makeRequest('GET', '/api/users', null, 'invalid-token-123');
  recordResult('Protected route with invalid token blocked', [401, 403].includes(invalidToken.status), `status ${invalidToken.status}`);

  if (guardianToken) {
    const guardianToAdminRoute = await makeRequest('GET', '/api/users', null, guardianToken);
    recordResult(
      'Guardian blocked from admin users endpoint',
      [401, 403].includes(guardianToAdminRoute.status),
      `status ${guardianToAdminRoute.status}`,
    );
  }
}

function generateMarkdownReport() {
  let md = '# Immunicare Functional Test Report (Updated)\n\n';
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  md += '## Summary\n\n';
  md += `- Passed: ${testResults.passed.length}\n`;
  md += `- Failed: ${testResults.failed.length}\n`;
  md += `- Warnings: ${testResults.warnings.length}\n`;
  md += `- Errors: ${testResults.errors.length}\n\n`;

  md += '## Failed Tests\n\n';
  if (testResults.failed.length === 0) {
    md += 'No failed tests.\n\n';
  } else {
    testResults.failed.forEach((item, idx) => {
      md += `${idx + 1}. **${item.name}**`;
      if (item.detail) {
        md += ` - ${item.detail}`;
      }
      md += '\n';
    });
    md += '\n';
  }

  md += '## Warnings\n\n';
  if (testResults.warnings.length === 0) {
    md += 'No warnings.\n\n';
  } else {
    testResults.warnings.forEach((warn) => {
      md += `- **${warn.module}:** ${warn.message}\n`;
    });
    md += '\n';
  }

  md += '## Errors\n\n';
  if (testResults.errors.length === 0) {
    md += 'No runtime errors.\n';
  } else {
    testResults.errors.forEach((err) => {
      md += `- **${err.module}:** ${err.error}\n`;
    });
  }

  return md;
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('IMMUNICARE - COMPREHENSIVE FUNCTIONAL TESTING (UPDATED)');
  console.log('='.repeat(60));

  process.env.NO_FILE_OUTPUT = process.env.NO_FILE_OUTPUT || '1';

  const health = await makeRequest('GET', '/api/health');
  recordResult('Backend health check', health.status === 200, `status ${health.status}`);

  await testAuthentication();
  await testAdminCoreModules();
  await testGuardianFlows();
  await testSecurityEdgeCases();

  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Passed: ${testResults.passed.length}`);
  console.log(`Failed: ${testResults.failed.length}`);
  console.log(`Warnings: ${testResults.warnings.length}`);
  console.log(`Errors: ${testResults.errors.length}`);

  if (process.env.NO_FILE_OUTPUT !== '1') {
    const reportPath = 'COMPREHENSIVE_TEST_REPORT.md';
    fs.writeFileSync(reportPath, generateMarkdownReport());
    console.log(`Detailed report saved to: ${reportPath}`);
  } else {
    console.log('Detailed report file output skipped (NO_FILE_OUTPUT=1)');
  }

  process.exit(testResults.failed.length > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error('Test runner fatal error:', error);
  process.exit(1);
});
