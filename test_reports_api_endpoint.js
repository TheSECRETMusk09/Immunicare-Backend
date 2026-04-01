require('dotenv').config({ path: '.env.development' });
require('dotenv').config();

const axios = require('axios');

async function testReportsAPI() {
  console.log('Testing Reports API Endpoint...\n');

  try {
    // Simulate the exact API call the frontend makes
    const response = await axios.get('http://localhost:5000/api/reports/admin/summary', {
      headers: {
        'Content-Type': 'application/json',
      }
    });

    console.log('1. Response Status:', response.status);
    console.log('\n2. Response Data Structure:');
    console.log(JSON.stringify(response.data, null, 2));
    
    console.log('\n3. Checking infants data:');
    console.log('   response.data:', typeof response.data);
    console.log('   response.data.data:', typeof response.data.data);
    console.log('   response.data.infants:', response.data.infants);
    console.log('   response.data.data?.infants:', response.data.data?.infants);
    
    console.log('\n✅ Test complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', error.response.data);
    }
  }
}

testReportsAPI();
