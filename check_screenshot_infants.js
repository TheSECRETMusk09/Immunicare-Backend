/**
 * Check if the infants shown in screenshot have transfer cases
 */

const pool = require('./db');

async function checkScreenshotInfants() {
  console.log('Checking infants from screenshot...\n');

  try {
    // Check Alvin Torres and Noel Bacani
    const result = await pool.query(`
      SELECT 
        p.id,
        p.first_name,
        p.last_name,
        (SELECT COUNT(*) FROM transfer_in_cases WHERE infant_id = p.id) as transfer_count,
        (SELECT tic.source_facility FROM transfer_in_cases tic 
         WHERE tic.infant_id = p.id 
         ORDER BY tic.updated_at DESC LIMIT 1) as latest_transfer_source
      FROM patients p
      WHERE (p.first_name = 'Alvin' AND p.last_name = 'Torres')
         OR (p.first_name = 'Noel' AND p.last_name = 'Bacani')
      ORDER BY p.id
    `);

    console.log('Results:');
    console.table(result.rows);

    if (result.rows.length === 0) {
      console.log('\n⚠️  These infants not found in database');
    } else {
      result.rows.forEach(row => {
        if (row.transfer_count === '0') {
          console.log(`\n⚠️  ${row.first_name} ${row.last_name} has NO transfer cases`);
          console.log('   This is why Transfer Source shows "—" (empty)');
        } else {
          console.log(`\n✅ ${row.first_name} ${row.last_name} has ${row.transfer_count} transfer case(s)`);
          console.log(`   Transfer Source: ${row.latest_transfer_source}`);
        }
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

checkScreenshotInfants();
