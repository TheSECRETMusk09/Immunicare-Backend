const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!',
});

async function quickSetup() {
  try {
    console.log('Quick setup: Creating admin roles and user...');

    // Create admin roles
    await pool.query(`
      INSERT INTO roles (name, display_name, is_system_role, hierarchy_level) VALUES
      ('super_admin', 'Super Administrator', true, 100),
      ('admin', 'Administrator', true, 80),
      ('clinic_manager', 'Clinic Manager', false, 60)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Create clinic
    await pool.query(`
      INSERT INTO clinics (name, region, address, contact)
      VALUES ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number')
      ON CONFLICT DO NOTHING;
    `);

    // Generate password hash
    const password = 'Admin2026!';
    const passwordHash = await bcrypt.hash(password, 10);

    // Create admin user
    await pool.query(
      `
      INSERT INTO users (username, password_hash, role_id, clinic_id, last_login)
      SELECT
        'admin',
        $1,
        r.id,
        c.id,
        NULL
      FROM roles r, clinics c
      WHERE r.name = 'super_admin' AND c.name = 'Main Health Center'
      ON CONFLICT (username) DO NOTHING
    `,
      [passwordHash],
    );

    // Create permissions
    await pool.query(`
      INSERT INTO permissions (name, resource, action, scope, description) VALUES
      ('users.create', 'users', 'create', 'global', 'Create new users'),
      ('users.read', 'users', 'read', 'global', 'View users'),
      ('users.update', 'users', 'update', 'global', 'Update user information'),
      ('users.delete', 'users', 'delete', 'global', 'Delete users'),
      ('infants.create', 'infants', 'create', 'clinic', 'Create infant records'),
      ('infants.read', 'infants', 'read', 'clinic', 'View infant records'),
      ('infants.update', 'infants', 'update', 'clinic', 'Update infant information'),
      ('infants.delete', 'infants', 'delete', 'clinic', 'Delete infant records'),
      ('vaccinations.create', 'vaccinations', 'create', 'clinic', 'Administer vaccinations'),
      ('vaccinations.read', 'vaccinations', 'read', 'clinic', 'View vaccination records'),
      ('vaccinations.update', 'vaccinations', 'update', 'clinic', 'Update vaccination records'),
      ('reports.generate', 'reports', 'create', 'clinic', 'Generate reports'),
      ('reports.read', 'reports', 'read', 'clinic', 'View reports')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Grant all permissions to super_admin role
    await pool.query(`
      INSERT INTO role_permissions (role_id, permission_id, granted_by)
      SELECT r.id, p.id,
        (SELECT u.id FROM users u WHERE u.username = 'admin' LIMIT 1)
      FROM roles r, permissions p
      WHERE r.name = 'super_admin'
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Quick setup completed!');
    console.log('\n📋 Admin Credentials:');
    console.log('Username: admin');
    console.log('Password: Admin2026!');
    console.log('Role: Super Administrator');
    console.log('\n🌐 Access the dashboard at: http://localhost:3000');

    // Verify setup
    const adminCheck = await pool.query(`
      SELECT u.username, r.display_name as role
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.username = 'admin'
    `);
    console.log('Admin user verified:', adminCheck.rows);
  } catch (error) {
    console.error('❌ Error in quick setup:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Run the setup
quickSetup();
