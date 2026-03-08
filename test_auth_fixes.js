/**
 * Test script to verify authentication fixes
 * Tests login, logout, and refresh endpoints
 */

const http = require('http');

// Helper function to make HTTP requests
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body
          });
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

// Test 1: Health check
async function testHealthCheck() {
  console.log('\n=== Test 1: Health Check ===');
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 5000,
      path: '/api/health',
      method: 'GET'
    });

    console.log('Status:', response.statusCode);
    console.log('Response:', response.body);
    return response.statusCode === 200;
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

// Test 2: Login with invalid credentials
async function testInvalidLogin() {
  console.log('\n=== Test 2: Login with Invalid Credentials ===');
  try {
    const response = await makeRequest(
      {
        hostname: 'localhost',
        port: 5000,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      },
      {
        username: 'invalid_user',
        password: 'wrong_password'
      }
    );

    console.log('Status:', response.statusCode);
    console.log('Response:', response.body);
    return response.statusCode === 401;
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

// Test 3: Login with missing credentials
async function testMissingCredentials() {
  console.log('\n=== Test 3: Login with Missing Credentials ===');
  try {
    const response = await makeRequest(
      {
        hostname: 'localhost',
        port: 5000,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      },
      {
        username: 'test_user'
        // Missing password
      }
    );

    console.log('Status:', response.statusCode);
    console.log('Response:', response.body);
    return response.statusCode === 400;
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

// Test 4: Logout (should work without authentication)
async function testLogout() {
  console.log('\n=== Test 4: Logout ===');
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/logout',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Status:', response.statusCode);
    console.log('Response:', response.body);
    return response.statusCode === 200;
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

// Test 5: Refresh token without token
async function testRefreshWithoutToken() {
  console.log('\n=== Test 5: Refresh Token Without Token ===');
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/refresh',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Status:', response.statusCode);
    console.log('Response:', response.body);
    return response.statusCode === 401;
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

// Test 6: Forgot password
async function testForgotPassword() {
  console.log('\n=== Test 6: Forgot Password ===');
  try {
    const response = await makeRequest(
      {
        hostname: 'localhost',
        port: 5000,
        path: '/api/auth/forgot-password',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      },
      {
        username: 'test_user'
      }
    );

    console.log('Status:', response.statusCode);
    console.log('Response:', response.body);
    return response.statusCode === 200;
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

// Test 7: Auth test endpoint
async function testAuthTest() {
  console.log('\n=== Test 7: Auth Test Endpoint ===');
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/test',
      method: 'GET'
    });

    console.log('Status:', response.statusCode);
    console.log('Response:', response.body);
    return response.statusCode === 200;
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('========================================');
  console.log('Authentication Fixes Test Suite');
  console.log('========================================');

  const results = {
    healthCheck: await testHealthCheck(),
    invalidLogin: await testInvalidLogin(),
    missingCredentials: await testMissingCredentials(),
    logout: await testLogout(),
    refreshWithoutToken: await testRefreshWithoutToken(),
    forgotPassword: await testForgotPassword(),
    authTest: await testAuthTest()
  };

  console.log('\n========================================');
  console.log('Test Results Summary');
  console.log('========================================');
  console.log('Health Check:', results.healthCheck ? '✓ PASS' : '✗ FAIL');
  console.log('Invalid Login:', results.invalidLogin ? '✓ PASS' : '✗ FAIL');
  console.log('Missing Credentials:', results.missingCredentials ? '✓ PASS' : '✗ FAIL');
  console.log('Logout:', results.logout ? '✓ PASS' : '✗ FAIL');
  console.log('Refresh Without Token:', results.refreshWithoutToken ? '✓ PASS' : '✗ FAIL');
  console.log('Forgot Password:', results.forgotPassword ? '✓ PASS' : '✗ FAIL');
  console.log('Auth Test:', results.authTest ? '✓ PASS' : '✗ FAIL');

  const passed = Object.values(results).filter((r) => r).length;
  const total = Object.keys(results).length;
  console.log(`\nTotal: ${passed}/${total} tests passed`);

  process.exit(passed === total ? 0 : 1);
}

// Wait a bit for server to be ready, then run tests
setTimeout(() => {
  runTests().catch((error) => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
}, 2000);
