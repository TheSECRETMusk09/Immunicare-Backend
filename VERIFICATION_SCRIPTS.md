# CORS and Route Verification Scripts

This document contains verification scripts to test CORS configuration and route accessibility.

## Script 1: CORS Test Script

Save this as `backend/test_cors.js`:

```javascript
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
      'Access-Control-Request-Headers': 'Content-Type, Authorization',
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
      'Content-Type': 'application/json',
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
    'access-control-allow-headers',
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
    console.log(`  ✗ Access-Control-Allow-Origin header is missing`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('Tests completed. Review results above.');
console.log('='.repeat(60));
```

### How to Run

```bash
cd backend
node test_cors.js
```

### Expected Output

For OPTIONS requests:

```
Status: 204 No Content
Response Headers:
  access-control-allow-origin: http://localhost:3000
  access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
  access-control-allow-headers: Content-Type, Authorization, x-csrf-token, Cache-Control, Pragma
  access-control-allow-credentials: true
  content-length: 0
  ...

CORS Header Check:
  ✓ access-control-allow-origin: http://localhost:3000
  ✓ access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
  ✓ access-control-allow-headers: Content-Type, Authorization, x-csrf-token, Cache-Control, Pragma
  ✓ Origin "http://localhost:3000" is allowed
```

For GET requests:

```
Status: 200 OK
Response Headers:
  access-control-allow-origin: http://localhost:3000
  access-control-allow-credentials: true
  content-type: application/json
  ...

CORS Header Check:
  ✓ access-control-allow-origin: http://localhost:3000
  ✓ Origin "http://localhost:3000" is allowed

Response Body:
{
  "status": "OK",
  "timestamp": "2026-01-31T09:00:00.000Z",
  "service": "Immunicare Backend API",
  "version": "1.0.0"
}
```

---

## Script 2: Route Verification Script

Save this as `backend/test_routes.js`:

```javascript
/**
 * Route Verification Script
 * Verifies that all routes are properly registered
 */

const express = require('express');
const app = express();

console.log('='.repeat(60));
console.log('ROUTE VERIFICATION SCRIPT');
console.log('='.repeat(60));

// Load all routes
console.log('\nLoading routes...');
try {
  app.use('/api/auth', require('./routes/auth'));
  console.log('✓ Auth routes loaded');
} catch (e) {
  console.error('✗ Auth routes failed:', e.message);
}

try {
  app.use('/api/dashboard', require('./routes/dashboard'));
  console.log('✓ Dashboard routes loaded');
} catch (e) {
  console.error('✗ Dashboard routes failed:', e.message);
}

try {
  app.use('/api/users', require('./routes/users'));
  console.log('✓ Users routes loaded');
} catch (e) {
  console.error('✗ Users routes failed:', e.message);
}

try {
  app.use('/api/infants', require('./routes/infants'));
  console.log('✓ Infants routes loaded');
} catch (e) {
  console.error('✗ Infants routes failed:', e.message);
}

try {
  app.use('/api/vaccinations', require('./routes/vaccinations'));
  console.log('✓ Vaccinations routes loaded');
} catch (e) {
  console.error('✗ Vaccinations routes failed:', e.message);
}

try {
  app.use('/api/inventory', require('./routes/inventory'));
  console.log('✓ Inventory routes loaded');
} catch (e) {
  console.error('✗ Inventory routes failed:', e.message);
}

try {
  app.use('/api/appointments', require('./routes/appointments'));
  console.log('✓ Appointments routes loaded');
} catch (e) {
  console.error('✗ Appointments routes failed:', e.message);
}

try {
  app.use('/api/announcements', require('./routes/announcements'));
  console.log('✓ Announcements routes loaded');
} catch (e) {
  console.error('✗ Announcements routes failed:', e.message);
}

try {
  app.use('/api/growth', require('./routes/growth'));
  console.log('✓ Growth routes loaded');
} catch (e) {
  console.error('✗ Growth routes failed:', e.message);
}

try {
  app.use('/api/documents', require('./routes/documents'));
  console.log('✓ Documents routes loaded');
} catch (e) {
  console.error('✗ Documents routes failed:', e.message);
}

try {
  app.use('/api/paper-templates', require('./routes/paper-templates'));
  console.log('✓ Paper templates routes loaded');
} catch (e) {
  console.error('✗ Paper templates routes failed:', e.message);
}

try {
  app.use('/api/analytics', require('./routes/analytics'));
  console.log('✓ Analytics routes loaded');
} catch (e) {
  console.error('✗ Analytics routes failed:', e.message);
}

try {
  app.use('/api/settings', require('./routes/settings'));
  console.log('✓ Settings routes loaded');
} catch (e) {
  console.error('✗ Settings routes failed:', e.message);
}

try {
  app.use('/api/monitoring', require('./routes/monitoring'));
  console.log('✓ Monitoring routes loaded');
} catch (e) {
  console.error('✗ Monitoring routes failed:', e.message);
}

try {
  app.use('/api/uploads', require('./routes/uploads'));
  console.log('✓ Uploads routes loaded');
} catch (e) {
  console.error('✗ Uploads routes failed:', e.message);
}

try {
  app.use('/api/messages', require('./routes/messages'));
  console.log('✓ Messages routes loaded');
} catch (e) {
  console.error('✗ Messages routes failed:', e.message);
}

try {
  app.use('/api/reports', require('./routes/reports'));
  console.log('✓ Reports routes loaded');
} catch (e) {
  console.error('✗ Reports routes failed:', e.message);
}

try {
  app.use('/api/reports-enhanced', require('./routes/reports-enhanced'));
  console.log('✓ Reports enhanced routes loaded');
} catch (e) {
  console.error('✗ Reports enhanced routes failed:', e.message);
}

try {
  app.use('/api/notifications', require('./routes/notifications'));
  console.log('✓ Notifications routes loaded');
} catch (e) {
  console.error('✗ Notifications routes failed:', e.message);
}

try {
  app.use('/api/notifications-enhanced', require('./routes/notifications-enhanced'));
  console.log('✓ Notifications enhanced routes loaded');
} catch (e) {
  console.error('✗ Notifications enhanced routes failed:', e.message);
}

try {
  app.use('/api/vaccination-management', require('./routes/vaccination-management'));
  console.log('✓ Vaccination management routes loaded');
} catch (e) {
  console.error('✗ Vaccination management routes failed:', e.message);
}

// Print all registered routes
console.log('\n' + '='.repeat(60));
console.log('REGISTERED ROUTES');
console.log('='.repeat(60));

let routeCount = 0;

function printRoutes(stack, prefix = '') {
  stack.forEach((middleware) => {
    if (middleware.route) {
      const methods = Object.keys(middleware.route.methods).join(', ').toUpperCase();
      console.log(`${prefix}${middleware.route.path} [${methods}]`);
      routeCount++;
    } else if (middleware.name === 'router') {
      console.log(`\n${prefix}Router: ${middleware.regexp}`);
      printRoutes(middleware.handle.stack, prefix + '  ');
    }
  });
}

printRoutes(app._router.stack);

console.log('\n' + '='.repeat(60));
console.log(`Total routes: ${routeCount}`);
console.log('='.repeat(60));

// Check for specific routes
console.log('\n' + '='.repeat(60));
console.log('ROUTE AVAILABILITY CHECK');
console.log('='.repeat(60));

const criticalRoutes = [
  '/api/auth/login',
  '/api/auth/verify',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/health',
];

criticalRoutes.forEach((route) => {
  const found = checkRouteExists(app, route);
  if (found) {
    console.log(`✓ ${route} - EXISTS`);
  } else {
    console.log(`✗ ${route} - NOT FOUND`);
  }
});

function checkRouteExists(app, path) {
  const stack = app._router.stack;
  for (const middleware of stack) {
    if (middleware.route && middleware.route.path === path) {
      return true;
    }
    if (middleware.name === 'router') {
      const routeStack = middleware.handle.stack;
      for (const route of routeStack) {
        if (route.route) {
          const fullPath = middleware.regexp.toString().includes(path.split('/')[2]) ? path : null;
          if (fullPath === path) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

console.log('\n' + '='.repeat(60));
console.log('Verification completed.');
console.log('='.repeat(60));
```

### How to Run

```bash
cd backend
node test_routes.js
```

### Expected Output

```
============================================================
ROUTE VERIFICATION SCRIPT
============================================================

Loading routes...
✓ Auth routes loaded
✓ Dashboard routes loaded
✓ Users routes loaded
...

============================================================
REGISTERED ROUTES
============================================================
/api/auth/login [POST]
/api/auth/verify [GET]
/api/auth/refresh [POST]
/api/auth/logout [POST]
/api/auth/register/guardian [POST]
/api/auth/verify-email [POST]
/api/auth/forgot-password [POST]
/api/auth/reset-password [POST]
/api/auth/change-password [POST]
/api/auth/sessions [GET]
/api/auth/sessions/:id [DELETE]
/api/auth/sessions [DELETE]
/api/auth/test [GET]
...

============================================================
Total routes: 150
============================================================

============================================================
ROUTE AVAILABILITY CHECK
============================================================
✓ /api/auth/login - EXISTS
✓ /api/auth/verify - EXISTS
✓ /api/auth/refresh - EXISTS
✓ /api/auth/logout - EXISTS
✓ /api/health - EXISTS

============================================================
Verification completed.
============================================================
```

---

## Script 3: Auth Verify Route Test

Save this as `backend/test_verify_route.js`:

```javascript
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
      'Content-Type': 'application/json',
    },
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
      console.log(`  ✗ Access-Control-Allow-Origin: MISSING`);
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
```

### How to Run

```bash
cd backend
node test_verify_route.js
```

### Expected Output

```
============================================================
AUTH VERIFY ROUTE TEST
============================================================

--- Test 1: Request without token ---
Status: 401 Unauthorized
Response Headers:
  access-control-allow-origin: http://localhost:3000
  access-control-allow-credentials: true
  content-type: application/json
  ...

CORS Header Check:
  ✓ Access-Control-Allow-Origin: http://localhost:3000

Response Body:
{
  "error": "No token provided",
  "code": "NO_TOKEN",
  "authenticated": false
}

Response Analysis:
  ✓ Route is accessible (401 is expected for invalid/no token)

--- Test 2: Request with invalid token ---
Status: 401 Unauthorized
Response Headers:
  access-control-allow-origin: http://localhost:3000
  access-control-allow-credentials: true
  content-type: application/json
  ...

CORS Header Check:
  ✓ Access-Control-Allow-Origin: http://localhost:3000

Response Body:
{
  "error": "Session verification failed",
  "code": "VERIFICATION_ERROR",
  "authenticated": false
}

Response Analysis:
  ✓ Route is accessible (401 is expected for invalid/no token)

============================================================
Tests completed. Review results above.
============================================================
```

---

## Summary

These verification scripts will help you:

1. **test_cors.js**: Verify that CORS headers are being set correctly for all endpoints
2. **test_routes.js**: Verify that all routes are properly registered and accessible
3. **test_verify_route.js**: Specifically test the `/api/auth/verify` endpoint

Run these scripts after implementing the fixes to verify that the CORS and 404 errors have been resolved.
