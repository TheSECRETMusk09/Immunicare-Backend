/**
 * Login Fix Verification Script
 * Tests that both admin and guardian login work correctly
 * after the frontend and backend fixes
 */

require('dotenv').config();
const axios = require('axios');

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Test credentials
const TEST_CREDENTIALS = {
  admin: {
    username: 'admin',
    password: 'Admin2024!'
  },
  guardian: {
    username: 'maria.dela.cruz',
    password: 'Guardian123!'
  }
};

async function testLogin(identifier, password, userType) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${userType} Login`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Identifier: ${identifier}`);
  console.log(`Password: ${'*'.repeat(password.length)}`);

  try {
    const response = await axios.post(
      `${API_BASE_URL}/auth/login`,
      {
        username: identifier,
        email: identifier,
        password: password
      },
      {
        timeout: 10000,
        withCredentials: true
      }
    );

    console.log(`\n✅ ${userType} login successful!`);
    console.log('\nResponse:');
    console.log(`  - Message: ${response.data.message}`);
    console.log(`  - User ID: ${response.data.user.id}`);
    console.log(`  - Username: ${response.data.user.username}`);
    console.log(`  - Role: ${response.data.user.role}`);
    console.log(`  - Clinic: ${response.data.user.clinic}`);
    console.log(`  - Token received: ${response.data.token ? 'Yes' : 'No'}`);

    return {
      success: true,
      user: response.data.user,
      token: response.data.token
    };
  } catch (error) {
    console.error(`\n❌ ${userType} login failed!`);
    if (error.response) {
      console.error(`  Status: ${error.response.status}`);
      console.error(
        `  Error: ${error.response.data?.error || error.response.data?.message || 'Unknown error'}`
      );
      console.error(`  Code: ${error.response.data?.code || 'N/A'}`);
    } else if (error.request) {
      console.error('  Error: No response received - backend may be down');
    } else {
      console.error(`  Error: ${error.message}`);
    }
    return {
      success: false,
      error: error.response?.data?.error || error.message
    };
  }
}

async function verifySession(token) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Verifying Session');
  console.log(`${'='.repeat(60)}`);

  try {
    const response = await axios.get(`${API_BASE_URL}/auth/verify`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      timeout: 5000
    });

    console.log('✅ Session verified!');
    console.log(`  - Authenticated: ${response.data.authenticated}`);
    console.log(`  - User: ${response.data.user?.username}`);
    console.log(`  - Role: ${response.data.user?.role}`);

    return { success: true, data: response.data };
  } catch (error) {
    console.error('❌ Session verification failed!');
    console.error(`  Status: ${error.response?.status}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log(`${'='.repeat(60)}`);
  console.log('Login Fix Verification');
  console.log(`${'='.repeat(60)}`);
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const results = {
    admin: await testLogin(
      TEST_CREDENTIALS.admin.username,
      TEST_CREDENTIALS.admin.password,
      'Admin'
    ),
    guardian: await testLogin(
      TEST_CREDENTIALS.guardian.username,
      TEST_CREDENTIALS.guardian.password,
      'Guardian'
    )
  };

  // Verify sessions
  if (results.admin.success) {
    await verifySession(results.admin.token);
  }
  if (results.guardian.success) {
    await verifySession(results.guardian.token);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test Results Summary');
  console.log(`${'='.repeat(60)}`);
  console.log(`Admin Login: ${results.admin.success ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Guardian Login: ${results.guardian.success ? '✅ PASSED' : '❌ FAILED'}`);

  const allPassed = results.admin.success && results.guardian.success;
  console.log(`\nOverall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  return results;
}

// Run tests
runTests()
  .then((results) => {
    const allPassed = results.admin.success && results.guardian.success;
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
