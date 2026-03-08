const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000/api';

// Test credentials
const GUARDIAN_CREDENTIALS = {
  email: 'maria.santos@email.com',
  password: 'guardian123'
};

const ADMIN_CREDENTIALS = {
  email: 'admin@immunicare.com',
  password: 'Admin2024!'
};

let guardianToken = null;
let guardianRefreshToken = null;
let guardianId = null;
let adminToken = null;

// Helper function to make API requests
async function apiRequest(endpoint, options = {}) {
  try {
    const response = await axios({
      url: `${API_BASE_URL}${endpoint}`,
      ...options,
      validateStatus: () => true // Don't throw on any status code
    });
    return response;
  } catch (error) {
    console.error(`Request failed for ${endpoint}:`, error.message);
    return { status: 500, data: { error: error.message } };
  }
}

// Test 1: Login as guardian
async function testGuardianLogin() {
  console.log('\n=== Test 1: Guardian Login ===');
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    data: GUARDIAN_CREDENTIALS,
    withCredentials: true
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 200 && response.data.token) {
    guardianToken = response.data.token;
    guardianRefreshToken = response.data.refreshToken;
    guardianId = response.data.user?.id || response.data.user?.guardian_id;
    console.log('✓ Guardian login successful');
    console.log('  Token:', guardianToken.substring(0, 50) + '...');
    console.log('  Guardian ID:', guardianId);
    return true;
  } else {
    console.log('✗ Guardian login failed');
    return false;
  }
}

// Test 2: Verify guardian session
async function testGuardianVerify() {
  console.log('\n=== Test 2: Guardian Session Verification ===');
  const response = await apiRequest('/auth/verify', {
    method: 'GET',
    headers: { Authorization: `Bearer ${guardianToken}` }
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 200) {
    console.log('✓ Guardian session verified');
    return true;
  } else {
    console.log('✗ Guardian session verification failed');
    return false;
  }
}

// Test 3: Refresh guardian token
async function testGuardianTokenRefresh() {
  console.log('\n=== Test 3: Guardian Token Refresh ===');
  const response = await apiRequest('/auth/refresh', {
    method: 'POST',
    data: { refreshToken: guardianRefreshToken },
    withCredentials: true
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 200 && response.data.token) {
    guardianToken = response.data.token;
    if (response.data.refreshToken) {
      guardianRefreshToken = response.data.refreshToken;
    }
    console.log('✓ Guardian token refresh successful');
    console.log('  New Token:', guardianToken.substring(0, 50) + '...');
    return true;
  } else {
    console.log('✗ Guardian token refresh failed');
    return false;
  }
}

// Test 4: Access guardian-specific stats
async function testGuardianStats() {
  console.log('\n=== Test 4: Guardian-Specific Stats ===');
  if (!guardianId) {
    console.log('✗ No guardian ID available');
    return false;
  }

  const response = await apiRequest(`/dashboard/guardian/${guardianId}/stats`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${guardianToken}` }
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 200) {
    console.log('✓ Guardian can access their own stats');
    return true;
  } else {
    console.log('✗ Guardian cannot access their own stats');
    return false;
  }
}

// Test 5: Access guardian-specific appointments
async function testGuardianAppointments() {
  console.log('\n=== Test 5: Guardian-Specific Appointments ===');
  if (!guardianId) {
    console.log('✗ No guardian ID available');
    return false;
  }

  const response = await apiRequest(`/dashboard/guardian/${guardianId}/appointments`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${guardianToken}` }
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 200) {
    console.log('✓ Guardian can access their own appointments');
    return true;
  } else {
    console.log('✗ Guardian cannot access their own appointments');
    return false;
  }
}

// Test 6: Guardian should NOT access admin dashboard stats
async function testGuardianAdminStatsAccess() {
  console.log('\n=== Test 6: Guardian Should NOT Access Admin Stats ===');
  const response = await apiRequest('/dashboard/stats', {
    method: 'GET',
    headers: { Authorization: `Bearer ${guardianToken}` }
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 403) {
    console.log('✓ Guardian correctly blocked from admin stats (403 Forbidden)');
    return true;
  } else {
    console.log('✗ Guardian should be blocked from admin stats but got status:', response.status);
    return false;
  }
}

// Test 7: Guardian should NOT access vaccine inventory
async function testGuardianInventoryAccess() {
  console.log('\n=== Test 7: Guardian Should NOT Access Vaccine Inventory ===');
  const response = await apiRequest('/inventory/vaccine-inventory', {
    method: 'GET',
    headers: { Authorization: `Bearer ${guardianToken}` }
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 403) {
    console.log('✓ Guardian correctly blocked from vaccine inventory (403 Forbidden)');
    return true;
  } else {
    console.log(
      '✗ Guardian should be blocked from vaccine inventory but got status:',
      response.status
    );
    return false;
  }
}

// Test 8: Login as admin
async function testAdminLogin() {
  console.log('\n=== Test 8: Admin Login ===');
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    data: ADMIN_CREDENTIALS,
    withCredentials: true
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 200 && response.data.token) {
    adminToken = response.data.token;
    console.log('✓ Admin login successful');
    console.log('  Token:', adminToken.substring(0, 50) + '...');
    return true;
  } else {
    console.log('✗ Admin login failed');
    return false;
  }
}

// Test 9: Admin should access dashboard stats
async function testAdminStatsAccess() {
  console.log('\n=== Test 9: Admin Should Access Dashboard Stats ===');
  const response = await apiRequest('/dashboard/stats', {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 200) {
    console.log('✓ Admin can access dashboard stats');
    return true;
  } else {
    console.log('✗ Admin cannot access dashboard stats');
    return false;
  }
}

// Test 10: Admin should access vaccine inventory
async function testAdminInventoryAccess() {
  console.log('\n=== Test 10: Admin Should Access Vaccine Inventory ===');
  const response = await apiRequest('/inventory/vaccine-inventory', {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(response.data, null, 2));

  if (response.status === 200) {
    console.log('✓ Admin can access vaccine inventory');
    return true;
  } else {
    console.log('✗ Admin cannot access vaccine inventory');
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('========================================');
  console.log('  Authentication & Permissions Test Suite');
  console.log('========================================');

  const results = [];

  // Guardian tests
  results.push(await testGuardianLogin());
  results.push(await testGuardianVerify());
  results.push(await testGuardianTokenRefresh());
  results.push(await testGuardianStats());
  results.push(await testGuardianAppointments());
  results.push(await testGuardianAdminStatsAccess());
  results.push(await testGuardianInventoryAccess());

  // Admin tests
  results.push(await testAdminLogin());
  results.push(await testAdminStatsAccess());
  results.push(await testAdminInventoryAccess());

  // Summary
  console.log('\n========================================');
  console.log('  Test Summary');
  console.log('========================================');
  const passed = results.filter((r) => r).length;
  const total = results.length;
  console.log(`Passed: ${passed}/${total}`);
  console.log(`Failed: ${total - passed}/${total}`);

  if (passed === total) {
    console.log('\n✓ All tests passed!');
  } else {
    console.log('\n✗ Some tests failed');
  }
}

// Run tests
runTests().catch(console.error);
