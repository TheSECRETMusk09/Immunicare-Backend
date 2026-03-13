const Pool = require('pg').Pool;
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD),
});

console.log('Testing database connection...');
console.log('Configuration:', {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: '***',
});

async function testConnection() {
  try {
    console.log('🔍 Attempting to connect to the database...');
    const client = await pool.connect();
    console.log('✅ Database connection successful');

    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ Query test successful - Current time:', result.rows[0].current_time);

    const userCount = await client.query('SELECT COUNT(*) as count FROM users');
    console.log('✅ Users table exists - Count:', userCount.rows[0].count);

    const activeUsers = await client.query(
      'SELECT id, username, role_id FROM users WHERE is_active = true LIMIT 5',
    );
    console.log('✅ Active users found:', activeUsers.rows.length);
    if (activeUsers.rows.length > 0) {
      console.log('✅ Sample users:', activeUsers.rows);
    }

    client.release();
    console.log('✅ Connection test completed');
    // NOTE: pool.end() is removed to prevent it from closing the connection pool
    // for the entire application, which would cause the running server to fail.
  } catch (error) {
    console.error('❌ Connection error:', error);
    console.error('🔍 Error details:', {
      message: error.message,
      code: error.code,
      severity: error.severity,
      detail: error.detail,
      hint: error.hint,
    });
    // process.exit(1);
  }
}

testConnection();
