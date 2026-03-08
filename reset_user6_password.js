const pool = require('./db');
const bcrypt = require('bcryptjs');

async function resetUser6Password() {
  try {
    const userId = 6;
    const newPassword = '12345678';

    // Hash the password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, userId]);

    console.log(`Password for user ${userId} updated successfully`);

    // Verify the update
    const userResult = await pool.query(
      'SELECT id, username, email, password_hash FROM users WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    const passwordMatch = await bcrypt.compare(newPassword, user.password_hash);
    console.log(`Password match test: ${passwordMatch}`);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

resetUser6Password();
