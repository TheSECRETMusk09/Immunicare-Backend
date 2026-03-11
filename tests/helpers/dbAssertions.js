const pool = require('../../db');

const findOne = async ({ table, whereSql = '1=1', params = [] }) => {
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
