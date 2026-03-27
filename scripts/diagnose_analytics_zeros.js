/**
 * Diagnose Analytics Zero Metrics Issue
 * Investigate why dashboard shows zeros despite having data
 */

const db = require('../db');

async function diagnoseAnalytics() {
  console.log('='.repeat(80));
  console.log('ANALYTICS ZERO METRICS DIAGNOSIS');
  console.log('='.repeat(80));
  console.log();

  try {
    // 1. Check vaccinations completed today
    console.log('1. VACCINATIONS COMPLETED TODAY');
    console.log('-'.repeat(80));
    const todayVax = await db.query(`
      SELECT COUNT(*) as count 
      FROM immunization_records 
      WHERE DATE(admin_date) = CURRENT_DATE 
        AND is_active = true
    `);
    console.log(`Vaccinations today: ${todayVax.rows[0].count}`);
    
    const recentVax = await db.query(`
      SELECT COUNT(*) as count,
             DATE(admin_date) as date
      FROM immunization_records 
      WHERE admin_date >= CURRENT_DATE - INTERVAL '7 days'
        AND is_active = true
      GROUP BY DATE(admin_date)
      ORDER BY date DESC
      LIMIT 5
    `);
    console.log('\nRecent vaccinations by date:');
    console.table(recentVax.rows);

    // 2. Check infants due for vaccination
    console.log('\n2. INFANTS DUE FOR VACCINATION');
    console.log('-'.repeat(80));
    const dueVax = await db.query(`
      SELECT 
        COUNT(DISTINCT patient_id) as total_due,
        COUNT(DISTINCT CASE WHEN next_due_date < CURRENT_DATE THEN patient_id END) as overdue,
        COUNT(DISTINCT CASE WHEN next_due_date = CURRENT_DATE THEN patient_id END) as due_today
      FROM immunization_records 
      WHERE next_due_date <= CURRENT_DATE 
        AND status IN ('scheduled', 'pending')
        AND is_active = true
    `);
    console.table(dueVax.rows[0]);

    // 3. Check vaccine inventory
    console.log('\n3. VACCINE INVENTORY');
    console.log('-'.repeat(80));
    
    // Check if vaccines table has quantity column
    const vaccineColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'vaccines'
      ORDER BY ordinal_position
    `);
    console.log('Vaccines table columns:');
    console.log(vaccineColumns.rows.map(r => r.column_name).join(', '));
    
    const vaccineCount = await db.query(`
      SELECT COUNT(*) as total_vaccines
      FROM vaccines 
      WHERE is_active = true
    `);
    console.log(`\nTotal active vaccines: ${vaccineCount.rows[0].total_vaccines}`);

    // 4. Check inventory table
    console.log('\n4. INVENTORY TABLE');
    console.log('-'.repeat(80));
    try {
      const inventoryCount = await db.query(`
        SELECT 
          COUNT(*) as total_items,
          SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) as items_in_stock,
          SUM(quantity) as total_doses
        FROM inventory
        WHERE is_active = true
      `);
      console.table(inventoryCount.rows[0]);
      
      const inventorySample = await db.query(`
        SELECT vaccine_id, quantity, reorder_level, last_updated
        FROM inventory
        WHERE is_active = true
        LIMIT 5
      `);
      console.log('\nSample inventory records:');
      console.table(inventorySample.rows);
    } catch (err) {
      if (err.code === '42P01') {
        console.log('⚠️  Inventory table does not exist');
      } else {
        console.log(`⚠️  Error querying inventory: ${err.message}`);
      }
    }

    // 5. Check total patients vs "children tracked"
    console.log('\n5. PATIENT COUNTS');
    console.log('-'.repeat(80));
    const patientCounts = await db.query(`
      SELECT 
        COUNT(*) as total_patients,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_patients,
        COUNT(CASE WHEN facility_id = 203 THEN 1 END) as san_nicolas_patients,
        COUNT(CASE WHEN DATE(created_at) >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_this_month
      FROM patients
    `);
    console.table(patientCounts.rows[0]);

    // 6. Check vaccination statistics
    console.log('\n6. VACCINATION STATISTICS');
    console.log('-'.repeat(80));
    const vaxStats = await db.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'scheduled' THEN 1 END) as scheduled,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN admin_date IS NOT NULL THEN 1 END) as administered
      FROM immunization_records
      WHERE is_active = true
    `);
    console.table(vaxStats.rows[0]);

    // 7. Check dashboard stats query (actual query from dashboard.js)
    console.log('\n7. DASHBOARD STATS QUERY (SIMULATED)');
    console.log('-'.repeat(80));
    const dashboardStats = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM patients WHERE is_active = true) as total_infants,
        (SELECT COUNT(*) FROM guardians) as total_guardians,
        (SELECT COUNT(*) FROM immunization_records WHERE is_active = true) as total_vaccinations,
        (SELECT COUNT(*) FROM immunization_records WHERE admin_date IS NOT NULL AND is_active = true) as completed_vaccinations,
        (SELECT COUNT(*) FROM appointments WHERE is_active = true) as total_appointments
    `);
    console.table(dashboardStats.rows[0]);

    // 8. Check date range issues
    console.log('\n8. DATE RANGE ANALYSIS');
    console.log('-'.repeat(80));
    const dateRanges = await db.query(`
      SELECT 
        MIN(admin_date) as earliest_vaccination,
        MAX(admin_date) as latest_vaccination,
        MIN(next_due_date) as earliest_due_date,
        MAX(next_due_date) as latest_due_date,
        CURRENT_DATE as today
      FROM immunization_records
      WHERE is_active = true
    `);
    console.table(dateRanges.rows[0]);

    // 9. Check if data is in the future
    console.log('\n9. FUTURE-DATED RECORDS CHECK');
    console.log('-'.repeat(80));
    const futureRecords = await db.query(`
      SELECT 
        COUNT(CASE WHEN admin_date > CURRENT_DATE THEN 1 END) as future_vaccinations,
        COUNT(CASE WHEN created_at > CURRENT_DATE THEN 1 END) as future_created
      FROM immunization_records
      WHERE is_active = true
    `);
    console.table(futureRecords.rows[0]);

    // 10. Sample recent immunization records
    console.log('\n10. SAMPLE RECENT IMMUNIZATION RECORDS');
    console.log('-'.repeat(80));
    const sampleRecords = await db.query(`
      SELECT 
        id,
        patient_id,
        vaccine_id,
        admin_date,
        next_due_date,
        status,
        DATE(created_at) as created_date
      FROM immunization_records
      WHERE is_active = true
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.table(sampleRecords.rows);

    console.log('\n' + '='.repeat(80));
    console.log('DIAGNOSIS COMPLETE');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error during diagnosis:', error);
    throw error;
  } finally {
    await db.end();
  }
}

diagnoseAnalytics()
  .then(() => {
    console.log('\n✅ Diagnosis completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Diagnosis failed:', error.message);
    process.exit(1);
  });
