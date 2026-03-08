const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!'
});

async function updateAdminCredentials() {
  try {
    console.log('Updating admin credentials...');

    // Generate new password hash
    const newPassword = 'Immunicare2026!';
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    const newEmail = 'administrator@immunicare.com';

    // Update admin user
    const adminResult = await pool.query(
      `UPDATE users 
       SET password_hash = $1, contact = $2 
       WHERE username = 'admin' 
       RETURNING id, username, contact`,
      [newPasswordHash, newEmail]
    );

    if (adminResult.rows.length > 0) {
      console.log('✅ Admin user updated:', adminResult.rows[0]);
    } else {
      console.log('⚠️ Admin user not found');
    }

    // Update administrator user
    const adminUserResult = await pool.query(
      `UPDATE users 
       SET password_hash = $1, contact = $2 
       WHERE username = 'administrator' 
       RETURNING id, username, contact`,
      [newPasswordHash, newEmail]
    );

    if (adminUserResult.rows.length > 0) {
      console.log('✅ Administrator user updated:', adminUserResult.rows[0]);
    } else {
      console.log('⚠️ Administrator user not found');
    }

    console.log('\n📋 Updated Admin Credentials:');
    console.log('Username: admin');
    console.log('Password: Immunicare2026!');
    console.log('Email: administrator@immunicare.com');
    console.log('');
    console.log('Username: administrator');
    console.log('Password: Immunicare2026!');
    console.log('Email: administrator@immunicare.com');
    console.log('\n✅ Credentials updated successfully!');
  } catch (error) {
    console.error('❌ Error updating credentials:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
    console.log('Database connection closed');
  }
}

updateAdminCredentials();
