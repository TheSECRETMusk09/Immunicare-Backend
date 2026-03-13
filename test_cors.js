/**
 * CORS Test Script
 * Tests CORS headers for backend API endpoints
 */

const http = require('http');

console.log('='.repeat(60));
console.log('CORS TEST SCRIPT');
console.log('='.repeat(60));

// Test 1: OPTIONS request to /api/health
console.log('\n--- Test 1: OPTIONS /api/health ---');
testOptionsRequest('/api/health', 'http://localhost:3000');

// Test 2: OPTIONS request to /api/auth/verify
console.log('\n--- Test 2: OPTIONS /api/auth/verify ---');
testOptionsRequest('/api/auth/verify', 'http://localhost:3000');

// Test 3: GET request to /api/health
console.log('\n--- Test 3: GET /api/health ---');
testGetRequest('/api/health', 'http://localhost:3000');

// Test 4: GET request to /api/auth/verify (without token)
console.log('\n--- Test 4: GET /api/auth/verify (no token) ---');
testGetRequest('/api/auth/verify', 'http://localhost:3000');

function testOptionsRequest(path, origin) {
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: path,
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type, Authorization'
    },
  };

  const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
    console.log('\nResponse Headers:');
    Object.keys(res.headers).forEach((key) => {
      console.log(`  ${key}: ${res.headers[key]}`);
    });

    // Check for required CORS headers
    console.log('\nCORS Header Check:');
    checkCORSHeaders(res.headers, origin);

    res.on('data', (d) => {
      if (d.length > 0) {
        console.log('\nResponse Body:', d.toString());
      }
    });
  });

  req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
  });

  req.end();
}

function testGetRequest(path, origin) {
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: path,
    method: 'GET',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json'
    }
  };

  const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
    console.log('\nResponse Headers:');
    Object.keys(res.headers).forEach((key) => {
      console.log(`  ${key}: ${res.headers[key]}`);
    });

    // Check for required CORS headers
    console.log('\nCORS Header Check:');
    checkCORSHeaders(res.headers, origin);

    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      if (data.length > 0) {
        console.log('\nResponse Body:');
        try {
          const json = JSON.parse(data);
          console.log(JSON.stringify(json, null, 2));
        } catch (e) {
          console.log(data);
        }
      }
    });
  });

  req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
  });

  req.end();
}

function checkCORSHeaders(headers, origin) {
  const requiredHeaders = [
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers'
  ];

  requiredHeaders.forEach((header) => {
    const value = headers[header];
    if (value) {
      console.log(`  ✓ ${header}: ${value}`);
    } else {
      console.log(`  ✗ ${header}: MISSING`);
    }
  });

  // Check if origin is allowed
  const allowOrigin = headers['access-control-allow-origin'];
  if (allowOrigin) {
    if (allowOrigin === '*' || allowOrigin === origin) {
      console.log(`  ✓ Origin "${origin}" is allowed`);
    } else {
      console.log(`  ✗ Origin "${origin}" is NOT allowed (got: ${allowOrigin})`);
    }
  } else {
    console.log('  ✗ Access-Control-Allow-Origin header is missing');
  }
}

console.log('\n' + '='.repeat(60));
console.log('Tests completed. Review results above.');
console.log('='.repeat(60));
