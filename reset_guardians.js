/**
 * Guardian Table Reset and Setup Script
 * Resets and repopulates the guardian table with realistic data
 * and creates user accounts for each guardian
 *
 * Usage: node reset_guardians.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Load environment variables
require('dotenv').config();

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

const DEFAULT_PASSWORD = 'password'; // Simple password for testing

async function resetGuardians() {
  const client = await pool.connect();

  try {
    console.log('🔄 Starting guardian table reset...');

    // Start transaction
    await client.query('BEGIN');

    // Check current schema and add columns if needed
    console.log('📝 Checking and updating schema...');

    // Add missing columns to guardians table (idempotent)
    const columnsToAdd = [
      { name: 'password', type: 'VARCHAR(255)' },
      { name: 'first_name', type: 'VARCHAR(100)' },
      { name: 'last_name', type: 'VARCHAR(100)' },
      { name: 'middle_name', type: 'VARCHAR(100)' },
      { name: 'emergency_contact_priority', type: 'INTEGER DEFAULT 1' },
      { name: 'alternate_phone', type: 'VARCHAR(20)' },
      { name: 'is_primary_guardian', type: 'BOOLEAN DEFAULT false' },
      { name: 'must_change_password', type: 'BOOLEAN DEFAULT false' },
      { name: 'is_password_set', type: 'BOOLEAN DEFAULT false' },
      { name: 'relationship_to_student', type: 'VARCHAR(50)' }
    ];

    for (const col of columnsToAdd) {
      try {
        await client.query(
          `ALTER TABLE guardians ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
        );
      } catch (e) {
        // Column might already exist, ignore
      }
    }

    // Truncate guardians table only
    console.log('📄 Truncating guardians table...');
    await client.query('TRUNCATE TABLE guardians RESTART IDENTITY CASCADE');

    // Get role and clinic IDs
    const roleResult = await client.query('SELECT id FROM roles WHERE name = \'guardian\'');
    const clinicResult = await client.query(
      'SELECT id FROM clinics WHERE name = \'Guardian Portal\''
    );

    let guardianRoleId = roleResult.rows[0]?.id;
    let guardianClinicId = clinicResult.rows[0]?.id;

    // Create guardian role if not exists
    if (!guardianRoleId) {
      const insertRole = await client.query(`
                INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
                VALUES ('guardian', 'Guardian', true, 20, '[]')
                RETURNING id
            `);
      guardianRoleId = insertRole.rows[0].id;
      console.log('✅ Created guardian role');
    }

    // Create Guardian Portal clinic if not exists
    if (!guardianClinicId) {
      const insertClinic = await client.query(`
                INSERT INTO clinics (name, region, address, contact)
                VALUES ('Guardian Portal', 'Virtual', 'Online Access Only', 'N/A')
                RETURNING id
            `);
      guardianClinicId = insertClinic.rows[0].id;
      console.log('✅ Created Guardian Portal clinic');
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    console.log('📝 Inserting guardian records...');

    // Insert guardians with explicit IDs - using existing column names
    const guardians = [
      {
        id: 1,
        first_name: 'Maria',
        last_name: 'Santos',
        phone: '+63-917-123-4567',
        email: 'maria.santos@email.com',
        rel: 'mother'
      },
      {
        id: 2,
        first_name: 'Juan',
        last_name: 'dela Cruz',
        phone: '+63-918-234-5678',
        email: 'juan.delacruz@email.com',
        rel: 'father'
      },
      {
        id: 3,
        first_name: 'Ana',
        last_name: 'Reyes',
        phone: '+63-919-345-6789',
        email: 'ana.reyes@email.com',
        rel: 'mother'
      },
      {
        id: 4,
        first_name: 'Pedro',
        last_name: 'Garcia',
        phone: '+63-920-456-7890',
        email: 'pedro.garcia@email.com',
        rel: 'father'
      },
      {
        id: 5,
        first_name: 'Carmen',
        last_name: 'Lim',
        phone: '+63-921-567-8901',
        email: 'carmen.lim@email.com',
        rel: 'grandmother'
      },
      {
        id: 6,
        first_name: 'Robert',
        last_name: 'Mendoza',
        phone: '+63-922-678-9012',
        email: 'robert.mendoza@email.com',
        rel: 'legal_guardian'
      },
      {
        id: 7,
        first_name: 'Elena',
        last_name: 'Flores-Bautista',
        phone: '+63-923-789-0123',
        email: 'elena.bautista@email.com',
        rel: 'foster_parent'
      },
      {
        id: 8,
        first_name: 'Michael',
        last_name: 'Tan',
        phone: '+63-924-890-1234',
        email: 'michael.tan@email.com',
        rel: 'father'
      },
      {
        id: 9,
        first_name: 'Sarah',
        last_name: 'Ong',
        phone: '+63-925-901-2345',
        email: 'sarah.ong@email.com',
        rel: 'mother'
      },
      {
        id: 10,
        first_name: 'David',
        last_name: 'Cruz',
        phone: '+63-926-012-3456',
        email: 'david.cruz@email.com',
        rel: 'stepfather'
      }
    ];

    for (const g of guardians) {
      const fullName = `${g.first_name} ${g.last_name}`;
      await client.query(
        `
                INSERT INTO guardians (id, name, first_name, last_name, phone, email, relationship, password, is_password_set, is_active, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `,
        [g.id, fullName, g.first_name, g.last_name, g.phone, g.email, g.rel, hashedPassword]
      );
      console.log(`   ✅ Inserted guardian: ${fullName}`);
    }

    console.log('👤 Creating/updating user accounts...');

    // Create or update user accounts for guardians
    // Users table columns: id, username, password_hash, role_id, clinic_id, contact, email, last_login, guardian_id, is_active, created_at, updated_at
    for (const g of guardians) {
      const username = 'guardian_' + g.phone.replace(/\D/g, '');

      // Check if user exists
      const existingUser = await client.query('SELECT id FROM users WHERE guardian_id = $1', [
        g.id
      ]);

      if (existingUser.rows.length > 0) {
        // Update existing user
        await client.query(
          `
                    UPDATE users SET 
                        password_hash = $1,
                        email = $2,
                        contact = $3,
                        is_active = true
                    WHERE guardian_id = $4
                `,
          [hashedPassword, g.email, g.phone, g.id]
        );
        console.log(`   🔄 Updated user: ${username}`);
      } else {
        // Create new user - only using columns that exist in the actual schema
        await client.query(
          `
                    INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, guardian_id, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                `,
          [username, hashedPassword, guardianRoleId, guardianClinicId, g.email, g.phone, g.id]
        );
        console.log(`   ✅ Created user: ${username}`);
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log('');
    console.log('✅ Guardian table reset completed successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log('   - 10 guardian records inserted');
    console.log('   - User accounts created/updated for all guardians');
    console.log('');
    console.log('🔑 Login credentials:');
    console.log('   Username: guardian_<phone>');
    console.log('   Password: password');
    console.log('');
    console.log('📍 Guardian accounts:');
    const result = await client.query(`
            SELECT g.id, g.name as full_name, g.email, g.relationship, u.username
            FROM guardians g
            LEFT JOIN users u ON g.id = u.guardian_id
            ORDER BY g.id
        `);

    result.rows.forEach((g) => {
      console.log(`   ${g.id}. ${g.full_name} (${g.relationship})`);
      console.log(`      Email: ${g.email}`);
      console.log(`      Username: ${g.username}`);
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error resetting guardian table:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
resetGuardians()
  .then(() => {
    console.log('');
    console.log('✨ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });
