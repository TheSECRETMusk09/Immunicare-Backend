require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function resetGuardianPasswords() {
  try {
    const newPassword = 'Guardian123!';
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Reset all guardian passwords
    const result = await pool.query(
      `
      UPDATE guardians 
      SET password = $1, is_password_set = true
      RETURNING id, name, email, relationship
    `,
      [passwordHash]
    );

    console.log('Guardian passwords reset to: ' + newPassword);
    console.table(result.rows);

    // Also update users table passwords for guardians
    const usersResult = await pool.query(
      `
      UPDATE users 
      SET password_hash = $1
      WHERE guardian_id IN (SELECT id FROM guardians)
      RETURNING id, username, email
    `,
      [passwordHash]
    );

    console.log('\nGuardian user accounts updated:');
    console.table(usersResult.rows);

    pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    pool.end();
  }
}

resetGuardianPasswords();
