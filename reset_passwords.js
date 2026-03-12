const pool = require('./db');
const bcrypt = require('bcryptjs');

async function resetPasswords() {
  try {
    console.log('=== Resetting User Passwords ===');

    // Hash the passwords
    const adminHash = await bcrypt.hash('Admin2026!', 10);
    const guardianHash = await bcrypt.hash('Guardian2026!', 10);

    console.log(`Admin password hash: ${adminHash}`);
    console.log(`Guardian password hash: ${guardianHash}`);

    // Update admin users
    const adminResult = await pool.query(
      `
            UPDATE users
            SET password_hash = $1
            WHERE role_id IN (
                SELECT id FROM roles WHERE name IN ('admin', 'super_admin', 'doctor', 'nurse')
            )
            RETURNING id, username, email
        `,
      [adminHash],
    );

    console.log(`\n✅ Updated ${adminResult.rowCount} admin users:`);
    adminResult.rows.forEach((user) => {
      console.log(`   ${user.username} (${user.email})`);
    });

    // Update guardian users
    const guardianResult = await pool.query(
      `
            UPDATE users
            SET password_hash = $1
            WHERE role_id IN (
                SELECT id FROM roles WHERE name = 'guardian'
            )
            RETURNING id, username, email
        `,
      [guardianHash],
    );

    console.log(`\n✅ Updated ${guardianResult.rowCount} guardian users:`);
    guardianResult.rows.forEach((user) => {
      console.log(`   ${user.username} (${user.email})`);
    });

    // Verify the updates
    console.log('\n=== Verifying Updates ===');

    // Check admin user
    const adminCheck = await pool.query(`
            SELECT id, username, email, password_hash
            FROM users
            WHERE role_id IN (
                SELECT id FROM roles WHERE name IN ('admin', 'super_admin', 'doctor', 'nurse')
            )
            LIMIT 1
        `);

    if (adminCheck.rows.length > 0) {
      const match = await bcrypt.compare('Admin2026!', adminCheck.rows[0].password_hash);
      console.log(`Admin password match: ${match ? '✅' : '❌'}`);
    }

    // Check guardian user
    const guardianCheck = await pool.query(`
            SELECT id, username, email, password_hash
            FROM users
            WHERE role_id IN (
                SELECT id FROM roles WHERE name = 'guardian'
            )
            LIMIT 1
        `);

    if (guardianCheck.rows.length > 0) {
      const match = await bcrypt.compare('Guardian2026!', guardianCheck.rows[0].password_hash);
      console.log(`Guardian password match: ${match ? '✅' : '❌'}`);
    }

    console.log('\n=== Password Reset Complete ===');
    console.log('Admin credentials: username=admin, password=Admin2026!');
    console.log('Guardian credentials: email=juan.delacruz@email.com, password=Guardian2026!');
  } catch (error) {
    console.error('Error resetting passwords:', error);
  } finally {
    await pool.end();
  }
}

resetPasswords();
