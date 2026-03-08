/**
 * Script to verify vaccine_waitlist table exists in the database
 */
const pool = require('../../db');

async function checkVaccineWaitlistTable() {
  try {
    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'vaccine_waitlist'
    `);

    if (tableCheck.rows.length === 0) {
      console.log('❌ vaccine_waitlist table does NOT exist');
      console.log('\nTo create the table, run the migration:');
      console.log('   npm run migrate:manifest');
      return false;
    }

    console.log('✅ vaccine_waitlist table EXISTS');

    // Get table structure
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'vaccine_waitlist'
      ORDER BY ordinal_position
    `);

    console.log('\nTable Structure:');
    console.log('----------------');
    columns.rows.forEach((col) => {
      console.log(
        `  ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : '(not null)'} ${col.column_default ? `default: ${col.column_default}` : ''}`,
      );
    });

    // Check if there's any data
    const count = await pool.query('SELECT COUNT(*) FROM vaccine_waitlist');
    console.log(`\nTotal records: ${count.rows[0].count}`);

    // Check related tables
    const relatedTables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('vaccine_availability_notifications', 'vaccine_waitlist')
    `);

    console.log('\nRelated tables found:');
    relatedTables.rows.forEach((t) => {
      console.log(`  ✅ ${t.table_name}`);
    });

    return true;
  } catch (error) {
    console.error('Error checking table:', error.message);
    return false;
  } finally {
    await pool.end();
  }
}

checkVaccineWaitlistTable();
