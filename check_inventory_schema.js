const pool = require('./db');

async function checkInventorySchema() {
  try {
    console.log('Checking inventory table schema...\n');

    // Check inventory table columns
    const inventoryColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' 
      AND table_name = 'inventory'
      ORDER BY ordinal_position
    `);
    
    console.log('INVENTORY table columns:');
    inventoryColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    console.log('\n');

    // Check vaccine_inventory table columns
    const vaccineInventoryColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' 
      AND table_name = 'vaccine_inventory'
      ORDER BY ordinal_position
    `);
    
    console.log('VACCINE_INVENTORY table columns:');
    vaccineInventoryColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    console.log('\n');

    // Check vaccine_inventory_transactions table
    const transactionsColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' 
      AND table_name = 'vaccine_inventory_transactions'
      ORDER BY ordinal_position
    `);
    
    console.log('VACCINE_INVENTORY_TRANSACTIONS table columns:');
    transactionsColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkInventorySchema();
