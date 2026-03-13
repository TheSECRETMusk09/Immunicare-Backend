#!/usr/bin/env node

/**
 * Fix sms_logs table - add missing message_content column
 */

require('dotenv').config({ path: '.env.development' });

const { Pool } = require('pg');

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
  ssl: process.env.DB_SSL === 'true',
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
          status VARCHAR(20) DEFAULT 'pending',
          gateway_response TEXT,
          appointment_id INTEGER,
          sent_at TIMESTAMP DEFAULT NOW(),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('✅ sms_logs table created');
    } else {
      console.log('sms_logs table exists, checking columns...');

      // Check for message_content column
      const colCheck = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'sms_logs'
        AND column_name = 'message_content'
      `);

      if (colCheck.rows.length === 0) {
        console.log('Adding message_content column...');
        await client.query(`
          ALTER TABLE sms_logs
          ADD COLUMN message_content TEXT
        `);
        console.log('✅ message_content column added');
      } else {
        console.log('✅ message_content column already exists');
      }
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
