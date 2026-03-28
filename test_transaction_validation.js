const pool = require('./db');

async function testTransactionValidation() {
  try {
    console.log('Testing transaction validation...\n');

    // Test 1: Check if we have inventory records
    const inventoryResult = await pool.query(`
      SELECT id, vaccine_id, clinic_id, facility_id, location, stock_on_hand, beginning_balance, received_during_period
      FROM inventory
      WHERE is_active = true
      LIMIT 5
    `);
    
    console.log('Sample Inventory Records:');
    console.log(inventoryResult.rows);
    console.log('\n');

    // Test 2: Check vaccine_inventory table
    const vaccineInventoryResult = await pool.query(`
      SELECT id, vaccine_id, clinic_id, facility_id, beginning_balance, received_during_period
      FROM vaccine_inventory
      WHERE is_active = true
      LIMIT 5
    `);
    
    console.log('Sample Vaccine Inventory Records:');
    console.log(vaccineInventoryResult.rows);
    console.log('\n');

    // Test 3: Check vaccines table
    const vaccinesResult = await pool.query(`
      SELECT id, name, code
      FROM vaccines
      WHERE is_active = true
      LIMIT 10
    `);
    
    console.log('Sample Vaccines:');
    console.log(vaccinesResult.rows);
    console.log('\n');

    // Test 4: Check which table is used for inventory
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('inventory', 'vaccine_inventory')
      ORDER BY table_name
    `);
    
    console.log('Available Inventory Tables:');
    console.log(tableCheck.rows);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

testTransactionValidation();
