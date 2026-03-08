/**
 * Database Migration: Add age_in_days to growth_records
 *
 * This migration:
 * 1. Adds age_in_days column to growth_records table
 * 2. Backfills age_in_days using infant's dob (date of birth)
 * 3. Makes the migration idempotent
 */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Starting migration: Add age_in_days to growth_records...');

    // Start transaction
    await client.query('BEGIN');

    // Check if age_in_days column already exists
    const checkColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'growth_records' AND column_name = 'age_in_days'
    `);

    if (checkColumn.rows.length === 0) {
      console.log('Adding age_in_days column to growth_records...');

      // Add age_in_days column
      await client.query(`
        ALTER TABLE growth_records 
        ADD COLUMN age_in_days INTEGER
      `);

      console.log('Column added successfully.');
    } else {
      console.log('Column age_in_days already exists. Skipping column creation.');
    }

    // Backfill age_in_days from infants table using date subtraction
    console.log('Backfilling age_in_days from infant date of birth...');

    const updateResult = await client.query(`
      UPDATE growth_records gr
      SET age_in_days = CAST(gr.record_date AS date) - CAST(i.dob AS date)
      FROM infants i
      WHERE gr.infant_id = i.id
      AND i.dob IS NOT NULL
      AND gr.record_date IS NOT NULL
      AND gr.age_in_days IS NULL
    `);

    console.log(`Updated ${updateResult.rowCount} records.`);

    // Verify the data
    const verifyResult = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(age_in_days) as with_age,
        COUNT(*) - COUNT(age_in_days) as missing_age
      FROM growth_records
    `);

    console.log('Verification:', verifyResult.rows[0]);

    // Commit transaction
    await client.query('COMMIT');

    console.log('Migration completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration error:', err);
    process.exit(1);
  });
