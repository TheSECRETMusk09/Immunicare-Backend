const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!'
});

async function checkTable() {
  const results = {};

  try {
    // Check users table columns
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    results.usersColumns = columns.rows;

    // Check if is_active column exists
    const hasIsActive = columns.rows.some((c) => c.column_name === 'is_active');
    results.hasIsActiveColumn = hasIsActive;

    // Check users table full structure from the database
    const usersData = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    results.allColumns = usersData.rows.map((r) => r.column_name);
  } catch (error) {
    results.error = error.message;
  } finally {
    await pool.end();
  }

  // Write results to file
  const outputPath = path.join(__dirname, 'table_structure.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log('Results written to ' + outputPath);
}

checkTable();
