/**
 * Schema Update Script
 * Applies all schema updates for Immunicare system
 * Run this script to update the database with new features
 */

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function applySchemaUpdates() {
  console.log('Starting schema updates...\n');

  try {
    // Read the schema updates SQL file
    const schemaUpdatesPath = path.join(__dirname, 'schema_updates_complete.sql');
    const sql = fs.readFileSync(schemaUpdatesPath, 'utf-8');

    // Split by semicolons to execute statements individually
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      try {
        await pool.query(statement);
        successCount++;

        // Log progress every 5 statements
        if ((i + 1) % 5 === 0 || i === statements.length - 1) {
          console.log(`Progress: ${i + 1}/${statements.length} statements executed`);
        }
      } catch (error) {
        // Skip duplicate key errors and table already exists errors
        if (
          error.message.includes('duplicate') ||
          error.message.includes('already exists') ||
          error.message.includes('already has')
        ) {
          console.log(`  - Skipping (already exists): ${statement.substring(0, 60)}...`);
          successCount++; // Count as success since it's expected
        } else {
          errorCount++;
          console.error(`  - Error: ${error.message}`);
          console.error(`    Statement: ${statement.substring(0, 100)}...`);
        }
      }
    }

    console.log('\n========================================');
    console.log('Schema Update Results:');
    console.log(`  Successful: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log('========================================\n');

    // Verify key tables exist
    const tablesToCheck = [
      'patients',
      'infant_allergies',
      'vaccine_waitlist',
      'vaccine_unavailability_notifications',
      'sms_logs',
      'incoming_sms',
      'appointment_confirmations',
      'critical_alert_notifications'
    ];

    console.log('Verifying key tables:');
    for (const table of tablesToCheck) {
      try {
        const result = await pool.query(
          `SELECT COUNT(*) FROM information_schema.tables 
           WHERE table_schema = 'public' AND table_name = $1`,
          [table]
        );
        const exists = parseInt(result.rows[0].count) > 0;
        console.log(`  ${table}: ${exists ? '✓ EXISTS' : '✗ MISSING'}`);
      } catch (error) {
        console.log(`  ${table}: ✗ ERROR - ${error.message}`);
      }
    }

    // Check control_number column
    console.log('\nVerifying control_number column:');
    try {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_schema = 'public' AND table_name = 'patients' AND column_name = 'control_number'`
      );
      const exists = result.rows.length > 0;
      console.log(`  patients.control_number: ${exists ? '✓ EXISTS' : '✗ MISSING'}`);
    } catch (error) {
      console.log(`  patients.control_number: ✗ ERROR - ${error.message}`);
    }

    // Generate sample control numbers if needed
    console.log('\nGenerating control numbers for existing patients without one:');
    try {
      const result = await pool.query(`
        UPDATE patients 
        SET control_number = TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(id::TEXT, 6, '0')
        WHERE control_number IS NULL
        RETURNING id, control_number
      `);

      if (result.rows.length > 0) {
        console.log(`  Generated ${result.rows.length} control numbers`);
      } else {
        console.log('  All patients already have control numbers');
      }
    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }

    console.log('\n✓ Schema updates completed successfully!');
  } catch (error) {
    console.error('Fatal error during schema updates:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the schema updates
applySchemaUpdates();
