const db = require('./db');

async function deactivateVaccines() {
  try {
    console.log('=== Deactivating PCV 13 and Measles & Rubella (MR) ===\n');
    
    // Check current status
    const current = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      WHERE name ILIKE '%PCV%' OR name ILIKE '%Measles%Rubella%' OR id IN (6, 7)
      ORDER BY id
    `);
    console.log('Current vaccines:');
    console.table(current.rows);
    
    // Deactivate PCV 13/PCV 10 (ID 6)
    console.log('\n--- Deactivating PCV 13/PCV 10 (ID 6) ---');
    const result1 = await db.query(
      'UPDATE vaccines SET is_active = false WHERE id = 6 RETURNING id, code, name, is_active'
    );
    if (result1.rows.length > 0) {
      console.log('✅ Updated:', result1.rows[0]);
    } else {
      console.log('⚠️  Vaccine ID 6 not found');
    }
    
    // Check if Measles & Rubella (MR) exists (ID 7)
    const check7 = await db.query('SELECT id, code, name, is_active FROM vaccines WHERE id = 7');
    if (check7.rows.length > 0) {
      console.log('\n--- Deactivating Measles & Rubella (MR) (ID 7) ---');
      const result2 = await db.query(
        'UPDATE vaccines SET is_active = false WHERE id = 7 RETURNING id, code, name, is_active'
      );
      console.log('✅ Updated:', result2.rows[0]);
    } else {
      console.log('\n⚠️  Vaccine ID 7 does not exist in database (may have been deleted)');
    }
    
    // Verify the changes
    const verify = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      ORDER BY id
    `);
    console.log('\n=== All Vaccines After Update ===');
    console.table(verify.rows);
    
    console.log('\n✅ SUCCESS! Vaccines deactivated.');
    console.log('📋 The inventory sheet will no longer show:');
    console.log('   - PCV 13/PCV 10');
    console.log('   - Measles & Rubella (MR) (if it existed)');
    console.log('\n🔄 Refresh your browser to see the changes.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

deactivateVaccines();
