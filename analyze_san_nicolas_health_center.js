const pool = require('./db');
const fs = require('fs');

async function analyzeSanNicolasHealthCenter() {
  const report = {
    timestamp: new Date().toISOString(),
    healthCenter: 'San Nicolas Health Center',
    location: 'Pasig City',
    findings: {}
  };

  try {
    console.log('=== ANALYZING SAN NICOLAS HEALTH CENTER BACKEND & DATABASE ===\n');

    // 1. Find the health center record
    console.log('1. IDENTIFYING HEALTH CENTER RECORD...');
    const facilityQuery = `
      SELECT * FROM clinics 
      WHERE name ILIKE '%San Nicolas%' 
         OR name ILIKE '%Pasig%'
      ORDER BY name;
    `;
    const facilities = await pool.query(facilityQuery);
    
    if (facilities.rows.length === 0) {
      console.log('⚠️  No facility found matching "San Nicolas" or "Pasig"');
      console.log('\nSearching all clinics:');
      const allClinics = await pool.query('SELECT id, name, address, city FROM clinics ORDER BY name LIMIT 20');
      console.table(allClinics.rows);
      report.findings.facility = { found: false, searched: allClinics.rows };
    } else {
      console.log(`✓ Found ${facilities.rows.length} matching facility/facilities:`);
      console.table(facilities.rows);
      report.findings.facility = { found: true, data: facilities.rows };
    }

    const sanNicolasFacility = facilities.rows.find(f => 
      f.name.toLowerCase().includes('san nicolas') || 
      f.name.toLowerCase().includes('pasig')
    );

    if (!sanNicolasFacility) {
      console.log('\n❌ Cannot proceed without identifying San Nicolas Health Center');
      await pool.end();
      return;
    }

    const facilityId = sanNicolasFacility.id;
    console.log(`\n✓ Using Facility ID: ${facilityId} - ${sanNicolasFacility.name}`);
    report.facilityId = facilityId;
    report.facilityName = sanNicolasFacility.name;

    // 2. Analyze database schema
    console.log('\n2. ANALYZING DATABASE SCHEMA...');
    const schemaQuery = `
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ILIKE '%clinic%' 
          OR column_name ILIKE '%facility%'
          OR column_name ILIKE '%health%center%')
      ORDER BY table_name, ordinal_position;
    `;
    const schemaResults = await pool.query(schemaQuery);
    console.log(`✓ Found ${schemaResults.rows.length} columns with facility/clinic references:`);
    
    const tableColumns = {};
    schemaResults.rows.forEach(row => {
      if (!tableColumns[row.table_name]) {
        tableColumns[row.table_name] = [];
      }
      tableColumns[row.table_name].push(row.column_name);
    });
    
    console.log('\nTables with facility/clinic columns:');
    Object.entries(tableColumns).forEach(([table, columns]) => {
      console.log(`  - ${table}: ${columns.join(', ')}`);
    });
    report.findings.schema = { facilityColumns: tableColumns };

    // 3. Count records per table for this facility
    console.log('\n3. COUNTING RECORDS FOR SAN NICOLAS HEALTH CENTER...');
    const recordCounts = {};
    
    for (const [tableName, columns] of Object.entries(tableColumns)) {
      const facilityColumn = columns.find(c => 
        c === 'clinic_id' || c === 'facility_id' || c === 'health_center_id'
      );
      
      if (facilityColumn) {
        try {
          const countQuery = `SELECT COUNT(*) as count FROM ${tableName} WHERE ${facilityColumn} = $1`;
          const result = await pool.query(countQuery, [facilityId]);
          recordCounts[tableName] = {
            column: facilityColumn,
            count: parseInt(result.rows[0].count)
          };
        } catch (err) {
          recordCounts[tableName] = { column: facilityColumn, error: err.message };
        }
      }
    }
    
    console.table(recordCounts);
    report.findings.recordCounts = recordCounts;

    // 4. Analyze users associated with this facility
    console.log('\n4. ANALYZING USERS...');
    const usersQuery = `
      SELECT 
        id, username, email, role, 
        clinic_id,
        is_active, created_at
      FROM users
      WHERE clinic_id = $1
      ORDER BY created_at DESC;
    `;
    const users = await pool.query(usersQuery, [facilityId]);
    console.log(`✓ Found ${users.rows.length} users associated with this facility`);
    if (users.rows.length > 0) {
      console.table(users.rows);
    }
    report.findings.users = { count: users.rows.length, data: users.rows };

    // 5. Analyze vaccine inventory
    console.log('\n5. ANALYZING VACCINE INVENTORY...');
    const inventoryQuery = `
      SELECT 
        vi.id,
        v.name as vaccine_name,
        vi.clinic_id,
        vi.beginning_balance,
        vi.received_during_period,
        vi.stock_on_hand,
        vi.low_stock_threshold,
        vi.critical_stock_threshold
      FROM vaccine_inventory vi
      LEFT JOIN vaccines v ON v.id = vi.vaccine_id
      WHERE vi.clinic_id = $1
      ORDER BY v.name;
    `;
    const inventory = await pool.query(inventoryQuery, [facilityId]);
    console.log(`✓ Found ${inventory.rows.length} vaccine inventory records`);
    if (inventory.rows.length > 0) {
      console.table(inventory.rows);
    }
    report.findings.inventory = { count: inventory.rows.length, data: inventory.rows };

    // 6. Analyze vaccinations/appointments
    console.log('\n6. ANALYZING VACCINATIONS & APPOINTMENTS...');
    
    // Check appointments table structure first
    const appointmentsSchemaQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'appointments' 
      AND table_schema = 'public';
    `;
    const appointmentsCols = await pool.query(appointmentsSchemaQuery);
    const hasClinicId = appointmentsCols.rows.some(r => r.column_name === 'clinic_id');
    const hasFacilityId = appointmentsCols.rows.some(r => r.column_name === 'facility_id');
    
    let appointmentsQuery;
    if (hasClinicId) {
      appointmentsQuery = `
        SELECT COUNT(*) as count 
        FROM appointments 
        WHERE clinic_id = $1;
      `;
    } else if (hasFacilityId) {
      appointmentsQuery = `
        SELECT COUNT(*) as count 
        FROM appointments 
        WHERE facility_id = $1;
      `;
    } else {
      appointmentsQuery = `SELECT COUNT(*) as count FROM appointments;`;
    }
    
    const appointments = await pool.query(
      appointmentsQuery, 
      hasClinicId || hasFacilityId ? [facilityId] : []
    );
    console.log(`✓ Appointments: ${appointments.rows[0].count}`);
    report.findings.appointments = { count: parseInt(appointments.rows[0].count) };

    // 7. Check for foreign key relationships
    console.log('\n7. ANALYZING FOREIGN KEY RELATIONSHIPS...');
    const fkQuery = `
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND (kcu.column_name ILIKE '%clinic%' 
          OR kcu.column_name ILIKE '%facility%'
          OR ccu.column_name ILIKE '%clinic%'
          OR ccu.column_name ILIKE '%facility%')
      ORDER BY tc.table_name, kcu.column_name;
    `;
    const foreignKeys = await pool.query(fkQuery);
    console.log(`✓ Found ${foreignKeys.rows.length} foreign key relationships:`);
    console.table(foreignKeys.rows);
    report.findings.foreignKeys = foreignKeys.rows;

    // 8. Check for data isolation issues
    console.log('\n8. CHECKING DATA ISOLATION...');
    const isolationChecks = {};
    
    // Check if there are records without facility assignment
    for (const [tableName, info] of Object.entries(recordCounts)) {
      if (info.column && !info.error) {
        try {
          const nullCheckQuery = `
            SELECT COUNT(*) as count 
            FROM ${tableName} 
            WHERE ${info.column} IS NULL;
          `;
          const nullResult = await pool.query(nullCheckQuery);
          isolationChecks[tableName] = {
            nullRecords: parseInt(nullResult.rows[0].count),
            facilityColumn: info.column
          };
        } catch (err) {
          isolationChecks[tableName] = { error: err.message };
        }
      }
    }
    
    console.table(isolationChecks);
    report.findings.dataIsolation = isolationChecks;

    // 9. Analyze indexes
    console.log('\n9. ANALYZING INDEXES ON FACILITY COLUMNS...');
    const indexQuery = `
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        a.attname AS column_name,
        ix.indisunique AS is_unique
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relkind = 'r'
        AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        AND (a.attname ILIKE '%clinic%' OR a.attname ILIKE '%facility%')
      ORDER BY t.relname, i.relname;
    `;
    const indexes = await pool.query(indexQuery);
    console.log(`✓ Found ${indexes.rows.length} indexes on facility columns:`);
    console.table(indexes.rows);
    report.findings.indexes = indexes.rows;

    // 10. Check authentication/authorization configuration
    console.log('\n10. CHECKING RBAC CONFIGURATION...');
    const rolesQuery = `
      SELECT DISTINCT role 
      FROM users 
      WHERE clinic_id = $1
      ORDER BY role;
    `;
    const roles = await pool.query(rolesQuery, [facilityId]);
    console.log('✓ Roles used in this facility:');
    console.table(roles.rows);
    report.findings.roles = roles.rows;

    // Write report to file
    const reportPath = 'SAN_NICOLAS_HEALTH_CENTER_ANALYSIS.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n✅ Analysis complete! Report saved to: ${reportPath}`);

    await pool.end();
  } catch (error) {
    console.error('\n❌ Error during analysis:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

analyzeSanNicolasHealthCenter();
