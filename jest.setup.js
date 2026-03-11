require('./tests/setup/testEnv');

const { initializeDatabase } = require('./setup_database');
const db = require('./db');
const { seedTestAccounts } = require('./tests/setup/testDataSeeder');

beforeAll(async () => {
  await initializeDatabase({ closePool: false, silent: true });
  await seedTestAccounts();
}, 45000);

afterAll(async () => {
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    await db.end();
  } catch (_error) {
    // Ignore close errors during test teardown
  }
});
