const pool = require('./db');
const inventoryCalculationService = require('./services/inventoryCalculationService');

async function testFefoBatchAPI() {
  try {
    console.log('Testing FEFO batch API for BCG (vaccine_id=1, clinic_id=1)...\n');
    
    const lots = await inventoryCalculationService.getAvailableLots(1, 1);
    
    console.log('Total batches returned:', lots.length);
    console.log('\nFirst 3 batches:');
    console.log(JSON.stringify(lots.slice(0, 3), null, 2));
    
    console.log('\nField names in first batch:');
    if (lots.length > 0) {
      console.log(Object.keys(lots[0]));
    }
    
    console.log('\nBatches with stock > 0:', lots.filter(b => b.available_quantity > 0 || b.stock > 0).length);
    console.log('Batches with stock = 0:', lots.filter(b => (b.available_quantity || 0) === 0 && (b.stock || 0) === 0).length);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

testFefoBatchAPI();
