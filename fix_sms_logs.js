#!/usr/bin/env node

/**
 * Fix sms_logs table - add missing message_content column
 */

const requestedEnv =
  process.env.IMMUNICARE_RUNTIME_ENV ||
  process.argv[2] ||
  process.env.NODE_ENV ||
  'development';

process.env.NODE_ENV = requestedEnv;

const loadBackendEnv = require('./config/loadEnv');
loadBackendEnv();

const { Pool } = require('pg');

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value).trim().toLowerCase() === 'true';
};

console.log('=== Fixing sms_logs table ===');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Database:', process.env.DB_NAME || 'immunicare_dev');
console.log('');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD,
  ssl: parseBoolean(process.env.DB_SSL)
    ? {
      rejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED),
    }
    : false,
});

async function fixSmsLogs() {
  let client;

  try {
    console.log('Connecting to PostgreSQL...');
    client = await pool.connect();
    console.log('✅ Connected successfully');
    console.log('');

    // Check if sms_logs table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'sms_logs'
      ) as exists
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('Creating sms_logs table...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_logs (
          id SERIAL PRIMARY KEY,
          phone_number VARCHAR(20) NOT NULL,
          message_content TEXT,
          message_type VARCHAR(50),
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          provider VARCHAR(20) NOT NULL DEFAULT 'log',
          external_message_id VARCHAR(100),
          metadata JSONB,
          attempts JSONB,
          gateway_response TEXT,
          appointment_id INTEGER,
          sent_at TIMESTAMP,
          failed_at TIMESTAMP,
          error_details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ sms_logs table created');
    } else {
      console.log('sms_logs table exists, checking columns...');

      const colCheck = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'sms_logs'
      `);

      const existingColumns = new Set(colCheck.rows.map((row) => row.column_name));
      const requiredColumns = [
        ['message_content', 'TEXT'],
        ['message_type', 'VARCHAR(50)'],
        ['status', 'VARCHAR(20) DEFAULT \'pending\''],
        ['provider', 'VARCHAR(20) DEFAULT \'log\''],
        ['external_message_id', 'VARCHAR(100)'],
        ['metadata', 'JSONB'],
        ['attempts', 'JSONB'],
        ['gateway_response', 'TEXT'],
        ['appointment_id', 'INTEGER'],
        ['sent_at', 'TIMESTAMP'],
        ['failed_at', 'TIMESTAMP'],
        ['error_details', 'TEXT'],
      ];

      for (const [columnName, definition] of requiredColumns) {
        if (!existingColumns.has(columnName)) {
          console.log(`Adding ${columnName} column...`);
          await client.query(`ALTER TABLE sms_logs ADD COLUMN ${columnName} ${definition}`);
          console.log(`✅ ${columnName} column added`);
        }
      }

      console.log('✅ sms_logs columns verified');
    }

    console.log('');
    console.log('=== SMS Logs Fix Complete ===');

  } catch (error) {
    console.error('❌ Error during fix:');
    console.error('  Message:', error.message);
    if (error.code) {
      console.error('  Code:', error.code);
    }
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

fixSmsLogs();
