const pool = require('./db');

async function fixAdminEmail() {
  try {
    // Find admin users with NULL email and update them
    const result = await pool.query(`
      UPDATE users 
      SET email = username || '@immunicare.local'
      WHERE email IS NULL OR email = ''
      AND role_id IN (SELECT id FROM roles WHERE name IN ('admin', 'super_admin'))
      RETURNING id, username, email
    `);

    console.log(`Updated ${result.rowCount} admin users with email addresses`);

    if (result.rowCount > 0) {
      console.log('Updated users:', result.rows);
    } else {
      console.log('No admin users needed email update');
    }

    // Also check for any users with NULL email and set a default
    const nullEmailResult = await pool.query(`
      SELECT id, username FROM users WHERE email IS NULL OR email = '' LIMIT 10
    `);

    if (nullEmailResult.rows.length > 0) {
      console.log('Users with NULL email:', nullEmailResult.rows);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error fixing admin email:', error);
    process.exit(1);
  }
}

fixAdminEmail();
