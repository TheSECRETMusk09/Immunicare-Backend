/**
 * Database Schema Dump Script
 * Generates a comprehensive SQL schema file from the current PostgreSQL database
 */

const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: String(process.env.DB_PASSWORD) || ''
});

async function getEnumTypes() {
  const result = await pool.query(`
    SELECT t.typname AS enum_name, e.enumlabel AS enum_value
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumlabel;
  `);

  const enums = {};
  result.rows.forEach((row) => {
    if (!enums[row.enum_name]) {
      enums[row.enum_name] = [];
    }
    enums[row.enum_name].push(row.enum_value);
  });
  return enums;
}

async function getTables() {
  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name NOT LIKE 'pg_%'
    AND table_name NOT LIKE 'sql_%'
    ORDER BY table_name;
  `);
  return result.rows.map((r) => r.table_name);
}

async function getColumns(tableName) {
  const result = await pool.query(
    `
    SELECT 
      column_name,
      data_type,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      is_identity,
      identity_generation
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = $1
    ORDER BY ordinal_position;
  `,
    [tableName]
  );
  return result.rows;
}

async function getPrimaryKey(tableName) {
  const result = await pool.query(
    `
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
    AND c.relname = $1
    AND i.indisprimary;
  `,
    [tableName]
  );
  return result.rows.map((r) => r.column_name);
}

async function getForeignKeys(tableName) {
  const result = await pool.query(
    `
    SELECT
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      tc.constraint_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = $1
    AND tc.table_schema = 'public';
  `,
    [tableName]
  );
  return result.rows;
}

async function getIndexes(tableName) {
  const result = await pool.query(
    `
    SELECT
      indexname AS index_name,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = $1
  `,
    [tableName]
  );

  const indexes = {};
  result.rows.forEach((row) => {
    const isUnique = row.indexdef.toLowerCase().includes('unique');
    const columnsMatch = row.indexdef.match(/ON\s+\w+\s+\(([^)]+)\)/i);
    const columns = columnsMatch ? columnsMatch[1].split(',').map((c) => c.trim()) : [];

    indexes[row.index_name] = {
      columns: columns,
      is_unique: isUnique,
      is_primary: false
    };
  });
  return indexes;
}

async function getTableComment(tableName) {
  const result = await pool.query(
    `
    SELECT obj_description(c.oid) AS comment
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
    AND c.relname = $1;
  `,
    [tableName]
  );
  return result.rows[0]?.comment || null;
}

function formatType(col) {
  if (col.data_type === 'character varying') {
    return `VARCHAR(${col.character_maximum_length})`;
  } else if (col.data_type === 'numeric') {
    if (col.numeric_scale > 0) {
      return `NUMERIC(${col.numeric_precision}, ${col.numeric_scale})`;
    }
    return `NUMERIC(${col.numeric_precision})`;
  } else if (col.data_type === 'timestamp without time zone') {
    return 'TIMESTAMP WITH TIME ZONE';
  } else if (col.data_type === 'time without time zone') {
    return 'TIME';
  } else if (col.data_type === 'bytea') {
    return 'BYTEA';
  }
  return col.data_type.toUpperCase();
}

async function dumpSchema() {
  console.log('Starting schema dump...');

  try {
    const enums = await getEnumTypes();
    const tables = await getTables();

    let sql = '-- ============================================================================\n';
    sql += '-- IMMUNICARE DATABASE SCHEMA\n';
    sql += `-- Generated from PostgreSQL database: ${process.env.DB_NAME || 'immunicare_dev'}\n`;
    sql += `-- Generated at: ${new Date().toISOString()}\n`;
    sql += '-- ============================================================================\n\n';

    // Extensions
    sql += '-- ============================================================================\n';
    sql += '-- SECTION 1: EXTENSIONS\n';
    sql += '-- ============================================================================\n\n';
    sql += 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n';
    sql += 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n\n';

    // Enum Types
    sql += '-- ============================================================================\n';
    sql += '-- SECTION 2: ENUM TYPES\n';
    sql += '-- ============================================================================\n\n';

    for (const [enumName, values] of Object.entries(enums)) {
      sql += 'DO $$\n';
      sql += 'BEGIN\n';
      sql += `    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') THEN\n`;
      sql += `        CREATE TYPE ${enumName} AS ENUM (${values.map((v) => `'${v}'`).join(', ')});\n`;
      sql += '    END IF;\n';
      sql += 'END $$\n;\n\n';
    }

    // Tables
    sql += '-- ============================================================================\n';
    sql += '-- SECTION 3: TABLES\n';
    sql += '-- ============================================================================\n\n';

    for (const tableName of tables) {
      const columns = await getColumns(tableName);
      const pk = await getPrimaryKey(tableName);
      const fks = await getForeignKeys(tableName);
      const indexes = await getIndexes(tableName);
      const comment = await getTableComment(tableName);

      sql += `-- Table: ${tableName}\n`;
      if (comment) {
        sql += `COMMENT ON TABLE ${tableName} IS '${comment.replace(/'/g, '\'\'')}';\n`;
      }

      sql += `CREATE TABLE IF NOT EXISTS ${tableName} (\n`;

      const colDefs = [];
      columns.forEach((col) => {
        let colDef = `    ${col.column_name} ${formatType(col)}`;
        if (col.is_nullable === 'NO') {
          colDef += ' NOT NULL';
        }
        if (col.column_default) {
          colDef += ` DEFAULT ${col.column_default}`;
        }
        if (col.is_identity === 'YES') {
          if (col.identity_generation === 'ALWAYS') {
            colDef += ' GENERATED ALWAYS AS IDENTITY';
          } else {
            colDef += ' GENERATED BY DEFAULT AS IDENTITY';
          }
        }
        colDefs.push(colDef);
      });

      // Primary key
      if (pk.length > 0) {
        colDefs.push(`    PRIMARY KEY (${pk.join(', ')})`);
      }

      // Foreign keys
      fks.forEach((fk) => {
        colDefs.push(
          `    CONSTRAINT ${fk.constraint_name} FOREIGN KEY (${fk.column_name}) REFERENCES ${fk.foreign_table_name}(${fk.foreign_column_name}) ON UPDATE CASCADE ON DELETE CASCADE`
        );
      });

      sql += colDefs.join(',\n');
      sql += '\n);\n\n';

      // Column comments
      for (const col of columns) {
        const colComment = await pool.query(
          `
          SELECT pg_catalog.col_description(a.attrelid, a.attnum) AS comment
          FROM pg_catalog.pg_attribute a
          JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname = 'public'
          AND c.relname = $1
          AND a.attname = $2;
        `,
          [tableName, col.column_name]
        );

        if (colComment.rows[0]?.comment) {
          sql += `COMMENT ON COLUMN ${tableName}.${col.column_name} IS '${colComment.rows[0].comment.replace(/'/g, '\'\'')}';\n`;
        }
      }
      sql += '\n';
    }

    // Indexes
    sql += '-- ============================================================================\n';
    sql += '-- SECTION 4: INDEXES\n';
    sql += '-- ============================================================================\n\n';

    for (const tableName of tables) {
      const indexes = await getIndexes(tableName);
      for (const [indexName, idx] of Object.entries(indexes)) {
        if (!idx.is_primary && idx.columns.length > 0) {
          const uniqueStr = idx.is_unique ? ' UNIQUE' : '';
          sql += `CREATE${uniqueStr} INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${idx.columns.join(', ')});\n`;
        }
      }
      sql += '\n';
    }

    // Write to file
    const outputPath = require('path').join(__dirname, 'immunicare_comprehensive_schema.sql');
    fs.writeFileSync(outputPath, sql, 'utf8');

    console.log(`Schema dumped successfully to: ${outputPath}`);
    console.log(`Tables: ${tables.length}`);
    console.log(`Enum types: ${Object.keys(enums).length}`);
  } catch (error) {
    console.error('Error dumping schema:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

dumpSchema()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
