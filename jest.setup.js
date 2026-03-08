// Jest setup file
process.env.DB_SUPPRESS_POOL_LOGS = 'true';

const { initializeDatabase } = require('./setup_database');
const db = require('./db');

beforeAll(async () => {
  // Initialize database without closing the pool (silent mode for tests)
  await initializeDatabase({ closePool: false, silent: true });
}, 30000);

/**
 * Global test cleanup to prevent resource leaks
 */

// Clean up intervals after each test
afterEach(() => {
  // Clear any pending intervals
  const intervalIds = setInterval(() => {}, 0);
  for (let i = 1; i <= intervalIds; i++) {
    clearInterval(i);
  }

  // Clear timeouts
  const timeoutIds = setTimeout(() => {}, 0);
  for (let i = 1; i <= timeoutIds; i++) {
    clearTimeout(i);
  }
});

// Clean up after all tests
afterAll(async () => {
  try {
    // Allow pool remove-event logs to flush before jest tears down console
    await new Promise((resolve) => setTimeout(resolve, 25));
    await db.end();
  } catch (_error) {
    // Ignore close errors during test teardown
  }
});
