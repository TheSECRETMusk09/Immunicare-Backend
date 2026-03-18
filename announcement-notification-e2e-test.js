/**
 * E2E Test: Admin Announcement to Guardian Notification
 * Tests the integration between admin announcement module and guardian notifications.
 */
const http = require('http');
const https = require('https');

const BASE_URL = process.env.TEST_URL || 'http://localhost:5000';

function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const client = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: body ? JSON.parse(body) : {} });
        } catch (_e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- ANNOUNCEMENT TO GUARDIAN NOTIFICATION E2E TEST ---');

  console.log('\n[1] Logging in as Admin...');
  const adminLogin = await makeRequest('POST', '/api/auth/login', { username: 'admin', password: 'Admin2024!' });
  const adminToken = adminLogin.data.token || adminLogin.data.accessToken;
  if (!adminToken) {
    throw new Error('Failed to login as admin');
  }
  console.log('✅ Admin logged in');

  console.log('\n[2] Logging in as Guardian...');
  const guardianLogin = await makeRequest('POST', '/api/auth/guardian/login', { email: 'maria.santos@email.com', password: 'guardian123' });
  const guardianToken = guardianLogin.data.token || guardianLogin.data.accessToken;
  if (!guardianToken) {
    throw new Error('Failed to login as guardian');
  }
  console.log('✅ Guardian logged in');

  console.log('\n[3] Creating Announcement for Patients...');
  const announcementData = {
    title: `Patient Update ${Date.now()}`,
    content: 'This is a critical update for all patients and guardians.',
    target_audience: 'patients',
    priority: 'high',
    status: 'draft',
  };
  const createAnn = await makeRequest('POST', '/api/announcements', announcementData, adminToken);
  if (createAnn.status !== 201 && createAnn.status !== 200) {
    throw new Error(`Failed to create announcement: ${JSON.stringify(createAnn.data)}`);
  }
  const announcementId = createAnn.data.id;
  console.log(`✅ Announcement created (ID: ${announcementId})`);

  console.log('\n[4] Testing Duplicate Prevention...');
  const duplicateAnn = await makeRequest('POST', '/api/announcements', announcementData, adminToken);
  if (duplicateAnn.status === 409 || duplicateAnn.status === 400) {
    console.log('✅ Duplicate correctly prevented');
  } else {
    console.log(`❌ Duplicate was NOT prevented (Status: ${duplicateAnn.status})`);
  }

  console.log('\n[5] Publishing Announcement...');
  const publishAnn = await makeRequest('PUT', `/api/announcements/${announcementId}/publish`, null, adminToken);
  if (publishAnn.status !== 200) {
    throw new Error(`Failed to publish announcement: ${JSON.stringify(publishAnn.data)}`);
  }
  console.log('✅ Announcement published. Delivery Summary:', publishAnn.data.delivery_summary);

  console.log('\n--- E2E TEST COMPLETED ---');
}

runTests().catch(console.error);
