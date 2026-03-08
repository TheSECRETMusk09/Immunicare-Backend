/**
 * Deterministic migration runner using explicit manifest ordering.
 * Supports both .sql and .js migrations without relying on numeric filename prefixes.
 */

const fs = require('fs');
const path = require('path');
const pool = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MANIFEST_PATH = path.join(MIGRATIONS_DIR, 'manifest.json');

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Migration manifest not found: ${MANIFEST_PATH}`);
  }

  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw);

  if (!Array.isArray(manifest)) {
    throw new Error('Migration manifest must be an array');
  }

  return manifest;
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migration_manifest_runs (
      id SERIAL PRIMARY KEY,
      migration_id VARCHAR(255) NOT NULL UNIQUE,
      file_name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64),
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      success BOOLEAN NOT NULL DEFAULT TRUE,
      details JSONB
    )
  `);
}

function getChecksum(content) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function hasRun(client, migrationId) {
  const result = await client.query(
    'SELECT migration_id FROM migration_manifest_runs WHERE migration_id = $1 LIMIT 1',
    [migrationId],
  );
  return result.rows.length > 0;
}

async function markRun(client, migration, checksum, details = {}) {
  await client.query(
    `
      INSERT INTO migration_manifest_runs (migration_id, file_name, checksum, success, details)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [migration.id, migration.file, checksum, true, JSON.stringify(details)],
  );
}

async function runSqlMigration(client, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  if (!sql.trim()) {
    return { checksum: getChecksum(''), details: { skipped: 'empty-sql' } };
  }
  await client.query(sql);
  return { checksum: getChecksum(sql), details: { type: 'sql' } };
}

async function runJsMigration(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const checksum = getChecksum(source);

  const mod = require(filePath);

  if (typeof mod.applyMigration === 'function') {
    await mod.applyMigration();
  } else if (typeof mod.up === 'function') {
    await mod.up();
  } else if (typeof mod.default === 'function') {
    await mod.default();
  } else {
    throw new Error(`Unsupported JS migration contract in ${path.basename(filePath)}`);
  }

  return { checksum, details: { type: 'js' } };
}

async function run() {
  const manifest = loadManifest();
  const client = await pool.connect();
  const runDeprecatedMigrations =
    String(process.env.RUN_DEPRECATED_MIGRATIONS || 'false').toLowerCase() === 'true';

  try {
    await ensureMigrationTable(client);

    for (const migration of manifest) {
      if (!migration.id || !migration.file || !migration.type) {
        throw new Error(`Invalid manifest item: ${JSON.stringify(migration)}`);
      }

      if (migration.deprecated && !runDeprecatedMigrations) {
        const alreadySkipped = await hasRun(client, migration.id);
        if (!alreadySkipped) {
          await markRun(client, migration, null, {
            type: migration.type,
            deprecated: true,
            skipped: true,
            skip_reason: 'deprecated_migration',
            description: migration.description || null,
          });
        }
        console.log(`↷ Skipped (deprecated): ${migration.id}`);
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, migration.file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Migration file missing: ${migration.file}`);
      }

      const alreadyRun = await hasRun(client, migration.id);
      if (alreadyRun) {
        console.log(`↷ Skipped (already applied): ${migration.id}`);
        continue;
      }

      console.log(`→ Applying: ${migration.id} (${migration.file})`);

      let execution;

      if (migration.type === 'sql') {
        await client.query('BEGIN');
        execution = await runSqlMigration(client, filePath);
        await markRun(client, migration, execution.checksum, {
          ...execution.details,
          deprecated: Boolean(migration.deprecated),
          description: migration.description || null,
        });
        await client.query('COMMIT');
      } else if (migration.type === 'js') {
        // JS migrations manage their own db transactions in many legacy scripts.
        execution = await runJsMigration(filePath);
        await markRun(client, migration, execution.checksum, {
          ...execution.details,
          deprecated: Boolean(migration.deprecated),
          description: migration.description || null,
        });
      } else {
        throw new Error(`Unsupported migration type: ${migration.type}`);
      }

      console.log(`✓ Applied: ${migration.id}`);
    }

    console.log('All manifest migrations processed successfully.');
    process.exit(0);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // no-op
    }
    console.error('Manifest migration run failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

run();
