/**
 * Script to execute the infant_documents table migration
 * Run with: node run_infant_documents_migration.js
 */

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('Starting infant_documents table migration...');

    // Read the SQL migration file
    const migrationPath = path.join(__dirname, 'add_infant_documents_table.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Execute the migration
    await client.query(sql);

    console.log('Migration completed successfully!');

    // Verify the table was created
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'infant_documents'
    `);

    if (result.rows.length > 0) {
      console.log('Table infant_documents created successfully!');

      // Show table structure
      const columns = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'infant_documents'
        ORDER BY ordinal_position
      `);

      console.log('\nTable structure:');
      columns.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
      });
    } else {
      console.error('Failed to create infant_documents table');
    }

  } catch (error) {
    console.error('Migration failed:', error.message);
    if (error.message.includes('already exists')) {
      console.log('Note: Table may already exist from a previous run.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
