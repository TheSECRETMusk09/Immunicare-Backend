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

async function setupAdminUser() {
  try {
    console.log('Setting up admin user...');

    // First, ensure the clinic exists
    await pool.query(`
      INSERT INTO clinics (name, region, address, contact) 
      VALUES ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number')
      ON CONFLICT DO NOTHING;
    `);

    // Generate password hash
    const password = 'Immunicare2026!';
    const passwordHash = await bcrypt.hash(password, 10);

    // Create super admin user
    const superAdminResult = await pool.query(
      `
      INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
      SELECT 
        'admin',
        $1,
        r.id,
        c.id,
        'administrator@immunicare.com',
        NULL
      FROM roles r, clinics c 
      WHERE r.name = 'super_admin' AND c.name = 'Main Health Center'
      ON CONFLICT (username) DO NOTHING
      RETURNING id, username;
    `,
      [passwordHash]
    );

    // Create admin user
    const adminResult = await pool.query(
      `
      INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
      SELECT 
        'administrator',
        $1,
        r.id,
        c.id,
        'administrator@immunicare.com',
        NULL
      FROM roles r, clinics c 
      WHERE r.name = 'admin' AND c.name = 'Main Health Center'
      ON CONFLICT (username) DO NOTHING
      RETURNING id, username;
    `,
      [passwordHash]
    );

    // Grant permissions to super_admin role
    await pool.query(`
      INSERT INTO role_permissions (role_id, permission_id, granted_by)
      SELECT r.id, p.id, 
        (SELECT u.id FROM users u WHERE u.username = 'admin' LIMIT 1)
      FROM roles r, permissions p
      WHERE r.name = 'super_admin' 
      AND p.name IN (
        'users.create', 'users.read', 'users.update', 'users.delete',
        'infants.create', 'infants.read', 'infants.update', 'infants.delete',
        'vaccinations.create', 'vaccinations.read', 'vaccinations.update',
        'reports.generate', 'reports.read'
      )
      ON CONFLICT DO NOTHING;
    `);

    // Grant permissions to admin role
    await pool.query(`
      INSERT INTO role_permissions (role_id, permission_id, granted_by)
      SELECT r.id, p.id,
        (SELECT u.id FROM users u WHERE u.username = 'admin' LIMIT 1)
      FROM roles r, permissions p
      WHERE r.name = 'admin' 
      AND p.name IN (
        'users.create', 'users.read', 'users.update', 'users.delete',
        'infants.create', 'infants.read', 'infants.update', 'infants.delete',
        'vaccinations.create', 'vaccinations.read', 'vaccinations.update',
        'reports.generate', 'reports.read'
      )
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Admin users created successfully!');
    console.log('\n📋 Admin Credentials:');
    console.log('Username: admin');
    console.log('Password: Immunicare2026!');
    console.log('Email: administrator@immunicare.com');
    console.log('Role: Super Administrator');
    console.log('');
    console.log('Username: administrator');
    console.log('Password: Immunicare2026!');
    console.log('Email: administrator@immunicare.com');
    console.log('Role: Administrator');
    console.log('\n🌐 Access the dashboard at: http://localhost:3000');
  } catch (error) {
    console.error('❌ Error setting up admin user:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Run the setup
setupAdminUser();
