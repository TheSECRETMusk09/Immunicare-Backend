require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!'
});

async function runMigration() {
  try {
    console.log('Applying guardian password migration...');
    console.log(`Database: ${process.env.DB_NAME || 'immunicare_dev'}`);
    console.log(`User: ${process.env.DB_USER || 'immunicare_dev'}`);

    await pool.query(`
      ALTER TABLE guardians ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    `);
    console.log('✓ Added password_hash column');

    await pool.query(`
      ALTER TABLE guardians ADD COLUMN IF NOT EXISTS is_password_set BOOLEAN DEFAULT FALSE;
    `);
    console.log('✓ Added is_password_set column');

    await pool.query(`
      ALTER TABLE guardians ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;
    `);
    console.log('✓ Added last_login column');

    await pool.query(`
      ALTER TABLE guardians ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
    `);
    console.log('✓ Added must_change_password column');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_guardians_password_lookup ON guardians(email);
    `);
    console.log('✓ Created index on email');

    console.log('\nMigration applied successfully!');
  } catch (error) {
    console.error('Migration error:', error.message);
  } finally {
    await pool.end();
  }
}

runMigration();
