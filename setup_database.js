/**
 * Database Setup and Initialization Script
 * Creates all required tables and ensures proper system configuration
 */

const pool = require('./db');

/**
 * Initialize database tables and default data
 * @param {Object} options - Configuration options
 * @param {boolean} options.closePool - Whether to close the pool after initialization (default: true for CLI, false for tests)
 * @param {boolean} options.silent - Suppress console output (useful for tests)
 */
async function initializeDatabase(options = {}) {
  const { closePool = false, silent = false } = options;

  if (!silent) {
    console.log('='.repeat(70));
    console.log('IMMUNICARE DATABASE INITIALIZATION');
    console.log('='.repeat(70));
    console.log();
  }

  try {
    // Create security_events table
    if (!silent) {
      console.log('Creating security_events table...');
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        event_type VARCHAR(100) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        resource_type VARCHAR(100),
        resource_id INTEGER,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_security_events_ip_address ON security_events(ip_address);
      CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
      CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
    `);
    if (!silent) {
      console.log('✅ security_events table created/verified\n');
    }

    // Create Guardian Portal clinic if not exists
    if (!silent) {
      console.log('Creating Guardian Portal clinic...');
    }
    await pool.query(`
      INSERT INTO clinics (name, region, address, contact)
      VALUES ('Guardian Portal', 'Virtual', 'Online Portal', 'portal@immunicare.com')
      ON CONFLICT (name) DO NOTHING
    `);
    if (!silent) {
      console.log('✅ Guardian Portal clinic created/verified\n');
    }

    // Create guardian role if not exists
    if (!silent) {
      console.log('Creating guardian role...');
    }
    await pool.query(`
      INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
      VALUES ('guardian', 'Guardian', false, 20, '{"can_view_own_children": true, "can_view_appointments": true}')
      ON CONFLICT (name) DO NOTHING
    `);
    if (!silent) {
      console.log('✅ guardian role created/verified\n');
    }

    // Ensure admin user exists with correct password
    if (!silent) {
      console.log('Verifying admin user...');
    }
    const bcrypt = require('bcryptjs');
    const adminPasswordHash = '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q'; // Admin2024!

    const adminCheck = await pool.query('SELECT id FROM users WHERE username = \'admin\'');
    if (adminCheck.rows.length === 0) {
      const roleResult = await pool.query(
        'SELECT id FROM roles WHERE name = \'super_admin\' LIMIT 1'
      );
      const clinicResult = await pool.query('SELECT id FROM clinics LIMIT 1');

      if (roleResult.rows.length > 0 && clinicResult.rows.length > 0) {
        await pool.query(
          `INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [
            'admin',
            adminPasswordHash,
            roleResult.rows[0].id,
            clinicResult.rows[0].id,
            'admin@immunicare.com',
            'admin@immunicare.com'
          ]
        );
        if (!silent) {
          console.log('✅ Admin user created with password: Admin2024!\n');
        }
      } else {
        if (!silent) {
          console.log('⚠️ Could not create admin user - role or clinic not found\n');
        }
      }
    } else {
      if (!silent) {
        console.log('✅ Admin user already exists\n');
      }
    }

    if (!silent) {
      console.log('='.repeat(70));
      console.log('DATABASE INITIALIZATION COMPLETE');
      console.log('='.repeat(70));
      console.log();
      console.log('Admin Credentials:');
      console.log('  Username: admin');
      console.log('  Password: Admin2024!');
      console.log();
    }
  } catch (error) {
    if (!silent) {
      console.error('❌ Database initialization error:', error);
    }
    throw error;
  } finally {
    // Only close pool when running as standalone script or explicitly requested
    if (closePool) {
      await pool.end();
    }
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase({ closePool: true })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { initializeDatabase };
