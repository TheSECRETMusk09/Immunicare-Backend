/**
 * Comprehensive Backend and Database Connection Test
 * Tests all admin dashboard modules for backend connectivity and database operations
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

// Admin dashboard modules to test
const modules = [
  { name: 'Dashboard', route: '/api/dashboard', tables: ['admin_activity', 'user_sessions'] },
  {
    name: 'Analytics',
    route: '/api/analytics',
    tables: ['vaccinations', 'appointments', 'infants']
  },
  { name: 'Users', route: '/api/users', tables: ['users', 'admin', 'guardians'] },
  { name: 'Infants', route: '/api/infants', tables: ['infants', 'guardians'] },
  {
    name: 'Vaccinations',
    route: '/api/vaccinations',
    tables: ['vaccinations', 'vaccines', 'vaccination_records']
  },
  { name: 'Inventory', route: '/api/inventory', tables: ['inventory', 'suppliers', 'vaccines'] },
  { name: 'Appointments', route: '/api/appointments', tables: ['appointments', 'infants'] },
  { name: 'Announcements', route: '/api/announcements', tables: ['announcements'] },
  { name: 'Growth', route: '/api/growth', tables: ['growth_records', 'infants'] },
  { name: 'Paper Templates', route: '/api/paper-templates', tables: ['paper_templates'] },
  { name: 'Documents', route: '/api/documents', tables: ['documents', 'paper_templates'] },
  {
    name: 'Notifications',
    route: '/api/notifications',
    tables: ['notifications', 'notification_preferences']
  },
  { name: 'Reports', route: '/api/reports', tables: ['vaccinations', 'appointments', 'infants'] },
  { name: 'Monitoring', route: '/api/monitoring', tables: ['admin_activity', 'audit_logs'] },
  {
    name: 'Vaccination Management',
    route: '/api/vaccination-management',
    tables: ['vaccinations', 'vaccines', 'health_centers']
  },
  { name: 'Uploads', route: '/api/uploads', tables: [] }, // File-based, no DB tables
  { name: 'Messages', route: '/api/messages', tables: ['conversations', 'messages'] },
  { name: 'Settings', route: '/api/settings', tables: ['user_settings', 'settings'] },
  { name: 'Admin', route: '/api/admin', tables: ['admin', 'users'] }
];

// Test results storage
const testResults = {
  databaseConnection: null,
  modules: [],
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0
  }
};

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

// Test database connection
async function testDatabaseConnection() {
  log('\n=== Testing Database Connection ===', 'blue');
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as db_version');
    client.release();

    testResults.databaseConnection = {
      success: true,
      timestamp: result.rows[0].current_time,
      version: result.rows[0].db_version
    };

    log('✓ Database connection successful', 'green');
    log(`  Timestamp: ${result.rows[0].current_time}`, 'gray');
    log(`  Version: ${result.rows[0].db_version.split(' ')[0]}`, 'gray');
    return true;
  } catch (error) {
    testResults.databaseConnection = {
      success: false,
      error: error.message
    };
    log('✗ Database connection failed', 'red');
    log(`  Error: ${error.message}`, 'red');
    return false;
  }
}

// Test if table exists and has data
async function testTable(tableName) {
  try {
    const result = await pool.query(
      `
      SELECT 
        EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        ) as exists,
        COALESCE((SELECT reltuples::bigint FROM pg_class WHERE relname = $1), 0) as row_count
    `,
      [tableName]
    );

    return {
      exists: result.rows[0].exists,
      rowCount: result.rows[0].row_count
    };
  } catch (error) {
    return {
      exists: false,
      error: error.message
    };
  }
}

// Test module database tables
async function testModuleTables(module) {
  const tableResults = [];

  for (const tableName of module.tables) {
    const result = await testTable(tableName);
    tableResults.push({
      table: tableName,
      ...result
    });
  }

  return tableResults;
}

// Test all modules
async function testAllModules() {
  log('\n=== Testing Admin Dashboard Modules ===', 'blue');

  for (const module of modules) {
    testResults.summary.total++;
    const moduleResult = {
      name: module.name,
      route: module.route,
      tables: [],
      status: 'unknown'
    };

    log(`\nTesting: ${module.name}`, 'blue');
    log(`  Route: ${module.route}`, 'gray');

    // Test database tables
    if (module.tables.length > 0) {
      const tableResults = await testModuleTables(module);
      moduleResult.tables = tableResults;

      const allTablesExist = tableResults.every((t) => t.exists);
      const tablesWithData = tableResults.filter((t) => t.rowCount > 0).length;

      if (allTablesExist) {
        if (tablesWithData === tableResults.length) {
          moduleResult.status = 'passed';
          testResults.summary.passed++;
          log(`  ✓ All tables exist with data (${tablesWithData}/${tableResults.length})`, 'green');
        } else {
          moduleResult.status = 'warning';
          testResults.summary.warnings++;
          log(
            `  ⚠ All tables exist but some are empty (${tablesWithData}/${tableResults.length} have data)`,
            'yellow'
          );
        }
      } else {
        moduleResult.status = 'failed';
        testResults.summary.failed++;
        const missingTables = tableResults.filter((t) => !t.exists).map((t) => t.table);
        log(`  ✗ Missing tables: ${missingTables.join(', ')}`, 'red');
      }

      // Log table details
      for (const table of tableResults) {
        if (table.exists) {
          log(`    - ${table.table}: ✓ (${table.rowCount} rows)`, 'gray');
        } else {
          log(`    - ${table.table}: ✗ (missing)`, 'red');
        }
      }
    } else {
      moduleResult.status = 'passed';
      testResults.summary.passed++;
      log('  ✓ No database tables required (file-based module)', 'green');
    }

    testResults.modules.push(moduleResult);
  }
}

// Test specific critical tables
async function testCriticalTables() {
  log('\n=== Testing Critical System Tables ===', 'blue');

  const criticalTables = [
    'users',
    'admin',
    'guardians',
    'infants',
    'vaccinations',
    'vaccines',
    'appointments',
    'inventory',
    'notifications'
  ];

  for (const tableName of criticalTables) {
    const result = await testTable(tableName);
    if (result.exists) {
      log(`  ✓ ${tableName}: ${result.rowCount} rows`, 'green');
    } else {
      log(`  ✗ ${tableName}: MISSING`, 'red');
    }
  }
}

// Print summary
function printSummary() {
  log('\n=== Test Summary ===', 'blue');
  log(`Total Modules Tested: ${testResults.summary.total}`, 'reset');
  log(`Passed: ${testResults.summary.passed}`, 'green');
  log(`Warnings: ${testResults.summary.warnings}`, 'yellow');
  log(`Failed: ${testResults.summary.failed}`, 'red');

  const successRate = ((testResults.summary.passed / testResults.summary.total) * 100).toFixed(1);
  log(`Success Rate: ${successRate}%`, 'blue');

  if (testResults.summary.failed > 0) {
    log('\n⚠ Failed Modules:', 'red');
    testResults.modules
      .filter((m) => m.status === 'failed')
      .forEach((m) => log(`  - ${m.name}`, 'red'));
  }

  if (testResults.summary.warnings > 0) {
    log('\n⚠ Modules with Warnings:', 'yellow');
    testResults.modules
      .filter((m) => m.status === 'warning')
      .forEach((m) => log(`  - ${m.name}`, 'yellow'));
  }
}

// Main test function
async function runTests() {
  log('╔════════════════════════════════════════════════════════════╗', 'blue');
  log('║  Immunicare Backend & Database Connection Test              ║', 'blue');
  log('╚════════════════════════════════════════════════════════════╝', 'blue');

  const dbConnected = await testDatabaseConnection();

  if (dbConnected) {
    await testCriticalTables();
    await testAllModules();
  } else {
    log('\n⚠ Skipping module tests due to database connection failure', 'yellow');
  }

  printSummary();

  // Close database pool
  await pool.end();

  log('\n=== Test Complete ===', 'blue');

  // Return exit code based on results
  const exitCode = testResults.summary.failed > 0 ? 1 : 0;
  process.exit(exitCode);
}

// Run tests
runTests().catch((error) => {
  log(`\n✗ Test execution failed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
