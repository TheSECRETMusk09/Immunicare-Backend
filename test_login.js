const axios = require('axios');

async function testLogin() {
  try {
    console.log('Testing login endpoint...');
    const response = await axios.post(
      'http://localhost:5000/api/auth/login',
      {
        username: 'maria.dela.cruz',
        password: 'Guardian123!'
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    console.log('Login successful:');
    console.log('Token:', response.data.token);
    console.log('User:', response.data.user);

    // Test the appointments endpoint
    console.log('\nTesting appointments endpoint...');
    const appointmentsResponse = await axios.get(
      'http://localhost:5000/api/dashboard/guardian/1/appointments',
      {
        headers: {
          Authorization: `Bearer ${response.data.token}`
        }
      }
    );

    console.log('Appointments data:');
    console.log(appointmentsResponse.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testLogin();
