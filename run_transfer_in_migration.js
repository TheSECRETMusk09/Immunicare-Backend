const fs = require('fs');
const pool = require('./db');

const runTransferInMigration = async () => {
  try {
    const sql = fs.readFileSync('./migrations/20260315_transfer_in_cases.sql', 'utf8');
    await pool.query(sql);
    console.log('Successfully executed transfer_in_cases migration');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    pool.end();
  }
};

runTransferInMigration();
