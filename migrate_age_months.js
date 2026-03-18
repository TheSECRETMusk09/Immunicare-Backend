/**
 * Migration Script: Add age_months column and trigger
 *
 * This script:
 * 1. Adds age_months column to patients table
 * 2. Creates trigger function for automatic age calculation
 * 3. Creates trigger on patients table
 * 4. Backfills existing records
 */

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('Starting age_months migration...');

    // Read the SQL file
    const sqlFile = path.join(__dirname, 'add_age_trigger.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    // Execute the migration
    await client.query(sql);

    console.log('Migration completed successfully!');

    // Verify the results
    const verifyResult = await client.query(`
      SELECT
        COUNT(*) AS total_records,
        COUNT(age_months) AS records_with_age,
        COUNT(*) - COUNT(age_months) AS records_without_age
      FROM patients
      WHERE is_active = true
    `);

    console.log('Verification results:', verifyResult.rows[0]);

    // Show sample of calculated ages
    const sampleResult = await client.query(`
      SELECT id, first_name, last_name, dob, age_months
      FROM patients
      WHERE is_active = true
        AND age_months IS NOT NULL
      ORDER BY age_months DESC
      LIMIT 10
    `);

    console.log('\nSample records with calculated ages:');
    sampleResult.rows.forEach(row => {
      console.log(`  ${row.first_name} ${row.last_name}: DOB=${row.dob}, Age=${row.age_months} months`);
    });

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log('\nMigration script finished.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nMigration script error:', err);
    process.exit(1);
  });
