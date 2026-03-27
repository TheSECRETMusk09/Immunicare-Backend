/**
 * Update all inventory locations from "Main Health Center" to "San Nicolas Health Center"
 */

const pool = require('./db');

async function updateLocations() {
  console.log('='.repeat(80));
  console.log('UPDATING INVENTORY LOCATIONS');
  console.log('='.repeat(80));
  console.log();

  try {
    // Check current locations
    console.log('Current locations:');
    const current = await pool.query(`
      SELECT DISTINCT location, COUNT(*) as count 
      FROM inventory 
      GROUP BY location 
      ORDER BY location
    `);
    console.table(current.rows);

    // Update Main Health Center to San Nicolas Health Center
    console.log('\nUpdating "Main Health Center" to "San Nicolas Health Center"...');
    const result = await pool.query(`
      UPDATE inventory 
      SET location = 'San Nicolas Health Center Vaccine Cold Storage'
      WHERE location = 'Main Health Center Vaccine Cold Storage'
      RETURNING id, location
    `);

    console.log(`✅ Updated ${result.rowCount} records\n`);

    if (result.rowCount > 0) {
      console.log('Sample updated records:');
      console.table(result.rows.slice(0, 5));
    }

    // Show final locations
    console.log('\nFinal locations:');
    const final = await pool.query(`
      SELECT DISTINCT location, COUNT(*) as count 
      FROM inventory 
      GROUP BY location 
      ORDER BY location
    `);
    console.table(final.rows);

    console.log('\n' + '='.repeat(80));
    console.log('✅ UPDATE COMPLETE');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ UPDATE FAILED');
    console.error('Error:', error.message);
    throw error;
  } finally {
    await pool.end();
    process.exit(0);
  }
}

updateLocations();
