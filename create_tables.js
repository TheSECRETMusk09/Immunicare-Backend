require('dotenv').config({ path: '.env.development' });
const pool = require('./db');

async function createTables() {
  try {
    console.log('Creating tables in database:', pool.options.database);

    // Create infant_vaccine_readiness table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS infant_vaccine_readiness (
        id SERIAL PRIMARY KEY,
        infant_id INTEGER NOT NULL,
        vaccine_id INTEGER NOT NULL,
        is_ready BOOLEAN NOT NULL DEFAULT false,
        ready_confirmed_by INTEGER,
        ready_confirmed_at TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        is_active BOOLEAN NOT NULL DEFAULT true,
        CONSTRAINT unique_infant_vaccine_readiness UNIQUE (infant_id, vaccine_id, is_active)
      )
    `);
    console.log('✓ infant_vaccine_readiness table created');

    // Create vaccination_audit_log table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vaccination_audit_log (
        id SERIAL PRIMARY KEY,
        infant_id INTEGER NOT NULL,
        vaccine_id INTEGER NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        previous_status VARCHAR(50),
        new_status VARCHAR(50),
        inventory_deducted BOOLEAN DEFAULT false,
        inventory_transaction_id INTEGER,
        performed_by INTEGER,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ vaccination_audit_log table created');

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_infant_vaccine_readiness_infant_id
      ON infant_vaccine_readiness(infant_id) WHERE is_active = true
    `);
    console.log('✓ Indexes created');

    // Verify tables
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('infant_vaccine_readiness', 'vaccination_audit_log')
    `);
    console.log('Tables created:', result.rows);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

createTables();
