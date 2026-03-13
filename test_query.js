const pool = require('./db');

async function testQuery() {
  try {
    // Test upcoming vaccinations query
    const result = await pool.query(`
      SELECT DISTINCT
        p.id,
        p.first_name,
        p.last_name
      FROM patients p
      LEFT JOIN immunization_records vr ON vr.patient_id = p.id
      WHERE p.is_active = true
        AND vr.next_due_date <= CURRENT_DATE + INTERVAL '30 days'
        AND vr.is_active = true
      ORDER BY vr.next_due_date ASC
      LIMIT 5
    `);
    console.log('Query result:', JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.log('Error:', error.message);
    console.log('Detail:', error.detail);
  } finally {
    // NOTE: process.exit() is removed to prevent it from killing the main server process.
    // This script will hang after execution; use Ctrl+C to exit.
    // process.exit();
  }
}

testQuery();
