/**
 * Admin Data Setup Script
 * Updates and configures admin user data in the database
 */

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: String(process.env.DB_PASSWORD) || ''
});

// Admin data to be configured
const adminUsers = [
  {
    username: 'admin',
    password: 'AdminImmunicare2026!',
    fullName: 'System Administrator',
    email: 'admin@immunicare.com',
    contact: '+63 917 123 4567',
    role: 'super_admin',
    position: 'System Administrator',
    department: 'IT Department'
  },
  {
    username: 'administrator',
    password: 'AdminImmunicare2026!',
    fullName: 'Maria Clara Santos',
    email: 'maria.santos@immunicare.com',
    contact: '+63 917 234 5678',
    role: 'admin',
    position: 'Clinic Administrator',
    department: 'Administration'
  },
  {
    username: 'dr_smith',
    password: 'DoctorImmunicare2026!',
    fullName: 'Dr. John Smith',
    email: 'john.smith@immunicare.com',
    contact: '+63 917 345 6789',
    role: 'doctor',
    position: 'Medical Officer',
    department: 'Medical Services'
  },
  {
    username: 'nurse_joyce',
    password: 'NurseImmunicare2026!',
    fullName: 'Joyce Ann Reyes',
    email: 'joyce.reyes@immunicare.com',
    contact: '+63 917 456 7890',
    role: 'nurse',
    position: 'Senior Nurse',
    department: 'Nursing Services'
  },
  {
    username: 'midwife_elena',
    password: 'MidwifeImmunicare2026!',
    fullName: 'Elena Mae Dela Cruz',
    email: 'elena.delacruz@immunicare.com',
    contact: '+63 917 567 8901',
    role: 'midwife',
    position: 'Midwife',
    department: 'Maternal Health'
  }
];

async function setupAdminData() {
  try {
    console.log('🔧 Setting up admin data...\n');

    // Ensure healthcare facility exists
    await pool.query(`
      INSERT INTO healthcare_facilities (name, region, address, contact, facility_type)
      VALUES ('Main Health Center', 'Region 1', '123 Health Center Street, City', '+63 900 123 4567', 'health_center')
      ON CONFLICT (name) DO NOTHING;
    `);
    console.log('✓ Healthcare facility verified/created');

    // Ensure clinic exists (for users table)
    await pool.query(`
      INSERT INTO clinics (name, region, address, contact)
      VALUES ('Main Health Center', 'Region 1', '123 Health Center Street, City', '+63 900 123 4567')
      ON CONFLICT DO NOTHING;
    `);
    console.log('✓ Clinic verified/created');

    // Ensure roles exist
    const roles = ['super_admin', 'admin', 'doctor', 'nurse', 'midwife', 'guardian'];
    for (const role of roles) {
      await pool.query(
        `
        INSERT INTO roles (name, display_name, description, hierarchy_level)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (name) DO NOTHING;
      `,
        [
          role,
          role.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
          `${role.replace('_', ' ')} role for the system`,
          roles.indexOf(role) + 1
        ]
      );
    }
    console.log('✓ Roles verified/created');

    // Insert or update admin users
    for (const admin of adminUsers) {
      const passwordHash = await bcrypt.hash(admin.password, 10);

      // Get role ID
      const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [admin.role]);
      const roleId = roleResult.rows[0]?.id;

      // Get clinic ID
      const clinicResult = await pool.query('SELECT id FROM clinics WHERE name = $1', [
        'Main Health Center'
      ]);
      const clinicId = clinicResult.rows[0]?.id;

      // Insert or update user
      await pool.query(
        `
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (username) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          role_id = EXCLUDED.role_id,
          clinic_id = EXCLUDED.clinic_id,
          email = EXCLUDED.email,
          contact = EXCLUDED.contact,
          is_active = EXCLUDED.is_active
        RETURNING id, username;
      `,
        [admin.username, passwordHash, roleId, clinicId, admin.email, admin.contact]
      );

      console.log(`✓ Admin user "${admin.username}" configured (${admin.role})`);
    }

    console.log('\n📋 Admin Data Configuration Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Username          | Role          | Email');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const admin of adminUsers) {
      console.log(`${admin.username.padEnd(17)} | ${admin.role.padEnd(13)} | ${admin.email}`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🔑 Default Password: Immunicare2026!');
    console.log('⚠️  Please change passwords after first login for security.\n');
  } catch (error) {
    console.error('❌ Error setting up admin data:', error.message);
    throw error;
  }
}

async function getAdminUsers() {
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.username,
        u.email,
        u.contact,
        u.last_login,
        u.is_active,
        u.created_at,
        r.name as role,
        r.display_name as role_display,
        c.name as clinic_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN clinics c ON u.clinic_id = c.id
      WHERE r.name IN ('super_admin', 'admin', 'doctor', 'nurse', 'midwife')
      ORDER BY r.hierarchy_level DESC, u.created_at ASC
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching admin users:', error.message);
    throw error;
  }
}

async function getAdminUserById(id) {
  try {
    const result = await pool.query(
      `
      SELECT 
        u.id,
        u.username,
        u.email,
        u.contact,
        u.last_login,
        u.is_active,
        u.created_at,
        r.name as role,
        r.display_name as role_display,
        c.name as clinic_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN clinics c ON u.clinic_id = c.id
      WHERE u.id = $1
    `,
      [id]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching admin user:', error.message);
    throw error;
  }
}

async function updateAdminUser(id, data) {
  try {
    const { email, contact, is_active } = data;

    const result = await pool.query(
      `
      UPDATE users 
      SET 
        email = COALESCE($1, email),
        contact = COALESCE($2, contact),
        is_active = COALESCE($3, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING id, username, email, contact, is_active;
    `,
      [email, contact, is_active, id]
    );

    return result.rows[0];
  } catch (error) {
    console.error('Error updating admin user:', error.message);
    throw error;
  }
}

async function resetAdminPassword(id, newPassword) {
  try {
    const passwordHash = await bcrypt.hash(newPassword, 10);

    const result = await pool.query(
      `
      UPDATE users 
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, username;
    `,
      [passwordHash, id]
    );

    return result.rows[0];
  } catch (error) {
    console.error('Error resetting admin password:', error.message);
    throw error;
  }
}

// Run setup if executed directly
if (require.main === module) {
  setupAdminData()
    .then(() => {
      console.log('✅ Admin data setup completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Admin data setup failed:', error);
      process.exit(1);
    });
}

module.exports = {
  setupAdminData,
  getAdminUsers,
  getAdminUserById,
  updateAdminUser,
  resetAdminPassword
};
