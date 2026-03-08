require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');
const fs = require('fs');

async function test() {
  const output = [];

  function log(msg) {
    output.push(msg);
    console.log(msg);
  }

  try {
    log('=== Testing Login System ===\n');

    // Test 1: Check all users
    log('1. Checking all users...');
    const users = await pool.query('SELECT id, username, email, role_id FROM users ORDER BY id LIMIT 20');
    log(`   Found ${users.rows.length} users`);
    log(`   Users: ${JSON.stringify(users.rows)}\n`);

    // Test 2: Check admin user
    log('2. Checking admin user...');
    const admin = await pool.query('SELECT id, username, password_hash, role_id, is_active FROM users WHERE username = \'admin\' OR username = \'superadmin\'');
    log(`   Admin users: ${JSON.stringify(admin.rows)}\n`);

    // Test 3: Test password for admin
    if (admin.rows[0]) {
      log('3. Testing admin password...');
      const hash = admin.rows[0].password_hash;
      const passwords = ['Admin2024!', 'admin', 'password', 'admin123', 'Admin2024'];

      for (const pwd of passwords) {
        const valid = await bcrypt.compare(pwd, hash);
        log(`   "${pwd}": ${valid ? 'VALID' : 'invalid'}`);
      }
      log('');
    }

    // Test 4: Check guardian users
    log('4. Checking guardian users...');
    const guardians = await pool.query(`
      SELECT u.id, u.username, u.email, u.is_active, g.is_password_set
      FROM users u
      JOIN guardians g ON u.guardian_id = g.id
      WHERE u.role_id = 5
      LIMIT 10
    `);
    log(`   Found ${guardians.rows.length} guardian users`);
    log(`   Guardians: ${JSON.stringify(guardians.rows)}\n`);

    // Test 5: Check roles
    log('5. Checking roles...');
    const roles = await pool.query('SELECT id, name FROM roles ORDER BY id');
    log(`   Roles: ${JSON.stringify(roles.rows)}\n`);

    // Test 6: Test guardian password if available
    if (guardians.rows[0]) {
      log('6. Testing guardian password...');
      const userWithHash = await pool.query('SELECT password_hash FROM users WHERE id = $1', [guardians.rows[0].id]);
      if (userWithHash.rows[0] && userWithHash.rows[0].password_hash) {
        const hash = userWithHash.rows[0].password_hash;
        const passwords = ['guardian123', 'Guardian123!', 'password', 'test123'];

        for (const pwd of passwords) {
          const valid = await bcrypt.compare(pwd, hash);
          log(`   "${pwd}": ${valid ? 'VALID' : 'invalid'}`);
        }
      }
      log('');
    }

    log('=== Test Complete ===');

  } catch (err) {
    log(`Error: ${err.message}`);
    log(err.stack);
  } finally {
    await pool.end();

    // Write to file
    fs.writeFileSync('login_diagnosis_result.txt', output.join('\n'));
    console.log('\nResult written to login_diagnosis_result.txt');
  }
}

test();
