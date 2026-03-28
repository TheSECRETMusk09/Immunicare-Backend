const pool = require('./db');

async function checkInventoryRecord() {
  try {
    console.log('=== Checking Inventory Record ID 478 ===\n');
    
    const query = `
      SELECT 
        vi.id,
        vi.vaccine_id,
        v.name as vaccine_name,
        vi.beginning_balance,
        vi.received_during_period,
        vi.transferred_in,
        vi.transferred_out,
        vi.expired_wasted,
        vi.issuance,
        vi.stock_on_hand,
        (vi.beginning_balance + vi.received_during_period + vi.transferred_in - 
         vi.transferred_out - vi.expired_wasted - vi.issuance) as calculated_stock_on_hand
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      WHERE vi.id = 478;
    `;
    
    const result = await pool.query(query);
    
    if (result.rows.length === 0) {
      console.log('No record found with ID 478');
    } else {
      console.log('Inventory Record Details:');
      console.table(result.rows);
      
      const record = result.rows[0];
      console.log('\n=== Analysis ===');
      console.log(`Calculated stock: ${record.calculated_stock_on_hand}`);
      console.log(`Stored stock_on_hand: ${record.stock_on_hand}`);
      console.log(`Difference: ${record.stock_on_hand - record.calculated_stock_on_hand}`);
      
      console.log('\n=== If trying to waste 600 units ===');
      console.log(`Using calculated stock (${record.calculated_stock_on_hand}): ${record.calculated_stock_on_hand - 600} (${record.calculated_stock_on_hand - 600 < 0 ? 'NEGATIVE - INVALID' : 'VALID'})`);
      console.log(`Using stock_on_hand (${record.stock_on_hand}): ${record.stock_on_hand - 600} (${record.stock_on_hand - 600 < 0 ? 'NEGATIVE - INVALID' : 'VALID'})`);
    }
    
    // Check recent transactions for this record
    console.log('\n=== Recent Transactions for Record 478 ===');
    const txnQuery = `
      SELECT 
        id,
        transaction_type,
        quantity,
        previous_balance,
        new_balance,
        created_at
      FROM vaccine_inventory_transactions
      WHERE vaccine_inventory_id = 478
      ORDER BY created_at DESC
      LIMIT 10;
    `;
    
    const txnResult = await pool.query(txnQuery);
    if (txnResult.rows.length > 0) {
      console.table(txnResult.rows);
    } else {
      console.log('No transactions found for this record');
    }
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkInventoryRecord();
