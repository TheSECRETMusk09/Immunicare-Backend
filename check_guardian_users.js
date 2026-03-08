const pool = require('./db');

async function checkGuardianUsers() {
  try {
    const result = await pool.query(`
            SELECT u.id, u.username, u.email, u.password_hash, u.is_active, u.guardian_id,
                   r.name as role_name, p.full_name as guardian_name
            FROM users u
            JOIN roles r ON u.role_id = r.id
            LEFT JOIN parent_guardian p ON u.guardian_id = p.id
            WHERE r.name = 'guardian'
            ORDER BY u.id
        `);

    console.log('Guardian users:');
    console.log(result.rows);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkGuardianUsers();
