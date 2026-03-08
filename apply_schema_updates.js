const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load environment variables
require('dotenv').config();

async function applySchemaUpdates() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'immunicare_dev',
    user: process.env.DB_USER || 'immunicare_dev',
    password: process.env.DB_PASSWORD || 'ImmunicareDev2024!',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔧 Applying database schema updates...');

    // Read the schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

    // Split by statements and execute each one
    const statements = schemaSQL
      .split(';')
      .map((stmt) => stmt.trim())
      .filter(
        (stmt) =>
          stmt.length > 0 && !stmt.startsWith('--') && !stmt.startsWith('/*')
      );

    let successCount = 0;
    let errorCount = 0;

    for (const statement of statements) {
      try {
        if (statement.trim()) {
          await pool.query(statement);
          successCount++;
        }
      } catch (error) {
        // Skip duplicate table/column errors (they already exist)
        if (
          error.message.includes('already exists') ||
          error.message.includes('duplicate key') ||
          error.message.includes('does not exist')
        ) {
          console.log(`⚠️  Skipped: ${error.message.substring(0, 80)}...`);
        } else {
          console.error(`❌ Error executing statement: ${error.message}`);
          errorCount++;
        }
      }
    }

    console.log('\n✅ Schema update completed:');
    console.log(`   • ${successCount} statements executed successfully`);
    console.log(`   • ${errorCount} statements with errors`);

    // Verify critical tables exist
    console.log('\n🔍 Verifying critical tables...');
    const criticalTables = [
      'announcements',
      'paper_templates',
      'document_generation',
      'digital_papers',
      'user_preferences',
      'messages'
    ];

    for (const table of criticalTables) {
      try {
        const result = await pool.query(
          `
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        `,
          [table]
        );

        if (result.rows.length > 0) {
          console.log(`   ✅ ${table} table exists`);
        } else {
          console.log(`   ❌ ${table} table missing`);
        }
      } catch (error) {
        console.log(`   ❌ Error checking ${table}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('❌ Schema update failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the update
if (require.main === module) {
  applySchemaUpdates().catch(console.error);
}

module.exports = { applySchemaUpdates };
