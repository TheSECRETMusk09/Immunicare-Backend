const db = require('../db');

async function checkSchema() {
  try {
    // Check patients table
    console.log('=== PATIENTS TABLE ===');
    const patients = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'patients' 
      ORDER BY ordinal_position
    `);
    console.table(patients.rows);

    // Check users table
    console.log('\n=== USERS TABLE (clinic/facility columns) ===');
    const users = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
        AND (column_name LIKE '%clinic%' OR column_name LIKE '%facility%')
      ORDER BY ordinal_position
    `);
    console.table(users.rows);

    // Check guardians table
    console.log('\n=== GUARDIANS TABLE ===');
    const guardians = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'guardians' 
      ORDER BY ordinal_position
    `);
    console.table(guardians.rows);

    // Check current user clinic assignments
    console.log('\n=== CURRENT USER CLINIC ASSIGNMENTS ===');
    const userClinics = await db.query(`
      SELECT 
        id, username, role_id, clinic_id, facility_id,
        (SELECT name FROM clinics WHERE id = users.clinic_id) as clinic_name
      FROM users 
      WHERE is_active = true
      LIMIT 10
    `);
    console.table(userClinics.rows);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.end();
  }
}

checkSchema();
