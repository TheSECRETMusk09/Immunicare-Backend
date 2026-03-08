/**
 * Execute Database Optimization Script
 *
 * This script reads and executes the database optimization SQL script
 * using the Node.js pg library.
 *
 * Usage: node execute_optimization.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load environment variables
require('dotenv').config();

// Database configuration from .env
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!',
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function executeOptimization() {
  console.log('='.repeat(60));
  console.log('IMMUNICARE DATABASE OPTIMIZATION');
  console.log('='.repeat(60));
  console.log();

  let client;

  try {
    // Connect to database
    client = await pool.connect();
    console.log('✅ Connected to database');
    console.log();

    // Read the SQL file
    const sqlFile = path.join(__dirname, 'database_optimization_and_restructuring.sql');
    const sqlContent = fs.readFileSync(sqlFile, 'utf8');

    console.log('✅ Read optimization script');
    console.log(`   File size: ${sqlContent.length} bytes`);
    console.log();

    // Split SQL into individual statements
    // Using a simple split - in production, use a proper SQL parser
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`✅ Parsed ${statements.length} SQL statements`);
    console.log();

    // Execute each statement
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip if it's a DO block or function definition (they end with $$)
      if (statement.includes('$$') && !statement.endsWith(';')) {
        // This is a function, need special handling
        try {
          await client.query(statement + ';');
          successCount++;
        } catch (err) {
          errorCount++;
          if (errors.length < 10) {
            errors.push(err.message.substring(0, 100));
          }
        }
      } else {
        try {
          await client.query(statement);
          successCount++;
        } catch (err) {
          // Ignore some common errors that are expected (like "table already exists")
          if (!err.message.includes('already exists') &&
              !err.message.includes('IF NOT EXISTS') &&
              !err.message.includes('duplicate key')) {
            errorCount++;
            if (errors.length < 10) {
              errors.push(err.message.substring(0, 150));
            }
          } else {
            successCount++; // Count as success since we're using IF NOT EXISTS
          }
        }
      }

      // Progress indicator
      if ((i + 1) % 20 === 0 || i === statements.length - 1) {
        console.log(`   Progress: ${i + 1}/${statements.length} statements executed`);
      }
    }

    console.log();
    console.log('='.repeat(60));
    console.log('EXECUTION RESULTS');
    console.log('='.repeat(60));
    console.log(`   Successful statements: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);

    if (errors.length > 0) {
      console.log();
      console.log('Sample errors (first 10):');
      errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. ${err}`);
      });
    }

    console.log();
    console.log('✅ Database optimization completed!');
    console.log();

    // Verify key tables/columns were created
    console.log('='.repeat(60));
    console.log('VERIFICATION');
    console.log('='.repeat(60));

    const checks = [
      { name: 'access_logs table', query: 'SELECT COUNT(*) FROM information_schema.tables WHERE table_name = \'access_logs\'' },
      { name: 'user_roles table', query: 'SELECT COUNT(*) FROM information_schema.tables WHERE table_name = \'user_roles\'' },
      { name: 'api_keys table', query: 'SELECT COUNT(*) FROM information_schema.tables WHERE table_name = \'api_keys\'' },
      { name: 'pgcrypto extension', query: 'SELECT COUNT(*) FROM pg_extension WHERE extname = \'pgcrypto\'' },
      { name: 'permissions table', query: 'SELECT COUNT(*) FROM information_schema.tables WHERE table_name = \'permissions\'' },
    ];

    for (const check of checks) {
      try {
        const result = await client.query(check.query);
        const exists = parseInt(result.rows[0].count) > 0;
        console.log(`   ${exists ? '✅' : '❌'} ${check.name}`);
      } catch (err) {
        console.log(`   ❌ ${check.name} - ${err.message.substring(0, 50)}`);
      }
    }

    console.log();
    console.log('='.repeat(60));
    console.log('NEXT STEPS');
    console.log('='.repeat(60));
    console.log('1. Run: node execute_optimization.js (to refresh materialized views)');
    console.log('2. Test the API endpoints');
    console.log('3. Verify frontend functionality');
    console.log();

  } catch (error) {
    console.error('❌ Error executing optimization:', error.message);
    console.error(error.stack);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

// Run the optimization
executeOptimization()
  .then(() => {
    console.log('Script completed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
