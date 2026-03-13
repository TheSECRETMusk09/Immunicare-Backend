const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD),
});

async function testConnection() {
  try {
    console.log('Testing database connection...');
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`Port: ${process.env.DB_PORT}`);
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`User: ${process.env.DB_USER}`);

    const result = await pool.query('SELECT NOW() as current_time, version() as version');
    console.log('\n✓ Database connection successful!');
    console.log('Current time:', result.rows[0].current_time);
    console.log('PostgreSQL version:', result.rows[0].version.split(' ')[1]);

    // Check if required tables exist
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('\nAvailable tables:', tables.rows.map((r) => r.table_name).join(', '));

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Database connection failed!');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    // NOTE: pool.end() and process.exit() are removed to prevent side effects
    // on a running server process. This script will hang; use Ctrl+C to exit.
    // process.exit(1);
  }
}

testConnection();
