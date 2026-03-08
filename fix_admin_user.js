const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!'
});

async function fixAdminUser() {
  try {
    console.log('=== FIXING ADMIN USER ===');

    // First, ensure the clinic exists
    await pool.query(`
      INSERT INTO clinics (name, region, address, contact) 
      VALUES ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number')
      ON CONFLICT DO NOTHING;
    `);

    // Generate correct password hash
    const password = 'Admin2024!';
    const passwordHash = await bcrypt.hash(password, 10);

    console.log('Generated password hash for \'Admin2024!\':', passwordHash);

    // Check if admin user exists
    const existingUser = await pool.query(
      `SELECT u.id, u.username, u.password_hash, u.role_id, r.name as role_name
       FROM users u 
       JOIN roles r ON u.role_id = r.id 
       WHERE u.username = 'admin'`
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      console.log('Found existing admin user:', user.username);

      // Verify current password
      const isValid = await bcrypt.compare(password, user.password_hash);
      console.log('Current password is valid:', isValid);

      if (!isValid) {
        console.log('Updating admin user password...');
        await pool.query(
          'UPDATE users SET password_hash = $1 WHERE username = \'admin\'',
          [passwordHash]
        );
        console.log('✅ Admin user password updated successfully!');
      } else {
        console.log('✅ Admin user password is already correct!');
      }
    } else {
      console.log('Creating new admin user...');

      // Create super admin user
      const result = await pool.query(
        `INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
         SELECT 
           'admin',
           $1,
           r.id,
           c.id,
           'admin@immunicare.com',
           NULL
         FROM roles r, clinics c 
         WHERE r.name = 'super_admin' AND c.name = 'Main Health Center'
         ON CONFLICT (username) DO UPDATE SET password_hash = $1
         RETURNING id, username;`,
        [passwordHash]
      );

      console.log('✅ Admin user created/updated successfully!');
      console.log('Admin credentials:');
      console.log('- Username: admin');
      console.log('- Password: Admin2024!');
    }

    // Verify the user exists and can be authenticated
    const verificationResult = await pool.query(
      `SELECT u.id, u.username, u.password_hash, r.name as role_name
       FROM users u 
       JOIN roles r ON u.role_id = r.id 
       WHERE u.username = 'admin'`
    );

    if (verificationResult.rows.length > 0) {
      const user = verificationResult.rows[0];
      const isValid = await bcrypt.compare(password, user.password_hash);

      if (isValid) {
        console.log('✅ Admin user verification successful!');
        console.log('📋 Admin Credentials:');
        console.log('Username: admin');
        console.log('Password: Admin2024!');
        console.log('Role: Super Administrator');
      } else {
        console.log('❌ Admin user verification failed!');
      }
    }
  } catch (error) {
    console.error('❌ Error fixing admin user:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Run the fix
fixAdminUser();
