const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!'
});

async function checkAdminUsers() {
  try {
    console.log('Connecting to database...');

    // Check roles first
    const roles = await pool.query(
      'SELECT * FROM roles WHERE name IN (\'super_admin\', \'admin\')'
    );
    console.log('Admin roles found:', roles.rows);

    // Check clinics
    const clinics = await pool.query('SELECT * FROM clinics LIMIT 1');
    console.log('Clinics found:', clinics.rows);

    // Check users
    const users = await pool.query(`
      SELECT u.username, r.name as role_name, r.display_name as role_display
      FROM users u 
      JOIN roles r ON u.role_id = r.id 
    `);
    console.log('All users:', users.rows);

    // Check specific admin users
    const adminUsers = await pool.query(`
      SELECT u.username, r.name as role_name, r.display_name as role_display
      FROM users u 
      JOIN roles r ON u.role_id = r.id 
      WHERE u.username IN ('admin', 'administrator') 
    `);
    console.log('Admin users found:', adminUsers.rows);
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
    console.log('Database connection closed');
  }
}

checkAdminUsers();
