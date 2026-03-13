/**
 * Script to apply SMS schema to the database
 * Run with: node setup_sms_schema.js
 */

const fs = require('fs');
const path = require('path');
const requestedEnv =
  process.env.IMMUNICARE_RUNTIME_ENV ||
  process.argv[2] ||
  process.env.NODE_ENV ||
  'development';

process.env.NODE_ENV = requestedEnv;

const loadBackendEnv = require('./config/loadEnv');
loadBackendEnv({ baseDir: __dirname });

const { Pool } = require('pg');

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value).trim().toLowerCase() === 'true';
};

async function setupSMSSchema() {
  // Create connection pool
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'immunicare_dev',
    user: process.env.DB_USER || 'immunicare_dev',
    password: process.env.DB_PASSWORD || '',
    ssl: parseBoolean(process.env.DB_SSL)
      ? {
        rejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED),
      }
      : false,
  });

  const tables = [
    {
      name: 'sms_logs',
      sql: `
        CREATE TABLE IF NOT EXISTS sms_logs (
          id SERIAL PRIMARY KEY,
          phone_number VARCHAR(20) NOT NULL,
          message_content TEXT NOT NULL,
          message_type VARCHAR(50) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          provider VARCHAR(20) NOT NULL DEFAULT 'log',
          external_message_id VARCHAR(100),
          metadata JSONB,
          attempts JSONB,
          sent_at TIMESTAMP,
          failed_at TIMESTAMP,
          error_details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
    },
    {
      name: 'sms_verification_codes',
      sql: `
        CREATE TABLE IF NOT EXISTS sms_verification_codes (
          id SERIAL PRIMARY KEY,
          phone_number VARCHAR(20) NOT NULL,
          code VARCHAR(6) NOT NULL,
          purpose VARCHAR(50) NOT NULL,
          user_id INTEGER,
          guardian_id INTEGER,
          expires_at TIMESTAMP NOT NULL,
          verified_at TIMESTAMP,
          ip_address VARCHAR(45),
          user_agent TEXT,
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (phone_number, purpose)
        )
      `,
    },
    {
      name: 'guardian_phone_numbers',
      sql: `
        CREATE TABLE IF NOT EXISTS guardian_phone_numbers (
          id SERIAL PRIMARY KEY,
          guardian_id INTEGER NOT NULL,
          phone_number VARCHAR(20) NOT NULL,
          is_primary BOOLEAN DEFAULT true,
          is_verified BOOLEAN DEFAULT false,
          verified_at TIMESTAMP,
          verification_code_id INTEGER,
          sms_preferences JSONB DEFAULT '{"appointment_reminders": true, "password_reset": true, "account_alerts": true}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (guardian_id, phone_number)
        )
      `,
    },
    {
      name: 'appointment_reminder_settings',
      sql: `
        CREATE TABLE IF NOT EXISTS appointment_reminder_settings (
          id SERIAL PRIMARY KEY,
          guardian_id INTEGER NOT NULL,
          infant_id INTEGER,
          reminder_enabled BOOLEAN DEFAULT true,
          reminder_hours_before INTEGER DEFAULT 24,
          sms_notification_enabled BOOLEAN DEFAULT true,
          email_notification_enabled BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (guardian_id, infant_id)
        )
      `,
    },
  ];

  const indexes = [
    {
      table: 'sms_logs',
      sql: 'CREATE INDEX IF NOT EXISTS idx_sms_logs_phone ON sms_logs(phone_number)',
    },
    {
      table: 'sms_logs',
      sql: 'CREATE INDEX IF NOT EXISTS idx_sms_logs_type ON sms_logs(message_type)',
    },
    {
      table: 'sms_logs',
      sql: 'CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status)',
    },
    {
      table: 'sms_verification_codes',
      sql: 'CREATE INDEX IF NOT EXISTS idx_sms_verification_phone ON sms_verification_codes(phone_number)',
    },
    {
      table: 'sms_verification_codes',
      sql: 'CREATE INDEX IF NOT EXISTS idx_sms_verification_expires ON sms_verification_codes(expires_at)',
    },
    {
      table: 'guardian_phone_numbers',
      sql: 'CREATE INDEX IF NOT EXISTS idx_guardian_phone_guardian ON guardian_phone_numbers(guardian_id)',
    },
    {
      table: 'appointment_reminder_settings',
      sql: 'CREATE INDEX IF NOT EXISTS idx_reminder_settings_guardian ON appointment_reminder_settings(guardian_id)',
    },
  ];

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    console.log('Connected to database');

    // Create tables
    console.log('\nCreating tables...');
    for (const table of tables) {
      try {
        await client.query(table.sql);
        console.log(`  ✓ ${table.name}`);
      } catch (err) {
        console.log(`  ✗ ${table.name}: ${err.message}`);
      }
    }

    // Create indexes
    console.log('\nCreating indexes...');
    for (const idx of indexes) {
      try {
        await client.query(idx.sql);
        console.log(`  ✓ ${idx.table} index`);
      } catch (err) {
        console.log(`  ✗ ${idx.table} index: ${err.message}`);
      }
    }

    // Verify tables
    console.log('\nVerifying tables:');
    for (const table of tables) {
      try {
        await client.query(`SELECT 1 FROM ${table.name} LIMIT 1`);
        console.log(`  ✓ ${table.name} exists`);
      } catch (err) {
        console.log(`  ✗ ${table.name} not found: ${err.message}`);
      }
    }

    client.release();
    console.log('\nSMS schema setup complete!');
  } catch (error) {
    console.error('Error setting up SMS schema:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  setupSMSSchema()
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nFailed:', error);
      process.exit(1);
    });
}

module.exports = { setupSMSSchema };
