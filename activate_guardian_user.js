/**
 * Activate Guardian User Script
 *
 * This script activates the test guardian user so they can login
 */

require('dotenv').config();
const pool = require('./db');

async function activateGuardianUser() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🔐 Activating guardian user...\n');

    // Find the test guardian user
    const userCheck = await client.query(
      `SELECT u.id, u.username, u.email, u.is_active
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'guardian'
       ORDER BY u.id DESC
       LIMIT 1`
    );

    if (userCheck.rows.length === 0) {
      console.log('❌ No guardian user found');
      return;
    }

    const user = userCheck.rows[0];
    console.log(`✅ Found guardian user: ${user.username} (active: ${user.is_active})`);

    if (user.is_active) {
      console.log('ℹ️  User is already active');
    } else {
      // Activate the user
      const activateResult = await client.query(
        `UPDATE users 
         SET is_active = true, updated_at = NOW()
         WHERE id = $1`,
        [user.id]
      );
      console.log('✅ Activated guardian user');
    }

    await client.query('COMMIT');

    console.log('\n✅ Guardian user activation complete!');
    console.log('\n📝 User Details:');
    console.log(`   Username: ${user.username}`);
    console.log(`   Email: ${user.email || 'N/A'}`);
    console.log('   Active: true');
    console.log('\n💡 You can now login with these credentials.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error activating guardian user:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
activateGuardianUser()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
