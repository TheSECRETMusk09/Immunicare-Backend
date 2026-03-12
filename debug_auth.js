const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || ''
});

async function debugAuth() {
  try {
    console.log('Debugging authentication...');

    // Check if user exists
    const result = await pool.query(
      'SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.username = $1',
      ['admin']
    );

    console.log('User query result:', result.rows);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      console.log('Found user:', user.username);
      console.log('Password hash:', user.password_hash);

      // Test password verification
      const isValidPassword = await bcrypt.compare(
        'Admin2024!',
        user.password_hash
      );
      console.log('Password verification result:', isValidPassword);

      if (isValidPassword) {
        console.log('✅ Authentication should work!');
      } else {
        console.log('❌ Password verification failed!');
      }
    } else {
      console.log('❌ No user found with username "admin"');
    }
  } catch (error) {
    console.error('❌ Error in debug:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Run the debug
debugAuth();
