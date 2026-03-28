/**
 * Test Analytics Fixes
 * Verify all analytics data is now correct
 */

const pool = require('./db');
const analyticsService = require('./services/analyticsService');

async function testAnalyticsFixes() {
  console.log('=== TESTING ANALYTICS FIXES ===\n');

  try {
    // Mock user object
    const mockUser = {
      id: 1,
      facility_id: 203,
      clinic_id: 203,
      role: 'SYSTEM_ADMIN'
    };

    // Test 1: Dashboard Analytics
    console.log('1. Testing Dashboard Analytics...');
    const dashboard = await analyticsService.getDashboardAnalytics({
      query: { period: 'month' },
      user: mockUser
    });

    console.log('\n✅ Dashboard Summary:');
    console.log(`   Total Registered Infants: ${dashboard.summary.totalRegisteredInfants} (expected: 5000)`);
    console.log(`   Total Guardians: ${dashboard.summary.totalGuardians} (expected: 3623)`);
    console.log(`   Vaccinations Completed Today: ${dashboard.summary.vaccinationsCompletedToday} (expected: >0)`);
    console.log(`   Infants Due for Vaccination: ${dashboard.summary.infantsDueForVaccination}`);
    console.log(`   Due Soon (7 Days): ${dashboard.summary.dueSoon7Days} (NEW METRIC)`);
    console.log(`   Overdue Vaccinations: ${dashboard.summary.overdueVaccinations} (expected: ~50000)`);
    console.log(`   Pending Appointments: ${dashboard.summary.pendingAppointments}`);

    // Test 2: Vaccination Analytics
    console.log('\n2. Testing Vaccination Analytics...');
    const vaccinations = await analyticsService.getVaccinationAnalytics({
      query: { period: 'month' },
      user: mockUser
    });

    console.log('\n✅ Vaccination Summary:');
    console.log(`   Completed Today: ${vaccinations.summary.completedToday}`);
    console.log(`   Administered in Period: ${vaccinations.summary.administeredInPeriod}`);
    console.log(`   Due in Period: ${vaccinations.summary.dueInPeriod}`);
    console.log(`   Due Soon (7 Days): ${vaccinations.summary.dueSoon7Days} (NEW)`);
    console.log(`   Overdue: ${vaccinations.summary.overdue}`);
    console.log(`   Unique Infants Served: ${vaccinations.summary.uniqueInfantsServed}`);

    // Test 3: Dashboard Summary (for frontend cards)
    console.log('\n3. Testing Dashboard Summary Analytics...');
    const summary = await analyticsService.getDashboardSummaryAnalytics({
      query: { period: 'month' },
      user: mockUser
    });

    console.log('\n✅ Dashboard Summary Cards:');
    console.log(`   Infants: ${summary.summary.infants} (expected: 5000)`);
    console.log(`   Guardians: ${summary.summary.guardians} (expected: 3623)`);
    console.log(`   Appointments Today: ${summary.summary.appointmentsToday}`);
    console.log(`   Low Stock: ${summary.summary.lowStock}`);
    console.log(`   Overdue Vaccinations: ${summary.summary.overdueVaccinations}`);
    console.log(`   Completed Today: ${summary.summary.completedToday}`);

    // Verification
    console.log('\n========================================');
    console.log('VERIFICATION RESULTS:');
    console.log('========================================');
    
    const infantsCorrect = dashboard.summary.totalRegisteredInfants === 5000;
    const guardiansCorrect = dashboard.summary.totalGuardians === 3623;
    const completedTodayFixed = dashboard.summary.vaccinationsCompletedToday > 0;
    const overdueFixed = dashboard.summary.overdueVaccinations > 40000;
    const dueSoonAdded = dashboard.summary.dueSoon7Days !== undefined;

    console.log(`✅ Total Infants: ${infantsCorrect ? 'FIXED (5000)' : `ISSUE (${dashboard.summary.totalRegisteredInfants})`}`);
    console.log(`✅ Total Guardians: ${guardiansCorrect ? 'FIXED (3623)' : `ISSUE (${dashboard.summary.totalGuardians})`}`);
    console.log(`✅ Completed Today: ${completedTodayFixed ? 'FIXED (>0)' : 'STILL ZERO'}`);
    console.log(`✅ Overdue Vaccinations: ${overdueFixed ? 'FIXED (~50k)' : `ISSUE (${dashboard.summary.overdueVaccinations})`}`);
    console.log(`✅ Due Soon (7 Days): ${dueSoonAdded ? 'ADDED' : 'MISSING'}`);
    
    const allFixed = infantsCorrect && guardiansCorrect && completedTodayFixed && overdueFixed && dueSoonAdded;
    console.log(`\n${allFixed ? '🎉 ALL FIXES VERIFIED!' : '⚠️  SOME ISSUES REMAIN'}`);
    console.log('========================================\n');

    await pool.end();
    process.exit(allFixed ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Error during testing:', error);
    console.error(error.stack);
    await pool.end();
    process.exit(1);
  }
}

testAnalyticsFixes();
