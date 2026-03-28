const pool = require('./db');

async function checkTableColumns() {
  try {
    const tables = ['appointments', 'vaccinations'];
    
    for (const table of tables) {
      const result = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1 
        AND table_schema = 'public'
        ORDER BY ordinal_position;
      `, [table]);
      
      console.log(`\n${table} table columns:`);
      console.table(result.rows);
    }
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkTableColumns();
