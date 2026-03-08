const pool = require('./db');
const bcrypt = require('bcryptjs');

async function checkPassword() {
  try {
    const result = await pool.query(
      'SELECT id, username, email, password_hash, is_active FROM users WHERE email = \'maria.santos@email.com\''
    );
    const user = result.rows[0];

    if (!user) {
      console.log('User NOT FOUND');
    } else {
      console.log('User found:', {
        id: user.id,
        username: user.username,
        is_active: user.is_active
      });

      if (user.password_hash) {
        console.log('Password hash exists:', user.password_hash.substring(0, 30));

        // Test the password
        const isValid = await bcrypt.compare('guardian123', user.password_hash);
        console.log('Password guardian123 valid:', isValid);
      } else {
        console.log('No password hash!');
      }
    }

    // Check admin users
    console.log('\nAdmin users:');
    const admins = await pool.query(
      'SELECT u.id, u.username, u.email, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name IN (\'admin\', \'super_admin\')'
    );
    console.log(admins.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkPassword();
