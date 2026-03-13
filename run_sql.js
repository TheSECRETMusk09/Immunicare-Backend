const fs = require('fs');
const pool = require('./db');

const runSql = async () => {
  try {
    const sql = fs.readFileSync('sql/add_indexes.sql', 'utf8');
    await pool.query(sql);
    console.log('Successfully executed sql/add_indexes.sql');
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
};

runSql();
