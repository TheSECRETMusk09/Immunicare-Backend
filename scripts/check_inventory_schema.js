const db = require('../db');

async function checkInventorySchema() {
  try {
    const cols = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'inventory' 
      ORDER BY ordinal_position
    `);
    
    console.log('Inventory table columns:');
    console.table(cols.rows);
    
    const sample = await db.query('SELECT * FROM inventory LIMIT 3');
    console.log('\nSample inventory records:');
    console.table(sample.rows);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.end();
  }
}

checkInventorySchema();
