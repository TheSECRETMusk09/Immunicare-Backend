const pool = require('./db');

async function checkBCGStock() {
  try {
    console.log('=== Checking BCG Stock from All Sources ===\n');
    
    // Check vaccine_inventory table (used by transactions)
    console.log('1. vaccine_inventory table (used for transactions):');
    const viQuery = `
      SELECT 
        vi.id,
        v.name as vaccine_name,
        vi.beginning_balance,
        vi.received_during_period,
        vi.transferred_in,
        vi.transferred_out,
        vi.expired_wasted,
        vi.issuance,
        (vi.beginning_balance + vi.received_during_period + vi.transferred_in - 
         vi.transferred_out - vi.expired_wasted - vi.issuance) as stock_on_hand
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      WHERE v.name ILIKE '%BCG%'
      ORDER BY vi.id;
    `;
    const viResult = await pool.query(viQuery);
    console.table(viResult.rows);
    
    // Check if there's a stock_on_hand column
    console.log('\n2. Checking for stock_on_hand column in vaccine_inventory:');
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'vaccine_inventory' 
      AND column_name = 'stock_on_hand';
    `);
    console.log('stock_on_hand column exists:', columnCheck.rows.length > 0);
    
    if (columnCheck.rows.length > 0) {
      const stockQuery = `
        SELECT 
          vi.id,
          v.name as vaccine_name,
          vi.stock_on_hand,
          (vi.beginning_balance + vi.received_during_period + vi.transferred_in - 
           vi.transferred_out - vi.expired_wasted - vi.issuance) as calculated_stock
        FROM vaccine_inventory vi
        JOIN vaccines v ON vi.vaccine_id = v.id
        WHERE v.name ILIKE '%BCG%';
      `;
      const stockResult = await pool.query(stockQuery);
      console.log('\nstock_on_hand vs calculated:');
      console.table(stockResult.rows);
    }
    
    // Sum all BCG stock
    console.log('\n3. Total BCG stock across all records:');
    const totalQuery = `
      SELECT 
        COUNT(*) as record_count,
        SUM(beginning_balance + received_during_period + transferred_in - 
            transferred_out - expired_wasted - issuance) as total_stock
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      WHERE v.name ILIKE '%BCG%';
    `;
    const totalResult = await pool.query(totalQuery);
    console.table(totalResult.rows);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkBCGStock();
