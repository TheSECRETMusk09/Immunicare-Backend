const db = require('./db');

async function reactivatePCV() {
  try {
    console.log('=== Reactivating PCV 13/PCV 10 ===\n');
    
    // Check current status
    const before = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      WHERE id = 6
    `);
    console.log('Before:');
    console.table(before.rows);
    
    // Reactivate PCV 13/PCV 10
    const result = await db.query(`
      UPDATE vaccines 
      SET is_active = true 
      WHERE id = 6 
      RETURNING id, code, name, is_active
    `);
    
    console.log('\n✅ Reactivated:');
    console.table(result.rows);
    
    // Verify all active vaccines
    const allActive = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      WHERE is_active = true
      ORDER BY id
    `);
    
    console.log('\n=== All Active Vaccines ===');
    console.table(allActive.rows);
    
    console.log('\n✅ SUCCESS! PCV 13/PCV 10 is now active and will appear in the inventory sheet.');
    console.log('🔄 Refresh your browser to see the changes.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

reactivatePCV();
