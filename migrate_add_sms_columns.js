#!/usr/bin/env node

/**
 * Check and add missing SMS tracking columns to appointments table
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

console.log('=== Database Migration Script ===');
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

async function migrate() {
  let client;

  try {
    console.log('Connecting to PostgreSQL...');
    client = await pool.connect();
    console.log('✅ Connected successfully');
    console.log('');

    // Check existing columns
    console.log('Checking for existing SMS tracking columns...');
    const checkResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'appointments'
      AND column_name IN ('reminder_sent_24h', 'reminder_sent_48h', 'sms_missed_notification_sent')
    `);

    console.log('Found columns:', checkResult.rows.map(r => r.column_name));

    if (checkResult.rows.length < 3) {
      console.log('');
      console.log('Adding missing columns...');

      await client.query(`
        ALTER TABLE appointments
        ADD COLUMN IF NOT EXISTS reminder_sent_24h BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS reminder_sent_48h BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS sms_missed_notification_sent BOOLEAN DEFAULT FALSE
      `);

      console.log('✅ Columns added successfully');
    } else {
      console.log('✅ All required columns already exist');
    }

    console.log('');
    console.log('=== Migration Complete ===');

  } catch (error) {
    console.error('❌ Error during migration:');
    console.error('  Message:', error.message);
    if (error.code) {
      console.error('  Code:', error.code);
    }
    if (error.stack) {
      console.error('  Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

migrate();
