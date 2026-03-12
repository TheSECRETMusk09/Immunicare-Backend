/**
 * Debug Startup Script
 * Tests the server startup process to identify any blocking issues
 */

console.log('='.repeat(60));
console.log('DEBUG SERVER STARTUP');
console.log('='.repeat(60));
console.log('Starting at:', new Date().toISOString());

const startTime = Date.now();

// Track module loading times
const moduleTimes = {};

function timeModuleLoad(name, loadFn) {
  const start = Date.now();
  try {
    const result = loadFn();
    const elapsed = Date.now() - start;
    moduleTimes[name] = elapsed;
    console.log(`✓ ${name} loaded in ${elapsed}ms`);
    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    moduleTimes[name] = elapsed;
    console.error(`✗ ${name} failed after ${elapsed}ms:`, error.message);
    throw error;
  }
}

// Step 1: Load environment variables
console.log('\n--- Step 1: Loading Environment Variables ---');
timeModuleLoad('dotenv', () => {
  require('dotenv').config();
  return true;
});

// Step 2: Test database connection
console.log('\n--- Step 2: Testing Database Connection ---');
let pool;
try {
  pool = timeModuleLoad('pg-pool', () => {
    const { Pool } = require('pg');
    return new Pool({
      user: process.env.DB_USER || 'immunicare_dev',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'immunicare_db',
      password: process.env.DB_PASSWORD || '',
      port: parseInt(process.env.DB_PORT) || 5432,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000
    });
  });

  // Test a simple query
  const dbStart = Date.now();
  pool
    .query('SELECT NOW() as current_time, version() as db_version')
    .then((result) => {
      console.log(`✓ Database query successful in ${Date.now() - dbStart}ms`);
      console.log('  Current time:', result.rows[0].current_time);
      console.log(
        '  DB Version:',
        result.rows[0].db_version.split(' ')[0] + ' ' + result.rows[0].db_version.split(' ')[1]
      );
    })
    .catch((err) => {
      console.error('✗ Database query failed:', err.message);
    });
} catch (error) {
  console.error('✗ Database connection failed:', error.message);
}

// Step 3: Test key middleware loading
console.log('\n--- Step 3: Testing Middleware Loading ---');
const middlewares = ['express', 'cors', 'helmet', 'express-rate-limit', 'compression', 'morgan'];

middlewares.forEach((mw) => {
  try {
    timeModuleLoad(mw, () => require(mw));
  } catch (error) {
    console.error(`  Note: ${mw} may be optional or already included`);
  }
});

// Step 4: Load custom middleware
console.log('\n--- Step 4: Loading Custom Middleware ---');
const customMiddlewares = [
  './middleware/sanitization',
  './middleware/rateLimiter',
  './middleware/cache',
  './middleware/bruteForceProtection'
];

customMiddlewares.forEach((mw) => {
  try {
    timeModuleLoad(mw, () => require(mw));
  } catch (error) {
    console.warn(`  Warning: ${mw} - ${error.message}`);
  }
});

// Step 5: Test Express app initialization
console.log('\n--- Step 5: Initializing Express App ---');
let app;
try {
  const express = require('express');
  app = express();

  // Apply basic middleware quickly (without delays)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Add health endpoint immediately
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  });

  console.log('✓ Express app initialized with health endpoint');
} catch (error) {
  console.error('✗ Express app initialization failed:', error.message);
}

// Step 6: Start server
console.log('\n--- Step 6: Starting Server ---');
const PORT = process.env.PORT || 5000;

if (app) {
  const server = app.listen(PORT, () => {
    const totalTime = Date.now() - startTime;
    console.log(`\n${'='.repeat(60)}`);
    console.log('SERVER STARTED SUCCESSFULLY!');
    console.log(`${'='.repeat(60)}`);
    console.log(`Port: ${PORT}`);
    console.log(`Total startup time: ${totalTime}ms`);
    console.log(`Health endpoint: http://localhost:${PORT}/api/health`);
    console.log('\nModule Load Times:');
    Object.entries(moduleTimes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, time]) => {
        console.log(`  ${name}: ${time}ms`);
      });
    console.log(`${'='.repeat(60)}`);

    // Close pool after a delay
    if (pool) {
      setTimeout(() => {
        pool.end();
        console.log('\nDatabase pool closed (test complete)');
      }, 2000);
    }
  });

  server.on('error', (err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });
} else {
  console.error('Cannot start server: Express app not initialized');
}
