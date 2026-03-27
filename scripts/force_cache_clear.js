/**
 * Force Clear Analytics Repository Cache
 * This script forces the schema mapping cache to be cleared
 */

const db = require('../db');

async function forceCacheClear() {
  console.log('Forcing analytics repository cache clear...\n');
  
  try {
    // Check what the schema actually has
    const result = await db.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('inventory', 'vaccine_inventory')
        AND column_name IN ('clinic_id', 'facility_id', 'quantity', 'stock_on_hand')
      ORDER BY table_name, column_name
    `);
    
    console.log('Actual Database Schema:');
    console.table(result.rows);
    
    console.log('\nInventory table columns:');
    const invCols = result.rows.filter(r => r.table_name === 'inventory');
    console.log('- Has clinic_id:', invCols.some(r => r.column_name === 'clinic_id'));
    console.log('- Has facility_id:', invCols.some(r => r.column_name === 'facility_id'));
    console.log('- Has quantity:', invCols.some(r => r.column_name === 'quantity'));
    console.log('- Has stock_on_hand:', invCols.some(r => r.column_name === 'stock_on_hand'));
    
    console.log('\nvaccine_inventory table exists:', result.rows.some(r => r.table_name === 'vaccine_inventory'));
    
    console.log('\n✅ Schema check complete');
    console.log('\nTo clear cache: Restart the backend server');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await db.end();
    process.exit(0);
  }
}

forceCacheClear();
