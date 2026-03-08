const pool = require('./db');

async function checkAppointmentsRelationships() {
  try {
    console.log('=== User 7 Details ===');
    const userResult = await pool.query(
      'SELECT u.id, u.username, u.email, u.guardian_id FROM users u WHERE u.id = 7'
    );
    console.log(userResult.rows);

    console.log('\n=== Guardians ===');
    const guardiansResult = await pool.query('SELECT * FROM guardians');
    console.log(guardiansResult.rows);

    console.log('\n=== Parent Guardians ===');
    const parentGuardiansResult = await pool.query('SELECT * FROM parent_guardian');
    console.log(parentGuardiansResult.rows);

    console.log('\n=== Infants ===');
    const infantsResult = await pool.query('SELECT * FROM infants');
    console.log(infantsResult.rows);

    console.log('\n=== Appointments ===');
    const appointmentsResult = await pool.query('SELECT * FROM appointments');
    console.log(appointmentsResult.rows);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkAppointmentsRelationships();
