require('dotenv').config({ path: '.env.development' });
require('dotenv').config();

const pool = require('./db');

async function verifyWasteData() {
  console.log('Verifying Waste Data in Database...\n');

  try {
    // 1. Check vaccine_inventory_transactions for WASTAGE type
    const wasteTransactions = await pool.query(`
      SELECT 
        COUNT(*) as waste_transaction_count,
        SUM(ABS(quantity)) as total_wasted_quantity
      FROM vaccine_inventory_transactions
      WHERE UPPER(transaction_type) = 'WASTAGE'
    `);
    console.log('1. Waste Transactions:');
    console.log('   Count:', wasteTransactions.rows[0].waste_transaction_count);
    console.log('   Total Quantity:', wasteTransactions.rows[0].total_wasted_quantity);

    // 2. Check vaccine_inventory for expired_wasted column
    const inventoryWaste = await pool.query(`
      SELECT 
        COUNT(*) as items_with_waste,
        SUM(COALESCE(expired_wasted, 0)) as total_expired_wasted
      FROM vaccine_inventory
      WHERE COALESCE(expired_wasted, 0) > 0
        AND COALESCE(is_active, true) = true
    `);
    console.log('\n2. Inventory Expired/Wasted:');
    console.log('   Items with waste:', inventoryWaste.rows[0].items_with_waste);
    console.log('   Total expired/wasted:', inventoryWaste.rows[0].total_expired_wasted);

    // 3. Check all vaccine_inventory columns
    const allInventory = await pool.query(`
      SELECT 
        id,
        vaccine_id,
        beginning_balance,
        received_during_period,
        transferred_in,
        transferred_out,
        expired_wasted,
        issuance,
        stock_on_hand
      FROM vaccine_inventory
      WHERE COALESCE(expired_wasted, 0) > 0
        AND COALESCE(is_active, true) = true
      LIMIT 10
    `);
    console.log('\n3. Sample Inventory Records with Waste:');
    allInventory.rows.forEach(row => {
      console.log(`   Vaccine ID ${row.vaccine_id}: expired_wasted=${row.expired_wasted}, stock_on_hand=${row.stock_on_hand}`);
    });

    // 4. Check stock movement history table
    const stockMovements = await pool.query(`
      SELECT 
        transaction_type as type,
        COUNT(*) as count,
        SUM(ABS(quantity)) as total_quantity
      FROM vaccine_inventory_transactions
      GROUP BY transaction_type
      ORDER BY count DESC
    `);
    console.log('\n4. Stock Movement Types:');
    stockMovements.rows.forEach(row => {
      console.log(`   ${row.type}: ${row.count} transactions, ${row.total_quantity} total quantity`);
    });

    // 5. Check what the dashboard query returns
    const dashboardWaste = await pool.query(`
      SELECT 
        COALESCE(SUM(expired_wasted), 0)::int AS wasted
      FROM vaccine_inventory
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('\n5. Dashboard Waste Query Result:');
    console.log('   Wasted:', dashboardWaste.rows[0].wasted);

    console.log('\n✅ Verification complete!');
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

verifyWasteData();
