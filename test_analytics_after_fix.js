const pool = require('./db');
const analyticsRepository = require('./repositories/analyticsRepository');

async function testAnalyticsAfterFix() {
  try {
    console.log('=== Testing Analytics After inventory → vaccine_inventory Fix ===\n');
    
    console.log('1. Testing getInventorySnapshot...');
    const inventorySnapshot = await analyticsRepository.getInventorySnapshot({
      facilityId: null,
      vaccineIds: null,
    });
    console.log('✓ getInventorySnapshot successful:');
    console.table([inventorySnapshot]);
    
    console.log('\n2. Testing getInventoryByVaccine...');
    const inventoryByVaccine = await analyticsRepository.getInventoryByVaccine({
      facilityId: null,
      vaccineIds: null,
      vaccineKeys: ['BCG', 'HEPB', 'PENTA', 'OPV', 'IPV', 'PCV', 'MMR'],
    });
    console.log(`✓ getInventoryByVaccine successful (${inventoryByVaccine.length} vaccines):`);
    console.table(inventoryByVaccine);
    
    console.log('\n3. Testing getLowStockAlerts...');
    const lowStockAlerts = await analyticsRepository.getLowStockAlerts({
      facilityId: null,
      vaccineIds: null,
      limit: 10,
    });
    console.log(`✓ getLowStockAlerts successful (${lowStockAlerts.length} alerts):`);
    console.table(lowStockAlerts.slice(0, 5));
    
    console.log('\n✅ All analytics functions working correctly with vaccine_inventory table!');
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error testing analytics:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testAnalyticsAfterFix();
