/**
 * Test Inventory Analytics WITHOUT Facility Filtering
 */

const analyticsRepository = require('../repositories/analyticsRepository');

async function testInventoryAnalytics() {
  console.log('Testing inventory analytics WITHOUT facility filtering...\n');

  try {
    // Test without facility ID
    const snapshot = await analyticsRepository.getInventorySnapshot({
      facilityId: null, // No facility filtering
      vaccineIds: null,
    });
    
    console.log('Inventory Snapshot (No Facility Filter):');
    console.table(snapshot);

    const byVaccine = await analyticsRepository.getInventoryByVaccine({
      facilityId: null,
      vaccineIds: null,
      vaccineKeys: ['BCG', 'HEPB', 'PENTA', 'OPV', 'IPV', 'PCV', 'MMR'],
    });
    
    console.log('\nInventory By Vaccine:');
    console.table(byVaccine);

    console.log('\n✅ Test completed successfully');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

testInventoryAnalytics();
