/**
 * Setup PostgreSQL Cache Table
 * This script creates the cache table and related functions
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!'
});

async function setupCache() {
  const client = await pool.connect();

  try {
    console.log('Setting up PostgreSQL cache...');

    // Read the cache schema SQL file
    const schemaPath = path.join(__dirname, 'cache_schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

    // Execute the schema
    await client.query(schemaSQL);

    console.log('✅ PostgreSQL cache setup completed successfully!');
    console.log('   - Cache table created');
    console.log('   - Cache functions created');
    console.log('   - Indexes created');
    console.log('   - Triggers created');

    // Test the cache
    console.log('\nTesting cache functionality...');

    // Test set and get
    await client.query('SELECT set_cache_value($1, $2, $3)', ['test_key', 'test_value', 60]);
    const result = await client.query('SELECT get_cache_value($1) as value', ['test_key']);

    if (result.rows[0].value === 'test_value') {
      console.log('✅ Cache test passed!');
    } else {
      console.log('❌ Cache test failed!');
    }

    // Clean up test data
    await client.query('SELECT delete_cache_value($1)', ['test_key']);
  } catch (error) {
    console.error('❌ Error setting up cache:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the setup
setupCache()
  .then(() => {
    console.log('\n✨ Cache setup completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Cache setup failed:', error);
    process.exit(1);
  });
