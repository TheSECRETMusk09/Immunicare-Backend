const pool = require('../../db');

// Support both object-based and positional args for convenience
const findOne = async (tableOrOptions, options = {}) => {
  // Handle positional args: findOne('tableName', { column: value })
  if (typeof tableOrOptions === 'string') {
    const table = tableOrOptions;
    const whereObj = options || {};
    const entries = Object.entries(whereObj);
    if (entries.length === 0) {
      return findOne({ table });
    }
    const whereParts = [];
    const params = [];
    let paramIndex = 1;
    for (const [column, value] of entries) {
      whereParts.push(`${column} = ${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
    return findOne({
      table,
      whereSql: whereParts.join(' AND '),
      params,
    });
  }
  // Original object-based API
  const { table, whereSql = '1=1', params = [] } = tableOrOptions;
  const result = await pool.query(
    `SELECT *
     FROM ${table}
     WHERE ${whereSql}
     LIMIT 1`,
    params,
  );

  return result.rows[0] || null;
};

const countRows = async ({ table, whereSql = '1=1', params = [] }) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM ${table}
     WHERE ${whereSql}`,
    params,
  );

  return result.rows[0]?.count || 0;
};

module.exports = {
  findOne,
  countRows,
};
