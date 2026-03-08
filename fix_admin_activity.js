/**
 * Fix admin_activity_log table
 * Creates the missing table for admin activity logging
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!'
});

async function fixAdminActivityTable() {
  console.log('=== Fixing admin_activity_log table ===\n');

  try {
    // Create admin_activity_log table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_activity_log (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action VARCHAR(100) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ admin_activity_log table created/verified');

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_activity_log_admin_id ON admin_activity_log(admin_id);
      CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action ON admin_activity_log(action);
      CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created_at ON admin_activity_log(created_at);
    `);
    console.log('✅ Indexes created/verified');

    // Verify table exists
    const tableCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'admin_activity_log'
    `);

    if (tableCheck.rows.length > 0) {
      console.log('✅ Table verified: admin_activity_log exists\n');
    }

    console.log('=== Fix completed successfully ===');
  } catch (error) {
    console.error('❌ Error fixing admin_activity_log table:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixAdminActivityTable();
