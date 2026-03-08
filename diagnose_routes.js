/**
 * Route Diagnostic Script
 * Checks if routes are properly registered in the Express app
 */

const express = require('express');
const dashboardRoutes = require('./routes/dashboard');
const infantsRoutes = require('./routes/infants');
const notificationsRoutes = require('./routes/notifications');

console.log('========================================');
console.log('Route Diagnostic');
console.log('========================================\n');

// Check dashboard routes
console.log('Dashboard Routes:');
const app = express();
app.use('/api/dashboard', dashboardRoutes);

// Get all registered routes
app._router.stack.forEach((middleware) => {
  if (middleware.route) {
    console.log(`  ${middleware.route.stack[0].method.toUpperCase()} ${middleware.route.path}`);
  } else if (middleware.name === 'router') {
    middleware.handle.stack.forEach((handler) => {
      if (handler.route) {
        console.log(
          `  ${handler.route.stack[0].method.toUpperCase()} /api/dashboard${handler.route.path}`
        );
      }
    });
  }
});

console.log('\n========================================');
console.log('Infants Routes:');
const app2 = express();
app2.use('/api/infants', infantsRoutes);

app2._router.stack.forEach((middleware) => {
  if (middleware.route) {
    console.log(`  ${middleware.route.stack[0].method.toUpperCase()} ${middleware.route.path}`);
  } else if (middleware.name === 'router') {
    middleware.handle.stack.forEach((handler) => {
      if (handler.route) {
        console.log(
          `  ${handler.route.stack[0].method.toUpperCase()} /api/infants${handler.route.path}`
        );
      }
    });
  }
});

console.log('\n========================================');
console.log('Notifications Routes:');
const app3 = express();
app3.use('/api/notifications', notificationsRoutes);

app3._router.stack.forEach((middleware) => {
  if (middleware.route) {
    console.log(`  ${middleware.route.stack[0].method.toUpperCase()} ${middleware.route.path}`);
  } else if (middleware.name === 'router') {
    middleware.handle.stack.forEach((handler) => {
      if (handler.route) {
        console.log(
          `  ${handler.route.stack[0].method.toUpperCase()} /api/notifications${handler.route.path}`
        );
      }
    });
  }
});

console.log('\n========================================');
console.log('Diagnostic Complete');
console.log('========================================');
