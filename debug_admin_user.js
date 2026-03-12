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

async function debugAdminUser() {
  try {
    console.log('=== ADMIN USER DEBUG ===');

    // Check if admin user exists
    const userResult = await pool.query(`
      SELECT u.id, u.username, u.password_hash, u.role_id, r.name as role_name, c.name as clinic_name
      FROM users u 
      JOIN roles r ON u.role_id = r.id 
      JOIN clinics c ON u.clinic_id = c.id 
      WHERE u.username = 'admin'
    `);

    console.log(
      '1. Admin user query result:',
      userResult.rows.length,
      'rows found'
    );

    if (userResult.rows.length === 0) {
      console.log('❌ No admin user found in database!');
      console.log('Available users:');
      const allUsers = await pool.query(`
        SELECT u.username, r.name as role_name 
        FROM users u 
        JOIN roles r ON u.role_id = r.id
      `);
      console.log(allUsers.rows);
      return;
    }

    const adminUser = userResult.rows[0];
    console.log('2. Admin user details:');
    console.log('   - ID:', adminUser.id);
    console.log('   - Username:', adminUser.username);
    console.log('   - Role:', adminUser.role_name);
    console.log('   - Clinic:', adminUser.clinic_name);
    console.log('   - Has password hash:', !!adminUser.password_hash);
    console.log(
      '   - Password hash length:',
      adminUser.password_hash ? adminUser.password_hash.length : 0
    );
    console.log(
      '   - Password hash prefix:',
      adminUser.password_hash
        ? adminUser.password_hash.substring(0, 20) + '...'
        : 'N/A'
    );

    // Test password verification with known password
    const testPassword = 'Admin2024!';
    console.log('\n3. Testing password verification:');
    console.log('   - Test password:', testPassword);
    console.log('   - Test password length:', testPassword.length);

    if (adminUser.password_hash) {
      const isValid = await bcrypt.compare(
        testPassword,
        adminUser.password_hash
      );
      console.log(
        '   - Password verification result:',
        isValid ? '✅ VALID' : '❌ INVALID'
      );

      if (!isValid) {
        console.log(
          '   - This indicates the stored password hash doesn\'t match \'Admin2024!\''
        );

        // Generate a new hash for comparison
        const newHash = await bcrypt.hash(testPassword, 10);
        console.log(
          '   - New hash for comparison:',
          newHash.substring(0, 20) + '...'
        );
        console.log(
          '   - Stored hash:',
          adminUser.password_hash.substring(0, 20) + '...'
        );
        console.log(
          '   - Hashes match:',
          newHash === adminUser.password_hash ? 'YES' : 'NO'
        );
      }
    } else {
      console.log('   - ❌ No password hash found!');
    }

    // Check roles table
    console.log('\n4. Checking roles table:');
    const rolesResult = await pool.query(`
      SELECT id, name, display_name, hierarchy_level 
      FROM roles 
      WHERE name IN ('super_admin', 'admin')
      ORDER BY hierarchy_level DESC
    `);
    console.log('   - Available admin roles:', rolesResult.rows);

    // Check clinics table
    console.log('\n5. Checking clinics table:');
    const clinicsResult = await pool.query(`
      SELECT id, name, region 
      FROM clinics 
      ORDER BY id
    `);
    console.log('   - Available clinics:', clinicsResult.rows);

    console.log('\n=== END ADMIN USER DEBUG ===');
  } catch (error) {
    console.error('❌ Error during admin user debug:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Run the debug
debugAdminUser();
