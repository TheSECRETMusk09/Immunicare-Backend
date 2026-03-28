const pool = require('./db');

async function debugWasteTransaction() {
  try {
    console.log('=== Debugging Waste Transaction Issue ===\n');
    
    // Get BCG inventory record (vaccine_id = 1 based on screenshot)
    const inventoryQuery = `
      SELECT 
        id,
        vaccine_id,
        beginning_balance,
        received_during_period,
        transferred_in,
        transferred_out,
        expired_wasted,
        issuance,
        (beginning_balance + received_during_period + transferred_in - transferred_out - expired_wasted - issuance) as calculated_balance
      FROM vaccine_inventory
      WHERE vaccine_id = 1
      LIMIT 1;
    `;
    
    const inventoryResult = await pool.query(inventoryQuery);
    
    if (inventoryResult.rows.length === 0) {
      console.log('❌ No vaccine_inventory record found for BCG (vaccine_id = 1)');
      console.log('This is the issue - the inventory sheet needs to be saved first!');
    } else {
      console.log('✓ Found vaccine_inventory record:');
      console.table(inventoryResult.rows);
      
      const inventory = inventoryResult.rows[0];
      const previousBalance = 
        Number(inventory.beginning_balance || 0) +
        Number(inventory.received_during_period || 0) +
        Number(inventory.transferred_in || 0) -
        Number(inventory.transferred_out || 0) -
        Number(inventory.expired_wasted || 0) -
        Number(inventory.issuance || 0);
      
      console.log(`\nCalculated previous balance: ${previousBalance}`);
      console.log(`Attempting to waste: 600`);
      console.log(`New balance would be: ${previousBalance - 600}`);
      
      if (previousBalance - 600 < 0) {
        console.log('\n❌ This would result in negative balance!');
        console.log(`Current stock (${previousBalance}) is less than waste amount (600)`);
      } else {
        console.log('\n✓ Transaction should be valid');
      }
    }
    
    console.log('\n=== Checking inventory table (different from vaccine_inventory) ===');
    const inventoryTableQuery = `
      SELECT 
        id,
        vaccine_id,
        batch_number,
        quantity
      FROM inventory
      WHERE vaccine_id = 1
      ORDER BY quantity DESC
      LIMIT 5;
    `;
    
    const inventoryTableResult = await pool.query(inventoryTableQuery);
    console.log('Inventory table records for BCG:');
    console.table(inventoryTableResult.rows);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

debugWasteTransaction();
