const pool = require('./db');

async function runMigration() {
  try {
    // Add notification_settings column if it doesn't exist
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'notification_settings'
    `);

    if (checkResult.rows.length === 0) {
      await pool.query(`
        ALTER TABLE users ADD COLUMN notification_settings JSONB DEFAULT '{}'::jsonb
      `);
      console.log('Added notification_settings column to users table');

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_users_notification_settings 
        ON users USING gin (notification_settings)
      `);
      console.log('Created index for notification_settings');
    } else {
      console.log('notification_settings column already exists');
    }

    // Check and add email column to admin_users if needed
    const adminCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'admin_users' AND column_name = 'email'
    `);

    if (adminCheck.rows.length === 0) {
      await pool.query(`
        ALTER TABLE admin_users ADD COLUMN email VARCHAR(255)
      `);
      console.log('Added email column to admin_users table');
    } else {
      console.log('email column already exists in admin_users');
    }

    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
