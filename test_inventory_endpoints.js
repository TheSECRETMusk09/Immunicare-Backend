/**
 * Test script to verify new inventory endpoints are working
 */

const pool = require('./db');

async function testInventoryEndpoints() {
  console.log('=== TESTING INVENTORY ENDPOINTS ===\n');

  try {
    // Test 1: Unified Summary
    console.log('1. Testing Unified Summary Calculation...');
    const inventoryCalculationService = require('./services/inventoryCalculationService');
    
    const clinicId = 1; // San Nicolas Health Center
    const summary = await inventoryCalculationService.getUnifiedSummary(clinicId);
    
    console.log('\n✅ Unified Summary:');
    console.log(`   Total Vaccines: ${summary.total_vaccines} (should be 7, not 522)`);
    console.log(`   Total Inventory Records: ${summary.total_inventory_records}`);
    console.log(`   Stock on Hand: ${summary.stock_on_hand}`);
    console.log(`   Wasted/Expired: ${summary.wasted_expired} (should match transactions)`);
    console.log(`   Critical Count: ${summary.critical_count}`);
    console.log(`   Low Stock Count: ${summary.low_stock_count}`);
    console.log(`   Movement Records: ${summary.movement_records}`);
    console.log(`   Stock In: ${summary.stock_in}`);
    console.log(`   Stock Out: ${summary.stock_out}`);

    // Test 2: Available Lots
    console.log('\n2. Testing Available Lots...');
    const bcgVaccineId = await pool.query(`SELECT id FROM vaccines WHERE name ILIKE '%BCG%' LIMIT 1`);
    
    let lots = [];
    if (bcgVaccineId.rows.length > 0) {
      lots = await inventoryCalculationService.getAvailableLots(
        bcgVaccineId.rows[0].id,
        clinicId
      );
      
      console.log(`\n✅ Available BCG Lots: ${lots.length}`);
      if (lots.length > 0) {
        console.log('   Sample lot:');
        console.log(`   - Lot Number: ${lots[0].lot_number}`);
        console.log(`   - Stock: ${lots[0].stock}`);
        console.log(`   - Expiry: ${lots[0].expiry_date || 'N/A'}`);
      }
    }

    // Test 3: Stock Movements with Performed By
    console.log('\n3. Testing Stock Movements with Performed By...');
    const movements = await pool.query(`
      SELECT 
        vit.id,
        vit.transaction_type,
        vit.quantity,
        v.name as vaccine_name,
        COALESCE(
          NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
          u.username,
          'System'
        ) as performed_by_name,
        u.role as performed_by_role
      FROM vaccine_inventory_transactions vit
      JOIN vaccines v ON vit.vaccine_id = v.id
      LEFT JOIN users u ON vit.performed_by = u.id
      WHERE vit.clinic_id = $1
      ORDER BY vit.created_at DESC
      LIMIT 5
    `, [clinicId]);

    console.log(`\n✅ Recent Stock Movements: ${movements.rows.length}`);
    movements.rows.forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.transaction_type} - ${m.vaccine_name} (${m.quantity})`);
      console.log(`      Performed By: ${m.performed_by_name} (${m.performed_by_role || 'N/A'})`);
    });

    // Test 4: Stock Alerts
    console.log('\n4. Testing Stock Alerts...');
    const alerts = await inventoryCalculationService.getStockAlerts(clinicId);
    
    console.log(`\n✅ Stock Alerts:`);
    console.log(`   Critical: ${alerts.critical.length}`);
    console.log(`   Low Stock: ${alerts.low.length}`);
    console.log(`   Out of Stock: ${alerts.out_of_stock.length}`);
    console.log(`   Expiring Soon: ${alerts.expiring_soon.length}`);

    // Summary
    console.log('\n========================================');
    console.log('VERIFICATION RESULTS:');
    console.log('========================================');
    console.log(`✅ Total Vaccines: ${summary.total_vaccines === 7 ? 'CORRECT (7)' : `INCORRECT (${summary.total_vaccines})`}`);
    console.log(`✅ Wasted/Expired: ${summary.wasted_expired > 0 ? `CORRECT (${summary.wasted_expired})` : 'INCORRECT (0)'}`);
    console.log(`✅ Available Lots: ${lots && lots.length > 0 ? 'WORKING' : 'NO DATA'}`);
    console.log(`✅ Performed By: ${movements.rows.length > 0 && movements.rows[0].performed_by_name !== 'System' ? 'WORKING' : 'CHECK NEEDED'}`);
    console.log('========================================\n');

    await pool.end();
  } catch (error) {
    console.error('\n❌ Error during testing:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testInventoryEndpoints();
