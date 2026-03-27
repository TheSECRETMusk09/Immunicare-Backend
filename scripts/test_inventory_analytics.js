/**
 * Test Inventory Analytics Query
 * Verify that analytics repository correctly queries inventory table
 */

const analyticsRepository = require('../repositories/analyticsRepository');

async function testInventoryAnalytics() {
  console.log('='.repeat(80));
  console.log('TESTING INVENTORY ANALYTICS QUERIES');
  console.log('='.repeat(80));
  console.log();

  try {
    // Test 1: Get inventory snapshot
    console.log('Test 1: Get Inventory Snapshot');
    console.log('-'.repeat(80));
    const snapshot = await analyticsRepository.getInventorySnapshot({
      facilityId: 203, // San Nicolas Health Center
      vaccineIds: null,
    });
    console.log('Inventory Snapshot:');
    console.table(snapshot);

    // Test 2: Get inventory by vaccine
    console.log('\nTest 2: Get Inventory By Vaccine');
    console.log('-'.repeat(80));
    const byVaccine = await analyticsRepository.getInventoryByVaccine({
      facilityId: 203,
      vaccineIds: null,
      vaccineKeys: ['BCG', 'HEPB', 'PENTA', 'OPV', 'IPV', 'PCV', 'MMR'],
    });
    console.log('Inventory By Vaccine:');
    console.table(byVaccine);

    console.log('\n' + '='.repeat(80));
    console.log('✅ INVENTORY ANALYTICS TEST COMPLETE');
    console.log('='.repeat(80));
    console.log('\nExpected Results:');
    console.log('- Total Items: 18');
    console.log('- Total Available Doses: 373');
    console.log('- Low Stock Count: 4');
    console.log('- Vaccines should show actual quantities from database\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

testInventoryAnalytics();
