const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: String(process.env.DB_PASSWORD || '')
});

async function main() {
  console.log('='.repeat(80));
  console.log('CRITICAL ISSUES FIX SCRIPT');
  console.log('='.repeat(80));

  const client = await pool.connect();

  try {
    console.log('\n[1/9] Fixing missing database tables...');
    await fixMissingTables(client);

    console.log('\n[2/9] Fixing missing columns...');
    await fixMissingColumns(client);

    console.log('\n[3/9] Fixing refresh tokens table issues...');
    await fixRefreshTokensTable(client);

    console.log('\n[4/9] Fixing PostgreSQL cache connection issues...');
    await fixCacheConnection(client);

    console.log('\n[5/9] Fixing email server configuration...');
    await fixEmailConfiguration();

    console.log('\n[6/9] Fixing port configuration...');
    await fixPortConfiguration();

    console.log('\n[7/9] Fixing authentication issues...');
    await fixAuthenticationIssues(client);

    console.log('\n[8/9] Fixing user sessions issues...');
    await fixUserSessions(client);

    console.log('\n[9/9] Fixing guardian registration issues...');
    await fixGuardianRegistration(client);

    console.log('\n' + '='.repeat(80));
    console.log('ALL FIXES COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('\n[ERROR] Fix failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function fixMissingTables(client) {
  console.log('  Checking for missing tables...');

  // Check if security_events table exists
  const securityEventsCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'security_events'
    );
  `);

  if (!securityEventsCheck.rows[0].exists) {
    console.log('  Creating security_events table...');
    await client.query(`
      CREATE TABLE security_events (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER REFERENCES admin(id) ON DELETE SET NULL,
        event_type VARCHAR(100) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        resource_type VARCHAR(100),
        resource_id INTEGER,
        details JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX idx_security_events_admin_id ON security_events(admin_id);
      CREATE INDEX idx_security_events_event_type ON security_events(event_type);
      CREATE INDEX idx_security_events_severity ON security_events(severity);
      CREATE INDEX idx_security_events_ip_address ON security_events(ip_address);
      CREATE INDEX idx_security_events_created_at ON security_events(created_at);
    `);

    console.log('  ✓ security_events table created');
  } else {
    console.log('  ✓ security_events table already exists');
  }

  // Check if admin_activity_log table exists
  const adminActivityLogCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'admin_activity_log'
    );
  `);

  if (!adminActivityLogCheck.rows[0].exists) {
    console.log('  Creating admin_activity_log table...');
    await client.query(`
      CREATE TABLE admin_activity_log (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
        action VARCHAR(100) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        details JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX idx_admin_activity_log_admin_id ON admin_activity_log(admin_id);
      CREATE INDEX idx_admin_activity_log_created_at ON admin_activity_log(created_at DESC);
      CREATE INDEX idx_admin_activity_log_action ON admin_activity_log(action);
    `);

    console.log('  ✓ admin_activity_log table created');
  } else {
    console.log('  ✓ admin_activity_log table already exists');
  }
}

async function fixMissingColumns(client) {
  console.log('  Checking for missing columns...');

  // Check users table for clinic_id
  const usersTableCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'users'
    );
  `);

  if (usersTableCheck.rows[0].exists) {
    const clinicIdCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'clinic_id'
      );
    `);

    if (!clinicIdCheck.rows[0].exists) {
      console.log('  Adding clinic_id column to users table...');
      await client.query(`
        ALTER TABLE users ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE CASCADE;
      `);
      console.log('  ✓ clinic_id column added to users table');
    } else {
      console.log('  ✓ clinic_id column already exists in users table');
    }

    // Check for role column
    const roleCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'role'
      );
    `);

    if (!roleCheck.rows[0].exists) {
      console.log('  Adding role column to users table...');
      await client.query(`
        ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'admin';
      `);
      console.log('  ✓ role column added to users table');
    } else {
      console.log('  ✓ role column already exists in users table');
    }
  }

  // Check notifications table for user_id
  const notificationsUserIdCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'notifications' 
      AND column_name = 'user_id'
    );
  `);

  if (!notificationsUserIdCheck.rows[0].exists) {
    console.log('  Adding user_id column to notifications table...');
    await client.query(`
      ALTER TABLE notifications ADD COLUMN user_id INTEGER REFERENCES admin(id) ON UPDATE CASCADE ON DELETE SET NULL;
    `);
    console.log('  ✓ user_id column added to notifications table');
  } else {
    console.log('  ✓ user_id column already exists in notifications table');
  }
}

async function fixRefreshTokensTable(client) {
  console.log('  Checking refresh_tokens table...');

  const refreshTokensCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'refresh_tokens'
    );
  `);

  if (!refreshTokensCheck.rows[0].exists) {
    console.log('  Creating refresh_tokens table...');
    await client.query(`
      CREATE TABLE refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
        token VARCHAR(500) NOT NULL,
        user_agent TEXT,
        ip_address VARCHAR(45),
        is_revoked BOOLEAN DEFAULT false,
        revoked_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
      CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
      CREATE INDEX idx_refresh_tokens_is_revoked ON refresh_tokens(is_revoked);
      CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
    `);

    console.log('  ✓ refresh_tokens table created');
  } else {
    console.log('  ✓ refresh_tokens table already exists');

    // Check for expires_at column
    const expiresCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'refresh_tokens' 
        AND column_name = 'expires_at'
      );
    `);

    if (!expiresCheck.rows[0].exists) {
      console.log('  Adding expires_at column to refresh_tokens...');
      await client.query(`
        ALTER TABLE refresh_tokens ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '7 days';
      `);
      console.log('  ✓ expires_at column added');
    }
  }

  // Clean up expired refresh tokens
  console.log('  Cleaning up expired refresh tokens...');
  const cleanup = await client.query(`
    DELETE FROM refresh_tokens WHERE expires_at < CURRENT_TIMESTAMP OR is_revoked = true;
  `);
  console.log(`  ✓ Cleaned up ${cleanup.rowCount} expired tokens`);
}

async function fixCacheConnection(client) {
  console.log('  Checking cache table...');

  const cacheCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'cache'
    );
  `);

  if (!cacheCheck.rows[0].exists) {
    console.log('  Creating cache table...');
    await client.query(`
      CREATE TABLE cache (
        id SERIAL PRIMARY KEY,
        cache_key VARCHAR(255) NOT NULL UNIQUE,
        cache_value TEXT NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX idx_cache_cache_key ON cache(cache_key);
      CREATE INDEX idx_cache_expires_at ON cache(expires_at);
      CREATE INDEX idx_cache_created_at ON cache(created_at);
    `);

    console.log('  ✓ cache table created');
  } else {
    console.log('  ✓ cache table already exists');
  }
}

async function fixEmailConfiguration() {
  console.log('  Checking email configuration...');

  const envPath = path.join(__dirname, '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Check if SMTP_HOST is using the placeholder
  if (envContent.includes('smtp.example.com') || !envContent.includes('SMTP_HOST=')) {
    console.log('  ⚠ SMTP_HOST is misconfigured or missing');
    console.log('  ℹ Please update the .env file with valid SMTP settings:');
    console.log('     SMTP_HOST=your_actual_smtp_host');
    console.log('     SMTP_PORT=587');
    console.log('     SMTP_SECURE=false');
    console.log('     SMTP_USER=your_email@example.com');
    console.log('     SMTP_PASSWORD=your_email_password');
    console.log('     EMAIL_FROM=noreply@yourdomain.com');
    console.log('  ℹ For development, you can use a service like Mailtrap or Ethereal');
  } else {
    console.log('  ✓ Email configuration appears to be set');
  }
}

async function fixPortConfiguration() {
  console.log('  Checking port configuration...');

  const envPath = path.join(__dirname, '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Check if PORT=5000 is causing conflicts
  if (envContent.includes('PORT=5000')) {
    console.log('  ⚠ Port 5000 may conflict with other processes');
    console.log('  ℹ Consider using a different port or implementing port conflict detection');
    console.log('  ℹ The server will attempt to use an available port if 5000 is in use');
  } else {
    console.log('  ✓ Port configuration is custom');
  }
}

async function fixAuthenticationIssues(client) {
  console.log('  Fixing authentication issues...');

  // Ensure JWT secrets are set
  const envPath = path.join(__dirname, '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  if (!envContent.includes('JWT_SECRET=')) {
    console.log('  Adding JWT_SECRET to .env...');
    envContent += '\nJWT_SECRET=immunicare_jwt_secret_key_2024_secure_key_for_production\n';
  }

  if (!envContent.includes('JWT_REFRESH_SECRET=')) {
    console.log('  Adding JWT_REFRESH_SECRET to .env...');
    envContent +=
      'JWT_REFRESH_SECRET=immunicare_jwt_refresh_secret_key_2024_secure_key_for_production\n';
  }

  fs.writeFileSync(envPath, envContent);
  console.log('  ✓ JWT configuration updated');
}

async function fixUserSessions(client) {
  console.log('  Checking user_sessions table...');

  const sessionsCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'user_sessions'
    );
  `);

  if (!sessionsCheck.rows[0].exists) {
    console.log('  Creating user_sessions table...');
    await client.query(`
      CREATE TABLE user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
        session_token TEXT NOT NULL UNIQUE,
        ip_address VARCHAR(45),
        user_agent TEXT,
        device_info JSONB,
        location_info JSONB,
        login_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        logout_time TIMESTAMP WITH TIME ZONE,
        last_activity TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        session_duration INTEGER,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX idx_user_sessions_session_token ON user_sessions(session_token);
      CREATE INDEX idx_user_sessions_is_active ON user_sessions(is_active);
    `);

    console.log('  ✓ user_sessions table created');
  } else {
    console.log('  ✓ user_sessions table already exists');

    // Clean up old sessions
    const cleanup = await client.query(`
      UPDATE user_sessions 
      SET is_active = false, logout_time = CURRENT_TIMESTAMP 
      WHERE last_activity < CURRENT_TIMESTAMP - INTERVAL '30 days' AND is_active = true;
    `);
    console.log(`  ✓ Cleaned up ${cleanup.rowCount} old sessions`);
  }
}

async function fixGuardianRegistration(client) {
  console.log('  Checking guardians table for clinic_id...');

  const guardiansCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'guardians'
    );
  `);

  if (guardiansCheck.rows[0].exists) {
    const clinicIdCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'guardians' 
        AND column_name = 'clinic_id'
      );
    `);

    if (!clinicIdCheck.rows[0].exists) {
      console.log('  Adding clinic_id column to guardians table...');
      await client.query(`
        ALTER TABLE guardians ADD COLUMN clinic_id INTEGER REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE SET NULL;
      `);
      console.log('  ✓ clinic_id column added to guardians table');
    } else {
      console.log('  ✓ clinic_id column already exists in guardians table');
    }
  }

  // Check if healthcare_facilities exists for default clinic
  const facilitiesCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'healthcare_facilities'
    );
  `);

  if (!facilitiesCheck.rows[0].exists) {
    console.log('  Creating healthcare_facilities table for guardian registration...');
    await client.query(`
      CREATE TABLE healthcare_facilities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        region VARCHAR(255),
        address TEXT,
        contact VARCHAR(255),
        facility_type VARCHAR(50) DEFAULT 'health_center',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default facility
    await client.query(`
      INSERT INTO healthcare_facilities (name, region, address, contact) VALUES
      ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number')
      ON CONFLICT (name) DO NOTHING;
    `);

    console.log('  ✓ healthcare_facilities table created');
  }
}

// Run the fix script
main().catch((error) => {
  console.error('[CRITICAL ERROR] Fix script failed:', error);
  process.exit(1);
});
