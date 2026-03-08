/**
 * Server Connectivity Test Script
 * Tests if the backend server is running and accessible on port 5000
 * Also verifies CORS headers are being set correctly
 */

const http = require('http');

const SERVER_HOST = 'localhost';
const SERVER_PORT = 5000;
const TEST_ORIGIN = 'http://localhost:3000';

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('Server Connectivity Test');
  console.log('='.repeat(60));
  console.log(`Server: ${SERVER_HOST}:${SERVER_PORT}`);
  console.log(`Test Origin: ${TEST_ORIGIN}`);
  console.log('');

  let allPassed = true;

  // Test 1: Basic TCP Connection
  console.log('Test 1: Basic TCP Connection');
  console.log('-'.repeat(40));
  try {
    const result = await makeRequest({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: '/',
      method: 'GET'
    });
    console.log('✅ Server is running and accessible');
    console.log(`   Status: ${result.statusCode}`);
  } catch (error) {
    console.log('❌ Server is NOT accessible');
    console.log(`   Error: ${error.message}`);
    console.log('');
    console.log('Troubleshooting Steps:');
    console.log('1. Start the backend server: cd backend && npm start');
    console.log('2. Check if port 5000 is in use: netstat -ano | findstr :5000');
    console.log('3. Check for firewall blocking the connection');
    allPassed = false;
    console.log('');
  }

  // Test 2: OPTIONS Preflight Request for Health Endpoint
  console.log('Test 2: OPTIONS Preflight Request - /api/health');
  console.log('-'.repeat(40));
  try {
    const result = await makeRequest({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: '/api/health',
      method: 'OPTIONS',
      headers: {
        Origin: TEST_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      }
    });

    console.log(`Status: ${result.statusCode}`);
    console.log('CORS Headers:');

    const corsHeaders = {
      'access-control-allow-origin': result.headers['access-control-allow-origin'],
      'access-control-allow-methods': result.headers['access-control-allow-methods'],
      'access-control-allow-headers': result.headers['access-control-allow-headers'],
      'access-control-allow-credentials': result.headers['access-control-allow-credentials']
    };

    let corsOk = true;
    for (const [key, value] of Object.entries(corsHeaders)) {
      console.log(`   ${key}: ${value || '❌ MISSING'}`);
      if (!value) {
        corsOk = false;
      }
    }

    if (result.statusCode === 204 && corsOk) {
      console.log('✅ OPTIONS request handled correctly');
    } else {
      console.log('❌ CORS headers missing or incorrect');
      allPassed = false;
    }
  } catch (error) {
    console.log('❌ OPTIONS request failed');
    console.log(`   Error: ${error.message}`);
    allPassed = false;
  }
  console.log('');

  // Test 3: GET Request for Health Endpoint
  console.log('Test 3: GET Request - /api/health');
  console.log('-'.repeat(40));
  try {
    const result = await makeRequest({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: '/api/health',
      method: 'GET',
      headers: {
        Origin: TEST_ORIGIN
      }
    });

    console.log(`Status: ${result.statusCode}`);

    if (result.statusCode === 200) {
      try {
        const body = JSON.parse(result.body);
        console.log('Response:', JSON.stringify(body, null, 2));
        console.log('✅ Health endpoint is working');
      } catch (e) {
        console.log('Response body:', result.body);
        console.log('✅ Health endpoint is working (non-JSON response)');
      }
    } else {
      console.log('❌ Health endpoint returned non-200 status');
      allPassed = false;
    }
  } catch (error) {
    console.log('❌ Health endpoint request failed');
    console.log(`   Error: ${error.message}`);
    allPassed = false;
  }
  console.log('');

  // Test 4: OPTIONS Preflight Request for Auth Verify Endpoint
  console.log('Test 4: OPTIONS Preflight Request - /api/auth/verify');
  console.log('-'.repeat(40));
  try {
    const result = await makeRequest({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: '/api/auth/verify',
      method: 'OPTIONS',
      headers: {
        Origin: TEST_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      }
    });

    console.log(`Status: ${result.statusCode}`);
    console.log('CORS Headers:');

    const corsHeaders = {
      'access-control-allow-origin': result.headers['access-control-allow-origin'],
      'access-control-allow-methods': result.headers['access-control-allow-methods'],
      'access-control-allow-headers': result.headers['access-control-allow-headers']
    };

    let corsOk = true;
    for (const [key, value] of Object.entries(corsHeaders)) {
      console.log(`   ${key}: ${value || '❌ MISSING'}`);
      if (!value) {
        corsOk = false;
      }
    }

    if (result.statusCode === 204 && corsOk) {
      console.log('✅ OPTIONS request handled correctly');
    } else {
      console.log('❌ CORS headers missing or incorrect');
      allPassed = false;
    }
  } catch (error) {
    console.log('❌ OPTIONS request failed');
    console.log(`   Error: ${error.message}`);
    allPassed = false;
  }
  console.log('');

  // Test 5: GET Request for Auth Verify Endpoint (should return 401, not 404)
  console.log('Test 5: GET Request - /api/auth/verify (no token)');
  console.log('-'.repeat(40));
  try {
    const result = await makeRequest({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: '/api/auth/verify',
      method: 'GET',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Status: ${result.statusCode}`);

    if (result.statusCode === 401) {
      console.log('✅ Route is accessible (401 = no token provided, not 404)');
      console.log(`   Response: ${result.body}`);
    } else if (result.statusCode === 404) {
      console.log('❌ Route NOT found (404 error)');
      console.log('   This indicates the route is not properly registered');
      allPassed = false;
    } else {
      console.log(`⚠️  Unexpected status code: ${result.statusCode}`);
      console.log(`   Response: ${result.body}`);
    }
  } catch (error) {
    console.log('❌ Request failed');
    console.log(`   Error: ${error.message}`);
    allPassed = false;
  }
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  if (allPassed) {
    console.log('✅ All tests passed! Server is configured correctly.');
  } else {
    console.log('❌ Some tests failed. Please review the issues above.');
    console.log('');
    console.log('Quick Fixes:');
    console.log('1. Start the server: cd backend && npm start');
    console.log('2. Check server logs for errors');
    console.log('3. Verify CORS configuration in server.js');
    console.log('4. Check route registration in routes/auth.js');
  }
  console.log('');

  return allPassed;
}

// Run tests
runTests()
  .then((passed) => {
    process.exit(passed ? 0 : 1);
  })
  .catch((error) => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
