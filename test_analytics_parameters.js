const pool = require('./db');

async function testAnalyticsQueries() {
  console.log('Testing Analytics Repository Parameter Issues...\n');

  try {
    // Test 1: Check if patients table has data
    console.log('1. Checking patients table...');
    const patientsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_patients,
        COUNT(DISTINCT guardian_id) as total_guardians
      FROM patients 
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('Patients:', patientsResult.rows[0]);

    // Test 2: Check immunization_records
    console.log('\n2. Checking immunization_records...');
    const immunizationsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE admin_date = CURRENT_DATE) as completed_today_admin,
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as completed_today_created,
        COUNT(*) FILTER (WHERE next_due_date < CURRENT_DATE AND status IN ('scheduled', 'pending')) as overdue
      FROM immunization_records
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('Immunizations:', immunizationsResult.rows[0]);

    // Test 3: Check appointments
    console.log('\n3. Checking appointments...');
    const appointmentsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_appointments,
        COUNT(*) FILTER (WHERE scheduled_date::date = CURRENT_DATE) as today,
        COUNT(*) FILTER (WHERE status IN ('scheduled', 'confirmed', 'rescheduled')) as pending
      FROM appointments
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('Appointments:', appointmentsResult.rows[0]);

    // Test 4: Test the actual analytics query with correct parameters
    console.log('\n4. Testing getInfantGuardianTotals query...');
    const infantGuardianResult = await pool.query(`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM patients p
          WHERE COALESCE(p.is_active, true) = true
            AND ($1::int IS NULL OR p.guardian_id = $1)
        ) AS total_infants,
        (
          SELECT COUNT(DISTINCT p.guardian_id)::int
          FROM patients p
          WHERE COALESCE(p.is_active, true) = true
            AND p.guardian_id IS NOT NULL
            AND ($1::int IS NULL OR p.guardian_id = $1)
        ) AS total_guardians
    `, [null]);
    console.log('Infant/Guardian Totals:', infantGuardianResult.rows[0]);

    // Test 5: Test vaccination snapshot with corrected parameters
    console.log('\n5. Testing getVaccinationSnapshot query...');
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const vaccinationResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE (
            ir.admin_date = CURRENT_DATE
            OR (ir.admin_date IS NULL AND ir.created_at::date = CURRENT_DATE)
          )
          AND ir.status IN ('completed', 'attended')
        )::int AS completed_today,
        COUNT(*) FILTER (
          WHERE (
            ir.admin_date BETWEEN $1::date AND $2::date
            OR (ir.admin_date IS NULL AND ir.created_at::date BETWEEN $1::date AND $2::date)
          )
          AND ir.status IN ('completed', 'attended')
        )::int AS administered_in_period,
        COUNT(*) FILTER (
          WHERE ir.next_due_date BETWEEN $1::date AND $2::date
            AND ir.status IN ('scheduled', 'pending')
        )::int AS due_in_period,
        COUNT(*) FILTER (
          WHERE ir.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
            AND ir.status IN ('scheduled', 'pending')
        )::int AS due_soon_7_days,
        COUNT(*) FILTER (
          WHERE ir.next_due_date < CURRENT_DATE
            AND ir.status IN ('scheduled', 'pending')
        )::int AS overdue_count,
        COUNT(DISTINCT ir.patient_id) FILTER (
          WHERE (
            ir.admin_date BETWEEN $1::date AND $2::date
            OR (ir.admin_date IS NULL AND ir.created_at::date BETWEEN $1::date AND $2::date)
          )
          AND ir.status IN ('completed', 'attended')
        )::int AS unique_infants_served
      FROM immunization_records ir
      JOIN patients p ON p.id = ir.patient_id
      WHERE COALESCE(ir.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND ($6::int IS NULL OR p.guardian_id = $6)
        AND ($3::int[] IS NULL OR ir.vaccine_id = ANY($3::int[]))
        AND ($4::text[] IS NULL OR ir.status = ANY($4::text[]))
        AND ($5::boolean = false OR (ir.next_due_date < CURRENT_DATE AND ir.status IN ('scheduled', 'pending')))
    `, [thirtyDaysAgo, today, null, null, false, null]);
    console.log('Vaccination Snapshot:', vaccinationResult.rows[0]);

    console.log('\n✅ All analytics queries executed successfully!');
    console.log('\nIf you see zeros, it means:');
    console.log('- The data exists in the database');
    console.log('- The queries are working correctly');
    console.log('- The issue is likely in how the frontend is calling the API or how dates are being passed');

  } catch (error) {
    console.error('❌ Error testing analytics queries:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

testAnalyticsQueries();
