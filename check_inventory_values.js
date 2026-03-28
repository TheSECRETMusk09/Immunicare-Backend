const pool = require('./db');

async function checkInventoryValues() {
  try {
    console.log('=== Checking Inventory Table Structure ===');
    const schemaQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'inventory'
      ORDER BY ordinal_position;
    `;
    const schemaResult = await pool.query(schemaQuery);
    console.log('Inventory table columns:');
    console.table(schemaResult.rows);

    console.log('\n=== Checking Inventory Stock Values ===');
    const inventoryQuery = `
      SELECT 
        id,
        vaccine_id,
        batch_number,
        quantity,
        CASE 
          WHEN quantity <= 0 THEN 'OUT_OF_STOCK'
          WHEN quantity <= 5 THEN 'CRITICAL'
          WHEN quantity <= 10 THEN 'LOW_STOCK'
          ELSE 'NORMAL'
        END as stock_status
      FROM inventory
      WHERE is_active = true
      ORDER BY quantity ASC
      LIMIT 20;
    `;
    const inventoryResult = await pool.query(inventoryQuery);
    console.log('Inventory items (sorted by quantity):');
    console.table(inventoryResult.rows);

    console.log('\n=== Stock Level Counts ===');
    const countsQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE quantity <= 10) as low_stock_count,
        COUNT(*) FILTER (WHERE quantity <= 5) as critical_stock_count,
        COUNT(*) FILTER (WHERE quantity <= 0) as out_of_stock_count,
        COUNT(*) as total_items,
        SUM(quantity) as total_doses
      FROM inventory
      WHERE is_active = true;
    `;
    const countsResult = await pool.query(countsQuery);
    console.log('Stock level summary:');
    console.table(countsResult.rows);

    console.log('\n=== Checking for Low Stock Threshold Columns ===');
    const thresholdCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'inventory' 
      AND column_name IN ('low_stock_threshold', 'critical_stock_threshold');
    `);
    console.log('Threshold columns found:', thresholdCheck.rows);

    await pool.end();
  } catch (error) {
    console.error('Error checking inventory:', error);
    process.exit(1);
  }
}

checkInventoryValues();
