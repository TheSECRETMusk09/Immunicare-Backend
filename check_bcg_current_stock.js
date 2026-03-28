const pool = require('./db');

async function checkBCGCurrentStock() {
  try {
    console.log('=== CHECKING BCG VACCINE STOCK ===\n');

    // Get BCG vaccine ID
    const vaccineQuery = await pool.query(`
      SELECT id, name FROM vaccines WHERE name ILIKE '%BCG%' LIMIT 1;
    `);
    
    if (vaccineQuery.rows.length === 0) {
      console.log('❌ BCG vaccine not found');
      await pool.end();
      return;
    }

    const bcgVaccineId = vaccineQuery.rows[0].id;
    console.log(`BCG Vaccine ID: ${bcgVaccineId} - ${vaccineQuery.rows[0].name}\n`);

    // Check vaccine inventory for San Nicolas Health Center (clinic_id = 1)
    const inventoryQuery = await pool.query(`
      SELECT 
        vi.id,
        v.name as vaccine_name,
        vi.beginning_balance,
        vi.received_during_period,
        vi.transferred_in,
        vi.transferred_out,
        vi.expired_wasted,
        vi.issuance,
        vi.stock_on_hand,
        (vi.beginning_balance + vi.received_during_period + vi.transferred_in - 
         vi.transferred_out - vi.expired_wasted - vi.issuance) as calculated_stock
      FROM vaccine_inventory vi
      JOIN vaccines v ON v.id = vi.vaccine_id
      WHERE vi.vaccine_id = $1 
        AND vi.clinic_id = 1
        AND vi.is_active = true
      ORDER BY vi.id;
    `, [bcgVaccineId]);

    if (inventoryQuery.rows.length === 0) {
      console.log('❌ No BCG inventory records found for San Nicolas Health Center');
      await pool.end();
      return;
    }

    console.log(`Found ${inventoryQuery.rows.length} BCG inventory record(s):\n`);
    console.table(inventoryQuery.rows);

    // Check recent transactions
    const transactionsQuery = await pool.query(`
      SELECT 
        vit.id,
        vit.transaction_type,
        vit.quantity,
        vit.transaction_date,
        vit.notes,
        vit.created_at
      FROM vaccine_inventory_transactions vit
      WHERE vit.vaccine_inventory_id IN (
        SELECT id FROM vaccine_inventory 
        WHERE vaccine_id = $1 AND clinic_id = 1
      )
      ORDER BY vit.created_at DESC
      LIMIT 10;
    `, [bcgVaccineId]);

    console.log(`\nRecent BCG transactions (last 10):\n`);
    console.table(transactionsQuery.rows);

    // Summary
    const totalStock = inventoryQuery.rows.reduce((sum, row) => sum + parseInt(row.stock_on_hand || 0), 0);
    console.log(`\n========================================`);
    console.log(`TOTAL BCG STOCK AVAILABLE: ${totalStock} doses`);
    console.log(`========================================\n`);

    if (totalStock <= 0) {
      console.log('⚠️  WARNING: No BCG stock available!');
      console.log('   You cannot issue stock when balance is 0 or negative.');
      console.log('   Please receive new stock first.');
    } else {
      console.log(`✅ You can issue up to ${totalStock} doses of BCG vaccine.`);
    }

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkBCGCurrentStock();
