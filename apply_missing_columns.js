#!/usr/bin/env node

/**
 * Script to apply the SMS tracking columns migration
 * This adds the missing reminder_sent_24h and reminder_sent_48h columns
 */

require('dotenv').config({ path: '.env.development' });

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function applyMigration() {
  console.log('=== Applying SMS tracking columns migration ===');

  try {
    const migrationPath = path.join(__dirname, 'migrations', 'add_sms_tracking_columns.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Executing SQL migration...');
    await pool.query(sql);

    console.log('✅ Migration completed successfully!');
    console.log('Added columns:');
    console.log('  - reminder_sent_24h (boolean, default: false)');
    console.log('  - reminder_sent_48h (boolean, default: false)');
    console.log('  - sms_missed_notification_sent (boolean, default: false)');
    console.log('Added indexes for better query performance');

  } catch (error) {
    console.error('❌ Migration failed:');
    console.error('Error:', error.message);
    if (error.code) {
      console.error('Code:', error.code);
    }
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  } finally {
    pool.end();
  }
}

applyMigration();
