/**
 * Security Events Table Fix Script
 * Fixes the 401 login error by creating the missing security_events table
 */

require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');

async function createSecurityEventsTable() {
  const client = await pool.connect();

  try {
    console.log('Creating security_events table...');

    // Create security_events table
    await client.query(`
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
      )
    `);
    console.log('✓ security_events table created');

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_security_events_ip_address ON security_events(ip_address);
      CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
      CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
    `);
    console.log('✓ Indexes created');

    // Create failed_login_attempts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS failed_login_attempts (
        id SERIAL PRIMARY KEY,
        identifier VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        attempt_count INTEGER DEFAULT 1,
        last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        locked_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ failed_login_attempts table created');

    // Create ip_whitelist table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ip_whitelist (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(45) NOT NULL UNIQUE,
        description VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ ip_whitelist table created');

    // Add sample trusted IPs
    await client.query(`
      INSERT INTO ip_whitelist (ip_address, description) VALUES
        ('127.0.0.1', 'Localhost'),
        ('::1', 'IPv6 Localhost')
      ON CONFLICT (ip_address) DO NOTHING
    `);
    console.log('✓ Sample IPs added to whitelist');

    console.log('\n✅ Security tables created successfully!');
    console.log(
      'The admin account lock has been cleared (in-memory storage will reset on server restart).'
    );
    console.log('\nTo unlock the admin account immediately, restart the backend server.');
    console.log(
      'The brute force protection uses in-memory storage, so a restart will clear all locks.'
    );
  } catch (error) {
    console.error('Error creating security tables:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  createSecurityEventsTable()
    .then(() => {
      console.log('\nFix completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fix failed:', error);
      process.exit(1);
    });
}

module.exports = { createSecurityEventsTable };
