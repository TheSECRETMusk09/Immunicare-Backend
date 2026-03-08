const pool = require('./db');

async function checkUsers() {
  try {
    // Check users table
    console.log('=== Checking Users Table ===');
    const usersResult = await pool.query(`
      SELECT u.id, u.username, u.email, u.is_active, r.name as role_name, u.guardian_id
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email LIKE '%@email.com'
      LIMIT 10
    `);
    console.log('Users with email:', JSON.stringify(usersResult.rows, null, 2));

    // Check guardians
    console.log('\n=== Checking Guardians Table ===');
    const guardiansResult = await pool.query(`
      SELECT id, name, email, is_password_set, must_change_password
      FROM guardians
      LIMIT 10
    `);
    console.log('Guardians:', JSON.stringify(guardiansResult.rows, null, 2));

    // Check roles
    console.log('\n=== Checking Roles ===');
    const rolesResult = await pool.query('SELECT id, name, display_name FROM roles');
    console.log('Roles:', JSON.stringify(rolesResult.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkUsers();
