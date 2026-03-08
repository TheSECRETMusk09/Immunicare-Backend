/**
 * ImmuniCare Login Issues Fix Script - Comprehensive Version
 *
 * This script fixes the following issues:
 * 1. Missing security_events table
 * 2. Missing admin_activity_log table
 * 3. Missing role column in users table
 * 4. Missing user_id column in notifications table
 * 5. Missing password_hash column in users table
 * 6. Missing role_id column in users table
 * 7. Missing is_active column in users table
 * 8. Missing force_password_change column in users table
 * 9. Creates/updates default admin and guardian users
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function fixLoginIssues() {
  const client = await pool.connect();

  try {
    console.log('🔧 Starting ImmuniCare Login Issues Fix...\n');

    // Fix 1: Create missing security_events table
    console.log('1️⃣ Creating security_events table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        event_type VARCHAR(50) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
    `);
    console.log('✅ security_events table created/verified\n');

    // Fix 2: Create missing admin_activity_log table
    console.log('2️⃣ Creating admin_activity_log table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_activity_log (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id INTEGER,
        ip_address VARCHAR(45),
        user_agent TEXT,
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_admin_activity_admin_id ON admin_activity_log(admin_id);
      CREATE INDEX IF NOT EXISTS idx_admin_activity_created_at ON admin_activity_log(created_at);
    `);
    console.log('✅ admin_activity_log table created/verified\n');

    // Fix 3: Check and add password_hash column to users table
    console.log('3️⃣ Checking users table schema (password_hash)...');
    const passwordHashCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'password_hash'
    `);

    if (passwordHashCheck.rows.length === 0) {
      console.log('   Adding password_hash column to users table...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
      `);
      console.log('✅ password_hash column added\n');
    } else {
      console.log('✅ password_hash column already exists\n');
    }

    // Fix 4: Check and add role_id column to users table
    console.log('4️⃣ Checking users table schema (role_id)...');
    const roleIdCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'role_id'
    `);

    if (roleIdCheck.rows.length === 0) {
      console.log('   Adding role_id column to users table...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id);
      `);
      console.log('✅ role_id column added\n');
    } else {
      console.log('✅ role_id column already exists\n');
    }

    // Fix 5: Check and add is_active column to users table
    console.log('5️⃣ Checking users table schema (is_active)...');
    const isActiveCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'is_active'
    `);

    if (isActiveCheck.rows.length === 0) {
      console.log('   Adding is_active column to users table...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
      `);
      console.log('✅ is_active column added\n');
    } else {
      console.log('✅ is_active column already exists\n');
    }

    // Fix 6: Check and add force_password_change column to users table
    console.log('6️⃣ Checking users table schema (force_password_change)...');
    const forcePwCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'force_password_change'
    `);

    if (forcePwCheck.rows.length === 0) {
      console.log('   Adding force_password_change column to users table...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT false;
      `);
      console.log('✅ force_password_change column added\n');
    } else {
      console.log('✅ force_password_change column already exists\n');
    }

    // Fix 7: Check and add user_id column to notifications table
    console.log('7️⃣ Checking notifications table schema...');
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'notifications'
      );
    `);

    if (tableCheck.rows[0].exists) {
      const notificationCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'notifications' 
        AND column_name = 'user_id'
      `);

      if (notificationCheck.rows.length === 0) {
        console.log('   Adding user_id column to notifications table...');
        await client.query(`
          ALTER TABLE notifications 
          ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
        `);
        console.log('✅ user_id column added\n');
      } else {
        console.log('✅ user_id column already exists\n');
      }
    } else {
      console.log('⚠️  notifications table does not exist, skipping...\n');
    }

    // Fix 8: Check and create/update default admin user
    console.log('8️⃣ Checking admin user...');
    const adminCheck = await client.query(`
      SELECT * FROM users WHERE username = 'admin' LIMIT 1
    `);

    const adminHashedPassword = await bcrypt.hash('Admin2024!', 10);

    if (adminCheck.rows.length === 0) {
      console.log('⚠️  Admin user not found. Creating default admin...');
      await client.query(
        `
        INSERT INTO users (username, password_hash, role_id, email, phone, is_active, force_password_change)
        VALUES ('admin', $1, 2, 'admin@immunicare.com', '+639000000000', true, false)
      `,
        [adminHashedPassword]
      );
      console.log('✅ Admin user created (username: admin, password: Admin2024!)\n');
    } else {
      console.log('   Updating admin user credentials...');
      await client.query(
        `
        UPDATE users 
        SET password_hash = $1, role_id = 2, is_active = true, force_password_change = false
        WHERE username = 'admin'
      `,
        [adminHashedPassword]
      );
      console.log('✅ Admin user updated (username: admin, password: Admin2024!)\n');
    }

    // Fix 9: Check and create/update default guardian user
    console.log('9️⃣ Checking guardian user (maria.dela.cruz)...');
    const guardianCheck = await client.query(`
      SELECT * FROM users WHERE username = 'maria.dela.cruz' LIMIT 1
    `);

    const guardianHashedPassword = await bcrypt.hash('Guardian123!', 10);

    if (guardianCheck.rows.length === 0) {
      console.log('⚠️  Guardian user not found. Creating default guardian...');
      await client.query(
        `
        INSERT INTO users (username, password_hash, role_id, email, phone, is_active, force_password_change)
        VALUES ('maria.dela.cruz', $1, 5, 'carmen.lim@email.com', '+639000000001', true, false)
      `,
        [guardianHashedPassword]
      );
      console.log('✅ Guardian user created (username: maria.dela.cruz, password: Guardian123!)\n');
    } else {
      console.log('   Updating guardian user credentials...');
      await client.query(
        `
        UPDATE users 
        SET password_hash = $1, role_id = 5, is_active = true, force_password_change = false
        WHERE username = 'maria.dela.cruz'
      `,
        [guardianHashedPassword]
      );
      console.log('✅ Guardian user updated (username: maria.dela.cruz, password: Guardian123!)\n');
    }

    console.log('========================================');
    console.log('✅ ALL FIXES APPLIED SUCCESSFULLY!');
    console.log('========================================\n');

    console.log('📋 Default Credentials:');
    console.log('   Admin: username=admin, password=Admin2024!');
    console.log('   Guardian: username=maria.dela.cruz, password=Guardian123!\n');

    console.log('⚠️  IMPORTANT: Please change these passwords after first login!\n');
  } catch (error) {
    console.error('❌ Error applying fixes:', error.message);
    console.error('Full error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fixes
fixLoginIssues()
  .then(() => {
    console.log('Fix script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fix script failed:', error);
    process.exit(1);
  });
