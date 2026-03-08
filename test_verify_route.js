/**
 * Auth Verify Route Test Script
 * Tests the /api/auth/verify endpoint
 */

const http = require('http');

console.log('='.repeat(60));
console.log('AUTH VERIFY ROUTE TEST');
console.log('='.repeat(60));

// Test 1: Request without token
console.log('\n--- Test 1: Request without token ---');
testVerifyRequest(null);

// Test 2: Request with invalid token
console.log('\n--- Test 2: Request with invalid token ---');
testVerifyRequest('invalid-token');

// Test 3: Request with malformed Authorization header
console.log('\n--- Test 3: Request with malformed Authorization header ---');
testVerifyRequest('Bearer', 'Bearer');

function testVerifyRequest(token, authType = 'Bearer') {
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/verify',
    method: 'GET',
    headers: {
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/json'
    }
  };

  if (token) {
    options.headers['Authorization'] = `${authType} ${token}`;
  }

  const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
    console.log('\nResponse Headers:');
    Object.keys(res.headers).forEach((key) => {
      console.log(`  ${key}: ${res.headers[key]}`);
    });

    // Check CORS headers
    console.log('\nCORS Header Check:');
    const allowOrigin = res.headers['access-control-allow-origin'];
    if (allowOrigin) {
      console.log(`  ✓ Access-Control-Allow-Origin: ${allowOrigin}`);
    } else {
      console.log('  ✗ Access-Control-Allow-Origin: MISSING');
    }

    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log('\nResponse Body:');
      try {
        const json = JSON.parse(data);
        console.log(JSON.stringify(json, null, 2));

        // Analyze response
        console.log('\nResponse Analysis:');
        if (res.statusCode === 200) {
          console.log('  ✓ Route is accessible and working');
          if (json.authenticated === true) {
            console.log('  ✓ Authentication successful');
          } else {
            console.log('  ✗ Authentication failed');
          }
        } else if (res.statusCode === 401) {
          console.log('  ✓ Route is accessible (401 is expected for invalid/no token)');
        } else if (res.statusCode === 404) {
          console.log('  ✗ Route not found (404 error)');
        } else {
          console.log(`  ? Unexpected status code: ${res.statusCode}`);
        }
      } catch (e) {
        console.log(data);
      }
    });
  });

  req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
    console.error('  ✗ Cannot connect to server');
  });

  req.end();
}

console.log('\n' + '='.repeat(60));
console.log('Tests completed. Review results above.');
console.log('='.repeat(60));
