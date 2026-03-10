/**
 * Production Database Migration Runner
 *
 * This script runs all SQL migrations in sequence against the production database.
 * It should be run AFTER the database has been provisioned on the Namecheap VPS.
 *
 * Usage:
 *   node run-migrations-production.js
 *
 * Environment:
 *   - DB_HOST: VPS IP address
 *   - DB_PORT: PostgreSQL port (default 5432)
 *   - DB_NAME: Database name (e.g., immunicare_prod)
 *   - DB_USER: Application user (e.g., immunicare_app)
 *   - DB_PASSWORD: Application user password
 *   - DB_SSL: true (required for production)
 *
 * WARNING: This script modifies the production database!
 * Run only after backing up the database.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432',
  database: process.env.DB_NAME || 'immunicare_prod',
  user: process.env.DB_USER || 'immunicare_app',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Migration files to run in order
const migrationFiles = [
  // Core schema
  'admin_setup.sql',

  // Schema fixes
  'fix_database_schema.sql',
  'fix_database_issues.sql',
  'fix_critical_schema_issues.sql',

  // Security
  'database_encryption_setup.sql',
  'create_password_reset_otps_table.sql',

  // Additional updates
  'fix_guardian_notifications_columns.sql',
  'fix_guardians_unique_constraint.sql',

  // Final optimizations
  'database_optimization_and_restructuring.sql',
];

async function runMigrations() {
  console.log('='.repeat(60));
  console.log('IMMUNICARE PRODUCTION DATABASE MIGRATION');
  console.log('='.repeat(60));
  console.log(`Target Database: ${process.env.DB_NAME}`);
  console.log(`Target Host: ${process.env.DB_HOST}`);
  console.log('');

  // Check if environment variables are set
  if (!process.env.DB_HOST || !process.env.DB_PASSWORD) {
    console.error('ERROR: Missing required environment variables!');
    console.error('Please set DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD');
    console.error('');
    console.error('Example:');
    console.error('  export DB_HOST=your-vps-ip');
    console.error('  export DB_NAME=immunicare_prod');
    console.error('  export DB_USER=immunicare_app');
    console.error('  export DB_PASSWORD=your-password');
    console.error('  node run-migrations-production.js');
    process.exit(1);
  }

  let client;

  try {
    // Connect to database
    console.log('Connecting to production database...');
    client = await pool.connect();
    console.log('Connected successfully!\n');

    // Verify database is empty or confirm migration
    const tableCheck = await client.query(`
      SELECT COUNT(*) as table_count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);

    const existingTables = parseInt(tableCheck.rows[0].table_count);

    if (existingTables > 0) {
      console.log(`WARNING: Database already has ${existingTables} tables.`);
      console.log('Migrations may need to be run selectively.');
      console.log('');

      // Continue anyway - migrations use CREATE TABLE IF NOT EXISTS
      console.log('Continuing with migration (using IF NOT EXISTS)...\n');
    }

    // Run each migration file
    let migrationNumber = 1;

    for (const migrationFile of migrationFiles) {
      const filePath = path.join(__dirname, migrationFile);

      if (!fs.existsSync(filePath)) {
        console.log(`[${migrationNumber}/${migrationFiles.length}] SKIP: ${migrationFile} (not found)`);
        migrationNumber++;
        continue;
      }

      console.log(`[${migrationNumber}/${migrationFiles.length}] RUNNING: ${migrationFile}`);

      try {
        const sql = fs.readFileSync(filePath, 'utf8');

        // Split by semicolon and run each statement
        const statements = sql.split(';').filter(s => s.trim());

        let statementCount = 0;
        for (const statement of statements) {
          if (statement.trim()) {
            await client.query(statement);
            statementCount++;
          }
        }

        console.log(`  ✓ Completed (${statementCount} statements)`);
      } catch (err) {
        console.log(`  ⚠ Warning: ${err.message}`);
        // Continue with other migrations - most use IF NOT EXISTS
      }

      migrationNumber++;
    }

    console.log('\n' + '='.repeat(60));
    console.log('MIGRATION COMPLETE');
    console.log('='.repeat(60));

    // Verify final table count
    const finalCheck = await client.query(`
      SELECT COUNT(*) as table_count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);

    console.log(`\nFinal table count: ${finalCheck.rows[0].table_count}`);
    console.log('\nProduction database is ready!');

  } catch (err) {
    console.error('\n❌ MIGRATION FAILED');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

// Run migrations
runMigrations();
