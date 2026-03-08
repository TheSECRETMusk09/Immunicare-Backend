const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function runPasswordMigration() {
  const migrationFile = path.join(__dirname, 'add_password_columns.sql');

  try {
    console.log('Reading migration file...');
    const sql = fs.readFileSync(migrationFile, 'utf8');

    console.log('Executing migration...');
    await pool.query(sql);

    console.log('✓ Password columns migration completed successfully!');

    // Verify the columns were added
    const result = await pool.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name IN ('guardians', 'parent_guardian')
      AND column_name LIKE '%password%'
      ORDER BY table_name, column_name
    `);

    console.log('\nPassword columns found:');
    if (result.rows.length === 0) {
      console.log('No password columns found.');
    } else {
      result.rows.forEach((row) => {
        console.log(
          `  - ${row.table_name}.${row.column_name} (${row.data_type}, nullable: ${row.is_nullable})`
        );
      });
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runPasswordMigration()
  .then(() => {
    console.log('\nMigration process finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration process failed:', error);
    process.exit(1);
  });
