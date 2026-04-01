const pool = require('./db');

async function verifyAllMetrics() {
  console.log('='.repeat(80));
  console.log('COMPREHENSIVE METRICS VERIFICATION');
  console.log('='.repeat(80));
  console.log('\n');

  try {
    // 1. INFANT & GUARDIAN COUNTS
    console.log('1. INFANT & GUARDIAN COUNTS');
    console.log('-'.repeat(80));
    const infantGuardianResult = await pool.query(`
      SELECT 
        COUNT(*) as total_infants,
        COUNT(DISTINCT guardian_id) as total_guardians
      FROM patients 
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('Total Infants:', infantGuardianResult.rows[0].total_infants);
    console.log('Total Guardians:', infantGuardianResult.rows[0].total_guardians);
    console.log('\n');

    // 2. VACCINATION RECORDS BREAKDOWN
    console.log('2. VACCINATION RECORDS BREAKDOWN');
    console.log('-'.repeat(80));
    const vaccinationBreakdown = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count,
        COUNT(DISTINCT patient_id) as unique_infants
      FROM immunization_records
      WHERE COALESCE(is_active, true) = true
      GROUP BY status
      ORDER BY count DESC
    `);
    console.log('By Status:');
    vaccinationBreakdown.rows.forEach(row => {
      console.log(`  ${row.status}: ${row.count} records (${row.unique_infants} unique infants)`);
    });
    console.log('\n');

    // 3. OVERDUE VACCINATIONS (Different Methods)
    console.log('3. OVERDUE VACCINATIONS (Different Calculation Methods)');
    console.log('-'.repeat(80));
    
    // Method 1: Count all overdue records
    const overdueRecords = await pool.query(`
      SELECT COUNT(*) as overdue_records
      FROM immunization_records
      WHERE COALESCE(is_active, true) = true
        AND next_due_date < CURRENT_DATE
        AND status IN ('scheduled', 'pending')
    `);
    console.log('Method 1 - All Overdue Records:', overdueRecords.rows[0].overdue_records);
    
    // Method 2: Count unique infants with overdue vaccinations
    const overdueInfants = await pool.query(`
      SELECT COUNT(DISTINCT patient_id) as overdue_infants
      FROM immunization_records
      WHERE COALESCE(is_active, true) = true
        AND next_due_date < CURRENT_DATE
        AND status IN ('scheduled', 'pending')
    `);
    console.log('Method 2 - Unique Infants with Overdue:', overdueInfants.rows[0].overdue_infants);
    console.log('\n');

    // 4. COMPLETED VACCINATIONS
    console.log('4. COMPLETED VACCINATIONS');
    console.log('-'.repeat(80));
    
    const completedToday = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE admin_date = CURRENT_DATE) as completed_admin_date,
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as completed_created_at,
        COUNT(*) FILTER (WHERE admin_date = CURRENT_DATE OR created_at::date = CURRENT_DATE) as completed_either
      FROM immunization_records
      WHERE COALESCE(is_active, true) = true
        AND status IN ('completed', 'attended')
    `);
    console.log('Completed Today (admin_date):', completedToday.rows[0].completed_admin_date);
    console.log('Completed Today (created_at):', completedToday.rows[0].completed_created_at);
    console.log('Completed Today (either):', completedToday.rows[0].completed_either);
    
    const completedTotal = await pool.query(`
      SELECT COUNT(*) as total_completed
      FROM immunization_records
      WHERE COALESCE(is_active, true) = true
        AND status IN ('completed', 'attended')
    `);
    console.log('Total Completed:', completedTotal.rows[0].total_completed);
    console.log('\n');

    // 5. INVENTORY METRICS
    console.log('5. INVENTORY METRICS');
    console.log('-'.repeat(80));
    
    // Total unique vaccines
    const uniqueVaccines = await pool.query(`
      SELECT COUNT(DISTINCT vaccine_id) as unique_vaccines
      FROM vaccine_inventory
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('Unique Vaccines:', uniqueVaccines.rows[0].unique_vaccines);
    
    // Total inventory records
    const totalInventoryRecords = await pool.query(`
      SELECT COUNT(*) as total_records
      FROM vaccine_inventory
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('Total Inventory Records:', totalInventoryRecords.rows[0].total_records);
    
    // Stock calculations
    const stockMetrics = await pool.query(`
      SELECT 
        SUM(beginning_balance) as total_beginning,
        SUM(received_during_period) as total_received,
        SUM(issuance) as total_issued,
        SUM(stock_on_hand) as total_stock_on_hand,
        SUM(expired_wasted) as total_wasted,
        SUM(transferred_in) as total_transferred_in,
        SUM(transferred_out) as total_transferred_out,
        COUNT(*) FILTER (WHERE stock_on_hand = 0) as out_of_stock_count,
        COUNT(*) FILTER (WHERE stock_on_hand > 0 AND stock_on_hand <= 10) as low_stock_count,
        COUNT(*) FILTER (WHERE is_low_stock = true) as low_stock_flag_count,
        COUNT(*) FILTER (WHERE is_critical_stock = true) as critical_stock_flag_count
      FROM vaccine_inventory
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('Stock Metrics:');
    console.log('  Total Beginning Balance:', stockMetrics.rows[0].total_beginning);
    console.log('  Total Received:', stockMetrics.rows[0].total_received);
    console.log('  Total Issued:', stockMetrics.rows[0].total_issued);
    console.log('  Total Transferred In:', stockMetrics.rows[0].total_transferred_in);
    console.log('  Total Transferred Out:', stockMetrics.rows[0].total_transferred_out);
    console.log('  Total Stock on Hand:', stockMetrics.rows[0].total_stock_on_hand);
    console.log('  Total Wasted:', stockMetrics.rows[0].total_wasted);
    console.log('  Out of Stock Count (stock = 0):', stockMetrics.rows[0].out_of_stock_count);
    console.log('  Low Stock Count (stock ≤ 10):', stockMetrics.rows[0].low_stock_count);
    console.log('  Low Stock Flag Count (is_low_stock = true):', stockMetrics.rows[0].low_stock_flag_count);
    console.log('  Critical Stock Flag Count (is_critical_stock = true):', stockMetrics.rows[0].critical_stock_flag_count);
    console.log('\n');

    // 6. APPOINTMENTS
    console.log('6. APPOINTMENTS');
    console.log('-'.repeat(80));
    
    const appointmentStats = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM appointments
      WHERE COALESCE(is_active, true) = true
      GROUP BY status
      ORDER BY count DESC
    `);
    console.log('By Status:');
    appointmentStats.rows.forEach(row => {
      console.log(`  ${row.status}: ${row.count}`);
    });
    
    const pendingAppointments = await pool.query(`
      SELECT COUNT(*) as pending_count
      FROM appointments
      WHERE COALESCE(is_active, true) = true
        AND status IN ('scheduled', 'confirmed', 'rescheduled')
    `);
    console.log('Pending Appointments:', pendingAppointments.rows[0].pending_count);
    console.log('\n');

    // 7. REPORTS (Skip - focus on key metrics)
    console.log('7. DIGITAL PAPERS/REPORTS');
    console.log('-'.repeat(80));
    console.log('(Skipping detailed report breakdown - focusing on key metrics)');
    console.log('\n');

    // 8. VACCINATION SCHEDULE OVERVIEW
    console.log('8. VACCINATION SCHEDULE OVERVIEW');
    console.log('-'.repeat(80));
    
    const scheduleOverview = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE next_due_date < CURRENT_DATE AND status IN ('scheduled', 'pending')) as overdue,
        COUNT(*) FILTER (WHERE next_due_date = CURRENT_DATE AND status IN ('scheduled', 'pending')) as due_today,
        COUNT(*) FILTER (WHERE next_due_date > CURRENT_DATE AND status IN ('scheduled', 'pending')) as upcoming,
        COUNT(*) FILTER (WHERE status IN ('completed', 'attended')) as completed,
        COUNT(*) as total_records
      FROM immunization_records
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('Overdue:', scheduleOverview.rows[0].overdue);
    console.log('Due Today:', scheduleOverview.rows[0].due_today);
    console.log('Upcoming:', scheduleOverview.rows[0].upcoming);
    console.log('Completed:', scheduleOverview.rows[0].completed);
    console.log('Total Records:', scheduleOverview.rows[0].total_records);
    console.log('\n');

    // 9. CROSS-VERIFICATION
    console.log('9. CROSS-VERIFICATION');
    console.log('-'.repeat(80));
    console.log('Expected Totals:');
    const expectedTotal = parseInt(scheduleOverview.rows[0].overdue) + 
                         parseInt(scheduleOverview.rows[0].due_today) + 
                         parseInt(scheduleOverview.rows[0].upcoming) + 
                         parseInt(scheduleOverview.rows[0].completed);
    console.log(`  Overdue + Due + Upcoming + Completed = ${expectedTotal}`);
    console.log(`  Total Records from Query = ${scheduleOverview.rows[0].total_records}`);
    console.log(`  Match: ${expectedTotal === parseInt(scheduleOverview.rows[0].total_records) ? '✅ YES' : '❌ NO'}`);
    console.log('\n');

    console.log('='.repeat(80));
    console.log('VERIFICATION COMPLETE');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('Error during verification:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

verifyAllMetrics();
