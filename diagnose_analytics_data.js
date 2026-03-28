/**
 * Diagnostic Script to Check Analytics Data Issues
 * Identifies why analytics dashboard shows zeros
 */

const pool = require('./db');

async function diagnoseAnalyticsData() {
  console.log('=== ANALYTICS DATA DIAGNOSTIC ===\n');

  try {
    const facilityId = 1; // San Nicolas Health Center

    // 1. Check Infants Count
    console.log('1. Checking Infants Count...');
    const infantsQuery = await pool.query(`
      SELECT 
        COUNT(*) as total_infants,
        COUNT(*) FILTER (WHERE is_active = true) as active_infants,
        COUNT(*) FILTER (WHERE facility_id = $1) as facility_1_infants
      FROM patients
    `, [facilityId]);
    console.log('Infants:', infantsQuery.rows[0]);

    // 2. Check Guardians Count
    console.log('\n2. Checking Guardians Count...');
    const guardiansQuery = await pool.query(`
      SELECT 
        COUNT(DISTINCT guardian_id) as total_guardians,
        COUNT(DISTINCT guardian_id) FILTER (WHERE is_active = true) as active_guardians,
        COUNT(DISTINCT guardian_id) FILTER (WHERE facility_id = $1) as facility_1_guardians
      FROM patients
      WHERE guardian_id IS NOT NULL
    `, [facilityId]);
    console.log('Guardians:', guardiansQuery.rows[0]);

    // 3. Check Patients Table Schema
    console.log('\n3. Checking Patients Table Schema...');
    const schemaQuery = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'patients'
        AND column_name IN ('facility_id', 'is_active', 'guardian_id')
      ORDER BY column_name
    `);
    console.log('Patients columns:', schemaQuery.rows);

    // 4. Check Vaccinations Completed Today
    console.log('\n4. Checking Vaccinations Completed Today...');
    const vaccinationsToday = await pool.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE admin_date = CURRENT_DATE) as completed_today,
        COUNT(*) FILTER (WHERE admin_date = CURRENT_DATE AND status = 'completed') as completed_today_status,
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as created_today
      FROM immunization_records
      WHERE is_active = true
    `);
    console.log('Vaccinations Today:', vaccinationsToday.rows[0]);

    // 5. Check Immunization Records Schema
    console.log('\n5. Checking Immunization Records Schema...');
    const irSchemaQuery = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'immunization_records'
        AND column_name IN ('admin_date', 'status', 'next_due_date', 'facility_id', 'patient_id')
      ORDER BY column_name
    `);
    console.log('Immunization Records columns:', irSchemaQuery.rows);
    
    // 5b. Check facility_id distribution in patients
    console.log('\n5b. Checking facility_id distribution in patients...');
    const facilityDistQuery = await pool.query(`
      SELECT 
        facility_id,
        COUNT(*) as count
      FROM patients
      WHERE is_active = true
      GROUP BY facility_id
      ORDER BY count DESC
      LIMIT 5
    `);
    console.log('Facility distribution:');
    console.table(facilityDistQuery.rows);

    // 6. Check Overdue Vaccinations
    console.log('\n6. Checking Overdue Vaccinations...');
    const overdueQuery = await pool.query(`
      SELECT 
        COUNT(*) as total_overdue,
        COUNT(*) FILTER (WHERE status = 'scheduled') as overdue_scheduled,
        COUNT(*) FILTER (WHERE status = 'pending') as overdue_pending
      FROM immunization_records
      WHERE is_active = true
        AND next_due_date < CURRENT_DATE
    `);
    console.log('Overdue Vaccinations:', overdueQuery.rows[0]);

    // 7. Check Status Values
    console.log('\n7. Checking Status Values in Database...');
    const statusQuery = await pool.query(`
      SELECT 
        COALESCE(status, 'NULL') as status,
        COUNT(*) as count
      FROM immunization_records
      WHERE is_active = true
      GROUP BY status
      ORDER BY count DESC
      LIMIT 10
    `);
    console.log('Status distribution:');
    console.table(statusQuery.rows);

    // 8. Check Appointments
    console.log('\n8. Checking Pending Appointments...');
    const appointmentsQuery = await pool.query(`
      SELECT 
        COUNT(*) as total_appointments,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE appointment_date >= CURRENT_DATE) as future_appointments
      FROM appointments
      WHERE is_active = true
    `);
    console.log('Appointments:', appointmentsQuery.rows[0]);

    // 9. Check Schema Column Mappings
    console.log('\n9. Checking Schema Column Mappings...');
    const mappingsQuery = await pool.query(`
      SELECT key, value
      FROM schema_column_mappings
      WHERE key IN ('patients_scope', 'patients_scope_fallback', 'immunization_status')
      ORDER BY key
    `);
    console.log('Schema mappings:');
    console.table(mappingsQuery.rows);

    // Summary
    console.log('\n========================================');
    console.log('DIAGNOSTIC SUMMARY:');
    console.log('========================================');
    console.log(`Total Infants: ${infantsQuery.rows[0].total_infants}`);
    console.log(`Total Guardians: ${guardiansQuery.rows[0].total_guardians}`);
    console.log(`Vaccinations Today: ${vaccinationsToday.rows[0].completed_today || vaccinationsToday.rows[0].created_today}`);
    console.log(`Overdue Vaccinations: ${overdueQuery.rows[0].total_overdue}`);
    console.log(`Pending Appointments: ${appointmentsQuery.rows[0].pending || appointmentsQuery.rows[0].scheduled}`);
    console.log('========================================\n');

    await pool.end();
  } catch (error) {
    console.error('\n❌ Error during diagnosis:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

diagnoseAnalyticsData();
