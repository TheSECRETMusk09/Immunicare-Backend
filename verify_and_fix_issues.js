const pool = require('./db');
const fs = require('fs');

async function verifyAndFixIssues() {
  const report = {
    timestamp: new Date().toISOString(),
    verification: {},
    fixes: {}
  };

  try {
    console.log('=== VERIFYING IDENTIFIED ISSUES ===\n');

    // 1. Verify duplicate facility records
    console.log('1. VERIFYING DUPLICATE FACILITY RECORDS...');
    const duplicateCheck = await pool.query(`
      SELECT id, name, address, created_at 
      FROM clinics 
      WHERE name ILIKE '%San Nicolas%' OR name ILIKE '%Pasig%'
      ORDER BY id;
    `);
    
    console.log(`Found ${duplicateCheck.rows.length} matching facilities:`);
    console.table(duplicateCheck.rows);
    
    report.verification.duplicateFacilities = {
      found: duplicateCheck.rows.length > 1,
      records: duplicateCheck.rows
    };

    // 2. Verify vaccine inventory issue
    console.log('\n2. VERIFYING VACCINE INVENTORY ISSUE...');
    
    const batchCount = await pool.query(`
      SELECT COUNT(*) as count FROM vaccine_batches WHERE clinic_id = 1;
    `);
    
    const inventoryCount = await pool.query(`
      SELECT COUNT(*) as count FROM vaccine_inventory WHERE clinic_id = 1;
    `);
    
    const transactionCount = await pool.query(`
      SELECT COUNT(*) as count FROM vaccine_inventory_transactions WHERE clinic_id = 1;
    `);
    
    console.log(`Vaccine Batches: ${batchCount.rows[0].count}`);
    console.log(`Vaccine Inventory: ${inventoryCount.rows[0].count}`);
    console.log(`Transactions: ${transactionCount.rows[0].count}`);
    
    report.verification.inventoryIssue = {
      batches: parseInt(batchCount.rows[0].count),
      inventory: parseInt(inventoryCount.rows[0].count),
      transactions: parseInt(transactionCount.rows[0].count),
      hasIssue: parseInt(inventoryCount.rows[0].count) === 0 && parseInt(batchCount.rows[0].count) > 0
    };

    // 3. Check for records in facility ID 203
    console.log('\n3. CHECKING RECORDS IN DUPLICATE FACILITY (ID: 203)...');
    
    const tables = [
      'infants', 'appointments', 'vaccine_batches', 'vaccine_inventory',
      'vaccine_inventory_transactions', 'vaccine_stock_alerts', 
      'vaccine_supply', 'guardians', 'users', 'blocked_dates'
    ];
    
    const recordsInDuplicate = {};
    for (const table of tables) {
      try {
        const result = await pool.query(`
          SELECT COUNT(*) as count FROM ${table} WHERE clinic_id = 203;
        `);
        recordsInDuplicate[table] = parseInt(result.rows[0].count);
      } catch (err) {
        recordsInDuplicate[table] = `Error: ${err.message}`;
      }
    }
    
    console.table(recordsInDuplicate);
    report.verification.recordsInDuplicate = recordsInDuplicate;

    // 4. Check existing indexes
    console.log('\n4. CHECKING EXISTING INDEXES...');
    const indexCheck = await pool.query(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        a.attname AS column_name
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relkind = 'r'
        AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        AND t.relname IN ('appointments', 'infants', 'guardians', 'vaccinations')
        AND a.attname IN ('clinic_id', 'created_at')
      ORDER BY t.relname, i.relname;
    `);
    
    console.log(`Found ${indexCheck.rows.length} relevant indexes:`);
    console.table(indexCheck.rows);
    report.verification.existingIndexes = indexCheck.rows;

    // 5. Check column naming consistency
    console.log('\n5. CHECKING COLUMN NAMING CONSISTENCY...');
    const columnCheck = await pool.query(`
      SELECT 
        table_name,
        column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name = 'clinic_id' OR column_name = 'facility_id')
      ORDER BY table_name, column_name;
    `);
    
    const clinicIdTables = [];
    const facilityIdTables = [];
    
    columnCheck.rows.forEach(row => {
      if (row.column_name === 'clinic_id') {
        clinicIdTables.push(row.table_name);
      } else {
        facilityIdTables.push(row.table_name);
      }
    });
    
    console.log(`\nTables using clinic_id (${clinicIdTables.length}):`);
    console.log(clinicIdTables.join(', '));
    console.log(`\nTables using facility_id (${facilityIdTables.length}):`);
    console.log(facilityIdTables.join(', '));
    
    report.verification.columnNaming = {
      clinic_id: clinicIdTables,
      facility_id: facilityIdTables
    };

    // Write verification report
    fs.writeFileSync('VERIFICATION_REPORT.json', JSON.stringify(report, null, 2));
    console.log('\n✅ Verification complete! Report saved to: VERIFICATION_REPORT.json');
    
    await pool.end();
    return report;
  } catch (error) {
    console.error('\n❌ Error during verification:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

verifyAndFixIssues();
