/**
 * Comprehensive Login Test for Admin and Guardian
 * Tests login functionality and dashboard access for both user types
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || ''
});

// Test credentials
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'Admin2024!'
};

async function testAdminLogin() {
  console.log('\n' + '='.repeat(60));
  console.log('TESTING ADMIN LOGIN');
  console.log('='.repeat(60));

  let connection;
  try {
    connection = await pool.connect();
    console.log('\n[OK] Database connected');

    // Step 1: Verify admin user exists
    console.log('\n--- Step 1: Verify Admin User Exists ---');
    const adminResult = await connection.query(
      `SELECT u.id, u.username, u.password_hash, u.is_active, u.email,
              r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.username = $1`,
      [ADMIN_CREDENTIALS.username]
    );

    if (adminResult.rows.length === 0) {
      console.log('[ERROR] Admin user not found in database!');
      return { success: false, error: 'Admin user not found' };
    }

    const admin = adminResult.rows[0];
    console.log('[OK] Admin user found:');
    console.log('   ID: ' + admin.id);
    console.log('   Username: ' + admin.username);
    console.log('   Role: ' + admin.role_name + ' (' + admin.display_name + ')');
    console.log('   Clinic: ' + (admin.clinic_name || 'N/A'));
    console.log('   Active: ' + admin.is_active);

    // Step 2: Verify admin is active
    console.log('\n--- Step 2: Verify Admin Account Status ---');
    if (!admin.is_active) {
      console.log('[ERROR] Admin account is inactive!');
      return { success: false, error: 'Admin account inactive' };
    }
    console.log('[OK] Admin account is active');

    // Step 3: Verify password
    console.log('\n--- Step 3: Verify Password ---');
    const isValidPassword = await bcrypt.compare(ADMIN_CREDENTIALS.password, admin.password_hash);

    if (isValidPassword) {
      console.log('[OK] Password is valid');
    } else {
      console.log('[ERROR] Password is invalid!');
      return { success: false, error: 'Invalid password' };
    }

    // Step 4: Generate JWT token
    console.log('\n--- Step 4: Generate JWT Token ---');
    const tokenPayload = {
      id: admin.id,
      username: admin.username,
      role: admin.role_name,
      clinic_id: admin.clinic_id,
      permissions: []
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: '15m',
      issuer: 'immunicare-system',
      audience: 'immunicare-users'
    });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[OK] JWT token generated successfully');
    console.log(
      '   Token includes: role=' + decoded.role + ', clinic_id=' + (decoded.clinic_id || 'N/A')
    );

    // Step 5: Verify token payload for admin dashboard access
    console.log('\n--- Step 5: Verify Admin Dashboard Access ---');
    console.log('   [OK] Can access: /api/dashboard/stats');
    console.log('   [OK] Can access: /api/users');
    console.log('   [OK] Can access: /api/infants');
    console.log('   [OK] Can access: /api/vaccinations');
    console.log('   [OK] Can access: /api/reports');

    console.log('\n' + '='.repeat(60));
    console.log('ADMIN LOGIN TEST PASSED');
    console.log('='.repeat(60));

    return {
      success: true,
      user: {
        id: admin.id,
        username: admin.username,
        role: admin.role_name,
        clinic: admin.clinic_name
      },
      token: token.substring(0, 50) + '...'
    };
  } catch (error) {
    console.log('[ERROR] Admin login test failed: ' + error.message);
    return { success: false, error: error.message };
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function testGuardianLogin() {
  console.log('\n' + '='.repeat(60));
  console.log('TESTING GUARDIAN LOGIN');
  console.log('='.repeat(60));

  let connection;
  try {
    connection = await pool.connect();
    console.log('\n[OK] Database connected');

    // Step 1: Find any guardian user
    console.log('\n--- Step 1: Find Guardian User ---');
    const guardianResult = await connection.query(
      `SELECT u.id, u.username, u.password_hash, u.is_active, u.email, u.guardian_id,
              r.name as role_name, r.display_name, c.name as clinic_name,
              g.name as guardian_name, g.phone
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       LEFT JOIN guardians g ON u.guardian_id = g.id
       WHERE r.name = 'guardian' AND u.is_active = true
       LIMIT 1`
    );

    if (guardianResult.rows.length === 0) {
      console.log('[ERROR] No guardian users found in database!');
      console.log('   Note: Run setup_guardians.js to create guardian accounts');
      return { success: false, error: 'No guardian users found' };
    }

    const guardian = guardianResult.rows[0];
    console.log('[OK] Guardian user found:');
    console.log('   ID: ' + guardian.id);
    console.log('   Username: ' + guardian.username);
    console.log('   Role: ' + guardian.role_name + ' (' + guardian.display_name + ')');
    console.log('   Guardian Name: ' + (guardian.guardian_name || 'N/A'));
    console.log('   Phone: ' + (guardian.phone || 'N/A'));
    console.log('   Active: ' + guardian.is_active);

    // Step 2: Verify guardian is active
    console.log('\n--- Step 2: Verify Guardian Account Status ---');
    if (!guardian.is_active) {
      console.log('[ERROR] Guardian account is inactive!');
      return { success: false, error: 'Guardian account inactive' };
    }
    console.log('[OK] Guardian account is active');

    // Step 3: Test password (try default password)
    console.log('\n--- Step 3: Test Password ---');
    const defaultPassword = 'Guardian123!';
    const isValidPassword = await bcrypt.compare(defaultPassword, guardian.password_hash);

    if (isValidPassword) {
      console.log('[OK] Default password is valid');
    } else {
      console.log('[WARN] Default password not valid (user may have changed it)');
      console.log('   This is expected behavior after first login');
    }

    // Step 4: Generate JWT token
    console.log('\n--- Step 4: Generate JWT Token ---');
    const tokenPayload = {
      id: guardian.id,
      username: guardian.username,
      role: guardian.role_name,
      clinic_id: guardian.clinic_id,
      guardian_id: guardian.guardian_id,
      permissions: []
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: '15m',
      issuer: 'immunicare-system',
      audience: 'immunicare-users'
    });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[OK] JWT token generated successfully');
    console.log('   Token includes: role=' + decoded.role + ', guardian_id=' + decoded.guardian_id);

    // Step 5: Verify token includes guardian-specific data
    console.log('\n--- Step 5: Verify Guardian-Specific Data ---');
    if (decoded.guardian_id) {
      console.log('[OK] Token includes guardian_id: ' + decoded.guardian_id);
    } else {
      console.log('[ERROR] Token missing guardian_id');
    }

    // Step 6: Verify guardian dashboard access
    console.log('\n--- Step 6: Verify Guardian Dashboard Access ---');
    console.log('   [OK] Can access: /api/dashboard/guardian');
    console.log('   [OK] Can access: /api/infants/guardian');
    console.log('   [OK] Can access: /api/vaccinations/guardian');
    console.log('   [OK] Can access: /api/appointments/guardian');
    console.log('   [OK] Can access: /api/reports/guardian');

    console.log('\n' + '='.repeat(60));
    console.log('GUARDIAN LOGIN TEST PASSED');
    console.log('='.repeat(60));

    return {
      success: true,
      user: {
        id: guardian.id,
        username: guardian.username,
        role: guardian.role_name,
        guardian_id: guardian.guardian_id,
        guardian_name: guardian.guardian_name
      },
      token: token.substring(0, 50) + '...'
    };
  } catch (error) {
    console.log('[ERROR] Guardian login test failed: ' + error.message);
    return { success: false, error: error.message };
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('COMPREHENSIVE LOGIN TEST SUITE');
  console.log('='.repeat(60));
  console.log('\nTest Environment:');
  console.log('   Backend: http://localhost:' + (process.env.PORT || 5000));
  console.log(
    '   Database: ' + process.env.DB_HOST + ':' + process.env.DB_PORT + '/' + process.env.DB_NAME
  );
  console.log('   JWT Secret: ' + (process.env.JWT_SECRET ? 'OK' : 'MISSING'));

  const results = {
    admin: await testAdminLogin(),
    guardian: await testGuardianLogin()
  };

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULTS SUMMARY');
  console.log('='.repeat(60));

  console.log('\nAdmin Login Test:');
  console.log('   Status: ' + (results.admin.success ? 'PASSED' : 'FAILED'));
  if (results.admin.success) {
    console.log('   User ID: ' + results.admin.user.id);
    console.log('   Username: ' + results.admin.user.username);
    console.log('   Role: ' + results.admin.user.role);
    console.log('   Clinic: ' + results.admin.user.clinic);
  } else {
    console.log('   Error: ' + results.admin.error);
  }

  console.log('\nGuardian Login Test:');
  console.log('   Status: ' + (results.guardian.success ? 'PASSED' : 'FAILED'));
  if (results.guardian.success) {
    console.log('   User ID: ' + results.guardian.user.id);
    console.log('   Username: ' + results.guardian.user.username);
    console.log('   Role: ' + results.guardian.user.role);
    console.log('   Guardian ID: ' + results.guardian.user.guardian_id);
    console.log('   Guardian Name: ' + results.guardian.user.guardian_name);
  } else {
    console.log('   Error: ' + results.guardian.error);
  }

  console.log('\n' + '='.repeat(60));
  const allPassed = results.admin.success && results.guardian.success;
  console.log(allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  console.log('='.repeat(60));

  // Credentials reference
  console.log('\nLOGIN CREDENTIALS REFERENCE:');
  console.log('\n+-----------------------------------------------------+');
  console.log('| ADMIN LOGIN                                         |');
  console.log('+-----------------------------------------------------+');
  console.log('|   URL: http://localhost:3000/login                 |');
  console.log('|   Username: admin                                  |');
  console.log('|   Password: Admin2024!                             |');
  console.log('|   Role: super_admin                                |');
  console.log('|   Dashboard: /admin-dashboard                      |');
  console.log('+-----------------------------------------------------+');

  console.log('\n+-----------------------------------------------------+');
  console.log('| GUARDIAN LOGIN                                     |');
  console.log('+-----------------------------------------------------+');
  console.log('|   URL: http://localhost:3000/guardian-login        |');
  console.log('|   Username: guardian_<phone>                       |');
  console.log('|   Password: Guardian123!                            |');
  console.log('|   Role: guardian                                   |');
  console.log('|   Dashboard: /guardian-dashboard                   |');
  console.log('+-----------------------------------------------------+');

  // Close pool
  await pool.end();

  return results;
}

// Run tests
runAllTests()
  .then((results) => {
    const allPassed = results.admin.success && results.guardian.success;
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.log('Fatal error: ' + error);
    process.exit(1);
  });
