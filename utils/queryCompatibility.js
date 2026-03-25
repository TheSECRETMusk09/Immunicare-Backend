const pool = require('../db');

const schemaCache = {
  columns: new Map(),
  tables: new Map(),
};

const tableExists = async (tableName) => {
  if (schemaCache.tables.has(tableName)) {
    return schemaCache.tables.get(tableName);
  }

  try {
    const result = await pool.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = $1
        ) AS exists
      `,
      [tableName],
    );

    const exists = result.rows[0]?.exists === true;
    schemaCache.tables.set(tableName, exists);
    return exists;
  } catch (_error) {
    schemaCache.tables.set(tableName, false);
    return false;
  }
};

const columnExists = async (tableName, columnName) => {
  const cacheKey = `${tableName}:${columnName}`;
  if (schemaCache.columns.has(cacheKey)) {
    return schemaCache.columns.get(cacheKey);
  }

  try {
    const result = await pool.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = $2
        ) AS exists
      `,
      [tableName, columnName],
    );

    const exists = result.rows[0]?.exists === true;
    schemaCache.columns.set(cacheKey, exists);
    return exists;
  } catch (_error) {
    schemaCache.columns.set(cacheKey, false);
    return false;
  }
};

const resolveFirstExistingColumn = async (
  tableName,
  candidateColumns,
  fallback = candidateColumns[0],
) => {
  for (const candidateColumn of candidateColumns) {
    if (await columnExists(tableName, candidateColumn)) {
      return candidateColumn;
    }
  }

  return fallback;
};

const escapeSqlLiteral = (value) => String(value || '').replace(/'/g, '\'\'');

const getUserNameExpressions = async (
  alias = 'u',
  { fallbackFirstName = 'System User' } = {},
) => {
  const firstNameColumn = await resolveFirstExistingColumn(
    'users',
    ['first_name', 'username', 'email'],
    'username',
  );
  const hasLastName = await columnExists('users', 'last_name');
  const fallbackLiteral = `'${escapeSqlLiteral(fallbackFirstName)}'`;
  const emptyStringLiteral = '\'\'';

  return {
    firstName: firstNameColumn
      ? `COALESCE(${alias}.${firstNameColumn}, ${fallbackLiteral})`
      : fallbackLiteral,
    lastName: hasLastName ? `COALESCE(${alias}.last_name, ${emptyStringLiteral})` : emptyStringLiteral,
  };
};

const getGuardianNameExpression = async (
  alias = 'g',
  { fallbackName = 'Guardian' } = {},
) => {
  const hasName = await columnExists('guardians', 'name');
  const hasFirstName = await columnExists('guardians', 'first_name');
  const hasLastName = await columnExists('guardians', 'last_name');
  const hasEmail = await columnExists('guardians', 'email');
  const fallbackLiteral = `'${escapeSqlLiteral(fallbackName)}'`;
  const fullNameParts = [];

  if (hasFirstName) {
    fullNameParts.push(`${alias}.first_name`);
  }

  if (hasLastName) {
    fullNameParts.push(`${alias}.last_name`);
  }

  const fullNameExpression =
    fullNameParts.length > 0
      ? `NULLIF(TRIM(CONCAT_WS(' ', ${fullNameParts.join(', ')})), '')`
      : 'NULL';

  const candidates = [];
  if (hasName) {
    candidates.push(`NULLIF(TRIM(${alias}.name), '')`);
  }
  if (fullNameParts.length > 0) {
    candidates.push(fullNameExpression);
  }
  if (hasEmail) {
    candidates.push(`${alias}.email`);
  }
  candidates.push(fallbackLiteral);

  return `COALESCE(${candidates.join(', ')})`;
};

const resetSchemaCompatibilityCache = () => {
  schemaCache.columns.clear();
  schemaCache.tables.clear();
};

module.exports = {
  columnExists,
  getGuardianNameExpression,
  getUserNameExpressions,
  resetSchemaCompatibilityCache,
  resolveFirstExistingColumn,
  tableExists,
};
