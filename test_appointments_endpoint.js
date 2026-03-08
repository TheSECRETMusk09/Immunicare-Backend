const axios = require('axios');

async function testAppointmentsEndpoint() {
  try {
    console.log('Testing appointments endpoint...');

    // First, log in to get token
    const loginResponse = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'carmen.lim@email.com',
      password: '12345678'
    });

    const token = loginResponse.data.token;
    console.log('Login successful');

    // Test appointments endpoint
    const appointmentsResponse = await axios.get(
      'http://localhost:5000/api/dashboard/guardian/6/appointments',
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    console.log('Appointments response received');
    console.log('Status:', appointmentsResponse.status);
    console.log('Data:', appointmentsResponse.data);
  } catch (error) {
    console.error('Error:', error);
    console.error('Response data:', error.response?.data);
    console.error('Response status:', error.response?.status);
    console.error('Response headers:', error.response?.headers);
  }
}

testAppointmentsEndpoint();
