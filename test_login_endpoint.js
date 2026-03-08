const axios = require('axios');

async function testLogin() {
  try {
    console.log('Testing Admin Login...');
    const adminResponse = await axios.post('http://localhost:5000/api/auth/login', {
      username: 'admin',
      password: 'Admin2024!'
    });
    console.log('✅ Admin Login SUCCESS');
    console.log('User:', adminResponse.data.user);
    console.log('Token:', adminResponse.data.token ? 'Generated' : 'Missing');
    console.log('');

    console.log('Testing Guardian Login...');
    const guardianResponse = await axios.post('http://localhost:5000/api/auth/login', {
      username: 'maria.dela.cruz',
      password: 'Guardian123!'
    });
    console.log('✅ Guardian Login SUCCESS');
    console.log('User:', guardianResponse.data.user);
    console.log('Token:', guardianResponse.data.token ? 'Generated' : 'Missing');
    console.log('');
  } catch (error) {
    console.log('❌ Login FAILED');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Error:', error.response.data);
    } else {
      console.log('Error:', error.message);
    }
  }
}

testLogin();
