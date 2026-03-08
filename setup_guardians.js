/**
 * Guardian Access Setup Script
 * Phase 1: Database Setup for Guardian Login
 *
 * This script:
 * 1. Creates the guardian role if it doesn't exist
 * 2. Creates a "Guardian Portal" clinic for virtual access
 * 3. Adds guardian_id column to users table
 * 4. Creates user accounts for existing guardians
 *
 * Usage: node setup_guardians.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const GUARDIAN_DEFAULT_PASSWORD = 'Guardian123!';

async function setupGuardians() {
  console.log('=== Guardian Access Setup ===\n');

  let connection;
  try {
    connection = await pool.connect();
    console.log('✅ Connected to database\n');

    // Step 1: Create guardian role
    console.log('Step 1: Creating guardian role...');
    const roleResult = await connection.query(`
      SELECT id FROM roles WHERE name = 'guardian'
    `);

    let guardianRoleId;
    if (roleResult.rows.length === 0) {
      const insertRole = await connection.query(`
        INSERT INTO roles (name, display_name, is_system_role, hierarchy_level)
        VALUES ('guardian', 'Guardian', false, 20)
        RETURNING id
      `);
      guardianRoleId = insertRole.rows[0].id;
      console.log('✅ Created guardian role (ID: ' + guardianRoleId + ')\n');
    } else {
      guardianRoleId = roleResult.rows[0].id;
      console.log(
        '✅ Guardian role already exists (ID: ' + guardianRoleId + ')\n'
      );
    }

    // Step 2: Create Guardian Portal clinic
    console.log('Step 2: Creating Guardian Portal clinic...');
    const clinicResult = await connection.query(`
      SELECT id FROM clinics WHERE name = 'Guardian Portal'
    `);

    let guardianClinicId;
    if (clinicResult.rows.length === 0) {
      const insertClinic = await connection.query(`
        INSERT INTO clinics (name, region, address, contact)
        VALUES ('Guardian Portal', 'Virtual', 'Online Access Only', 'N/A')
        RETURNING id
      `);
      guardianClinicId = insertClinic.rows[0].id;
      console.log(
        '✅ Created Guardian Portal clinic (ID: ' + guardianClinicId + ')\n'
      );
    } else {
      guardianClinicId = clinicResult.rows[0].id;
      console.log(
        '✅ Guardian Portal clinic already exists (ID: ' +
          guardianClinicId +
          ')\n'
      );
    }

    // Step 3: Add guardian_id column to users table
    console.log('Step 3: Adding guardian_id column to users table...');
    try {
      await connection.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_id INTEGER REFERENCES guardians(id)
      `);
      console.log('✅ guardian_id column added/exists\n');
    } catch (err) {
      if (err.code === '42701') {
        // duplicate column
        console.log('✅ guardian_id column already exists\n');
      } else {
        throw err;
      }
    }

    // Step 4: Create user accounts for guardians
    console.log('Step 4: Creating user accounts for guardians...');
    const guardiansResult = await connection.query(`
      SELECT id, name, phone, email, relationship
      FROM guardians
      WHERE name IS NOT NULL AND name != ''
        AND phone IS NOT NULL AND phone != ''
        AND phone != 'invalid-phone'
    `);

    if (guardiansResult.rows.length === 0) {
      console.log('⚠️  No valid guardians found to create accounts for\n');
    } else {
      const hashedPassword = await bcrypt.hash(GUARDIAN_DEFAULT_PASSWORD, 10);
      let createdCount = 0;
      let skippedCount = 0;

      for (const guardian of guardiansResult.rows) {
        // Check if user account already exists for this guardian
        const existingUser = await connection.query(
          `
          SELECT id FROM users WHERE guardian_id = $1
        `,
          [guardian.id]
        );

        if (existingUser.rows.length > 0) {
          console.log(
            '  ⏭️  Skipped: User already exists for guardian \'' +
              guardian.name +
              '\' (ID: ' +
              guardian.id +
              ')'
          );
          skippedCount++;
          continue;
        }

        // Create username from phone number (remove special chars)
        const username = 'guardian_' + guardian.phone.replace(/\D/g, '');

        // Check if username already exists
        const usernameCheck = await connection.query(
          `
          SELECT id FROM users WHERE username = $1
        `,
          [username]
        );

        if (usernameCheck.rows.length > 0) {
          console.log(
            '  ⏭️  Skipped: Username \'' + username + '\' already exists'
          );
          skippedCount++;
          continue;
        }

        // Create user account (using correct column names from actual table)
        await connection.query(
          `
          INSERT INTO users (username, password_hash, role_id, clinic_id, email, phone, full_name, guardian_id, is_active, login_attempts)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 0)
        `,
          [
            username,
            hashedPassword,
            guardianRoleId,
            guardianClinicId,
            guardian.email,
            guardian.phone,
            guardian.name,
            guardian.id
          ]
        );

        console.log(
          '  ✅ Created user account for guardian: ' +
            guardian.name +
            ' (Phone: ' +
            guardian.phone +
            ')'
        );
        createdCount++;
      }

      console.log(
        '\n  Summary: ' +
          createdCount +
          ' accounts created, ' +
          skippedCount +
          ' skipped\n'
      );
    }

    // Step 5: Grant basic permissions to guardian role
    console.log('Step 5: Granting permissions to guardian role...');
    const permissionsResult = await connection.query(`
      SELECT id FROM permissions WHERE name IN ('infants.read', 'vaccinations.read', 'appointments.read', 'reports.read')
    `);

    if (permissionsResult.rows.length > 0) {
      for (const perm of permissionsResult.rows) {
        await connection.query(
          `
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
          [guardianRoleId, perm.id]
        );
      }
      console.log('✅ Basic permissions granted to guardian role\n');
    }

    // Verification
    console.log('=== Setup Complete ===\n');

    console.log('Verification:');
    const finalRoles = await connection.query(
      'SELECT id, name, display_name FROM roles ORDER BY hierarchy_level'
    );
    console.log('  Roles: ' + finalRoles.rows.map((r) => r.name).join(', '));

    const finalUsers = await connection.query(`
      SELECT u.username, r.name as role_name, u.guardian_id
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.name = 'guardian'
    `);
    console.log('  Guardian users: ' + finalUsers.rows.length);

    console.log('\nDefault login credentials:');
    console.log('  Username: guardian_09123456789 (or phone-based username)');
    console.log('  Password: ' + GUARDIAN_DEFAULT_PASSWORD);
    console.log('  ⚠️  Users should change password on first login\n');
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      connection.release();
    }
    await pool.end();
  }
}

// Run setup
setupGuardians()
  .then(() => {
    console.log('Guardian setup completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
