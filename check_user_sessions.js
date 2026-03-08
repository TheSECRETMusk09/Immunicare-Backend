const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!'
});

async function checkUserSessionsTable() {
  try {
    console.log('Checking if user_sessions table exists...');

    // Check if user_sessions table exists
    const tableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'user_sessions'
      )`
    );

    const tableExists = tableCheck.rows[0].exists;
    console.log('user_sessions table exists:', tableExists);

    if (tableExists) {
      // Get table structure
      const structure = await pool.query(
        `SELECT column_name, data_type, is_nullable 
         FROM information_schema.columns 
         WHERE table_name = 'user_sessions'
         ORDER BY ordinal_position`
      );

      console.log('\nuser_sessions table structure:');
      console.log(structure.rows);
    } else {
      console.log('\nuser_sessions table does NOT exist!');
    }
  } catch (error) {
    console.error('Error checking user_sessions table:', error.message);
  } finally {
    await pool.end();
  }
}

checkUserSessionsTable();
