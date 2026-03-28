const db = require('./db');

async function checkCurrentState() {
  try {
    console.log('=== CURRENT DATABASE STATE ===\n');
    
    // Check all vaccines
    const vaccines = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      ORDER BY id
    `);
    console.log('All Vaccines:');
    console.table(vaccines.rows);
    
    // Check vaccine inventory with details
    const inventory = await db.query(`
      SELECT 
        vi.id as inventory_id,
        vi.vaccine_id,
        v.name as vaccine_name,
        v.is_active as vaccine_active,
        vi.beginning_balance,
        vi.received_during_period,
        vi.issuance,
        vi.expired_wasted
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      ORDER BY vi.vaccine_id, vi.id
    `);
    console.log('\nVaccine Inventory Records:');
    console.table(inventory.rows);
    
    // Check for PCV vaccines specifically
    const pcvVaccines = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      WHERE name ILIKE '%PCV%'
      ORDER BY id
    `);
    console.log('\nPCV Vaccines:');
    console.table(pcvVaccines.rows);
    
    // Check for MR vaccines
    const mrVaccines = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      WHERE name ILIKE '%Measles%' OR name ILIKE '%Rubella%' OR code = 'MR'
      ORDER BY id
    `);
    console.log('\nMeasles/Rubella Vaccines:');
    console.table(mrVaccines.rows);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkCurrentState();
