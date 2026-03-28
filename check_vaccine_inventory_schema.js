const pool = require('./db');

async function checkSchema() {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'vaccine_inventory' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    
    console.log('vaccine_inventory table columns:');
    console.table(result.rows);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkSchema();
