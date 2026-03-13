const db = require('./db');

async function checkColumns() {
  try {
    const result = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'appointments'
      ORDER BY ordinal_position
    `);
    console.log('Appointments columns:', result.rows.map(x => x.column_name).join(', '));
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    process.exit();
  }
}

checkColumns();
