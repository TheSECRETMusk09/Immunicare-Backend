/**
 * Script to check user roles in the database
 * This helps diagnose role-based access issues
 */

const db = require('./db');

async function checkUserRoles() {
  try {
    console.log('=== Checking User Roles in Database ===\n');

    // Check if roles table exists and has the correct roles
    console.log('1. Checking roles table...');
    try {
      const rolesResult = await db.query(`
        SELECT id, name, display_name, description 
        FROM roles 
        ORDER BY id
      `);

      if (rolesResult.rows.length === 0) {
        console.log('   ⚠️  No roles found in roles table!');
      } else {
        console.log('   ✓ Roles found:');
        rolesResult.rows.forEach((role) => {
          console.log(`      - ID: ${role.id}, Name: ${role.name}, Display: ${role.display_name}`);
        });
      }
    } catch (err) {
      console.log('   ❌ Error checking roles:', err.message);
    }

    console.log('\n2. Checking users table...');

    // Get all users with their roles
    const usersResult = await db.query(`
      SELECT u.id, u.username, u.email, u.is_active, u.role_id, 
             r.name as role_name, r.display_name as role_display_name,
             c.name as clinic_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN clinics c ON u.clinic_id = c.id
      ORDER BY u.id
    `);

    if (usersResult.rows.length === 0) {
      console.log('   ⚠️  No users found in users table!');
    } else {
      console.log(`   ✓ Found ${usersResult.rows.length} users:\n`);

      usersResult.rows.forEach((user) => {
        const status = user.is_active ? '✓ Active' : '✗ Inactive';
        const roleInfo = user.role_name ? user.role_name : '❌ NO ROLE ASSIGNED';
        console.log(`   User ID: ${user.id}`);
        console.log(`      Username: ${user.username}`);
        console.log(`      Email: ${user.email || 'N/A'}`);
        console.log(`      Status: ${status}`);
        console.log(`      Role: ${roleInfo} (role_id: ${user.role_id})`);
        console.log(`      Clinic: ${user.clinic_name || 'N/A'}`);
        console.log('');
      });
    }

    // Check for users without roles
    console.log('3. Checking for users without roles...');
    const noRoleResult = await db.query(`
      SELECT id, username, email, role_id 
      FROM users 
      WHERE role_id IS NULL
    `);

    if (noRoleResult.rows.length > 0) {
      console.log(`   ⚠️  Found ${noRoleResult.rows.length} users without roles:`);
      noRoleResult.rows.forEach((user) => {
        console.log(`      - ${user.username} (ID: ${user.id})`);
      });
    } else {
      console.log('   ✓ All users have roles assigned');
    }

    // Check for inactive users
    console.log('\n4. Checking inactive users...');
    const inactiveResult = await db.query(`
      SELECT id, username, email, role_id 
      FROM users 
      WHERE is_active = false
    `);

    if (inactiveResult.rows.length > 0) {
      console.log(`   Found ${inactiveResult.rows.length} inactive users:`);
      inactiveResult.rows.forEach((user) => {
        console.log(`      - ${user.username} (ID: ${user.id})`);
      });
    } else {
      console.log('   ✓ No inactive users');
    }

    // Summary
    console.log('\n=== Summary ===');
    const activeUsers = usersResult.rows.filter((u) => u.is_active);
    console.log(`Total users: ${usersResult.rows.length}`);
    console.log(`Active users: ${activeUsers.length}`);
    console.log(`Inactive users: ${usersResult.rows.length - activeUsers.length}`);

    // Role distribution
    console.log('\n=== Role Distribution ===');
    const roleCount = {};
    activeUsers.forEach((user) => {
      const role = user.role_name || 'NO ROLE';
      roleCount[role] = (roleCount[role] || 0) + 1;
    });

    Object.entries(roleCount).forEach(([role, count]) => {
      console.log(`   ${role}: ${count} users`);
    });

    console.log('\n=== Recommended Actions ===');
    if (noRoleResult.rows.length > 0) {
      console.log('⚠️  Assign roles to users without roles');
    }
    if (roleCount['NO ROLE'] > 0) {
      console.log('⚠️  Fix users with NULL role_id');
    }
  } catch (error) {
    console.error('Error checking user roles:', error);
  } finally {
    process.exit();
  }
}

checkUserRoles();
