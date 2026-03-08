/**
 * Database Fixes Script
 * Applies missing tables and column fixes
 */

const pool = require('./db');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function applyFixes() {
  log('\n========================================', 'cyan');
  log('  IMMUNICARE DATABASE FIXES', 'cyan');
  log('========================================\n', 'cyan');

  const fixes = [];

  // 1. Create growth table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS growth (
        id SERIAL PRIMARY KEY,
        infant_id INTEGER NOT NULL REFERENCES infants(id) ON DELETE CASCADE,
        date_recorded DATE NOT NULL DEFAULT CURRENT_DATE,
        weight_kg DECIMAL(5,2),
        height_cm DECIMAL(5,2),
        head_circumference_cm DECIMAL(5,2),
        age_in_days INTEGER,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_infant_id ON growth(infant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_date ON growth(date_recorded)`);

    fixes.push({ name: 'growth table', status: 'PASS' });
    log('✅ Created growth table', 'green');
  } catch (error) {
    fixes.push({ name: 'growth table', status: 'FAIL', error: error.message });
    log(`❌ Failed to create growth table: ${error.message}`, 'red');
  }

  // 2. Create user_sessions table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_token VARCHAR(255) NOT NULL UNIQUE,
        ip_address VARCHAR(45),
        user_agent TEXT,
        device_info JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE,
        last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP WITH TIME ZONE,
        ended_reason VARCHAR(50)
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token)`);

    fixes.push({ name: 'user_sessions table', status: 'PASS' });
    log('✅ Created user_sessions table', 'green');
  } catch (error) {
    fixes.push({ name: 'user_sessions table', status: 'FAIL', error: error.message });
    log(`❌ Failed to create user_sessions table: ${error.message}`, 'red');
  }

  // 3. Create password_reset_otps table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_otps (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        otp VARCHAR(10) NOT NULL,
        method VARCHAR(10) NOT NULL DEFAULT 'email',
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used_at TIMESTAMP WITH TIME ZONE,
        attempts INTEGER DEFAULT 0,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user_id ON password_reset_otps(user_id)`);

    fixes.push({ name: 'password_reset_otps table', status: 'PASS' });
    log('✅ Created password_reset_otps table', 'green');
  } catch (error) {
    fixes.push({ name: 'password_reset_otps table', status: 'FAIL', error: error.message });
    log(`❌ Failed to create password_reset_otps table: ${error.message}`, 'red');
  }

  // 4. Add guardian_id to appointments
  try {
    const columnCheck = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'appointments' AND column_name = 'guardian_id'
    `);

    if (columnCheck.rows.length === 0) {
      await pool.query(`ALTER TABLE appointments ADD COLUMN guardian_id INTEGER REFERENCES guardians(id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_appointments_guardian_id ON appointments(guardian_id)`);
      fixes.push({ name: 'appointments.guardian_id column', status: 'PASS' });
      log('✅ Added guardian_id to appointments', 'green');
    } else {
      fixes.push({ name: 'appointments.guardian_id column', status: 'PASS', note: 'Already exists' });
      log('✅ appointments.guardian_id already exists', 'green');
    }
  } catch (error) {
    fixes.push({ name: 'appointments.guardian_id column', status: 'FAIL', error: error.message });
    log(`❌ Failed to add guardian_id to appointments: ${error.message}`, 'red');
  }

  // 5. Fix admin passwords
  try {
    const bcrypt = require('bcryptjs');
    const newPassword = 'Immunicare2026!';
    const hash = await bcrypt.hash(newPassword, 10);

    // Update admin password
    const adminResult = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING username',
      [hash, 'admin']
    );

    // Update administrator password
    const admin2Result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING username',
      [hash, 'administrator']
    );

    fixes.push({ name: 'admin passwords', status: 'PASS', users: [...adminResult.rows, ...admin2Result.rows] });
    log(`✅ Updated admin passwords (${adminResult.rows.length + admin2Result.rows.length} users)`, 'green');
  } catch (error) {
    fixes.push({ name: 'admin passwords', status: 'FAIL', error: error.message });
    log(`❌ Failed to update admin passwords: ${error.message}`, 'red');
  }

  // 6. Add performance indexes
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_date ON appointments(scheduled_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vaccination_records_infant_id ON vaccination_records(infant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_infants_guardian_id ON infants(guardian_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)`);

    fixes.push({ name: 'performance indexes', status: 'PASS' });
    log('✅ Created performance indexes', 'green');
  } catch (error) {
    fixes.push({ name: 'performance indexes', status: 'FAIL', error: error.message });
    log(`❌ Failed to create indexes: ${error.message}`, 'red');
  }

  // Summary
  log('\n========================================', 'cyan');
  log('  FIX SUMMARY', 'cyan');
  log('========================================\n', 'cyan');

  const passed = fixes.filter(f => f.status === 'PASS').length;
  const failed = fixes.filter(f => f.status === 'FAIL').length;

  log(`Total Fixes: ${fixes.length}`, 'cyan');
  log(`Passed: ${passed}`, 'green');
  log(`Failed: ${failed}`, failed > 0 ? 'red' : 'green');

  if (failed > 0) {
    log('\nFailed fixes:', 'red');
    fixes.filter(f => f.status === 'FAIL').forEach(f => {
      log(`  - ${f.name}: ${f.error}`, 'red');
    });
  }

  return { passed, failed, total: fixes.length };
}

applyFixes()
  .then(result => {
    log('\nDatabase fixes completed.\n', 'green');
    pool.end();
    process.exit(result.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    log(`\nFatal error: ${error.message}`, 'red');
    pool.end();
    process.exit(1);
  });
