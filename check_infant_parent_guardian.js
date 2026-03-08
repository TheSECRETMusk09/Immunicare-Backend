const pool = require('./db');

async function checkInfantParentGuardian() {
  try {
    const result = await pool.query(`
            SELECT 
                i.id as infant_id,
                i.first_name,
                i.last_name,
                p.id as parent_guardian_id,
                p.full_name as guardian_name,
                p.email as guardian_email
            FROM infants i
            LEFT JOIN parent_guardian p ON i.guardian_id = p.id
        `);

    console.log('Infants with parent guardians:');
    console.log(result.rows);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkInfantParentGuardian();
