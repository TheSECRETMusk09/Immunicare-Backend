const pool = require('./db');

(async () => {
  const client = await pool.connect();

  try {
    // Get active vaccines
    const result = await client.query(`
      SELECT id, code, name, is_active, is_approved
      FROM vaccines
      WHERE is_active = true
      ORDER BY is_approved DESC, name
    `);

    console.log('=== ACTIVE VACCINES ===');
    console.log('Total:', result.rows.length);
    for (const v of result.rows) {
      console.log(`  ${v.id}: ${v.name} [${v.code}] approved:${v.is_approved}`);
    }

    // Get archived/inactive vaccines
    const archived = await client.query(`
      SELECT id, name FROM vaccines WHERE is_active = false ORDER BY name
    `);
    console.log('\n=== ARCHIVED VACCINES ===');
    console.log('Total:', archived.rows.length);
    for (const v of archived.rows) {
      console.log(`  ${v.id}: ${v.name}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
})();
