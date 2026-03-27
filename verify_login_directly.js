const bcrypt = require('bcryptjs');
const pool = require('./db');

async function verifyLogin() {
  try {
    console.log('Testing direct password verification...\n');
    
    // Get admin user
    const adminResult = await pool.query(`
      SELECT id, username, password_hash, role, email 
      FROM users 
      WHERE username = $1
    `, ['defense.admin']);
    
    if (adminResult.rows.length === 0) {
      console.error('Admin user not found!');
      return;
    }
    
    const admin = adminResult.rows[0];
    console.log('Admin user:', admin.username);
    console.log('Email:', admin.email);
    console.log('Role:', admin.role);
    console.log('Has password_hash:', !!admin.password_hash);
    console.log('');
    
    // Test the password from seed script
    const testPassword = 'AdminDemo2026!';
    console.log(`Testing password: "${testPassword}"`);
    
    const matches = await bcrypt.compare(testPassword, admin.password_hash);
    console.log(`Password matches: ${matches}\n`);
    
    if (matches) {
      console.log('✅ Password verification successful!');
      console.log('The issue is in the login API logic, not the credentials.\n');
      
      // Check what the login endpoint expects
      console.log('Checking login endpoint requirements...');
      console.log('Username field in DB:', admin.username);
      console.log('Email field in DB:', admin.email);
      console.log('\nTry logging in with:');
      console.log(`  Username: ${admin.username}`);
      console.log(`  Password: ${testPassword}`);
      console.log('\nOR with email:');
      console.log(`  Username: ${admin.email}`);
      console.log(`  Password: ${testPassword}`);
    } else {
      console.log('❌ Password does not match!');
      console.log('The password in the database is different from the seed script.\n');
      
      // Try other common passwords
      const otherPasswords = [
        'Admin@2024',
        'admin123',
        'Administrator@2024',
        'Defense@2024'
      ];
      
      console.log('Testing other common passwords...\n');
      for (const pwd of otherPasswords) {
        const match = await bcrypt.compare(pwd, admin.password_hash);
        if (match) {
          console.log(`✅ Found matching password: "${pwd}"`);
          break;
        }
      }
    }
    
    // Also test guardian
    console.log('\n--- Testing Guardian User ---\n');
    
    const guardianResult = await pool.query(`
      SELECT id, username, password_hash, role, email 
      FROM users 
      WHERE username = $1
    `, ['demo.guardian.0001']);
    
    if (guardianResult.rows.length > 0) {
      const guardian = guardianResult.rows[0];
      console.log('Guardian user:', guardian.username);
      console.log('Email:', guardian.email);
      
      const guardianPassword = 'GuardianDemo2026!';
      const guardianMatches = await bcrypt.compare(guardianPassword, guardian.password_hash);
      console.log(`Password "${guardianPassword}" matches: ${guardianMatches}\n`);
      
      if (!guardianMatches) {
        const otherPwds = ['Guardian@2024', 'guardian123', 'Guardian123'];
        for (const pwd of otherPwds) {
          const match = await bcrypt.compare(pwd, guardian.password_hash);
          if (match) {
            console.log(`✅ Found matching guardian password: "${pwd}"`);
            break;
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

verifyLogin();
