const db = require('./db');

async function checkVaccines() {
  try {
    const result = await db.query(`
      SELECT id, code, name, is_active 
      FROM vaccines 
      WHERE name ILIKE '%PCV%' OR name ILIKE '%Measles%Rubella%' OR code = 'MR'
      ORDER BY id
    `);
    
    console.log('Vaccines matching PCV or Measles & Rubella:');
    console.table(result.rows);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkVaccines();
