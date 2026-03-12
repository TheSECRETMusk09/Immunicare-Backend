/**
 * Guardian Login Setup - Fixed Version
 * Creates guardian users for testing
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || ''
});

const GUARDIAN_DEFAULT_PASSWORD = 'Guardian123!';

async function createGuardianUser() {
  console.log('\n' + '='.repeat(60));
  console.log('CREATING GUARDIAN TEST USER');
  console.log('='.repeat(60));

  let connection;
  try {
    connection = await pool.connect();
    console.log('\n[OK] Database connected');

    // Step 1: Get guardian role ID
    console.log('\n--- Step 1: Get Guardian Role ---');
    const roleResult = await connection.query('SELECT id FROM roles WHERE name = \'guardian\'');

    if (roleResult.rows.length === 0) {
      console.log('[ERROR] Guardian role not found!');
      return;
    }

    const guardianRoleId = roleResult.rows[0].id;
    console.log('[OK] Guardian role ID: ' + guardianRoleId);

    // Step 2: Get or create Guardian Portal clinic
    console.log('\n--- Step 2: Get Guardian Portal Clinic ---');
    const clinicResult = await connection.query(
      'SELECT id FROM clinics WHERE name = \'Guardian Portal\''
    );

    let guardianClinicId;
    if (clinicResult.rows.length > 0) {
      guardianClinicId = clinicResult.rows[0].id;
      console.log('[OK] Guardian Portal clinic ID: ' + guardianClinicId);
    } else {
      const createClinic = await connection.query(`
        INSERT INTO clinics (name, region, address, contact)
        VALUES ('Guardian Portal', 'Virtual', 'Online Portal', 'N/A')
        RETURNING id
      `);
      guardianClinicId = createClinic.rows[0].id;
      console.log('[OK] Created Guardian Portal clinic ID: ' + guardianClinicId);
    }

    // Step 3: Create guardian record
    console.log('\n--- Step 3: Create Guardian Record ---');
    const guardianResult = await connection.query(`
      INSERT INTO guardians (name, phone, email, address, relationship)
      VALUES ('Maria Dela Cruz', '09123456789', 'maria.dela.cruz@email.com', '123 Main St, City', 'mother')
      RETURNING id
    `);

    const guardianId = guardianResult.rows[0].id;
    console.log('[OK] Created guardian record ID: ' + guardianId);

    // Step 4: Create user account
    console.log('\n--- Step 4: Create User Account ---');
    const hashedPassword = await bcrypt.hash(GUARDIAN_DEFAULT_PASSWORD, 10);

    // Check if user already exists
    const existingUser = await connection.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      ['maria.dela.cruz', 'maria.dela.cruz@email.com']
    );

    if (existingUser.rows.length > 0) {
      console.log('[INFO] User already exists, updating password...');
      await connection.query(
        'UPDATE users SET password_hash = $1, guardian_id = $2, is_active = true WHERE id = $3',
        [hashedPassword, guardianId, existingUser.rows[0].id]
      );
      console.log('[OK] Updated existing user');
    } else {
      await connection.query(
        `
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, guardian_id, is_active)
        VALUES ('maria.dela.cruz', $1, $2, $3, 'maria.dela.cruz@email.com', '09123456789', $4, true)
      `,
        [hashedPassword, guardianRoleId, guardianClinicId, guardianId]
      );
      console.log('[OK] Created user account: maria.dela.cruz');
    }

    console.log('\n' + '='.repeat(60));
    console.log('GUARDIAN USER CREATED SUCCESSFULLY');
    console.log('='.repeat(60));

    console.log('\nCredentials:');
    console.log('   Username: maria.dela.cruz');
    console.log('   Password: ' + GUARDIAN_DEFAULT_PASSWORD);
    console.log('   Role: guardian');
  } catch (error) {
    console.log('[ERROR] Failed to create guardian user: ' + error.message);
  } finally {
    if (connection) {
      connection.release();
    }
    await pool.end();
  }
}

createGuardianUser();
