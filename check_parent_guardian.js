const pool = require('./db');

async function checkParentGuardianTable() {
  try {
    const result = await pool.query('SELECT * FROM parent_guardian LIMIT 10');
    console.log('Parent guardian table:');
    console.log(result.rows);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkParentGuardianTable();
