const fs = require('fs');
const path = require('path');

process.env.DB_QUERY_TIMEOUT = '0';
process.env.DB_STATEMENT_TIMEOUT = '0';

const db = require('./db');

async function run() {
  const sqlPath = path.join(__dirname, 'synthetic_dashboard_data_seed.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const startedAt = new Date();
  console.log(`[seed-runner] started_at=${startedAt.toISOString()}`);

  const startMs = Date.now();
  try {
    const result = await db.query(sql);
    const elapsedMs = Date.now() - startMs;
    const resultSets = Array.isArray(result) ? result.length : 1;
    console.log(`[seed-runner] status=SUCCESS elapsed_ms=${elapsedMs} result_sets=${resultSets}`);
  } catch (error) {
    const elapsedMs = Date.now() - startMs;
    console.error(`[seed-runner] status=ERROR elapsed_ms=${elapsedMs} message=${error.message}`);
    if (error.code) console.error(`[seed-runner] code=${error.code}`);
    if (error.detail) console.error(`[seed-runner] detail=${error.detail}`);
    if (error.hint) console.error(`[seed-runner] hint=${error.hint}`);
    if (error.where) console.error(`[seed-runner] where=${error.where}`);
    if (error.position) console.error(`[seed-runner] position=${error.position}`);
    throw error;
  } finally {
    await db.end();
    console.log(`[seed-runner] finished_at=${new Date().toISOString()}`);
  }
}

run().then(() => process.exit(0)).catch(() => process.exit(1));
