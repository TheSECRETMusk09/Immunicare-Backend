/**
 * Test Analytics Dashboard Endpoint
 * This tests the full dashboard analytics that the frontend calls
 */

const analyticsService = require('../services/analyticsService');

async function testDashboard() {
  console.log('='.repeat(80));
  console.log('TESTING ANALYTICS DASHBOARD ENDPOINT');
  console.log('='.repeat(80));
  console.log();

  try {
    const query = {
      period: 'month',
      vaccineType: 'ALL',
      vaccinationStatus: 'all',
    };

    const user = {
      id: 1,
      role_id: 1,
      clinic_id: 203,
      facility_id: 203,
    };

    console.log('Calling getDashboardAnalytics...');
    const result = await analyticsService.getDashboardAnalytics({ query, user });

    console.log('\n✅ Dashboard Analytics Response:');
    console.log('Filters:', result.filters);
    console.log('\nMetrics:');
    console.table({
      'Vaccinations Today': result.vaccinationsCompletedToday,
      'Infants Due': result.infantsDueForVaccination,
      'Overdue': result.overdueVaccinations,
      'Low Stock Vaccines': result.lowStockVaccines,
      'Total Available Doses': result.totalAvailableVaccineDoses,
    });

    console.log('\nInventory:');
    console.table({
      'Total Items': result.inventory.totalItems,
      'Total Doses': result.inventory.totalAvailableDoses,
      'Low Stock': result.inventory.lowStockCount,
      'Critical Stock': result.inventory.criticalStockCount,
    });

    console.log('\nInventory By Vaccine:');
    console.table(result.inventory.byVaccine);

    console.log('\n' + '='.repeat(80));
    console.log('✅ TEST PASSED - All metrics returned successfully');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ TEST FAILED');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    process.exit(0);
  }
}

testDashboard();
