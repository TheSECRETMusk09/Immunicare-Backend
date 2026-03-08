/**
 * Check and fix orphaned infant records
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD),
  ssl: false,
});

async function checkAndFix() {
  console.log('=== Checking infants table structure ===\n');

  // Check infants table foreign keys
  const fkCheck = await pool.query(`
    SELECT
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'infants'
  `);

  console.log('Foreign keys on infants table:');
  console.log(JSON.stringify(fkCheck.rows, null, 2));

  // Check guardians table
  console.log('\n=== Checking guardians table ===\n');
  const guardiansCheck = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'guardians'
    ORDER BY ordinal_position
  `);

  console.log('Guardians table columns:');
  console.log(JSON.stringify(guardiansCheck.rows, null, 2));

  // Check orphaned infants
  console.log('\n=== Checking orphaned infants ===\n');
  const orphans = await pool.query(`
    SELECT i.id, i.first_name, i.last_name, i.guardian_id
    FROM infants i
    WHERE i.guardian_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM guardians g WHERE g.id = i.guardian_id)
  `);

  console.log(`Found ${orphans.rows.length} orphaned infants`);
  console.log(JSON.stringify(orphans.rows, null, 2));

  // Check NULL guardian_id
  const nullGuardians = await pool.query(`
    SELECT COUNT(*) as count FROM infants WHERE guardian_id IS NULL
  `);
  console.log(`\nInfants with NULL guardian_id: ${nullGuardians.rows[0].count}`);

  await pool.end();
}

checkAndFix().catch(console.error);
