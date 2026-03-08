/**
 * Fix orphaned infants - create missing parent_guardian records
 */

const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/.env' });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD),
  ssl: false,
});

async function fixOrphanedInfants() {
  console.log('=== Fixing orphaned infants ===\n');

  // Get orphaned guardian_ids that don't exist in parent_guardian
  const orphans = await pool.query(`
    SELECT DISTINCT guardian_id
    FROM infants
    WHERE guardian_id IS NOT NULL
    AND guardian_id NOT IN (SELECT id FROM parent_guardian)
  `);

  console.log(`Found ${orphans.rows.length} orphaned guardian_ids:`, orphans.rows.map(r => r.guardian_id));

  // Create missing parent_guardian records for each orphaned guardian_id
  for (const o of orphans.rows) {
    const guardianId = o.guardian_id;

    // Insert placeholder parent_guardian record
    await pool.query(`
      INSERT INTO parent_guardian (id, name, phone, email, relationship, is_active)
      VALUES ($1, 'Unknown Guardian', '0000000000', 'unknown@immunicare.gov.ph', 'other', true)
      ON CONFLICT (id) DO NOTHING
    `, [guardianId]);

    console.log(`Created parent_guardian record with ID: ${guardianId}`);
  }

  // Verify orphans are fixed
  const remainingOrphans = await pool.query(`
    SELECT COUNT(*) as count
    FROM infants i
    WHERE i.guardian_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM parent_guardian pg WHERE pg.id = i.guardian_id)
  `);

  console.log(`\nRemaining orphaned infants: ${remainingOrphans.rows[0].count}`);
  console.log('\n✓ Data integrity fix complete!');
}

fixOrphanedInfants()
  .then(() => pool.end())
  .catch(e => {
    console.error('Error:', e.message);
    pool.end();
    process.exit(1);
  });
