#!/usr/bin/env node

/**
 * Create missing database tables
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load environment variables
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = {};
    envContent.split('\n').forEach((line) => {
      const [key, ...valueParts] = line.split('=');
      if (key && !key.startsWith('#')) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    });
    return envVars;
  }
  return {};
}

async function createTables() {
  const env = loadEnv();
  const pool = new Pool({
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT) || 5432,
    database: env.DB_NAME || 'immunicare_dev',
    user: env.DB_USER || 'immunicare_dev',
    password: env.DB_PASSWORD || ''
  });

  try {
    console.log('Connecting to database...');

    // Create immunization_records table
    console.log('\nCreating immunization_records table...');
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'immunization_records') THEN
              CREATE TABLE immunization_records (
                  id SERIAL PRIMARY KEY,
                  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                  vaccine_id INTEGER REFERENCES vaccines(id) ON DELETE SET NULL,
                  batch_id INTEGER REFERENCES vaccine_batches(id) ON DELETE SET NULL,
                  admin_date DATE,
                  next_due_date DATE,
                  status VARCHAR(50) DEFAULT 'scheduled',
                  notes TEXT,
                  administered_by INTEGER REFERENCES users(id),
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  is_active BOOLEAN DEFAULT true
              );
              
              CREATE INDEX idx_immunization_records_patient_id ON immunization_records(patient_id);
              CREATE INDEX idx_immunization_records_vaccine_id ON immunization_records(vaccine_id);
              CREATE INDEX idx_immunization_records_status ON immunization_records(status);
              CREATE INDEX idx_immunization_records_next_due_date ON immunization_records(next_due_date);
              
              RAISE NOTICE 'Created immunization_records table';
          ELSE
              RAISE NOTICE 'immunization_records table already exists';
          END IF;
      END $$;
    `);
    console.log('✓ immunization_records table ready');

    // Create patient_growth table
    console.log('\nCreating patient_growth table...');
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patient_growth') THEN
              CREATE TABLE patient_growth (
                  id SERIAL PRIMARY KEY,
                  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                  measurement_date DATE NOT NULL,
                  weight DECIMAL(10,2),
                  height DECIMAL(10,2),
                  head_circumference DECIMAL(10,2),
                  weight_for_age_percentile DECIMAL(5,2),
                  height_for_age_percentile DECIMAL(5,2),
                  weight_for_height_percentile DECIMAL(5,2),
                  notes TEXT,
                  measured_by INTEGER REFERENCES users(id),
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  is_active BOOLEAN DEFAULT true
              );
              
              CREATE INDEX idx_patient_growth_patient_id ON patient_growth(patient_id);
              CREATE INDEX idx_patient_growth_measurement_date ON patient_growth(measurement_date);
              
              RAISE NOTICE 'Created patient_growth table';
          ELSE
              RAISE NOTICE 'patient_growth table already exists';
          END IF;
      END $$;
    `);
    console.log('✓ patient_growth table ready');

    // Create vaccine_batches table
    console.log('\nCreating vaccine_batches table...');
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vaccine_batches') THEN
              CREATE TABLE vaccine_batches (
                  id SERIAL PRIMARY KEY,
                  vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON DELETE CASCADE,
                  lot_no VARCHAR(100) UNIQUE NOT NULL,
                  manufacturer VARCHAR(255),
                  production_date DATE,
                  expiry_date DATE,
                  initial_quantity INTEGER DEFAULT 0,
                  current_quantity INTEGER DEFAULT 0,
                  clinic_id INTEGER REFERENCES clinics(id),
                  received_date DATE,
                  supplier VARCHAR(255),
                  notes TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  is_active BOOLEAN DEFAULT true
              );
              
              CREATE INDEX idx_vaccine_batches_vaccine_id ON vaccine_batches(vaccine_id);
              CREATE INDEX idx_vaccine_batches_lot_no ON vaccine_batches(lot_no);
              CREATE INDEX idx_vaccine_batches_expiry_date ON vaccine_batches(expiry_date);
              
              RAISE NOTICE 'Created vaccine_batches table';
          ELSE
              RAISE NOTICE 'vaccine_batches table already exists';
          END IF;
      END $$;
    `);
    console.log('✓ vaccine_batches table ready');

    // Display summary
    console.log('\n' + '='.repeat(60));
    console.log('TABLE CREATION SUMMARY');
    console.log('='.repeat(60));

    const tables = ['immunization_records', 'patient_growth', 'vaccine_batches'];
    for (const table of tables) {
      const result = await pool.query(
        'SELECT EXISTS(SELECT FROM pg_tables WHERE schemaname = \'public\' AND tablename = $1) as exists',
        [table]
      );
      const status = result.rows[0].exists ? '✓ EXISTS' : '✗ MISSING';
      console.log(`${table.padEnd(30)} ${status}`);
    }

    console.log('\n✓ All missing tables created successfully!');
  } catch (error) {
    console.error('✗ Error creating tables:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

createTables()
  .then(() => {
    console.log('\nScript completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed:', error);
    process.exit(1);
  });
