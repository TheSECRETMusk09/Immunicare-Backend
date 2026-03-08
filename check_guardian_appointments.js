const pool = require('./db');

async function checkGuardianAppointments() {
  try {
    const result = await pool.query(`
            SELECT DISTINCT i.guardian_id, g.name, COUNT(a.id) as appointment_count
            FROM appointments a
            JOIN infants i ON a.infant_id = i.id
            JOIN guardians g ON i.guardian_id = g.id
            GROUP BY i.guardian_id, g.name
            ORDER BY appointment_count DESC
        `);

    console.log('Guardians with appointments:');
    console.log(result.rows);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkGuardianAppointments();
