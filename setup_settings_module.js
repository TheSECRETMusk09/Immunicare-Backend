/**
 * Settings Module Setup Script
 * Initializes the settings management system by running the schema and verifying setup
 */

require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== Settings Module Setup ===\n');

// Check if PostgreSQL is available
console.log('Step 1: Checking PostgreSQL connection...');
try {
  const pool = require('./db');
  pool
    .query('SELECT NOW()')
    .then(() => {
      console.log('✓ PostgreSQL connection successful\n');
      runSchema();
    })
    .catch((error) => {
      console.error('✗ PostgreSQL connection failed:', error.message);
      console.error('\nPlease ensure:');
      console.error('1. PostgreSQL is running');
      console.error('2. Database credentials in .env are correct');
      console.error('3. Database exists and is accessible');
      process.exit(1);
    });
} catch (error) {
  console.error('✗ Error checking database:', error.message);
  process.exit(1);
}

function runSchema() {
  console.log('Step 2: Running settings schema...');

  const schemaPath = path.join(__dirname, 'settings_schema.sql');

  if (!fs.existsSync(schemaPath)) {
    console.error('✗ Schema file not found:', schemaPath);
    process.exit(1);
  }

  try {
    const pool = require('./db');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    pool
      .query(schema)
      .then(() => {
        console.log('✓ Settings schema applied successfully\n');
        verifySetup();
      })
      .catch((error) => {
        console.error('✗ Error applying schema:', error.message);
        console.error('\nSchema may have already been applied. Continuing with verification...\n');
        verifySetup();
      });
  } catch (error) {
    console.error('✗ Error reading schema file:', error.message);
    process.exit(1);
  }
}

function verifySetup() {
  console.log('Step 3: Verifying setup...');

  const pool = require('./db');

  // Check if tables exist
  pool
    .query(
      `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('user_settings', 'settings_audit_log')
  `
    )
    .then((result) => {
      const tables = result.rows.map((row) => row.table_name);

      if (tables.includes('user_settings') && tables.includes('settings_audit_log')) {
        console.log('✓ All required tables exist');

        // Check if indexes exist
        return pool.query(`
          SELECT indexname 
          FROM pg_indexes 
          WHERE tablename IN ('user_settings', 'settings_audit_log')
        `);
      } else {
        console.error('✗ Missing tables:', tables);
        process.exit(1);
      }
    })
    .then((result) => {
      const indexes = result.rows.map((row) => row.indexname);
      console.log(`✓ Found ${indexes.length} indexes`);

      // Check if triggers exist
      return pool.query(`
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE event_object_table IN ('user_settings', 'settings_audit_log')
      `);
    })
    .then((result) => {
      const triggers = result.rows.map((row) => row.trigger_name);
      console.log(`✓ Found ${triggers.length} triggers`);

      // Check if view exists
      return pool.query(`
        SELECT viewname 
        FROM information_schema.views 
        WHERE viewname = 'user_settings_summary'
      `);
    })
    .then((result) => {
      if (result.rows.length > 0) {
        console.log('✓ Summary view exists\n');
        printSuccessMessage();
      } else {
        console.error('✗ Summary view not found');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('✗ Error verifying setup:', error.message);
      process.exit(1);
    });
}

function printSuccessMessage() {
  console.log('=== Setup Complete ===\n');
  console.log('The Settings Management Module has been successfully installed!\n');
  console.log('Next steps:');
  console.log('1. Start the backend server: npm start');
  console.log('2. Access the settings module in the admin dashboard');
  console.log('3. Test the functionality using: node test_settings_module.js\n');
  console.log('For more information, see: SETTINGS_MODULE_DOCUMENTATION.md\n');
}

// Handle errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
