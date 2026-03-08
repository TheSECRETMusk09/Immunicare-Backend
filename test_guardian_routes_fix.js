/**
 * Test script to verify the API route fixes for guardian endpoints
 * Tests the following endpoints that were failing:
 * - GET /api/dashboard/guardian/:guardianId/appointments
 * - GET /api/dashboard/guardian/:guardianId/stats
 * - GET /api/infants/guardian/:guardianId
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';
const GUARDIAN_ID = '1';

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

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: jsonData
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function testEndpoint(name, path, expectedStatus = 200) {
  log(`\nTesting: ${name}`, 'blue');
  log(`Endpoint: ${path}`, 'yellow');

  try {
    const response = await makeRequest(path);

    if (response.statusCode === expectedStatus) {
      log(`✓ Status: ${response.statusCode} (Expected: ${expectedStatus})`, 'green');
      log(`✓ Response: ${JSON.stringify(response.data, null, 2).substring(0, 200)}...`, 'green');
      return { success: true, name, path, status: response.statusCode };
    } else {
      log(`✗ Status: ${response.statusCode} (Expected: ${expectedStatus})`, 'red');
      log(`✗ Response: ${JSON.stringify(response.data, null, 2)}`, 'red');
      return { success: false, name, path, status: response.statusCode, error: response.data };
    }
  } catch (error) {
    log(`✗ Error: ${error.message}`, 'red');
    return { success: false, name, path, error: error.message };
  }
}

async function runTests() {
  log('\n========================================', 'blue');
  log('API ROUTE FIX VERIFICATION TESTS', 'blue');
  log('========================================', 'blue');

  const tests = [
    // Dashboard Guardian Endpoints
    {
      name: 'Guardian Dashboard Stats',
      path: `/api/dashboard/guardian/${GUARDIAN_ID}/stats`,
      expectedStatus: 200
    },
    {
      name: 'Guardian Dashboard Appointments',
      path: `/api/dashboard/guardian/${GUARDIAN_ID}/appointments`,
      expectedStatus: 200
    },
    {
      name: 'Guardian Dashboard Children',
      path: `/api/dashboard/guardian/${GUARDIAN_ID}/children`,
      expectedStatus: 200
    },
    {
      name: 'Guardian Dashboard Vaccinations',
      path: `/api/dashboard/guardian/${GUARDIAN_ID}/vaccinations`,
      expectedStatus: 200
    },
    {
      name: 'Guardian Dashboard Health Charts',
      path: `/api/dashboard/guardian/${GUARDIAN_ID}/health-charts`,
      expectedStatus: 200
    },
    {
      name: 'Guardian Dashboard Notifications',
      path: `/api/dashboard/guardian/${GUARDIAN_ID}/notifications`,
      expectedStatus: 200
    },

    // Infants Guardian Endpoints
    {
      name: 'Infants by Guardian',
      path: `/api/infants/guardian/${GUARDIAN_ID}`,
      expectedStatus: 200
    },

    // General Dashboard Endpoints
    {
      name: 'Dashboard Health Check',
      path: '/api/dashboard/health',
      expectedStatus: 200
    },
    {
      name: 'Dashboard Stats',
      path: '/api/dashboard/stats',
      expectedStatus: 200
    },
    {
      name: 'Dashboard Appointments',
      path: '/api/dashboard/appointments',
      expectedStatus: 200
    },

    // General Infants Endpoints
    {
      name: 'All Infants',
      path: '/api/infants',
      expectedStatus: 200
    },
    {
      name: 'Infant Stats Overview',
      path: '/api/infants/stats/overview',
      expectedStatus: 200
    }
  ];

  const results = [];

  for (const test of tests) {
    const result = await testEndpoint(test.name, test.path, test.expectedStatus);
    results.push(result);
    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Print summary
  log('\n========================================', 'blue');
  log('TEST SUMMARY', 'blue');
  log('========================================', 'blue');

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  log(`\nTotal Tests: ${results.length}`, 'blue');
  log(`Passed: ${passed}`, 'green');
  log(`Failed: ${failed}`, failed > 0 ? 'red' : 'green');

  if (failed > 0) {
    log('\nFailed Tests:', 'red');
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        log(`  ✗ ${r.name}: ${r.path}`, 'red');
        if (r.error) {
          log(`    Error: ${r.error}`, 'red');
        }
      });
  }

  log('\n========================================', 'blue');
  log(failed === 0 ? 'ALL TESTS PASSED! ✓' : 'SOME TESTS FAILED ✗', failed === 0 ? 'green' : 'red');
  log('========================================\n', 'blue');

  process.exit(failed === 0 ? 0 : 1);
}

// Check if server is running
async function checkServer() {
  try {
    await makeRequest('/api/health');
    return true;
  } catch (error) {
    return false;
  }
}

async function main() {
  log('Checking if server is running...', 'yellow');
  const serverRunning = await checkServer();

  if (!serverRunning) {
    log('ERROR: Server is not running on http://localhost:5000', 'red');
    log('Please start the server first: cd backend && npm start', 'yellow');
    process.exit(1);
  }

  log('Server is running!', 'green');
  await runTests();
}

main().catch((error) => {
  log(`Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
