require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function checkGuardianLogin() {
  try {
    // Get the password hash from guardians
    const hash = '$2b$10$XTD0pnXwFrstxlfzlCLi5ePKUNyDPnu/7v2tynTEacXyhsnZc8ANW';

    // Try different passwords to find the correct one
    const testPasswords = ['guardian123', 'Admin2024!', 'password123', 'test123', '123456'];

    console.log('Trying common passwords against guardian password hash:');
    for (const pwd of testPasswords) {
      const isValid = await bcrypt.compare(pwd, hash);
      console.log(`  '${pwd}': ${isValid ? '✓ MATCH' : '✗'}`);
    }

    // Also check what the actual password might be
    console.log('\nPassword hash:', hash);

    pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    pool.end();
  }
}

checkGuardianLogin();
