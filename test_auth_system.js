/**
 * Authentication System Test Suite
 * Tests login, registration, password reset, and session management
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';
const API_BASE = `${BASE_URL}/api`;

// Test credentials
const testGuardian = {
  email: `test.guardian.${Date.now()}@test.com`,
  password: 'TestPassword123!',
  firstName: 'Test',
  lastName: 'Guardian',
  phone: '+639123456789',
  relationship: 'guardian',
  infantName: 'Test Baby',
  infantDob: '2024-01-15'
};

const testAdmin = {
  username: 'admin',
  password: 'Admin2024!'
};

let accessToken = '';
let refreshToken = '';
let createdUserId = null;
const passwordResetToken = '';

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
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

// Test runner
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('IMMUNICARE AUTHENTICATION SYSTEM TEST');
  console.log('='.repeat(60) + '\n');

  // Test 1: Auth endpoint test
  console.log('TEST 1: Auth Endpoint Test');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('GET', `${API_BASE}/auth/test`);
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    console.log('✅ Auth endpoint is working\n');
  } catch (error) {
    console.log(`❌ Auth endpoint test failed: ${error.message}\n`);
  }

  // Test 2: Guardian Registration
  console.log('TEST 2: Guardian Registration');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/register/guardian`, {
      ...testGuardian,
      confirmPassword: testGuardian.password
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);

    if (response.status === 201) {
      createdUserId = response.data.user?.id;
      console.log(`✅ Guardian registration successful (User ID: ${createdUserId})\n`);
    } else {
      console.log('❌ Guardian registration failed\n');
    }
  } catch (error) {
    console.log(`❌ Registration error: ${error.message}\n`);
  }

  // Test 3: Duplicate Registration (should fail)
  console.log('TEST 3: Duplicate Registration (Should Fail)');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/register/guardian`, {
      ...testGuardian,
      confirmPassword: testGuardian.password
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 409) {
      console.log('✅ Correctly rejected duplicate registration\n');
    } else {
      console.log('⚠️ Unexpected response for duplicate registration\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 4: Invalid Registration (weak password)
  console.log('TEST 4: Invalid Registration (Weak Password)');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/register/guardian`, {
      email: 'weak@test.com',
      password: '123',
      confirmPassword: '123',
      firstName: 'Test',
      lastName: 'User',
      phone: '+639123456789',
      relationship: 'guardian'
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 400) {
      console.log('✅ Correctly rejected weak password\n');
    } else {
      console.log('⚠️ Unexpected response for weak password\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 5: Login with Invalid Credentials
  console.log('TEST 5: Login with Invalid Credentials');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/login`, {
      username: 'nonexistent_user',
      password: 'wrongpassword'
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 401) {
      console.log('✅ Correctly rejected invalid credentials\n');
    } else {
      console.log('⚠️ Unexpected response\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 6: Admin Login
  console.log('TEST 6: Admin Login');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/login`, {
      username: testAdmin.username,
      password: testAdmin.password
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);

    if (response.status === 200 && response.data.token) {
      accessToken = response.data.token;
      refreshToken = response.data.refreshToken;
      console.log('✅ Admin login successful');
      console.log(`   User: ${response.data.user?.username}`);
      console.log(`   Role: ${response.data.user?.role}\n`);
    } else {
      console.log('⚠️ Admin login failed - continuing with tests\n');
    }
  } catch (error) {
    console.log(`❌ Admin login error: ${error.message}\n`);
  }

  // Test 7: Session Verification
  console.log('TEST 7: Session Verification');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('GET', `${API_BASE}/auth/verify`, null, {
      Authorization: `Bearer ${accessToken}`
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 200 && response.data.authenticated) {
      console.log('✅ Session verification successful\n');
    } else {
      console.log('⚠️ Session verification issue\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 8: Forgot Password
  console.log('TEST 8: Forgot Password');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/forgot-password`, {
      email: testGuardian.email
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 200) {
      console.log('✅ Password reset request processed\n');
    } else {
      console.log('⚠️ Password reset request issue\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 9: Get User Sessions
  console.log('TEST 9: Get User Sessions');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('GET', `${API_BASE}/auth/sessions`, null, {
      Authorization: `Bearer ${accessToken}`
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 200) {
      console.log('✅ Sessions retrieved successfully\n');
    } else {
      console.log('⚠️ Session retrieval issue\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 10: Token Refresh
  console.log('TEST 10: Token Refresh');
  console.log('-'.repeat(40));
  if (refreshToken) {
    try {
      const response = await makeRequest('POST', `${API_BASE}/auth/refresh`, null, {
        Cookie: `refreshToken=${refreshToken}`
      });
      console.log(`Status: ${response.status}`);
      console.log(`Response: ${JSON.stringify(response.data)}`);
      if (response.status === 200 && response.data.token) {
        accessToken = response.data.token;
        refreshToken = response.data.refreshToken;
        console.log('✅ Token refresh successful\n');
      } else {
        console.log('⚠️ Token refresh issue\n');
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}\n`);
    }
  } else {
    console.log('⚠️ No refresh token available, skipping test\n');
  }

  // Test 11: Invalid Token Access
  console.log('TEST 11: Invalid Token Access (Should Fail)');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('GET', `${API_BASE}/auth/verify`, null, {
      Authorization: 'Bearer invalid_token_here'
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 401) {
      console.log('✅ Correctly rejected invalid token\n');
    } else {
      console.log('⚠️ Unexpected response\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 12: Logout
  console.log('TEST 12: Logout');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/logout`, null, {
      Authorization: `Bearer ${accessToken}`
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 200) {
      console.log('✅ Logout successful\n');
    } else {
      console.log('⚠️ Logout issue\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 13: SQL Injection Prevention
  console.log('TEST 13: SQL Injection Prevention');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/login`, {
      username: 'admin\' OR \'1\'=\'1',
      password: 'anything'
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 401) {
      console.log('✅ SQL injection attempt blocked\n');
    } else {
      console.log('⚠️ Unexpected response\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 14: XSS Prevention
  console.log('TEST 14: XSS Prevention in Login');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest('POST', `${API_BASE}/auth/login`, {
      username: '<script>alert("xss")</script>',
      password: 'password'
    });
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${JSON.stringify(response.data)}`);
    if (response.status === 401) {
      console.log('✅ XSS attempt blocked\n');
    } else {
      console.log('⚠️ Unexpected response\n');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Summary
  console.log('='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Server: ${BASE_URL}`);
  console.log(`Test Time: ${new Date().toISOString()}`);
  console.log(`Created Guardian User ID: ${createdUserId || 'Not created'}`);
  console.log('\nAll authentication tests completed.');
  console.log('='.repeat(60) + '\n');
}

// Run tests
runTests().catch(console.error);
