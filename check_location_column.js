const pool = require('./db');

async function checkLocationColumn() {
  try {
    console.log('Checking if location column exists in appointments table...');
    const result = await pool.query(`
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_name = 'appointments' 
                AND column_name = 'location'
            ) as column_exists
        `);

    console.log('Location column exists:', result.rows[0].column_exists);

    if (result.rows[0].column_exists) {
      console.log('\nSample appointments data:');
      const appointments = await pool.query(
        'SELECT id, type, location, status, scheduled_date FROM appointments LIMIT 5'
      );
      console.log(appointments.rows);
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkLocationColumn();
