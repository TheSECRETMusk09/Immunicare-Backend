const db = require('./db');

async function checkAllVaccines() {
  try {
    const result = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      ORDER BY id
    `);
    
    console.log('All vaccines in database:');
    console.table(result.rows);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAllVaccines();
