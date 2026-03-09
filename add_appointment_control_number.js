/**
 * Database Migration: Add Control Number Support
 *
 * This script:
 * 1. Adds control_number column to appointments table
 * 2. Creates appointment_control_numbers table for daily sequence tracking
 *
 * Run with: node backend/add_appointment_control_number.js
 */

const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();

  try {
    console.log('Starting migration...');

    await client.query('BEGIN');

    // 1. Add control_number column to appointments table if it doesn't exist
    const columnCheck = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'appointments' AND column_name = 'control_number'
    `);

    if (columnCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE appointments
        ADD COLUMN control_number VARCHAR(20) UNIQUE
      `);
      console.log('✓ Added control_number column to appointments table');
    } else {
      console.log('✓ control_number column already exists');
    }

    // 2. Create appointment_control_numbers table for daily sequence tracking
    const tableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'appointment_control_numbers'
    `);

    if (tableCheck.rows.length === 0) {
      await client.query(`
        CREATE TABLE appointment_control_numbers (
          id SERIAL PRIMARY KEY,
          control_date DATE NOT NULL UNIQUE,
          sequence_number INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add index for faster lookups
      await client.query(`
        CREATE INDEX idx_appointment_control_numbers_date
        ON appointment_control_numbers(control_date)
      `);

      console.log('✓ Created appointment_control_numbers table');
    } else {
      console.log('✓ appointment_control_numbers table already exists');
    }

    await client.query('COMMIT');
    console.log('Migration completed successfully!');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

// Run migration if executed directly
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration error:', err);
      process.exit(1);
    });
}

module.exports = { migrate };
