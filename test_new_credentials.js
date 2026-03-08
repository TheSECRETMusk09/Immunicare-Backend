const axios = require('axios');

async function testAdminLogin() {
  try {
    console.log('Testing Admin Login with new credentials...');
    console.log('Username: admin');
    console.log('Password: Immunicare2026!');
    console.log('');

    const adminResponse = await axios.post('http://localhost:5000/api/auth/login', {
      username: 'admin',
      password: 'Immunicare2026!'
    });
    console.log('✅ Admin Login SUCCESS');
    console.log('User:', adminResponse.data.user);
    console.log('Token:', adminResponse.data.token ? 'Generated' : 'Missing');

    console.log('');
    console.log('Testing Administrator Login...');
    const adminUserResponse = await axios.post('http://localhost:5000/api/auth/login', {
      username: 'administrator',
      password: 'Immunicare2026!'
    });
    console.log('✅ Administrator Login SUCCESS');
    console.log('User:', adminUserResponse.data.user);
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

testAdminLogin();
