const pool = require('./db');

async function addTestAppointments() {
  try {
    console.log('Adding test appointments...');

    // Get all infants
    const infantsResult = await pool.query(`
            SELECT id, first_name, last_name, guardian_id
            FROM infants
            WHERE guardian_id IS NOT NULL
        `);

    const infants = infantsResult.rows;
    console.log(`Found ${infants.length} infants with guardians`);

    // Create appointments for each infant
    const appointments = [];
    const today = new Date();

    for (let i = 0; i < infants.length; i++) {
      const infant = infants[i];
      const appointmentDate = new Date(today);
      appointmentDate.setDate(today.getDate() + i * 7); // Every week

      const appointment = await pool.query(
        `
                INSERT INTO appointments (
                    infant_id, scheduled_date, type, duration_minutes, 
                    notes, status, created_by, clinic_id, location
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
            `,
        [
          infant.id,
          appointmentDate.toISOString(),
          'Vaccination Appointment',
          30,
          `Vaccination for ${infant.first_name} ${infant.last_name}`,
          'scheduled',
          1, // Default created by user (admin)
          1, // Default clinic
          'Main Health Center'
        ]
      );

      appointments.push(appointment.rows[0]);
      console.log(
        `Created appointment for ${infant.first_name} on ${appointmentDate.toLocaleDateString()}`
      );
    }

    console.log(`Successfully added ${appointments.length} test appointments`);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

addTestAppointments();
