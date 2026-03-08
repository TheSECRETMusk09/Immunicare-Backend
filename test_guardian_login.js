/**
 * Guardian Login Test Script
 * Tests guardian login functionality
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const GUARDIAN_DEFAULT_PASSWORD = 'Guardian123!';

async function testGuardianLogin() {
  console.log('=== Guardian Login Test ===\n');

  let connection;
  try {
    connection = await pool.connect();
    console.log('✅ Connected to database\n');

    // Step 1: Verify guardian role exists
    console.log('Step 1: Checking guardian role...');
    const roleResult = await connection.query(
      'SELECT id, name, display_name FROM roles WHERE name = \'guardian\''
    );
    if (roleResult.rows.length === 0) {
      console.log('❌ Guardian role not found!');
      return;
    }
    console.log(
      `✅ Guardian role found: ${roleResult.rows[0].display_name} (ID: ${roleResult.rows[0].id})\n`
    );

    // Step 2: Verify guardian user exists
    console.log('Step 2: Checking guardian user accounts...');
    const userResult = await connection.query(
      `SELECT u.id, u.username, u.guardian_id, r.name as role_name 
       FROM users u 
       JOIN roles r ON u.role_id = r.id 
       WHERE r.name = 'guardian'`
    );
    if (userResult.rows.length === 0) {
      console.log('❌ No guardian user accounts found!');
      return;
    }
    console.log(`✅ Found ${userResult.rows.length} guardian user(s):`);
    for (const user of userResult.rows) {
      console.log(
        `   - ${user.username} (ID: ${user.id}, Guardian ID: ${user.guardian_id})`
      );
    }
    console.log();

    // Step 3: Test password verification
    console.log('Step 3: Testing password verification...');
    const testUser = userResult.rows[0];
    const passwordResult = await connection.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [testUser.id]
    );

    const isValid = await bcrypt.compare(
      GUARDIAN_DEFAULT_PASSWORD,
      passwordResult.rows[0].password_hash
    );
    if (isValid) {
      console.log('✅ Password verification successful!\n');
    } else {
      console.log('❌ Password verification failed!\n');
      return;
    }

    // Step 4: Test JWT token generation
    console.log('Step 4: Testing JWT token generation...');
    const tokenPayload = {
      id: testUser.id,
      username: testUser.username,
      role: testUser.role_name,
      clinic_id: null,
      guardian_id: testUser.guardian_id,
      permissions: []
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: '24h',
      issuer: 'immunicare-system',
      audience: 'immunicare-users'
    });

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ JWT token generated successfully!');
    console.log(
      `   Token includes: role=${decoded.role}, guardian_id=${decoded.guardian_id}\n`
    );

    // Step 5: Test login query
    console.log('Step 5: Testing login query...');
    const loginResult = await connection.query(
      `SELECT u.id, u.username, u.password_hash, u.role_id, u.clinic_id, u.guardian_id,
              r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.username = $1 AND u.is_active = true`,
      [testUser.username]
    );

    if (loginResult.rows.length === 0) {
      console.log('❌ Login query failed - user not found!');
      return;
    }
    console.log(
      `✅ Login query successful for user: ${loginResult.rows[0].username}`
    );
    console.log(`   Role: ${loginResult.rows[0].role_name}`);
    console.log(`   Clinic: ${loginResult.rows[0].clinic_name || 'N/A'}`);
    console.log(
      `   Guardian ID: ${loginResult.rows[0].guardian_id || 'N/A'}\n`
    );

    console.log('=== All Tests Passed! ===\n');
    console.log('Guardian login is ready to use.');
    console.log('\nTest credentials:');
    console.log(`  Username: ${testUser.username}`);
    console.log(`  Password: ${GUARDIAN_DEFAULT_PASSWORD}`);
    console.log('  ⚠️  Users should change password on first login\n');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    if (connection) {
      connection.release();
    }
    await pool.end();
  }
}

testGuardianLogin();
