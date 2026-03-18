/**
 * Appointment Date Validation Tests
 * Verifies that appointments reject past dates but allow today and future dates in the Asia/Manila timezone.
 */
const http = require('http');
const https = require('https');

const BASE_URL = process.env.TEST_URL || 'http://localhost:5000';

function makeRequest(method, path, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const client = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (_e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('--- APPOINTMENT DATE VALIDATION TESTS ---');

  const formatManilaDate = (date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(date);

  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

  const yesterdayStr = formatManilaDate(yesterday);
  const todayStr = formatManilaDate(today);
  const tomorrowStr = formatManilaDate(tomorrow);

  console.log(`\n[1] Testing Yesterday: ${yesterdayStr}`);
  const res1 = await makeRequest('GET', `/api/appointments/availability/check?scheduled_date=${yesterdayStr}`);
  if (res1.data.code === 'DATE_IN_PAST') {
    console.log('✅ Yesterday correctly rejected');
  } else {
    console.log('❌ Yesterday test failed', res1.data);
  }

  console.log(`\n[2] Testing Today: ${todayStr}`);
  const res2 = await makeRequest('GET', `/api/appointments/availability/check?scheduled_date=${todayStr}`);
  if (res2.data.code !== 'DATE_IN_PAST') {
    console.log('✅ Today correctly accepted (past the date check)');
  } else {
    console.log('❌ Today test failed', res2.data);
  }

  console.log(`\n[3] Testing Tomorrow: ${tomorrowStr}`);
  const res3 = await makeRequest('GET', `/api/appointments/availability/check?scheduled_date=${tomorrowStr}`);
  if (res3.data.code !== 'DATE_IN_PAST') {
    console.log('✅ Tomorrow correctly accepted (past the date check)');
  } else {
    console.log('❌ Tomorrow test failed', res3.data);
  }
}

runTests().catch(console.error);
