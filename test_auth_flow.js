const axios = require('axios');

// Test configuration
const API_BASE_URL = 'http://localhost:5000/api';
const ADMIN_CREDENTIALS = {
  email: 'admin',
  password: 'Admin2024!'
};

async function testAuthenticationFlow() {
  console.log('=== TESTING AUTHENTICATION FLOW ===\n');

  try {
    // Test 1: Health check
    console.log('1. Testing API health check...');
    const healthResponse = await axios.get(`${API_BASE_URL}/health`);
    console.log('✅ Health check successful:', healthResponse.data);

    // Test 2: Login
    console.log('\n2. Testing admin login...');
    const loginResponse = await axios.post(
      `${API_BASE_URL}/auth/login`,
      ADMIN_CREDENTIALS
    );
    console.log('✅ Login successful!');
    console.log('Token received:', loginResponse.data.token ? 'YES' : 'NO');
    console.log('User info:', loginResponse.data.user);

    const token = loginResponse.data.token;

    // Test 3: Dashboard stats (protected endpoint)
    console.log('\n3. Testing dashboard stats (protected endpoint)...');
    const statsResponse = await axios.get(`${API_BASE_URL}/dashboard/stats`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log('✅ Dashboard stats successful!');
    console.log('Stats data:', statsResponse.data);

    // Test 4: Dashboard infants (protected endpoint)
    console.log('\n4. Testing dashboard infants (protected endpoint)...');
    const infantsResponse = await axios.get(
      `${API_BASE_URL}/dashboard/infants`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    console.log('✅ Dashboard infants successful!');
    console.log('Infants count:', infantsResponse.data.length);

    // Test 5: Dashboard guardians (protected endpoint)
    console.log('\n5. Testing dashboard guardians (protected endpoint)...');
    const guardiansResponse = await axios.get(
      `${API_BASE_URL}/dashboard/guardians`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    console.log('✅ Dashboard guardians successful!');
    console.log('Guardians count:', guardiansResponse.data.length);

    // Test 6: Dashboard appointments (protected endpoint)
    console.log('\n6. Testing dashboard appointments (protected endpoint)...');
    const appointmentsResponse = await axios.get(
      `${API_BASE_URL}/dashboard/appointments`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    console.log('✅ Dashboard appointments successful!');
    console.log('Appointments count:', appointmentsResponse.data.length);

    console.log(
      '\n🎉 ALL TESTS PASSED! Authentication flow is working correctly.'
    );
  } catch (error) {
    console.error('\n❌ TEST FAILED:');

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Status Text:', error.response.statusText);
      console.error('Data:', error.response.data);
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Error:', error.message);
    }

    console.error('Config:', error.config);
  }
}

// Run the test
testAuthenticationFlow();
