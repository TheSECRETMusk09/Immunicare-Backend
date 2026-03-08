/**
 * Admin User Migration Script
 * Moves admin/administrator credentials from users table to admin table
 */

const pool = require('./db');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

async function migrateAdminUsers() {
  const client = await pool.connect();

  try {
    console.log('Starting admin user migration...');
    console.log('=================================\n');

    await client.query('BEGIN');

    // Step 1: Check existing admin table structure and add missing columns
    console.log('Step 1: Checking existing admin table structure...');
    const columnsQuery = `
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'admin'
        `;
    const existingColumns = await client.query(columnsQuery);
    const columnNames = existingColumns.rows.map((r) => r.column_name);
    console.log(`  Existing columns: ${columnNames.join(', ')}`);

    // Add missing columns
    const columnsToAdd = [
      { name: 'username', type: 'VARCHAR(255)' },
      { name: 'password_hash', type: 'VARCHAR(255)' },
      { name: 'last_login', type: 'TIMESTAMP WITH TIME ZONE' },
      { name: 'is_active', type: 'BOOLEAN DEFAULT TRUE' },
      { name: 'contact', type: 'VARCHAR(255)' }
    ];

    for (const col of columnsToAdd) {
      if (!columnNames.includes(col.name)) {
        console.log(`  Adding ${col.name} column...`);
        await client.query(`ALTER TABLE admin ADD COLUMN ${col.name} ${col.type}`);
      }
    }

    // Step 2: Get admin/administrator users from users table
    console.log('\nStep 2: Fetching admin/administrator users from users table...');
    const usersQuery = `
            SELECT id, username, password_hash, role_id, clinic_id, contact, email, last_login, is_active, role
            FROM users
            WHERE LOWER(username) IN ('admin', 'administrator')
        `;
    const adminUsers = await client.query(usersQuery);

    console.log(`  Found ${adminUsers.rows.length} admin/administrator user(s):`);
    adminUsers.rows.forEach((user) => {
      console.log(`    - ID: ${user.id}, Username: ${user.username}, Role ID: ${user.role_id}`);
    });

    // Step 3: Migrate users to admin table
    console.log('\nStep 3: Migrating users to admin table...');

    for (const user of adminUsers.rows) {
      // Check if this user already exists in admin table
      const checkQuery = 'SELECT id FROM admin WHERE user_id = $1 OR username = $2';
      const checkResult = await client.query(checkQuery, [user.id, user.username]);

      // Create default email if not exists
      const defaultEmail = user.email || user.username + '@immunicare.com';

      if (checkResult.rows.length > 0) {
        // Update existing admin record
        console.log(`  Updating existing admin record for: ${user.username}`);
        const updateQuery = `
                    UPDATE admin SET
                        username = $1,
                        password_hash = $2,
                        role = COALESCE(admin.role, $3),
                        clinic_id = COALESCE(admin.clinic_id, $4),
                        email = COALESCE($5, admin.email),
                        contact = $6,
                        last_login = $7,
                        is_active = $8,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $9 OR username = $10
                    RETURNING id, username, role
                `;
        await client.query(updateQuery, [
          user.username,
          user.password_hash,
          user.role || 'admin',
          user.clinic_id,
          defaultEmail,
          user.contact,
          user.last_login,
          user.is_active,
          user.id,
          user.username
        ]);
      } else {
        // Insert new admin record
        console.log(`  Inserting new admin record for: ${user.username}`);
        const insertQuery = `
                    INSERT INTO admin (user_id, name, username, password_hash, role, clinic_id, contact, email, last_login, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING id, username, role
                `;
        await client.query(insertQuery, [
          user.id,
          user.username,
          user.username,
          user.password_hash,
          user.role || 'admin',
          user.clinic_id,
          user.contact,
          defaultEmail,
          user.last_login,
          user.is_active
        ]);
      }
    }

    // Step 4: Ensure default admin exists if no users were migrated
    console.log('\nStep 4: Ensuring default admin credentials exist...');
    const defaultAdminCheck = await client.query(`
            SELECT * FROM users WHERE LOWER(username) = 'admin'
        `);

    if (defaultAdminCheck.rows.length === 0) {
      console.log('  Creating default admin user in users table...');
      await client.query(`
                INSERT INTO users (username, password_hash, role_id, clinic_id, contact, email, is_active)
                VALUES (
                    'admin',
                    '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q',
                    2,
                    1,
                    'admin@immunicare.com',
                    'admin@immunicare.com',
                    TRUE
                )
            `);
    }

    await client.query('COMMIT');

    // Step 5: Verify migration
    console.log('\n=================================');
    console.log('Migration Verification');
    console.log('=================================');

    // Get all admin records for admin/administrator
    const verifyQuery = `
            SELECT id, user_id, name, username, password_hash, role, clinic_id, contact, email, is_active, last_login, created_at, updated_at
            FROM admin
            WHERE LOWER(username) IN ('admin', 'administrator')
            ORDER BY username
        `;

    const adminRecords = await pool.query(verifyQuery);

    console.log(
      `\nAdmin table now contains ${adminRecords.rows.length} admin/administrator record(s):\n`
    );
    adminRecords.rows.forEach((record, index) => {
      console.log(`Record ${index + 1}:`);
      console.log(`  ID: ${record.id}`);
      console.log(`  User ID (from users table): ${record.user_id}`);
      console.log(`  Username: ${record.username}`);
      console.log(
        `  Password Hash: ${record.password_hash ? record.password_hash.substring(0, 30) + '...' : 'NOT SET'}`
      );
      console.log(`  Role: ${record.role}`);
      console.log(`  Clinic ID: ${record.clinic_id}`);
      console.log(`  Contact: ${record.contact || 'NOT SET'}`);
      console.log(`  Email: ${record.email || 'NOT SET'}`);
      console.log(`  Active: ${record.is_active}`);
      console.log(`  Last Login: ${record.last_login || 'NEVER'}`);
      console.log('');
    });

    console.log('=================================');
    console.log('Migration completed successfully!');
    console.log('=================================');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\nMigration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration if executed directly
if (require.main === module) {
  migrateAdminUsers()
    .then(() => {
      console.log('\nMigration script finished.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateAdminUsers };
