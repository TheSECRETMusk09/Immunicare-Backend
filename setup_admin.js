const bcrypt = require('bcryptjs');
const pool = require('./db');

async function setupAdmin() {
  const client = await pool.connect();
  try {
    console.log('Setting up admin user...');

    // Create admin role if not exists
    await pool.query(`
      INSERT INTO roles (name, display_name, is_system_role, hierarchy_level) VALUES
      ('super_admin', 'Super Administrator', true, 100)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Create clinic if not exists
    await pool.query(`
      INSERT INTO clinics (name, region, address, contact)
      VALUES ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number')
      ON CONFLICT DO NOTHING;
    `);

    // Generate password hash
    const password = 'Admin2026!';
    const passwordHash = await bcrypt.hash(password, 10);

    // Create or update admin user
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
      ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role_id = EXCLUDED.role_id,
        clinic_id = EXCLUDED.clinic_id
    `,
      [passwordHash],
    );

    // Verify setup
    const adminCheck = await pool.query(`
      SELECT u.username, r.display_name as role
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.username = 'admin'
    `);
    console.log('Admin user:', adminCheck.rows);
    console.log('✅ Admin setup complete!');
    console.log('Username: admin');
    console.log('Password: Admin2026!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (client) {
      client.release();
    }
    // Don't call pool.end() - let the server continue running
  }
}

setupAdmin();
