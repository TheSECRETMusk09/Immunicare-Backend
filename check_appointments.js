const pool = require('./db');

async function checkAppointments() {
  try {
    const result = await pool.query(`
            SELECT a.id, a.patient_id, a.appointment_date, a.status, a.appointment_type, a.location,
                   i.first_name, i.last_name, i.guardian_id,
                   p.full_name as guardian_name, u.id as user_id, u.email
            FROM appointments a
            JOIN infants i ON a.patient_id = i.id
            LEFT JOIN parent_guardian p ON i.guardian_id = p.id
            LEFT JOIN users u ON p.user_id = u.id
            ORDER BY a.appointment_date DESC
        `);

    console.log('Appointments:');
    console.log(result.rows);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkAppointments();
