/**
 * Authentication System Database Migration
 * Creates tables for enhanced authentication features
 */

const pool = require('./db');

async function runMigration() {
  console.log('Starting authentication system database migration...');

  try {
    // Create password history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '1 year'
      );

      CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_password_history_expires_at ON password_history(expires_at);
    `);
    console.log('✓ Password history table created');

    // Create password reset tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
    `);
    console.log('✓ Password reset tokens table created');

    // Create email verification tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
    `);
    console.log('✓ Email verification tokens table created');

    // Create security events table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        event_type VARCHAR(100) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        resource_type VARCHAR(100),
        resource_id INTEGER,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_security_events_ip_address ON security_events(ip_address);
      CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
      CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
    `);
    console.log('✓ Security events table created');

    // Create admin activity log table
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

      CREATE INDEX IF NOT EXISTS idx_admin_activity_log_admin_id ON admin_activity_log(admin_id);
      CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action ON admin_activity_log(action);
      CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created_at ON admin_activity_log(created_at);
    `);
    console.log('✓ Admin activity log table created');

    // Add indexes to user_sessions table if not exists
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active, logout_time);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON user_sessions(last_activity);
    `);
    console.log('✓ User sessions indexes created');

    // Add Guardian Portal clinic if not exists
    await pool.query(`
      INSERT INTO clinics (name, region, address, contact)
      VALUES ('Guardian Portal', 'Virtual', 'Online Portal', 'support@immunicare.com')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('✓ Guardian Portal clinic verified');

    // Add guardian role if not exists (already in schema.sql but ensuring it)
    await pool.query(`
      INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
      VALUES ('guardian', 'Guardian', false, 20, '{"can_view_own_children": true, "can_view_appointments": true}')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('✓ Guardian role verified');

    console.log('\n✅ Authentication system migration completed successfully!');
    console.log('\nNew tables created:');
    console.log('  - password_history');
    console.log('  - password_reset_tokens');
    console.log('  - email_verification_tokens');
    console.log('  - security_events');
    console.log('  - admin_activity_log');

    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration if executed directly
if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runMigration };
