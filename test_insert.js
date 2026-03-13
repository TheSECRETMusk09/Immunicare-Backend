require('dotenv').config({ path: '.env' });
const db = require('./db');

async function test() {
  try {
    console.log('Testing insert...');
    const result = await db.query(
      `INSERT INTO parent_guardian (user_id, infant_id, full_name, phone, email, relationship_details, relationship_type, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
      [1, 1, 'Test Guardian', '+63-999-999-9999', 'test@email.com', 'Test Address', 'parent', true],
    );
    console.log('Inserted with id:', result.rows[0].id);
    // NOTE: process.exit() is removed to prevent it from killing the main server process.
    // This script will hang after execution; use Ctrl+C to exit.
    // process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    // process.exit(1);
  }
}

test();
