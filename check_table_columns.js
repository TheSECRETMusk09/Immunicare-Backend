// Quick script to check table columns
const pool = require('./db');

async function checkTables() {
  try {
    // Check immunization_records
    const immunRec = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = \'immunization_records\' ORDER BY ordinal_position',
    );
    console.log('immunization_records:', immunRec.rows.map(c => c.column_name).join(', '));

    // Check patients
    const patients = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = \'patients\' ORDER BY ordinal_position',
    );
    console.log('patients:', patients.rows.map(c => c.column_name).join(', '));

    // Check appointments
    const appointments = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = \'appointments\' ORDER BY ordinal_position',
    );
    console.log('appointments:', appointments.rows.map(c => c.column_name).join(', '));

    // Check vaccines
    const vaccines = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = \'vaccines\' ORDER BY ordinal_position',
    );
    console.log('vaccines:', vaccines.rows.map(c => c.column_name).join(', '));

    // Check inventory
    const inventory = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = \'inventory\' ORDER BY ordinal_position',
    );
    console.log('inventory:', inventory.rows.map(c => c.column_name).join(', '));

    process.exit(0);
  } catch (e) {
    console.log('Error:', e.message);
    process.exit(1);
  }
}

checkTables();
