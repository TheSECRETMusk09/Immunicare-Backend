/**
 * Database Cleanup Script
 * Checks for duplicates, orphaned records, and unused data across all tables
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'immunicare_dev',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!',
  port: parseInt(process.env.DB_PORT) || 5432
});

async function checkAndCleanDatabase() {
  const client = await pool.connect();

  try {
    console.log('=== Database Cleanup Analysis ===\n');

    // 1. Check for duplicate records in key tables
    await checkDuplicates(client);

    // 2. Check for orphaned foreign key references
    await checkOrphanedRecords(client);

    // 3. Check for inactive records that could be archived/deleted
    await checkInactiveRecords(client);

    // 4. Clean up cache entries
    await cleanupCache(client);

    console.log('\n=== Cleanup Complete ===');
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

async function checkDuplicates(client) {
  console.log('--- Checking for Duplicate Records ---\n');

  const duplicateChecks = [
    { table: 'clinics', column: 'name', message: 'Duplicate clinic names' },
    { table: 'users', column: 'username', message: 'Duplicate usernames' },
    { table: 'users', column: 'email', message: 'Duplicate user emails' },
    { table: 'guardians', column: 'email', message: 'Duplicate guardian emails' },
    { table: 'guardians', column: 'phone', message: 'Duplicate guardian phone numbers' },
    {
      table: 'infants',
      column: 'first_name',
      secondaryColumn: 'last_name',
      message: 'Duplicate infant names'
    },
    { table: 'vaccines', column: 'code', message: 'Duplicate vaccine codes' },
    { table: 'vaccines', column: 'name', message: 'Duplicate vaccine names' },
    { table: 'suppliers', column: 'name', message: 'Duplicate supplier names' },
    { table: 'suppliers', column: 'supplier_code', message: 'Duplicate supplier codes' },
    // Medicine duplicates check removed - system focuses on vaccines only
    // { table: 'medicines', column: 'name', message: 'Duplicate medicine names' },
    { table: 'items', column: 'name', message: 'Duplicate item names' },
    { table: 'roles', column: 'name', message: 'Duplicate role names' },
    { table: 'permissions', column: 'name', message: 'Duplicate permission names' },
    { table: 'system_config', column: 'config_key', message: 'Duplicate config keys' },
    { table: 'healthcare_facilities', column: 'name', message: 'Duplicate facility names' }
  ];

  for (const check of duplicateChecks) {
    try {
      const query = `
        SELECT ${check.column}, COUNT(*) as cnt
        FROM ${check.table}
        GROUP BY ${check.column}
        HAVING COUNT(*) > 1
        LIMIT 10
      `;
      const result = await client.query(query);

      if (result.rows.length > 0) {
        console.log(`⚠️  ${check.message} in table '${check.table}':`);
        result.rows.forEach((row) => {
          console.log(`   Value: '${row[check.column]}' - Count: ${row.cnt}`);
        });
        console.log('');
      }
    } catch (err) {
      // Table or column might not exist in current schema
      console.log(`   Skipping ${check.table}.${check.column}: ${err.message}`);
    }
  }
}

async function checkOrphanedRecords(client) {
  console.log('--- Checking for Orphaned Records ---\n');

  const orphanChecks = [
    // Old schema (infants, users referencing clinics)
    {
      childTable: 'infants',
      childColumn: 'clinic_id',
      parentTable: 'clinics',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'users',
      childColumn: 'clinic_id',
      parentTable: 'clinics',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'appointments',
      childColumn: 'clinic_id',
      parentTable: 'clinics',
      parentColumn: 'id',
      parentName: 'name'
    },
    // New schema (patients, admin referencing healthcare_facilities)
    {
      childTable: 'patients',
      childColumn: 'facility_id',
      parentTable: 'healthcare_facilities',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'admin',
      childColumn: 'facility_id',
      parentTable: 'healthcare_facilities',
      parentColumn: 'id',
      parentName: 'name'
    },
    // Common orphan checks
    {
      childTable: 'infants',
      childColumn: 'guardian_id',
      parentTable: 'guardians',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'patients',
      childColumn: 'guardian_id',
      parentTable: 'guardians',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'vaccination_records',
      childColumn: 'infant_id',
      parentTable: 'infants',
      parentColumn: 'id',
      parentName: 'first_name'
    },
    {
      childTable: 'immunization_records',
      childColumn: 'patient_id',
      parentTable: 'patients',
      parentColumn: 'id',
      parentName: 'first_name'
    },
    {
      childTable: 'vaccination_records',
      childColumn: 'vaccine_id',
      parentTable: 'vaccines',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'vaccine_batches',
      childColumn: 'vaccine_id',
      parentTable: 'vaccines',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'vaccination_schedules',
      childColumn: 'vaccine_id',
      parentTable: 'vaccines',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'item_batches',
      childColumn: 'item_id',
      parentTable: 'items',
      parentColumn: 'id',
      parentName: 'name'
    },
    // Medicine batches orphan check removed - system focuses on vaccines only
    // {
    //   childTable: 'medicine_batches',
    //   childColumn: 'medicine_id',
    //   parentTable: 'medicines',
    //   parentColumn: 'id',
    //   parentName: 'name',
    // },
    {
      childTable: 'inventory_transactions',
      childColumn: 'batch_id',
      parentTable: 'vaccine_batches',
      parentColumn: 'id',
      parentName: 'lot_no'
    },
    {
      childTable: 'health_records',
      childColumn: 'infant_id',
      parentTable: 'infants',
      parentColumn: 'id',
      parentName: 'first_name'
    },
    {
      childTable: 'infant_growth',
      childColumn: 'infant_id',
      parentTable: 'infants',
      parentColumn: 'id',
      parentName: 'first_name'
    },
    {
      childTable: 'patient_growth',
      childColumn: 'patient_id',
      parentTable: 'patients',
      parentColumn: 'id',
      parentName: 'first_name'
    },
    {
      childTable: 'vaccine_inventory',
      childColumn: 'clinic_id',
      parentTable: 'clinics',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'vaccine_inventory',
      childColumn: 'vaccine_id',
      parentTable: 'vaccines',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'messages',
      childColumn: 'guardian_id',
      parentTable: 'guardians',
      parentColumn: 'id',
      parentName: 'name'
    },
    {
      childTable: 'messages',
      childColumn: 'infant_id',
      parentTable: 'infants',
      parentColumn: 'id',
      parentName: 'first_name'
    },
    {
      childTable: 'audit_logs',
      childColumn: 'user_id',
      parentTable: 'users',
      parentColumn: 'id',
      parentName: 'username'
    },
    {
      childTable: 'notifications',
      childColumn: 'created_by',
      parentTable: 'users',
      parentColumn: 'id',
      parentName: 'username'
    }
  ];

  for (const check of orphanChecks) {
    try {
      const query = `
        SELECT c.${check.childColumn}, c.id as child_id
        FROM ${check.childTable} c
        LEFT JOIN ${check.parentTable} p ON c.${check.childColumn} = p.${check.parentColumn}
        WHERE c.${check.childColumn} IS NOT NULL AND p.${check.parentColumn} IS NULL
        LIMIT 10
      `;
      const result = await client.query(query);

      if (result.rows.length > 0) {
        console.log(`⚠️  Orphaned records in '${check.childTable}.${check.childColumn}':`);
        result.rows.forEach((row) => {
          console.log(
            `   ${check.childColumn}: ${row[check.childColumn]} (referenced in child_id: ${row.child_id})`
          );
        });
        console.log('');
      }
    } catch (err) {
      // Skip if table or column doesn't exist
    }
  }
}

async function checkInactiveRecords(client) {
  console.log('--- Checking for Inactive Records ---\n');

  const inactiveChecks = [
    { table: 'users', countColumn: 'is_active', countValue: false, nameColumn: 'username' },
    { table: 'guardians', countColumn: 'is_active', countValue: false, nameColumn: 'name' },
    { table: 'infants', countColumn: 'is_active', countValue: false, nameColumn: 'first_name' },
    { table: 'patients', countColumn: 'is_active', countValue: false, nameColumn: 'first_name' },
    { table: 'clinics', countColumn: 'is_active', countValue: false, nameColumn: 'name' },
    {
      table: 'healthcare_facilities',
      countColumn: 'is_active',
      countValue: false,
      nameColumn: 'name'
    },
    { table: 'vaccines', countColumn: 'is_active', countValue: false, nameColumn: 'name' },
    // Medicine inactive check removed - system focuses on vaccines only
    // { table: 'medicines', countColumn: 'is_active', countValue: false, nameColumn: 'name' },
    { table: 'items', countColumn: 'is_active', countValue: false, nameColumn: 'name' },
    { table: 'suppliers', countColumn: 'is_active', countValue: false, nameColumn: 'name' },
    { table: 'roles', countColumn: 'is_active', countValue: false, nameColumn: 'name' },
    { table: 'permissions', countColumn: 'is_active', countValue: false, nameColumn: 'name' }
  ];

  for (const check of inactiveChecks) {
    try {
      const query = `
        SELECT COUNT(*) as cnt
        FROM ${check.table}
        WHERE ${check.countColumn} = $1
      `;
      const result = await client.query(query, [check.countValue]);
      const count = parseInt(result.rows[0].cnt);

      if (count > 0) {
        console.log(`ℹ️  Inactive records in '${check.table}': ${count} records`);
      }
    } catch (err) {
      // Skip if table doesn't exist
    }
  }
}

async function cleanupCache(client) {
  console.log('\n--- Checking Cache Entries ---\n');

  try {
    // Clean expired cache entries
    const deleteExpired = `
      DELETE FROM cache
      WHERE expires_at IS NOT NULL
      AND expires_at < CURRENT_TIMESTAMP
    `;
    const expiredResult = await client.query(deleteExpired);

    if (expiredResult.rowCount > 0) {
      console.log(`🗑️  Cleaned ${expiredResult.rowCount} expired cache entries`);
    }

    // Check cache_entries table too
    const deleteExpiredEntries = `
      DELETE FROM cache_entries
      WHERE expires_at IS NOT NULL
      AND expires_at < CURRENT_TIMESTAMP
    `;
    const expiredEntriesResult = await client.query(deleteExpiredEntries);

    if (expiredEntriesResult.rowCount > 0) {
      console.log(`🗑️  Cleaned ${expiredEntriesResult.rowCount} expired cache_entries`);
    }
  } catch (err) {
    console.log(`   Cache cleanup skipped: ${err.message}`);
  }
}

// Run the cleanup
checkAndCleanDatabase().catch(console.error);
