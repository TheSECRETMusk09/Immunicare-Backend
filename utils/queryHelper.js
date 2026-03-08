/**
 * Database Query Helper Utilities
 * Provides safe query execution with error handling and logging
 */

const logger = require('../config/logger');

/**
 * Execute a database query with error handling
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} query - SQL query string
 * @param {Array} params - Query parameters
 * @param {Object} options - Additional options
 * @returns {Promise<{rows: Array, error: Error|null, rowCount: number}>}
 */
async function safeQuery(pool, query, params = [], options = {}) {
  const { logErrors = true, fallback = [], context = {} } = options;
  const startTime = Date.now();

  try {
    const result = await pool.query(query, params);
    const duration = Date.now() - startTime;

    // Log slow queries (> 1 second)
    if (duration > 1000) {
      logger.warn('Slow query detected', {
        query: query.substring(0, 200),
        duration,
        ...context
      });
    }

    return {
      rows: result.rows,
      error: null,
      rowCount: result.rowCount,
      duration
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    if (logErrors) {
      logger.error('Query error', {
        error: error.message,
        query: query.substring(0, 200),
        params: params.length > 0 ? '[params]' : 'none',
        duration,
        ...context
      });
    }

    return {
      rows: fallback,
      error,
      rowCount: 0,
      duration
    };
  }
}

/**
 * Execute a transaction with multiple queries
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Function} callback - Async function receiving client
 * @param {Object} options - Additional options
 * @returns {Promise<{success: boolean, result: any, error: Error|null}>}
 */
async function transaction(pool, callback, options = {}) {
  const { logErrors = true, context = {} } = options;
  const client = await pool.connect();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');

    const duration = Date.now() - startTime;
    logger.info('Transaction completed', { duration, ...context });

    return { success: true, result, error: null };
  } catch (error) {
    await client.query('ROLLBACK');
    const duration = Date.now() - startTime;

    if (logErrors) {
      logger.error('Transaction failed', {
        error: error.message,
        duration,
        ...context
      });
    }

    return { success: false, result: null, error };
  } finally {
    client.release();
  }
}

/**
 * Execute a query and return first row only
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} query - SQL query string
 * @param {Array} params - Query parameters
 * @param {Object} options - Additional options
 * @returns {Promise<{row: Object|null, error: Error|null}>}
 */
async function queryOne(pool, query, params = [], options = {}) {
  const result = await safeQuery(pool, query, params, options);
  return {
    row: result.rows.length > 0 ? result.rows[0] : null,
    error: result.error
  };
}

/**
 * Execute a query and return a single value
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} query - SQL query string
 * @param {Array} params - Query parameters
 * @param {string} column - Column name to extract
 * @param {Object} options - Additional options
 * @returns {Promise<{value: any, error: Error|null}>}
 */
async function queryValue(pool, query, params = [], column = null, options = {}) {
  const result = await safeQuery(pool, query, params, options);
  if (result.error) {
    return { value: null, error: result.error };
  }
  if (result.rows.length === 0) {
    return { value: null, error: null };
  }
  const row = result.rows[0];
  const value = column ? row[column] : Object.values(row)[0];
  return { value, error: null };
}

/**
 * Check if a record exists
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} table - Table name
 * @param {string} column - Column name to check
 * @param {any} value - Value to check for
 * @returns {Promise<boolean>}
 */
async function exists(pool, table, column, value) {
  const query = `SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`;
  const result = await safeQuery(pool, query, [value], { logErrors: false });
  return result.rows.length > 0;
}

/**
 * Count records in a table with optional conditions
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} table - Table name
 * @param {Object} conditions - Optional where conditions {column: value}
 * @returns {Promise<number>}
 */
async function count(pool, table, conditions = {}) {
  let query = `SELECT COUNT(*) FROM ${table}`;
  const params = [];
  const whereClauses = [];

  if (Object.keys(conditions).length > 0) {
    let paramIndex = 1;
    for (const [column, value] of Object.entries(conditions)) {
      whereClauses.push(`${column} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const result = await safeQuery(pool, query, params, { logErrors: false });
  return result.rows.length > 0 ? parseInt(result.rows[0].count) : 0;
}

/**
 * Insert a record and return the inserted row
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} table - Table name
 * @param {Object} data - Data to insert {column: value}
 * @param {Object} options - Additional options
 * @returns {Promise<{row: Object|null, error: Error|null}>}
 */
async function insert(pool, table, data, options = {}) {
  const { returning = '*' } = options;
  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

  const query = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
    RETURNING ${returning}
  `;

  const result = await safeQuery(pool, query, values, { context: { table, operation: 'insert' } });
  return {
    row: result.rows.length > 0 ? result.rows[0] : null,
    error: result.error
  };
}

/**
 * Update records and return affected rows
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} table - Table name
 * @param {Object} data - Data to update {column: value}
 * @param {Object} conditions - Where conditions {column: value}
 * @param {Object} options - Additional options
 * @returns {Promise<{rows: Array, error: Error|null, rowCount: number}>}
 */
async function update(pool, table, data, conditions, options = {}) {
  const { returning = '*' } = options;
  const setClauses = [];
  const whereClauses = [];
  const params = [];
  let paramIndex = 1;

  // Build SET clause
  for (const [column, value] of Object.entries(data)) {
    setClauses.push(`${column} = $${paramIndex}`);
    params.push(value);
    paramIndex++;
  }

  // Build WHERE clause
  for (const [column, value] of Object.entries(conditions)) {
    whereClauses.push(`${column} = $${paramIndex}`);
    params.push(value);
    paramIndex++;
  }

  const query = `
    UPDATE ${table}
    SET ${setClauses.join(', ')}
    WHERE ${whereClauses.join(' AND ')}
    RETURNING ${returning}
  `;

  const result = await safeQuery(pool, query, params, { context: { table, operation: 'update' } });
  return {
    rows: result.rows,
    error: result.error,
    rowCount: result.rowCount
  };
}

/**
 * Delete records and return affected count
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} table - Table name
 * @param {Object} conditions - Where conditions {column: value}
 * @returns {Promise<{rowCount: number, error: Error|null}>}
 */
async function deleteRecords(pool, table, conditions) {
  const whereClauses = [];
  const params = [];
  let paramIndex = 1;

  for (const [column, value] of Object.entries(conditions)) {
    whereClauses.push(`${column} = $${paramIndex}`);
    params.push(value);
    paramIndex++;
  }

  const query = `DELETE FROM ${table} WHERE ${whereClauses.join(' AND ')}`;

  const result = await safeQuery(pool, query, params, { context: { table, operation: 'delete' } });
  return {
    rowCount: result.rowCount,
    error: result.error
  };
}

module.exports = {
  safeQuery,
  transaction,
  queryOne,
  queryValue,
  exists,
  count,
  insert,
  update,
  deleteRecords
};
