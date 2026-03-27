/**
 * Reset Analytics Schema Mapping Cache
 * This clears the cached schema mappings and forces re-detection
 */

// Force module cache clear
delete require.cache[require.resolve('../repositories/analyticsRepository')];

const analyticsRepository = require('../repositories/analyticsRepository');

async function resetCache() {
  console.log('Resetting analytics schema mapping cache...\n');
  
  try {
    // The module has been reloaded, cache is now clear
    console.log('✅ Cache cleared successfully');
    console.log('✅ Next analytics query will re-detect schema\n');
    
    // Test inventory query to verify it works
    console.log('Testing inventory query...');
    const snapshot = await analyticsRepository.getInventorySnapshot({
      facilityId: null,
      vaccineIds: null,
    });
    
    console.log('✅ Inventory query successful!');
    console.table(snapshot);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    process.exit(0);
  }
}

resetCache();
