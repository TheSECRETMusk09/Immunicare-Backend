/**
 * ============================================================================
 * DEPRECATED MIGRATION FILE
 * ============================================================================
 * Status: DEPRECATED as of 2026-02-04
 * Reason: This migration is no longer needed
 * Canonical Source: backend/schema.sql
 * ============================================================================
 *
 * Migration: Add location field to appointments table
 * Date: 2026-01-31
 * Description: Adds location field to appointments table
 *
 * NOTE: This migration is deprecated. The location field is already defined
 * in the appointments table within backend/schema.sql.
 *
 * DO NOT RUN THIS FILE. Use backend/schema.sql instead.
 * ============================================================================
 */

const db = require('../db');

async function up() {
  console.log('Adding location column to appointments table...');

  try {
    // Add location column
    await db.query(`
            ALTER TABLE appointments 
            ADD COLUMN IF NOT EXISTS location VARCHAR(255)
        `);

    // Add comment
    await db.query(`
            COMMENT ON COLUMN appointments.location 
            IS 'Physical location where the appointment will take place'
        `);

    // Create index
    await db.query(`
            CREATE INDEX IF NOT EXISTS idx_appointments_location 
            ON appointments(location)
        `);

    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

async function down() {
  console.log('Reverting location column addition...');

  try {
    await db.query(`
            ALTER TABLE appointments 
            DROP COLUMN IF EXISTS location
        `);

    console.log('Rollback completed');
  } catch (error) {
    console.error('Rollback failed:', error);
    throw error;
  }
}

module.exports = { up, down };
