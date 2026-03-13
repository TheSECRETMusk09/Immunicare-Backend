const http = require('http');

// Function to make GET request
function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:5000${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

// Test function
async function runTests() {
  console.log('=== Testing Vaccination Management API ===\n');

  const tests = [
    {
      name: 'Root endpoint',
      path: '/api/vaccination-management',
    },
    {
      name: 'Dashboard statistics',
      path: '/api/vaccination-management/dashboard',
    },
    {
      name: 'Patients list',
      path: '/api/vaccination-management/patients',
    },
    {
      name: 'Inventory list',
      path: '/api/vaccination-management/inventory',
    },
    {
      name: 'Appointments list (with filters)',
      path: '/api/vaccination-management/appointments?limit=5&offset=0',
    },
    {
      name: 'Vaccinations list',
      path: '/api/vaccination-management/vaccinations',
    },
  ];

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    console.log(`[${i + 1}/${tests.length}] Testing ${test.name}...`);

    try {
      const result = await makeRequest(test.path);
      console.log(`✅ Success - Status: ${result.status}`);

      if (typeof result.data === 'object') {
        // Check if we have data in response
        if (result.data.success === true) {
          const keys = Object.keys(result.data);
          for (const key of keys) {
            if (Array.isArray(result.data[key])) {
              console.log(`   ${key}: ${result.data[key].length} items`);
            } else if (typeof result.data[key] === 'object') {
              console.log(`   ${key}: ${Object.keys(result.data[key]).length} properties`);
            }
          }
        }
      } else {
        console.log(`   Response: ${result.data.substring(0, 100)}...`);
      }
      console.log();
    } catch (error) {
      console.log(`❌ Error - ${error.message}`);
      console.log();
    }
  }
}

runTests().catch(console.error);
