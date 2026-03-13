/**
 * Direct test of infants endpoint
 */

const pool = require('./db');

async function test() {
  try {
    // Check guardians
    const guardians = await pool.query(
      'SELECT id, email, name FROM guardians WHERE is_active = true LIMIT 5',
    );
    console.log('Active guardians:');
    guardians.rows.forEach((g) => console.log(`  ID: ${g.id}, Email: ${g.email}, Name: ${g.name}`));

    if (guardians.rows.length > 0) {
      const guardianId = guardians.rows[0].id;

      // Check patients for this guardian
      const patients = await pool.query(
        `
        SELECT id, name, first_name, last_name, dob, sex, control_number, guardian_id, is_active
        FROM patients
        WHERE guardian_id = $1
      `,
        [guardianId],
      );

      console.log(`\nPatients for guardian ${guardianId}:`);
      patients.rows.forEach((p) =>
        console.log(
          `  ID: ${p.id}, Name: ${p.name}, First: ${p.first_name}, Last: ${p.last_name}, DOB: ${p.dob}, Sex: ${p.sex}`,
        ),
      );

      // Test the exact query used in the route
      console.log('\nTesting route query...');
      const routeQuery = await pool.query(
        `
        SELECT p.*, p.control_number,
          (SELECT json_agg(json_build_object(
            'id', ia.id,
            'allergy_type', ia.allergy_type,
            'allergen', ia.allergen,
            'severity', ia.severity,
            'reaction_description', ia.reaction_description,
            'onset_date', ia.onset_date
          )) FROM infant_allergies ia WHERE ia.infant_id = p.id AND ia.is_active = true) as allergies
         FROM patients p
         WHERE p.guardian_id = $1 AND p.is_active = true
         ORDER BY p.created_at DESC
      `,
        [guardianId],
      );

      console.log('Route query result:');
      console.log(JSON.stringify(routeQuery.rows, null, 2));
    } else {
      console.log('No active guardians found');
    }

    // NOTE: process.exit() is removed to prevent it from killing the main server process.
    // This script will hang after execution; use Ctrl+C to exit.
    // process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    console.error(e.stack);
    // process.exit(1);
  }
}

test();
