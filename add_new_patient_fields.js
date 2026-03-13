/**
 * Database Migration: Add allergy_information and health_care_provider fields
 *
 * This migration adds the following new columns:
 * - patients.allergy_information: TEXT - Stores allergy information for patients
 * - patients.health_care_provider: VARCHAR(255) - Stores the health care provider name for patients
 * - immunization_records.health_care_provider: VARCHAR(255) - Stores the health care provider for each immunization record
 *
 * Run with: node add_new_patient_fields.js
 * Or execute the SQL directly in your database
 */

const pool = require('./db');

const migrationSQL = `
-- Add allergy_information and health_care_provider to patients table
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS allergy_information TEXT,
ADD COLUMN IF NOT EXISTS health_care_provider VARCHAR(255);

-- Add health_care_provider to immunization_records table
ALTER TABLE immunization_records
ADD COLUMN IF NOT EXISTS health_care_provider VARCHAR(255);

-- Create index for faster queries on health_care_provider
CREATE INDEX IF NOT EXISTS idx_immunization_records_provider
ON immunization_records(health_care_provider);

-- Create index for faster queries on patients health_care_provider
CREATE INDEX IF NOT EXISTS idx_patients_health_care_provider
ON patients(health_care_provider);
`;

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('Starting migration: Adding new patient and immunization fields...');

    await client.query('BEGIN');

    // Execute the migration SQL
    await client.query(migrationSQL);

    await client.query('COMMIT');

    console.log('Migration completed successfully!');
    console.log('Added columns:');
    console.log('  - patients.allergy_information');
    console.log('  - patients.health_care_provider');
    console.log('  - immunization_records.health_care_provider');

    // Verify the columns were added
    const patientColumns = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'patients'
      AND column_name IN ('allergy_information', 'health_care_provider')
      ORDER BY column_name;
    `);

    console.log('\nVerified patients table columns:');
    patientColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

    const immunizationColumns = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'immunization_records'
      AND column_name = 'health_care_provider';
    `);

    console.log('\nVerified immunization_records table columns:');
    immunizationColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('\nMigration script finished.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nMigration script failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration, migrationSQL };
