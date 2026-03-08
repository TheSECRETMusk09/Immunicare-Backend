/**
 * Quick Diagnostic Script
 * Tests server connectivity and CORS configuration
 */

const http = require('http');

console.log('='.repeat(60));
console.log('QUICK DIAGNOSTIC SCRIPT');
console.log('='.repeat(60));

// Test 1: Check if server is listening
console.log('\n--- Test 1: Server Connectivity ---');
const req = http.get('http://localhost:5000/api/health', (res) => {
  console.log(`✓ Server is responding! Status: ${res.statusCode}`);

  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('✓ Response:', JSON.stringify(json, null, 2));
      checkCORSHeaders(res.headers);
    } catch (e) {
      console.log('✗ Invalid JSON response');
    }

    // Test 2: Test auth verify endpoint
    console.log('\n--- Test 2: Auth Verify Endpoint ---');
    testAuthVerify();
  });
});

req.on('error', (err) => {
  console.log(`✗ Connection failed: ${err.message}`);
  console.log('\nPossible causes:');
  console.log('  1. Server is not running');
  console.log('  2. Server is not listening on port 5000');
  console.log('  3. Firewall is blocking the connection');
  console.log('  4. Port 5000 is in use by another process');

  // Still try to test the endpoint
  console.log('\n--- Test 2: Auth Verify Endpoint (Attempting) ---');
  testAuthVerify();
});

req.setTimeout(5000, () => {
  console.log('\n✗ Request timed out - server may be hanging');
  req.destroy();
});

function checkCORSHeaders(headers) {
  console.log('\n--- CORS Header Check ---');
  const corsHeaders = [
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers'
  ];

  corsHeaders.forEach((header) => {
    if (headers[header]) {
      console.log(`✓ ${header}: ${headers[header]}`);
    } else {
      console.log(`✗ ${header}: MISSING`);
    }
  });
}

function testAuthVerify() {
  const authReq = http.get('http://localhost:5000/api/auth/verify', (res) => {
    console.log(`✓ Auth verify endpoint responding! Status: ${res.statusCode}`);

    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log('✓ Response:', JSON.stringify(json, null, 2));
      } catch (e) {
        console.log('Response:', data);
      }

      console.log('\n' + '='.repeat(60));
      console.log('DIAGNOSTIC COMPLETE');
      console.log('='.repeat(60));
    });
  });

  authReq.on('error', (err) => {
    console.log(`✗ Auth verify failed: ${err.message}`);
    console.log('\n' + '='.repeat(60));
    console.log('DIAGNOSTIC COMPLETE');
    console.log('='.repeat(60));
  });

  authReq.setTimeout(5000, () => {
    console.log('\n✗ Auth verify request timed out');
    authReq.destroy();
  });
}
