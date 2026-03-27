const axios = require('axios');
const bcrypt = require('bcryptjs');
const pool = require('./db');

const BASE_URL = 'http://localhost:5000/api';

async function testLogin() {
  try {
    console.log('Fetching admin user from database...\n');
    
    const adminResult = await pool.query(`
      SELECT id, username, password_hash, role, email 
      FROM users 
      WHERE role = 'admin' 
      LIMIT 1
    `);
    
    if (adminResult.rows.length === 0) {
      console.error('No admin user found in database!');
      return;
    }
    
    const admin = adminResult.rows[0];
    console.log('Admin user found:');
    console.log(`  Username: ${admin.username}`);
    console.log(`  Email: ${admin.email}`);
    console.log(`  Role: ${admin.role}`);
    console.log(`  Has password hash: ${!!admin.password_hash}\n`);
    
    // Test common passwords
    const testPasswords = [
      'Admin@2024',
      'admin123',
      'Admin123',
      'password',
      'admin',
      'Administrator@2024'
    ];
    
    console.log('Testing password combinations...\n');
    
    for (const password of testPasswords) {
      try {
        const response = await axios.post(`${BASE_URL}/auth/login`, {
          username: admin.username,
          password: password
        }, {
          timeout: 5000,
          validateStatus: () => true
        });
        
        if (response.status === 200 && response.data.success) {
          console.log(`✅ SUCCESS! Password found: "${password}"`);
          console.log(`   Token: ${response.data.token.substring(0, 20)}...`);
          console.log(`   User: ${response.data.user.username} (${response.data.user.role})\n`);
          
          // Now test guardian
          await testGuardianLogin();
          return;
        }
      } catch (error) {
        // Continue to next password
      }
    }
    
    console.log('❌ None of the test passwords worked.');
    console.log('\nTrying to verify password hash directly...\n');
    
    // Try to verify the hash format
    if (admin.password_hash) {
      const isBcrypt = admin.password_hash.startsWith('$2a$') || 
                      admin.password_hash.startsWith('$2b$') || 
                      admin.password_hash.startsWith('$2y$');
      
      console.log(`Password hash format: ${isBcrypt ? 'bcrypt' : 'unknown'}`);
      console.log(`Hash preview: ${admin.password_hash.substring(0, 30)}...\n`);
      
      // Try to match against known hashes
      for (const password of testPasswords) {
        const matches = await bcrypt.compare(password, admin.password_hash);
        if (matches) {
          console.log(`✅ Password hash matches: "${password}"`);
          console.log('   But login API is rejecting it. Check auth logic.\n');
          break;
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

async function testGuardianLogin() {
  console.log('\n=== Testing Guardian Login ===\n');
  
  try {
    const guardianResult = await pool.query(`
      SELECT id, username, password_hash, role, email 
      FROM users 
      WHERE role = 'guardian' 
      LIMIT 1
    `);
    
    if (guardianResult.rows.length === 0) {
      console.error('No guardian user found!');
      return;
    }
    
    const guardian = guardianResult.rows[0];
    console.log('Guardian user found:');
    console.log(`  Username: ${guardian.username}`);
    console.log(`  Email: ${guardian.email}\n`);
    
    const testPasswords = [
      'Guardian@2024',
      'guardian123',
      'Guardian123',
      'password'
    ];
    
    for (const password of testPasswords) {
      try {
        const response = await axios.post(`${BASE_URL}/auth/login`, {
          username: guardian.username,
          password: password
        }, {
          timeout: 5000,
          validateStatus: () => true
        });
        
        if (response.status === 200 && response.data.success) {
          console.log(`✅ SUCCESS! Guardian password: "${password}"`);
          console.log(`   Username: ${guardian.username}\n`);
          return;
        }
      } catch (error) {
        // Continue
      }
    }
    
    console.log('❌ Guardian login failed with test passwords\n');
    
  } catch (error) {
    console.error('Guardian test error:', error.message);
  }
}

testLogin();
