const pool = require('./db');

async function checkLocations() {
  console.log('Current inventory locations:\n');
  
  const r = await pool.query(`
    SELECT DISTINCT location, COUNT(*) as count 
    FROM inventory 
    GROUP BY location 
    ORDER BY location
  `);
  
  console.table(r.rows);
  
  console.log('\nSample records with "Main Health Center":');
  const main = await pool.query(`
    SELECT id, vaccine_name, location 
    FROM inventory 
    WHERE location LIKE '%Main Health Center%' 
    LIMIT 5
  `);
  console.table(main.rows);
  
  await pool.end();
}

checkLocations();
