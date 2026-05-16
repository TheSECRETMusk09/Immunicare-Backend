/**
 * Unlock Admin Account Script
 *
 * This script unlocks the admin account by:
 * 1. Clearing failed login attempts
 * 2. Removing account lock
 * 3. Resetting brute force protection counters
 */

require('dotenv').config();
const pool = require('./db');

async function unlockAdminAccount() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🔓 Unlocking admin account...\n');

    // Check if admin account exists
    const adminCheck = await client.query(
      `SELECT u.id, u.username, u.email, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'admin' OR u.username LIKE '%admin%'
       LIMIT 1`
    );

    if (adminCheck.rows.length === 0) {
      console.log('❌ No admin account found');
      return;
    }

    const admin = adminCheck.rows[0];
    console.log(`✅ Found admin account: ${admin.username} (${admin.email})`);

    // Clear failed login attempts from security_events table
    const deleteResult = await client.query(
      `DELETE FROM security_events 
       WHERE user_id = $1 
       AND event_type IN ('LOGIN_FAILED', 'BRUTE_FORCE_DETECTED')`,
      [admin.id]
    );
    console.log(`🗑️  Cleared ${deleteResult.rowCount} failed login events`);

    // Check if there's a brute force protection table
    const bruteForceTableCheck = await client.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables 
         WHERE table_name = 'brute_force_protection'
       )`
    );

    if (bruteForceTableCheck.rows[0].exists) {
      const deleteBruteForce = await client.query(
        'DELETE FROM brute_force_protection WHERE identifier = $1',
        [admin.username]
      );
      console.log(`🗑️  Cleared ${deleteBruteForce.rowCount} brute force records`);
    }

    // Check if there's a login_attempts table
    const loginAttemptsTableCheck = await client.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables 
         WHERE table_name = 'login_attempts'
       )`
    );

    if (loginAttemptsTableCheck.rows[0].exists) {
      const deleteLoginAttempts = await client.query(
        'DELETE FROM login_attempts WHERE username = $1',
        [admin.username]
      );
      console.log(`🗑️  Cleared ${deleteLoginAttempts.rowCount} login attempt records`);
    }

    // Check if users table has locked_until column
    const columnCheck = await client.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.columns 
         WHERE table_name = 'users' 
         AND column_name = 'locked_until'
       )`
    );

    if (columnCheck.rows[0].exists) {
      await client.query(
        `UPDATE users 
         SET locked_until = NULL 
         WHERE id = $1`,
        [admin.id]
      );
      console.log('🔓 Unlocked account (cleared locked_until)');
    }

    await client.query('COMMIT');

    console.log('\n✅ Admin account successfully unlocked!');
    console.log('\n📝 Admin Details:');
    console.log(`   Username: ${admin.username}`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Role: ${admin.role_name}`);
    console.log('\n💡 You can now login with your admin credentials.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error unlocking admin account:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
unlockAdminAccount()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
