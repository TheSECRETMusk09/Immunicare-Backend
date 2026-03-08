/**
 * Migration Script: Add force_password_change support
 *
 * This script applies the necessary database changes to support
 * the mandatory password change feature for new guardian accounts.
 */

const pool = require('../db');

async function applyMigration() {
  const client = await pool.connect();

  try {
    console.log('Starting migration: Add force_password_change support...');

    await client.query('BEGIN');

    // Check if force_password_change column exists
    const checkForcePasswordChange = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'force_password_change'
    `);

    if (checkForcePasswordChange.rows.length === 0) {
      console.log('Adding force_password_change column...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN force_password_change BOOLEAN NOT NULL DEFAULT false
      `);
      console.log('✓ force_password_change column added');
    } else {
      console.log('✓ force_password_change column already exists');
    }

    // Check if password_changed_at column exists
    const checkPasswordChangedAt = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'password_changed_at'
    `);

    if (checkPasswordChangedAt.rows.length === 0) {
      console.log('Adding password_changed_at column...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN password_changed_at TIMESTAMP WITH TIME ZONE
      `);
      console.log('✓ password_changed_at column added');
    } else {
      console.log('✓ password_changed_at column already exists');
    }

    // Create index for faster lookups
    console.log('Creating index for force_password_change...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_force_password_change 
      ON users(force_password_change) 
      WHERE force_password_change = true
    `);
    console.log('✓ Index created');

    // Update existing guardian users who have never changed their password
    console.log('Updating existing guardian accounts...');
    const updateResult = await client.query(`
      UPDATE users 
      SET force_password_change = true
      WHERE role_id IN (SELECT id FROM roles WHERE name = 'guardian')
        AND force_password_change = false
        AND password_changed_at IS NULL
        AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
      RETURNING id, username
    `);
    console.log(`✓ Updated ${updateResult.rowCount} guardian accounts to require password change`);

    // Add comments for documentation
    await client.query(`
      COMMENT ON COLUMN users.force_password_change IS 'Indicates if user must change password on next login (for new accounts or password resets)'
    `);
    await client.query(`
      COMMENT ON COLUMN users.password_changed_at IS 'Timestamp when the user last changed their password'
    `);
    console.log('✓ Added column comments');

    await client.query('COMMIT');

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Restart the backend server to apply changes');
    console.log('2. Test the password change flow with a guardian account');
    console.log('3. Verify that force_password_change is set correctly in the database');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackMigration() {
  const client = await pool.connect();

  try {
    console.log('Rolling back migration...');

    await client.query('BEGIN');

    // Remove columns
    await client.query(`
      ALTER TABLE users 
      DROP COLUMN IF EXISTS force_password_change
    `);
    console.log('✓ Removed force_password_change column');

    await client.query(`
      ALTER TABLE users 
      DROP COLUMN IF EXISTS password_changed_at
    `);
    console.log('✓ Removed password_changed_at column');

    await client.query('COMMIT');

    console.log('\n✅ Rollback completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Rollback failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if called directly
if (require.main === module) {
  const command = process.argv[2];

  if (command === 'rollback') {
    rollbackMigration()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    applyMigration()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  }
}

module.exports = { applyMigration, rollbackMigration };
