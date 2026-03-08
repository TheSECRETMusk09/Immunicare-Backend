const pool = require('./db');

async function checkAdminTable() {
  try {
    // Check for admin-related tables
    const tablesResult = await pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' AND table_name LIKE \'%admin%\''
    );
    console.log('Admin-related tables:', tablesResult.rows);

    // Check all tables
    const allTablesResult = await pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' ORDER BY table_name'
    );
    console.log('\nAll tables in database:');
    allTablesResult.rows.forEach((row) => console.log(`  - ${row.table_name}`));

    // Check if admin_dashboard_users exists
    const adminDashboardResult = await pool.query(
      'SELECT COUNT(*) as count FROM admin_dashboard_users'
    );
    console.log('\nadmin_dashboard_users count:', adminDashboardResult.rows[0].count);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkAdminTable();
