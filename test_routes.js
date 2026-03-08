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
  '/api/health'
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
