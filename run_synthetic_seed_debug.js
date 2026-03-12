const fs = require('fs');
const path = require('path');

process.env.DB_QUERY_TIMEOUT = process.env.DB_QUERY_TIMEOUT || '0';
process.env.DB_STATEMENT_TIMEOUT = process.env.DB_STATEMENT_TIMEOUT || '0';

const db = require('./db');

function splitSqlStatements(sqlText) {
  const normalized = sqlText.replace(/\r\n/g, '\n');
  const chunks = normalized.split(/;\s*(?:\n|$)/g);

  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => `${chunk};`);
}

function getStatementPreview(statement) {
  const line = statement
    .split('\n')
    .map((x) => x.trim())
    .find((x) => x.length > 0 && !x.startsWith('--'));

  return line ? line.slice(0, 140) : '<comment-only statement>';
}

async function run() {
  const sqlPath = path.join(__dirname, 'synthetic_dashboard_data_seed.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = splitSqlStatements(sql);

  const startStatement = Number.parseInt(process.env.SEED_START_STATEMENT || '1', 10);
  const maxStatements = Number.parseInt(process.env.SEED_MAX_STATEMENTS || '0', 10);
  const startIndex = Number.isFinite(startStatement) && startStatement > 0
    ? Math.min(startStatement - 1, statements.length - 1)
    : 0;

  const requestedCount = Number.isFinite(maxStatements) && maxStatements > 0
    ? maxStatements
    : (statements.length - startIndex);

  const endExclusive = Math.min(startIndex + requestedCount, statements.length);
  const selected = statements.slice(startIndex, endExclusive);

  console.log(`[seed-debug] started_at=${new Date().toISOString()}`);
  console.log(
    `[seed-debug] total_statements=${statements.length} start_statement=${startIndex + 1} end_statement=${endExclusive} executing=${selected.length}`,
  );

  const globalStart = Date.now();

  for (let i = 0; i < selected.length; i += 1) {
    const stmt = selected[i];
    const originalStatementNumber = startIndex + i + 1;
    const preview = getStatementPreview(stmt);
    const start = Date.now();

    console.log(`[seed-debug] [${originalStatementNumber}/${statements.length}] START ${preview}`);

    try {
      const result = await db.query(stmt);
      const elapsed = Date.now() - start;
      const rowCount = typeof result?.rowCount === 'number' ? result.rowCount : 'n/a';
      console.log(`[seed-debug] [${originalStatementNumber}/${statements.length}] OK rowCount=${rowCount} elapsed_ms=${elapsed}`);
    } catch (error) {
      const elapsed = Date.now() - start;
      console.error(`[seed-debug] [${originalStatementNumber}/${statements.length}] ERROR elapsed_ms=${elapsed}`);
      console.error(`[seed-debug] message=${error.message}`);
      if (error.code) {
        console.error(`[seed-debug] code=${error.code}`);
      }
      if (error.detail) {
        console.error(`[seed-debug] detail=${error.detail}`);
      }
      if (error.hint) {
        console.error(`[seed-debug] hint=${error.hint}`);
      }
      if (error.where) {
        console.error(`[seed-debug] where=${error.where}`);
      }
      if (error.position) {
        console.error(`[seed-debug] position=${error.position}`);
      }
      console.error('[seed-debug] failing_statement_preview:');
      console.error(stmt.slice(0, 1500));
      throw error;
    }
  }

  console.log(`[seed-debug] status=SUCCESS elapsed_ms=${Date.now() - globalStart}`);
}

run()
  .then(async () => {
    await db.end();
    console.log(`[seed-debug] finished_at=${new Date().toISOString()}`);
    process.exit(0);
  })
  .catch(async () => {
    try {
      await db.end();
    } catch (_) {
      // ignore
    }
    console.log(`[seed-debug] finished_at=${new Date().toISOString()}`);
    process.exit(1);
  });
