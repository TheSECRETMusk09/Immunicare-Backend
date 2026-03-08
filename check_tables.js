/**
 * check_tables.js
 * Utility script to verify database tables exist in the Immunicare system
 *
 * This script checks all required tables for the vaccination management system
 */

const db = require('./db');

/**
 * List of required tables for the Immunicare system
 */
const REQUIRED_TABLES = [
  'admins',
  'guardians',
  'infants',
  'vaccinations',
  'vaccines',
  'appointments',
  'health_centers',
  'vaccine_inventory',
  'notifications',
  'digital_papers',
  'users',
  'sessions',
  'activity_logs',
  'settings',
];

/**
 * Check if a specific table exists
 * @param {string} tableName - Name of the table to check
 */
async function checkTableExists(tableName) {
  try {
    const result = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = $1
    `, [tableName]);
    return result.rows.length > 0;
  } catch (error) {
    console.error(`Error checking table ${tableName}:`, error.message);
    return false;
  }
}

/**
 * Get all tables in the database
 */
async function getAllTables() {
  try {
    const result = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    return result.rows.map((row) => row.table_name);
  } catch (error) {
    console.error('Error fetching tables:', error.message);
    return [];
  }
}

/**
 * Get table row counts
 */
async function getTableCounts() {
  const counts = {};
  const tables = await getAllTables();

  for (const table of tables) {
    try {
      const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
      counts[table] = parseInt(result.rows[0].count, 10);
    } catch (_error) {
      counts[table] = -1; // Error indicator
    }
  }

  return counts;
}

/**
 * Verify all required tables exist
 */
async function verifyRequiredTables() {
  const missingTables = [];
  const existingTables = [];

  for (const table of REQUIRED_TABLES) {
    const exists = await checkTableExists(table);
    if (exists) {
      existingTables.push(table);
    } else {
      missingTables.push(table);
    }
  }

  return {
    complete: missingTables.length === 0,
    existing: existingTables,
    missing: missingTables,
  };
}

/**
 * Get detailed table information
 */
async function getTableInfo() {
  try {
    const result = await db.query(`
      SELECT
        t.table_name,
        obj_description(t.table_schema::regclass) as description,
        (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `);
    return result.rows;
  } catch (error) {
    console.error('Error getting table info:', error.message);
    return [];
  }
}

/**
 * Main function to run all checks
 */
async function main() {
  console.log('=== Database Table Verification Script ===\n');

  try {
    // Get all tables
    const allTables = await getAllTables();
    console.log(`Total tables in database: ${allTables.length}\n`);

    // Verify required tables
    const verification = await verifyRequiredTables();

    console.log('Required Tables Status:');
    console.log('---------------------');

    if (verification.complete) {
      console.log('✅ All required tables exist!\n');
    } else {
      console.log('⚠️  Missing required tables:\n');
      verification.missing.forEach((table) => {
        console.log(`  ❌ ${table}`);
      });
      console.log('');
    }

    // Show existing tables
    console.log('Existing required tables:');
    verification.existing.forEach((table) => {
      console.log(`  ✅ ${table}`);
    });
    console.log('');

    // Get table information
    const tableInfo = await getTableInfo();
    console.log('Table Details:');
    console.log('--------------');
    tableInfo.forEach((info) => {
      console.log(`  ${info.table_name}: ${info.column_count} columns`);
    });
    console.log('');

    // Get row counts
    console.log('Table Row Counts:');
    console.log('-----------------');
    const counts = await getTableCounts();
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table}: ${count} rows`);
    }

    console.log('\n=== Verification Complete ===');
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  } finally {
    // Close database connection
    if (db.end) {
      await db.end();
    }
  }
}

// Export functions for use in other modules
module.exports = {
  checkTableExists,
  getAllTables,
  getTableCounts,
  verifyRequiredTables,
  getTableInfo,
  REQUIRED_TABLES,
};

// Run if executed directly
if (require.main === module) {
  main();
}
