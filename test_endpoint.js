const axios = require('axios');

const API_URL = 'http://localhost:5000/api';

async function testEndpoint() {
  try {
    // First, login to get token
    console.log('Logging in...');
    const loginResponse = await axios.post(
      `${API_URL}/auth/login`,
      {
        username: 'carmen.lim@email.com',
        password: '12345678'
      },
      {
        withCredentials: true
      }
    );

    console.log('Login status:', loginResponse.status);
    const token = loginResponse.data.token;
    console.log('Token received:', token ? 'Yes' : 'No');

    // Now test the appointments endpoint
    console.log('\nTesting /dashboard/guardian/6/appointments...');
    const appointmentsResponse = await axios.get(
      `${API_URL}/dashboard/guardian/6/appointments?limit=5`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        withCredentials: true
      }
    );

    console.log('Appointments status:', appointmentsResponse.status);
    console.log('Appointments data:', JSON.stringify(appointmentsResponse.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testEndpoint();
