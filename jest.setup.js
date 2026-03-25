require('./tests/setup/testEnv');

const { initializeDatabase } = require('./setup_database');
const db = require('./db');
const { seedTestAccounts } = require('./tests/setup/testDataSeeder');
const { createRefreshTokensTable } = require('./services/refreshTokenService');

beforeAll(async () => {
  if (process.env.SKIP_DB_BOOTSTRAP === 'true') {
    return;
  }
  await initializeDatabase({ closePool: false, silent: true });
  await createRefreshTokensTable();
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
