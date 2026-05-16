require('path');

// Override console methods to capture all output
const originalLog = console.log;
const originalError = console.error;

console.log = function (...args) {
  process.stdout.write(
    args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ') +
      '\n'
  );
  originalLog.apply(console, args);
};

console.error = function (...args) {
  process.stderr.write(
    args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ') +
      '\n'
  );
  originalError.apply(console, args);
};

// Catch all errors
process.on('uncaughtException', (err) => {
  console.error('\n❌ UNCAUGHT EXCEPTION:');
  console.error('Message:', err.message);
  console.error('Stack:', err.stack);
  if (err.code) {
    console.error('Code:', err.code);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

console.log('🔍 Verifying backend routes...\n');

// Test importing each route individually
const routesToTest = [
  { name: 'auth', path: './routes/auth' },
  { name: 'users', path: './routes/users' },
  { name: 'dashboard', path: './routes/dashboard' },
  { name: 'announcements', path: './routes/announcements' },
  { name: 'infants', path: './routes/infants' },
  { name: 'vaccinations', path: './routes/vaccinations' },
  { name: 'vaccination-management', path: './routes/vaccination-management' },
  { name: 'appointments', path: './routes/appointments' },
  { name: 'messages', path: './routes/messages' },
  { name: 'reports', path: './routes/reports' },
  { name: 'notifications', path: './routes/notifications' },
  { name: 'notifications-enhanced', path: './routes/notifications-enhanced' },
  { name: 'growth', path: './routes/growth' },
  { name: 'documents', path: './routes/documents' },
  { name: 'paper-templates', path: './routes/paper-templates' },
  { name: 'analytics', path: './routes/analytics' },
  { name: 'settings', path: './routes/settings' },
  { name: 'monitoring', path: './routes/monitoring' },
  { name: 'uploads', path: './routes/uploads' },
  { name: 'reports-enhanced', path: './routes/reports-enhanced' },
  { name: 'inventory', path: './routes/inventory' },
];

const failedRoutes = [];

for (const route of routesToTest) {
  try {
    require(route.path);
    console.log(`✅ ${route.name}`);
  } catch (err) {
    console.error(`❌ ${route.name}: ${err.message}`);
    failedRoutes.push({ name: route.name, error: err.message, stack: err.stack });
  }
}

// Check specific middleware
console.log('\n📦 Testing middleware...');
const middlewareToTest = [
  { name: 'auth', path: './middleware/auth' },
  { name: 'rateLimiter', path: './middleware/rateLimiter' },
  { name: 'bruteForceProtection', path: './middleware/bruteForceProtection' },
  { name: 'cache', path: './middleware/cache' },
  { name: 'sanitization', path: './middleware/sanitization' },
];

for (const mw of middlewareToTest) {
  try {
    require(mw.path);
    console.log(`✅ ${mw.name}`);
  } catch (err) {
    console.error(`❌ ${mw.name}: ${err.message}`);
    failedRoutes.push({ name: mw.name, error: err.message });
  }
}

// Check services
console.log('\n⚙️ Testing services...');
const servicesToTest = [
  { name: 'socketService', path: './services/socketService' },
  { name: 'notificationService', path: './services/notificationService' },
  { name: 'emailService', path: './services/emailService' },
];

for (const svc of servicesToTest) {
  try {
    require(svc.path);
    console.log(`✅ ${svc.name}`);
  } catch (err) {
    console.error(`❌ ${svc.name}: ${err.message}`);
    failedRoutes.push({ name: svc.name, error: err.message });
  }
}

console.log('\n' + '='.repeat(50));
if (failedRoutes.length > 0) {
  console.log(`\n❌ ${failedRoutes.length} module(s) failed to load:`);
  failedRoutes.forEach((r) => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
} else {
  console.log('\n✅ All modules loaded successfully!');
  process.exit(0);
}
