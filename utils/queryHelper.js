const logger = require('../config/logger');

async function safeQuery(pool, query, params = [], options = {}) {
  const { logErrors: catchLog = true, fallback: fbVal = [], context: ctx = {} } = options;
  const startTime = Date.now();

  try {
    const result = await pool.query(query, params);
    const duration = Date.now() - startTime;

    if (duration > 1000) {
      logger.warn('Slow query detected', {
        query: query.substring(0, 200),
        duration,
        ...ctx
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

    if (catchLog) {
      logger.error('Query error', {
        error: error.message,
        query: query.substring(0, 200),
        params: params.length > 0 ? '[params]' : 'none',
        duration,
        ...ctx
      });
    }

    return {
      rows: fbVal,
      error,
      rowCount: 0,
      duration
    };
  }
}

async function transaction(pool, callback, options = {}) {
  const { logErrors: catchLog = true, context: ctx = {} } = options;
  const client = await pool.connect();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');

    const duration = Date.now() - startTime;
    logger.info('Transaction completed', { duration, ...ctx });

    return { success: true, result, error: null };
  } catch (error) {
    await client.query('ROLLBACK');
    const duration = Date.now() - startTime;

    if (catchLog) {
      logger.error('Transaction failed', {
        error: error.message,
        duration,
        ...ctx
      });
    }

    return { success: false, result: null, error };
  } finally {
    client.release();
  }
}

async function queryOne(pool, query, params = [], options = {}) {
  const result = await safeQuery(pool, query, params, options);
  return {
    row: result.rows.length > 0 ? result.rows[0] : null,
    error: result.error
  };
}

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

async function exists(pool, table, column, value) {
  const query = `SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`;
  const result = await safeQuery(pool, query, [value], { logErrors: false });
  return result.rows.length > 0;
}

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

async function update(pool, table, data, conditions, options = {}) {
  const { returning = '*' } = options;
  const setClauses = [];
  const whereClauses = [];
  const params = [];
  let paramIndex = 1;

  for (const [column, value] of Object.entries(data)) {
    setClauses.push(`${column} = $${paramIndex}`);
    params.push(value);
    paramIndex++;
  }

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
