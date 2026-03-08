const pool = require('./db');

async function checkTables() {
  try {
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name LIKE '%infant%' OR table_name LIKE '%allergy%')
    `);
    console.log('Related tables:');
    result.rows.forEach((t) => console.log('  ' + t.table_name));

    if (!result.rows.find((r) => r.table_name === 'infant_allergies')) {
      console.log('\n⚠️ infant_allergies table does not exist!');
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

checkTables();
