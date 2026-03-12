/**
 * Execute Database Optimization - Fixed Execution Order
 *
 * This script executes the database optimization in the correct order:
 * 1. Create tables first
 * 2. Add columns to existing tables
 * 3. Create indexes
 * 4. Create functions and triggers
 * 5. Create views and materialized views
 * 6. Seed initial data
 */

const { Pool } = require('pg');

require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || '',
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function executeSQL(sql) {
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);

  for (const stmt of statements) {
    if (stmt.startsWith('--') || stmt.startsWith('/*')) {
      continue;
    }

    try {
      await pool.query(stmt);
    } catch (err) {
      // Ignore "already exists" errors
      if (!err.message.includes('already exists') &&
          !err.message.includes('IF NOT EXISTS')) {
        console.log(`   ⚠️ ${err.message.substring(0, 80)}`);
      }
    }
  }
}

async function main() {
  let client;

  console.log('='.repeat(60));
  console.log('IMMUNICARE DATABASE OPTIMIZATION - FIXED ORDER');
  console.log('='.repeat(60));
  console.log();

  try {
    client = await pool.connect();
    console.log('✅ Connected to database');
    console.log();

    // STEP 1: Add missing columns to existing tables
    console.log('STEP 1: Adding missing columns...');
    const columnsSQL = `
      ALTER TABLE infant_growth ADD COLUMN IF NOT EXISTS age_in_days INTEGER;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE vaccine_inventory ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
      ALTER TABLE growth ADD COLUMN IF NOT EXISTS age_in_days INTEGER;
      ALTER TABLE guardians ADD COLUMN IF NOT EXISTS encrypted_phone TEXT;
      ALTER TABLE guardians ADD COLUMN IF NOT EXISTS encrypted_address TEXT;
      ALTER TABLE infants ADD COLUMN IF NOT EXISTS encrypted_birth_certificate TEXT;
      ALTER TABLE infants ADD COLUMN IF NOT EXISTS encrypted_national_id TEXT;
    `;
    await executeSQL(columnsSQL);
    console.log('✅ Columns added');
    console.log();

    // STEP 1.5: Setup Control Number System
    console.log('STEP 1.5: Setting up Control Number System...');
    const controlNumberSQL = `
      CREATE SEQUENCE IF NOT EXISTS infant_control_number_seq START 1;

      ALTER TABLE patients ADD COLUMN IF NOT EXISTS control_number VARCHAR(50);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_control_number ON patients(control_number);

      -- Backfill missing control numbers
      DO $$
      DECLARE
        r RECORD;
        year TEXT;
        seq BIGINT;
      BEGIN
        FOR r IN SELECT id FROM patients WHERE control_number IS NULL LOOP
          year := to_char(CURRENT_DATE, 'YYYY');
          seq := nextval('infant_control_number_seq');
          UPDATE patients SET control_number = 'INF-' || year || '-' || lpad(seq::text, 6, '0') WHERE id = r.id;
        END LOOP;
      END $$;
    `;
    await executeSQL(controlNumberSQL);
    console.log('✅ Control number system configured');
    console.log();

    // STEP 2: Create new tables
    console.log('STEP 2: Creating new tables...');
    const tablesSQL = `
      CREATE TABLE IF NOT EXISTS access_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(50),
        resource_id INTEGER,
        ip_address VARCHAR(45),
        user_agent TEXT,
        status VARCHAR(20) DEFAULT 'success',
        method VARCHAR(10),
        path VARCHAR(500),
        query_params JSONB,
        response_code INTEGER,
        response_time_ms INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_roles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        role VARCHAR(50) NOT NULL,
        assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        assigned_by INTEGER,
        expires_at TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN DEFAULT true,
        UNIQUE(user_id, role)
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        key_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100),
        permissions JSONB DEFAULT '[]'::jsonb,
        last_used_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await executeSQL(tablesSQL);
    console.log('✅ Tables created');
    console.log();

    // STEP 3: Create indexes
    console.log('STEP 3: Creating indexes...');
    const indexesSQL = `
      CREATE INDEX IF NOT EXISTS idx_infant_growth_age_in_days ON infant_growth(age_in_days);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_is_active ON vaccine_inventory(is_active) WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_access_logs_action ON access_logs(action);
      CREATE INDEX IF NOT EXISTS idx_access_logs_resource ON access_logs(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
      CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

      -- Composite indexes
      CREATE INDEX IF NOT EXISTS idx_vaccination_records_infant_date ON vaccination_records(infant_id, admin_date DESC);
      CREATE INDEX IF NOT EXISTS idx_appointments_infant_date ON appointments(infant_id, scheduled_date DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, status) WHERE status IN ('pending', 'sent');
      CREATE INDEX IF NOT EXISTS idx_guardians_email_active ON guardians(email, is_active) WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role_id, is_active) WHERE is_active = true;
    `;
    await executeSQL(indexesSQL);
    console.log('✅ Indexes created');
    console.log();

    // STEP 4: Create audit trigger function
    console.log('STEP 4: Creating audit trigger function...');
    const triggerFunctionSQL = `
      CREATE OR REPLACE FUNCTION audit_trigger_function()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO access_logs (user_id, action, resource_type, resource_id, created_at)
        VALUES (
          current_setting('app.user_id', true)::integer,
          TG_OP,
          TG_TABLE_NAME,
          NEW.id,
          CURRENT_TIMESTAMP
        );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `;
    await executeSQL(triggerFunctionSQL);
    console.log('✅ Trigger function created');
    console.log();

    // STEP 5: Create materialized views
    console.log('STEP 5: Creating materialized views...');
    const materializedViewsSQL = `
      DROP MATERIALIZED VIEW IF EXISTS infant_vaccination_summary;
      CREATE MATERIALIZED VIEW infant_vaccination_summary AS
      SELECT
        i.id AS infant_id,
        i.first_name,
        i.last_name,
        i.dob,
        g.name AS guardian_name,
        COUNT(vr.id) AS vaccination_count,
        MAX(vr.admin_date) AS last_vaccination_date,
        COUNT(CASE WHEN vr.next_due_date < CURRENT_DATE AND vr.next_due_date IS NOT NULL THEN 1 END) AS overdue_count
      FROM infants i
      LEFT JOIN guardians g ON i.guardian_id = g.id
      LEFT JOIN vaccination_records vr ON i.id = vr.infant_id
      WHERE i.is_active = true
      GROUP BY i.id, i.first_name, i.last_name, i.dob, g.name;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_infant_vaccination_summary ON infant_vaccination_summary(infant_id);

      DROP MATERIALIZED VIEW IF EXISTS inventory_summary;
      CREATE MATERIALIZED VIEW inventory_summary AS
      SELECT
        vi.id,
        vi.vaccine_id,
        v.name AS vaccine_name,
        v.code AS vaccine_code,
        vi.clinic_id,
        c.name AS clinic_name,
        vi.beginning_balance + vi.received_during_period - vi.issuance - vi.expired_wasted AS current_stock,
        vi.is_low_stock,
        vi.is_critical_stock
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      JOIN clinics c ON vi.clinic_id = c.id;
    `;
    await executeSQL(materializedViewsSQL);
    console.log('✅ Materialized views created');
    console.log();

    // STEP 6: Insert default permissions
    console.log('STEP 6: Inserting default permissions...');
    const permissionsSQL = `
      INSERT INTO permissions (name, resource, action, scope, description) VALUES
        ('users:read', 'users', 'read', 'global', 'View user information'),
        ('infants:read', 'infants', 'read', 'global', 'View infant records'),
        ('vaccinations:read', 'vaccinations', 'read', 'global', 'View vaccination records'),
        ('appointments:read', 'appointments', 'read', 'global', 'View appointments'),
        ('inventory:read', 'inventory', 'read', 'global', 'View inventory')
      ON CONFLICT (resource, action) DO NOTHING;
    `;
    await executeSQL(permissionsSQL);
    console.log('✅ Permissions inserted');
    console.log();

    // STEP 7: Create views
    console.log('STEP 7: Creating views...');
    const viewsSQL = `
      CREATE OR REPLACE VIEW dashboard_statistics AS
      SELECT
        (SELECT COUNT(*) FROM infants WHERE is_active = true) AS total_infants,
        (SELECT COUNT(*) FROM guardians WHERE is_active = true) AS total_guardians,
        (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled' AND scheduled_date > NOW()) AS upcoming_appointments,
        (SELECT COUNT(*) FROM vaccine_inventory WHERE is_low_stock = true) AS low_stock_items;
    `;
    await executeSQL(viewsSQL);
    console.log('✅ Views created');
    console.log();

    // VERIFICATION
    console.log('='.repeat(60));
    console.log('VERIFICATION');
    console.log('='.repeat(60));

    const checks = [
      { name: 'access_logs table', query: 'SELECT COUNT(*) FROM information_schema.tables WHERE table_name = \'access_logs\'' },
      { name: 'user_roles table', query: 'SELECT COUNT(*) FROM information_schema.tables WHERE table_name = \'user_roles\'' },
      { name: 'api_keys table', query: 'SELECT COUNT(*) FROM information_schema.tables WHERE table_name = \'api_keys\'' },
      { name: 'pgcrypto extension', query: 'SELECT COUNT(*) FROM pg_extension WHERE extname = \'pgcrypto\'' },
      { name: 'infant_vaccination_summary', query: 'SELECT COUNT(*) FROM pg_matviews WHERE matviewname = \'infant_vaccination_summary\'' },
      { name: 'inventory_summary', query: 'SELECT COUNT(*) FROM pg_matviews WHERE matviewname = \'inventory_summary\'' },
    ];

    for (const check of checks) {
      try {
        const result = await client.query(check.query);
        const exists = parseInt(result.rows[0].count) > 0;
        console.log(`   ${exists ? '✅' : '❌'} ${check.name}`);
      } catch (_err) {
        console.log(`   ❌ ${check.name} - error`);
      }
    }

    console.log();
    console.log('✅ Database optimization completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

main();
