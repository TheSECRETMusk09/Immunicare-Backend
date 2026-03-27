const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';

async function testLoginAPI() {
  console.log('Testing login API with correct credentials...\n');
  
  const tests = [
    {
      name: 'Admin with username',
      credentials: { username: 'defense.admin', password: 'AdminDemo2026!' }
    },
    {
      name: 'Admin with email',
      credentials: { username: 'defense.admin@demo-immunicare.ph', password: 'AdminDemo2026!' }
    },
    {
      name: 'Guardian with username',
      credentials: { username: 'demo.guardian.0001', password: 'GuardianDemo2026!' }
    },
    {
      name: 'Guardian with email',
      credentials: { username: 'carlo.torres.0001@demo-immunicare.ph', password: 'GuardianDemo2026!' }
    }
  ];
  
  for (const test of tests) {
    console.log(`Testing: ${test.name}`);
    console.log(`  Credentials: ${JSON.stringify(test.credentials)}`);
    
    try {
      const response = await axios.post(`${BASE_URL}/auth/login`, test.credentials, {
        timeout: 10000,
        validateStatus: () => true,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`  Status: ${response.status}`);
      console.log(`  Response:`, JSON.stringify(response.data, null, 2));
      
      if (response.status === 200 && response.data.success) {
        console.log(`  ✅ SUCCESS!`);
        console.log(`  Token: ${response.data.token.substring(0, 30)}...`);
        console.log(`  User: ${response.data.user.username} (${response.data.user.role})`);
      } else {
        console.log(`  ❌ FAILED`);
      }
    } catch (error) {
      console.log(`  ❌ ERROR: ${error.message}`);
    }
    
    console.log('');
  }
}

testLoginAPI();
