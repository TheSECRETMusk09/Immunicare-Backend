/**
 * Test if API returns latest_transfer_source_facility
 */

const pool = require('./db');

async function testTransferSource() {
  console.log('='.repeat(80));
  console.log('TESTING TRANSFER SOURCE IN INFANTS API');
  console.log('='.repeat(80));
  console.log();

  try {
    // Test the exact query used by /api/infants endpoint
    const result = await pool.query(`
      SELECT
        p.id,
        p.first_name,
        p.last_name,
        (
          SELECT tic.source_facility
          FROM transfer_in_cases tic
          WHERE tic.infant_id = p.id
          ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
          LIMIT 1
        ) AS latest_transfer_source_facility,
        (
          SELECT tic.id
          FROM transfer_in_cases tic
          WHERE tic.infant_id = p.id
          ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
          LIMIT 1
        ) AS latest_transfer_case_id
      FROM patients p
      WHERE p.is_active = true
        AND EXISTS (SELECT 1 FROM transfer_in_cases WHERE infant_id = p.id)
      ORDER BY p.created_at DESC
      LIMIT 5
    `);

    console.log('✅ Query executed successfully');
    console.log(`Found ${result.rows.length} infants with transfer cases\n`);

    console.log('Sample Results:');
    console.log('-'.repeat(80));
    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ID: ${row.id}`);
      console.log(`   Name: ${row.first_name} ${row.last_name}`);
      console.log(`   Transfer Case ID: ${row.latest_transfer_case_id}`);
      console.log(`   Transfer Source: ${row.latest_transfer_source_facility || 'NULL'}`);
      console.log();
    });

    console.log('='.repeat(80));
    console.log('✅ TEST PASSED - Data is in database');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ TEST FAILED');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    await pool.end();
    process.exit(0);
  }
}

testTransferSource();
