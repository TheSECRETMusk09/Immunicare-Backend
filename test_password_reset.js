const axios = require('axios');
const BASE_URL = 'http://localhost:5000/api/auth';

async function testPasswordReset() {
  console.log('Testing password reset functionality...');

  // Test 1: Request password reset for existing user
  try {
    const forgotResponse = await axios.post(`${BASE_URL}/forgot-password`, {
      username: 'admin'
    });
    console.log('1. Forgot password request:', forgotResponse.data.message);
  } catch (error) {
    console.error('1. Forgot password error:', error.response?.data || error.message);
  }

  // Test 2: Request password reset with missing username
  try {
    const forgotResponse = await axios.post(`${BASE_URL}/forgot-password`, {});
    console.log('2. Forgot password request (missing username):', forgotResponse.data.message);
  } catch (error) {
    console.error(
      '2. Forgot password error (missing username):',
      error.response?.data || error.message
    );
  }

  console.log('Password reset functionality tested');
}

testPasswordReset().catch(console.error);
