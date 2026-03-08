/**
 * API Error Fixes Verification Script
 * Tests the fixed API endpoints to ensure they handle errors gracefully
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';
const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'; // Placeholder token

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function makeRequest(path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            data: jsonData
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            data: data
          });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function testEndpoint(name, path, expectedStatus = 200) {
  log(`\nTesting: ${name}`, 'blue');
  log(`Endpoint: ${path}`, 'yellow');

  try {
    const response = await makeRequest(path, 'GET', {
      Authorization: `Bearer ${TEST_TOKEN}`
    });

    const isSuccess =
      response.statusCode === expectedStatus ||
      response.statusCode === 200 ||
      response.statusCode === 304;

    if (isSuccess) {
      log(`✓ Status: ${response.statusCode}`, 'green');
      log(`✓ Response: ${JSON.stringify(response.data).substring(0, 100)}...`, 'green');
      return true;
    } else {
      log(`✗ Status: ${response.statusCode} (expected ${expectedStatus})`, 'red');
      log(`✗ Response: ${JSON.stringify(response.data)}`, 'red');
      return false;
    }
  } catch (error) {
    log(`✗ Error: ${error.message}`, 'red');
    return false;
  }
}

async function runTests() {
  log('\n========================================', 'blue');
  log('API Error Fixes Verification', 'blue');
  log('========================================', 'blue');

  const tests = [
    // Dashboard routes that were returning 404
    { name: 'Guardian Stats', path: '/api/dashboard/guardian/1/stats' },
    { name: 'Guardian Appointments', path: '/api/dashboard/guardian/1/appointments?limit=10' },

    // Infants routes that were returning 500
    { name: 'Infants by Guardian', path: '/api/infants/guardian/1' },

    // Notifications route that was returning 500
    { name: 'Notifications', path: '/api/notifications' },

    // Additional dashboard routes
    { name: 'Dashboard Stats', path: '/api/dashboard/stats' },
    { name: 'Dashboard Appointments', path: '/api/dashboard/appointments' },
    { name: 'Dashboard Infants', path: '/api/dashboard/infants' }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await testEndpoint(test.name, test.path);
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  log('\n========================================', 'blue');
  log('Test Results', 'blue');
  log('========================================', 'blue');
  log(`Passed: ${passed}`, 'green');
  log(`Failed: ${failed}`, failed > 0 ? 'red' : 'green');
  log(`Total: ${tests.length}`, 'blue');
  log('========================================\n', 'blue');

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  log(`\nFatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
