/**
 * Fix Missing Database Tables
 * Creates missing tables identified in the database connection test
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || ''
};

// Create database pool
const pool = new Pool(dbConfig);

// SQL statements to create missing tables
const createTableStatements = [
  // Admin table
  `CREATE TABLE IF NOT EXISTS admin (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    clinic_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Admin activity table
  `CREATE TABLE IF NOT EXISTS admin_activity (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES admin(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100),
    entity_id INTEGER,
    details TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Inventory table
  `CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    vaccine_id INTEGER REFERENCES vaccines(id) ON DELETE CASCADE,
    batch_number VARCHAR(100) UNIQUE NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    expiry_date DATE NOT NULL,
    manufacturer VARCHAR(255),
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    location VARCHAR(255),
    status VARCHAR(50) DEFAULT 'available',
    received_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Growth records table
  `CREATE TABLE IF NOT EXISTS growth_records (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER REFERENCES infants(id) ON DELETE CASCADE,
    record_date DATE NOT NULL,
    weight DECIMAL(5,2),
    height DECIMAL(5,2),
    head_circumference DECIMAL(5,2),
    notes TEXT,
    recorded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Documents table
  `CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER REFERENCES infants(id) ON DELETE CASCADE,
    template_id INTEGER REFERENCES paper_templates(id) ON DELETE SET NULL,
    document_type VARCHAR(100) NOT NULL,
    file_path VARCHAR(500),
    file_name VARCHAR(255),
    file_size INTEGER,
    generated_by INTEGER REFERENCES users(id),
    download_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'generated',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Health centers table
  `CREATE TABLE IF NOT EXISTS health_centers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    address TEXT,
    city VARCHAR(100),
    province VARCHAR(100),
    contact_number VARCHAR(20),
    email VARCHAR(255),
    head_of_center VARCHAR(255),
    capacity INTEGER DEFAULT 100,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // User settings table
  `CREATE TABLE IF NOT EXISTS user_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    theme VARCHAR(20) DEFAULT 'light',
    language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'Asia/Singapore',
    email_notifications BOOLEAN DEFAULT true,
    sms_notifications BOOLEAN DEFAULT false,
    push_notifications BOOLEAN DEFAULT true,
    two_factor_enabled BOOLEAN DEFAULT false,
    session_timeout INTEGER DEFAULT 30,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Settings table (global settings)
  `CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    category VARCHAR(50),
    updated_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`
];

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function createMissingTables() {
  log('╔════════════════════════════════════════════════════════════╗', 'blue');
  log('║  Creating Missing Database Tables                           ║', 'blue');
  log('╚════════════════════════════════════════════════════════════╝', 'blue');

  let successCount = 0;
  let failCount = 0;

  for (const sql of createTableStatements) {
    try {
      await pool.query(sql);
      const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
      log(`✓ Created table: ${tableName}`, 'green');
      successCount++;
    } catch (error) {
      log(`✗ Failed to create table: ${error.message}`, 'red');
      failCount++;
    }
  }

  log('\n=== Summary ===', 'blue');
  log(`Tables created: ${successCount}`, 'green');
  log(`Failed: ${failCount}`, failCount > 0 ? 'red' : 'gray');

  // Close database pool
  await pool.end();

  log('\n=== Complete ===', 'blue');
  process.exit(failCount > 0 ? 1 : 0);
}

createMissingTables().catch((error) => {
  log(`\n✗ Error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
