/**
 * Unify Clinic and Facility IDs to San Nicolas Health Center, Pasig City
 * This script consolidates all data to use clinic_id = 203
 */

const db = require('../db');

const SAN_NICOLAS_CLINIC_ID = 203;

async function unifyClinicFacility() {
  console.log('Starting clinic/facility unification...');
  console.log(`Target: San Nicolas Health Center, Pasig City (ID: ${SAN_NICOLAS_CLINIC_ID})\n`);

  try {
    // Step 1: Update patients
    console.log('Step 1: Updating patients...');
    const patientsResult = await db.query(
      'UPDATE patients SET clinic_id = $1 WHERE clinic_id IS NOT NULL AND clinic_id != $1 RETURNING id',
      [SAN_NICOLAS_CLINIC_ID]
    );
    console.log(`✅ Updated ${patientsResult.rowCount} patients\n`);

    // Step 2: Update guardians
    console.log('Step 2: Updating guardians...');
    const guardiansResult = await db.query(
      'UPDATE guardians SET clinic_id = $1 WHERE clinic_id IS NOT NULL AND clinic_id != $1 RETURNING id',
      [SAN_NICOLAS_CLINIC_ID]
    );
    console.log(`✅ Updated ${guardiansResult.rowCount} guardians\n`);

    // Step 3: Update appointments
    console.log('Step 3: Updating appointments...');
    const appointmentsResult = await db.query(
      'UPDATE appointments SET clinic_id = $1 WHERE clinic_id IS NOT NULL AND clinic_id != $1 RETURNING id',
      [SAN_NICOLAS_CLINIC_ID]
    );
    console.log(`✅ Updated ${appointmentsResult.rowCount} appointments\n`);

    // Step 4: Update immunization records
    console.log('Step 4: Updating immunization records...');
    const immunizationResult = await db.query(
      'UPDATE immunization_records SET clinic_id = $1 WHERE clinic_id IS NOT NULL AND clinic_id != $1 RETURNING id',
      [SAN_NICOLAS_CLINIC_ID]
    );
    console.log(`✅ Updated ${immunizationResult.rowCount} immunization records\n`);

    // Step 5: Update users (both clinic_id and facility_id)
    console.log('Step 5: Updating users...');
    const usersResult = await db.query(
      `UPDATE users 
       SET clinic_id = $1, facility_id = $1
       WHERE (clinic_id IS NOT NULL AND clinic_id != $1) 
          OR (facility_id IS NOT NULL AND facility_id != $1)
       RETURNING id`,
      [SAN_NICOLAS_CLINIC_ID]
    );
    console.log(`✅ Updated ${usersResult.rowCount} users\n`);

    // Step 6: Update inventory (if table exists)
    console.log('Step 6: Updating inventory...');
    try {
      const inventoryResult = await db.query(
        'UPDATE inventory SET clinic_id = $1 WHERE clinic_id IS NOT NULL AND clinic_id != $1 RETURNING id',
        [SAN_NICOLAS_CLINIC_ID]
      );
      console.log(`✅ Updated ${inventoryResult.rowCount} inventory items\n`);
    } catch (err) {
      if (err.code === '42P01') {
        console.log('⚠️  Inventory table not found, skipping...\n');
      } else {
        throw err;
      }
    }

    // Step 7: Verify the changes
    console.log('Step 7: Verifying changes...\n');
    const verification = await db.query(`
      SELECT 
        'patients' as table_name, 
        COUNT(*) as total_records, 
        COUNT(CASE WHEN clinic_id = $1 THEN 1 END) as san_nicolas_records,
        COUNT(CASE WHEN clinic_id != $1 THEN 1 END) as other_clinic_records
      FROM patients
      WHERE is_active = true

      UNION ALL

      SELECT 
        'guardians' as table_name, 
        COUNT(*) as total_records, 
        COUNT(CASE WHEN clinic_id = $1 THEN 1 END) as san_nicolas_records,
        COUNT(CASE WHEN clinic_id != $1 THEN 1 END) as other_clinic_records
      FROM guardians

      UNION ALL

      SELECT 
        'appointments' as table_name, 
        COUNT(*) as total_records, 
        COUNT(CASE WHEN clinic_id = $1 THEN 1 END) as san_nicolas_records,
        COUNT(CASE WHEN clinic_id != $1 THEN 1 END) as other_clinic_records
      FROM appointments
      WHERE is_active = true

      UNION ALL

      SELECT 
        'immunization_records' as table_name, 
        COUNT(*) as total_records, 
        COUNT(CASE WHEN clinic_id = $1 THEN 1 END) as san_nicolas_records,
        COUNT(CASE WHEN clinic_id != $1 THEN 1 END) as other_clinic_records
      FROM immunization_records
      WHERE is_active = true

      UNION ALL

      SELECT 
        'users' as table_name, 
        COUNT(*) as total_records, 
        COUNT(CASE WHEN clinic_id = $1 THEN 1 END) as san_nicolas_records,
        COUNT(CASE WHEN clinic_id != $1 THEN 1 END) as other_clinic_records
      FROM users
      WHERE is_active = true
    `, [SAN_NICOLAS_CLINIC_ID]);

    console.log('Verification Results:');
    console.log('═══════════════════════════════════════════════════════════');
    console.table(verification.rows);

    console.log('\n✅ Clinic/Facility unification completed successfully!');
    console.log(`All records now use clinic_id = ${SAN_NICOLAS_CLINIC_ID} (San Nicolas Health Center, Pasig City)`);

  } catch (error) {
    console.error('❌ Error during unification:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the script
unifyClinicFacility()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
