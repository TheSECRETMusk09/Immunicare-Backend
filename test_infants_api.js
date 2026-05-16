/**
 * Test script to verify the infants API endpoint
 */

const http = require('http');

// Test login and then fetch infants
async function test() {
  console.log('Testing infants API...\n');

  // First, login to get a token
  const loginData = JSON.stringify({
    email: 'guardian@test.com',
    password: 'password123',
  });

  const loginOptions = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginData),
    },
  };

  return new Promise((resolve) => {
    const loginReq = http.request(loginOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        console.log('Login response status:', res.statusCode);
        try {
          const loginResult = JSON.parse(data);
          console.log('Login result:', JSON.stringify(loginResult, null, 2));

          if (loginResult.token) {
            // Now test the infants endpoint
            testInfantsEndpoint(loginResult.token, loginResult.user?.id);
          } else {
            console.log('\nNo token received. Trying with different credentials...');
            // Try to find existing guardian
            testInfantsWithExistingGuardian();
          }
          resolve();
        } catch (e) {
          console.error('Error parsing login response:', e.message);
          console.log('Raw response:', data);
          testInfantsWithExistingGuardian();
          resolve();
        }
      });
    });

    loginReq.on('error', (e) => {
      console.error('Login error:', e.message);
      testInfantsWithExistingGuardian();
      resolve();
    });

    loginReq.write(loginData);
    loginReq.end();
  });
}

async function testInfantsEndpoint(token, guardianId) {
  console.log('\n--- Testing infants endpoint ---');
  console.log('Using guardian ID:', guardianId);

  const options = {
    hostname: 'localhost',
    port: 5000,
    path: `/api/infants/guardian/${guardianId}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        console.log('Infants response status:', res.statusCode);
        try {
          const result = JSON.parse(data);
          console.log('Infants result:', JSON.stringify(result, null, 2));
        } catch (e) {
          console.error('Error parsing response:', e.message);
          console.log('Raw response:', data);
        }
        resolve();
      });
    });

    req.on('error', (e) => {
      console.error('Infants request error:', e.message);
      resolve();
    });

    req.end();
  });
}

async function testInfantsWithExistingGuardian() {
  // Use the pool to get a guardian
  const pool = require('./db');

  try {
    const result = await pool.query('SELECT id FROM guardians WHERE is_active = true LIMIT 1');
    if (result.rows.length > 0) {
      const guardianId = result.rows[0].id;
      console.log('\nFound guardian with ID:', guardianId);

      // Test the infants endpoint directly
      const options = {
        hostname: 'localhost',
        port: 5000,
        path: `/api/infants/guardian/${guardianId}`,
        method: 'GET',
        headers: {},
      };

      return new Promise((resolve) => {
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            console.log('Infants response status:', res.statusCode);
            try {
              const result = JSON.parse(data);
              console.log('Infants result:', JSON.stringify(result, null, 2));
            } catch (e) {
              console.error('Error parsing response:', e.message);
              console.log('Raw response:', data);
            }
            resolve();
          });
        });

        req.on('error', (e) => {
          console.error('Infants request error:', e.message);
          resolve();
        });

        req.end();
      });
    } else {
      console.log('No active guardians found in database');
    }
  } catch (e) {
    console.error('Database error:', e.message);
  }
}

test()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Test error:', e);
    process.exit(1);
  });
