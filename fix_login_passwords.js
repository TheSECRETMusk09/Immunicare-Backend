require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function fixLoginPasswords() {
  try {
    console.log('=== Fixing Login Passwords ===\n');

    const adminPassword = 'Admin2024!';
    const guardianPassword = 'guardian123';

    // Hash passwords
    const adminHash = await bcrypt.hash(adminPassword, 10);
    const guardianHash = await bcrypt.hash(guardianPassword, 10);

    console.log('1. Updating admin user password...');

    // Update admin users (role_id = 2 for 'admin')
    const adminResult = await pool.query(
      'UPDATE users SET password_hash = $1, is_active = true WHERE username = \'admin\' RETURNING id, username',
      [adminHash],
    );
    console.log(`   Updated admin: ${JSON.stringify(adminResult.rows)}`);

    // Also update administrator user
    const adminResult2 = await pool.query(
      'UPDATE users SET password_hash = $1, is_active = true WHERE username = \'administrator\' RETURNING id, username',
      [adminHash],
    );
    console.log(`   Updated administrator: ${JSON.stringify(adminResult2.rows)}`);

    console.log('\n2. Updating guardian users password...');

    // Get all guardian users
    const guardianUsers = await pool.query(
      'SELECT id, username, guardian_id FROM users WHERE role_id = 5',
    );

    console.log(`   Found ${guardianUsers.rows.length} guardian users`);

    for (const user of guardianUsers.rows) {
      // Update user password
      await pool.query(
        'UPDATE users SET password_hash = $1, is_active = true WHERE id = $2',
        [guardianHash, user.id],
      );

      // Also update guardian table
      if (user.guardian_id) {
        await pool.query(
          'UPDATE guardians SET is_password_set = true, must_change_password = false WHERE id = $1',
          [user.guardian_id],
        );
      }

      console.log(`   Updated: ${user.username}`);
    }

    console.log('\n3. Verifying fixes...');

    // Verify admin password
    const verifyAdmin = await pool.query('SELECT password_hash FROM users WHERE username = \'admin\'');
    const adminValid = await bcrypt.compare(adminPassword, verifyAdmin.rows[0].password_hash);
    console.log(`   Admin password valid: ${adminValid ? 'YES' : 'NO'}`);

    // Verify guardian password
    const verifyGuardian = await pool.query('SELECT password_hash FROM users WHERE role_id = 5 LIMIT 1');
    const guardianValid = await bcrypt.compare(guardianPassword, verifyGuardian.rows[0].password_hash);
    console.log(`   Guardian password valid: ${guardianValid ? 'YES' : 'NO'}`);

    console.log('\n=== Password Fix Complete ===');
    console.log('\nLogin credentials after fix:');
    console.log('  Admin: username=admin, password=Admin2024!');
    console.log('  Admin: username=administrator, password=Admin2024!');
    console.log('  Guardian: use email or username from guardians table, password=guardian123');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

fixLoginPasswords();
