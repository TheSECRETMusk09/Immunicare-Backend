[
  {
    path: 'path.join(__dirname',
    '.env': ''
  },
  {
    host: 'process.env.DB_HOST || \'localhost\'',
    port: 'parseInt(process.env.DB_PORT) || 5432',
    database: 'process.env.DB_NAME || \'immunicare_dev\'',
    user: 'process.env.DB_USER || \'immunicare_dev\'',
    password: 'String(process.env.DB_PASSWORD) || \'\''
  },
  {
    'pg_%\'\n    AND t.typname NOT LIKE \'_%': 'RDER BY t.typname',
    'public\'\n    AND table_type = \'BASE TABLE':
      'RDER BY table_name\n  `);\n  \n  return result.rows.map(r => r.table_name);'
  },
  {
    public: 'ND table_name = $1\n    ORDER BY ordinal_position\n  `',
    'FOREIGN KEY\'\n    AND tc.table_schema = \'public': 'ND tc.table_name = $1\n  `',
    'r\'\n    AND i.relname NOT LIKE \'pg_%': 'RDER BY i.relname',
    columns: [],
    is_unique: 'row.is_unique',
    is_primary: 'row.is_primary'
  },
  [
    'row.index_name].columns.push(row.column_name);\n  });\n  \n  return indexes;\n}\n\n/**\n * Get table comments\n */\nasync function getTableComment(tableName) {\n  const result = await pool.query(`\n    SELECT\n      obj_description(c.oid) AS comment\n    FROM pg_class c\n    JOIN pg_namespace n ON c.relnamespace = n.oid\n    WHERE n.nspname = \'public\'\n    AND c.relname = $1\n  `, [tableName]);\n  \n  return result.rows[0]?.comment || null;\n}\n\n/**\n * Get column comments\n */\nasync function getColumnComments(tableName) {\n  const result = await pool.query(`\n    SELECT\n      a.attname AS column_name,\n      pgd.description AS comment\n    FROM pg_class c\n    JOIN pg_namespace n ON c.relnamespace = n.oid\n    JOIN pg_attribute a ON a.attrelid = c.oid\n    LEFT JOIN pg_description pgd ON pgd.objoid = c.oid AND pgd.objsubid = a.attnum\n    WHERE n.nspname = \'public\'\n    AND c.relname = $1\n    AND a.attnum > 0\n    AND NOT a.attisdropped\n  `, [tableName]);\n  \n  const comments = {};\n  result.rows.forEach(row => {\n    if (row.comment) {\n      comments[row.column_name] = row.comment;\n    }\n  });\n  \n  return comments;\n}\n\n/**\n * Get functions\n */\nasync function getFunctions() {\n  const result = await pool.query(`\n    SELECT\n      p.proname AS function_name,\n      pg_get_functiondef(p.oid) AS function_definition\n    FROM pg_proc p\n    JOIN pg_namespace n ON p.pronamespace = n.oid\n    WHERE n.nspname = \'public\'\n    AND p.proname NOT LIKE \'pg_%\'\n    ORDER BY p.proname\n  `);\n  \n  return result.rows;\n}\n\n/**\n * Get triggers\n */\nasync function getTriggers() {\n  const result = await pool.query(`\n    SELECT\n      t.tgname AS trigger_name,\n      c.relname AS table_name,\n      pg_get_triggerdef(t.oid) AS trigger_definition\n    FROM pg_trigger t\n    JOIN pg_class c ON t.tgrelid = c.oid\n    JOIN pg_namespace n ON c.relnamespace = n.oid\n    WHERE n.nspname = \'public\'\n    AND NOT t.tgisinternal\n    ORDER BY c.relname, t.tgname\n  `, [tableName]);\n  \n  return result.rows;\n}\n\n/**\n * Generate CREATE TABLE statement\n */\nfunction generateCreateTable(tableName, columns, foreignKeys, tableComment) {\n  let sql = `-- Table: ${tableName}\n`;\n  \n  if (tableComment) {\n    sql += `COMMENT ON TABLE ${tableName} IS \'${tableComment.replace(/\'/g, "\'\''
  ],
  {
    'NO\') {\n      colDef += \' NOT NULL': ''
  },
  {
    ',': 'const fkDefs = foreignKeys.map(fk => {\n      let fkDef = `    CONSTRAINT ${fk.constraint_name'
  },
  {
    'NO ACTION': {
      'NO ACTION': {
        '\\n);': 'return sql;'
      },
      ' UNIQUE': ''
    },
    ')});\n`;\n  });\n  \n  return sql;\n}\n\n/**\n * Generate enum type statements\n */\nfunction generateEnumTypes(enums) {\n  let sql = \'-- Enum Types\n\n\';\n  \n  Object.entries(enums).forEach(([typeName, values]) => {\n    sql += `DO $$\n`;\n    sql += `BEGIN\n`;\n    sql += `    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname =':
      {
        '${v}\'`).join(\',': ''
      },
    Generated: {
      Database: {
        Tables: {
          'uuid-ossp";\nCREATE EXTENSION IF NOT EXISTS "pgcrypto':
            'SECTION 2: ENUM TYPES\n-- ============================================================================\n\n`;\n    \n    sql += generateEnumTypes(enums);\n    \n    sql += `-- ============================================================================\n-- SECTION 3: TABLES\n-- ============================================================================\n\n`;\n    \n    // Generate table definitions\n    for (const tableName of tables) {\n      console.log(`Processing table: ${tableName'
        },
        '${comment.replace(/\'/g, "\'': ''
      },
      '\\n': ''
    }
  },
  {
    '\\n': ''
  },
  {
    'public\'\nAND table_type = \'BASE TABLE\';\n`;\n    \n    // Write to file\n    const outputPath = path.join(__dirname, \'immunicare_comprehensive_schema.sql\');\n    fs.writeFileSync(outputPath, sql, \'utf8':
      'console.log(`Schema dumped successfully to: ${outputPath'
  },
  {
    types: {
      schema:
        ', error);\n    throw error;\n  } finally {\n    await pool.end();\n  }\n}\n\n// Run the dump\ndumpSchema()\n  .then(() => {\n    console.log(',
      failed: ', err);\n    process.exit(1);\n  });'
    }
  }
];
