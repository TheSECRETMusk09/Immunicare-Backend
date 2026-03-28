const db = require('./db');

async function checkPCVInventory() {
  try {
    console.log('=== CHECKING PCV INVENTORY RECORDS ===\n');
    
    // Check vaccines table for PCV
    const vaccines = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      WHERE name ILIKE '%PCV%'
      ORDER BY id
    `);
    console.log('PCV Vaccines in vaccines table:');
    console.table(vaccines.rows);
    
    // Check vaccine_inventory records for PCV
    const inventory = await db.query(`
      SELECT 
        vi.id as inventory_id,
        vi.vaccine_id,
        v.name as vaccine_name,
        vi.beginning_balance,
        vi.received_during_period,
        vi.issuance,
        vi.expired_wasted,
        vi.transferred_in,
        vi.transferred_out,
        vi.period_start,
        vi.period_end,
        vi.lot_batch_number
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      WHERE v.name ILIKE '%PCV%'
      ORDER BY vi.id
      LIMIT 20
    `);
    console.log('\nPCV Inventory Records (first 20):');
    console.table(inventory.rows);
    console.log(`\nTotal PCV inventory records: ${inventory.rows.length}`);
    
    // Check for Measles & Rubella
    const mrVaccines = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      WHERE name ILIKE '%Measles%' OR name ILIKE '%Rubella%' OR code = 'MR'
      ORDER BY id
    `);
    console.log('\nMeasles/Rubella Vaccines:');
    if (mrVaccines.rows.length > 0) {
      console.table(mrVaccines.rows);
    } else {
      console.log('❌ No Measles/Rubella vaccines found in database');
    }
    
    // Check for MR inventory records
    const mrInventory = await db.query(`
      SELECT 
        vi.id as inventory_id,
        vi.vaccine_id,
        v.name as vaccine_name
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      WHERE v.name ILIKE '%Measles%' OR v.name ILIKE '%Rubella%' OR v.code = 'MR'
    `);
    console.log('\nMeasles/Rubella Inventory Records:');
    if (mrInventory.rows.length > 0) {
      console.table(mrInventory.rows);
    } else {
      console.log('❌ No Measles/Rubella inventory records found');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkPCVInventory();
