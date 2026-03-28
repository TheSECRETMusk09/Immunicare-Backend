const pool = require('./db');

async function fixStockOnHandSync() {
  try {
    console.log('=== Syncing stock_on_hand with calculated values ===\n');
    
    // First, check how many records need updating
    const checkQuery = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (
          WHERE stock_on_hand IS NULL OR 
          stock_on_hand != (beginning_balance + received_during_period + transferred_in - 
                           transferred_out - expired_wasted - issuance)
        ) as records_needing_update
      FROM vaccine_inventory;
    `;
    
    const checkResult = await pool.query(checkQuery);
    console.log('Current state:');
    console.table(checkResult.rows);
    
    if (checkResult.rows[0].records_needing_update === '0') {
      console.log('\n✓ All records are already in sync!');
      await pool.end();
      return;
    }
    
    console.log('\n=== Updating stock_on_hand values ===');
    
    const updateQuery = `
      UPDATE vaccine_inventory
      SET stock_on_hand = (
        beginning_balance + received_during_period + transferred_in - 
        transferred_out - expired_wasted - issuance
      ),
      updated_at = CURRENT_TIMESTAMP
      WHERE stock_on_hand IS NULL OR 
        stock_on_hand != (beginning_balance + received_during_period + transferred_in - 
                         transferred_out - expired_wasted - issuance);
    `;
    
    const updateResult = await pool.query(updateQuery);
    console.log(`✓ Updated ${updateResult.rowCount} records`);
    
    // Verify the fix
    console.log('\n=== Verification ===');
    const verifyResult = await pool.query(checkQuery);
    console.table(verifyResult.rows);
    
    // Show sample of updated records
    console.log('\n=== Sample of updated records ===');
    const sampleQuery = `
      SELECT 
        id,
        vaccine_id,
        beginning_balance,
        received_during_period,
        transferred_in,
        transferred_out,
        expired_wasted,
        issuance,
        stock_on_hand,
        (beginning_balance + received_during_period + transferred_in - 
         transferred_out - expired_wasted - issuance) as calculated_stock
      FROM vaccine_inventory
      ORDER BY updated_at DESC
      LIMIT 5;
    `;
    
    const sampleResult = await pool.query(sampleQuery);
    console.table(sampleResult.rows);
    
    console.log('\n✅ Stock synchronization complete!');
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixStockOnHandSync();
