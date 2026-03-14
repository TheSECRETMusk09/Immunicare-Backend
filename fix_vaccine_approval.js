const db = require('./db');

async function fixVaccineApproval() {
  try {
    console.log('Fixing vaccine approval status...');

    // Set is_approved = true for all active vaccines
    const result = await db.query(
      "UPDATE vaccines SET is_approved = true WHERE is_active = true RETURNING id, name, is_approved"
    );

    console.log('Updated vaccines:');
    result.rows.forEach(v => console.log(`ID ${v.id}: ${v.name} - is_approved=${v.is_approved}`));

    // Also set is_approved = false for inactive vaccines (for consistency)
    const inactiveResult = await db.query(
      "UPDATE vaccines SET is_approved = false WHERE is_active = false RETURNING id, name, is_approved"
    );

    console.log('\nInactive vaccines set to not approved:');
    inactiveResult.rows.forEach(v => console.log(`ID ${v.id}: ${v.name} - is_approved=${v.is_approved}`));

    console.log('\n=== Done ===');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit();
  }
}

fixVaccineApproval();
