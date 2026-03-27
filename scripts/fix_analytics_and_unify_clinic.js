/**
 * Fix Analytics/Reports Zero Metrics and Unify Clinic to San Nicolas Health Center
 * 
 * Issues to fix:
 * 1. Analytics and Reports showing zero metrics
 * 2. Unify all data to San Nicolas Health Center, Pasig City (ID: 203)
 */

const db = require('../db');

const SAN_NICOLAS_CLINIC_ID = 203;

async function fixAnalyticsAndUnifyClinic() {
  console.log('='.repeat(70));
  console.log('FIX ANALYTICS & UNIFY CLINIC TO SAN NICOLAS HEALTH CENTER');
  console.log('='.repeat(70));
  console.log(`Target Clinic: San Nicolas Health Center, Pasig City (ID: ${SAN_NICOLAS_CLINIC_ID})\n`);

  try {
    // Step 1: Update patients (uses facility_id, not clinic_id)
    console.log('Step 1: Updating patients to San Nicolas Health Center...');
    const patientsResult = await db.query(
      'UPDATE patients SET facility_id = $1 WHERE facility_id IS NOT NULL AND facility_id != $1 RETURNING id',
      [SAN_NICOLAS_CLINIC_ID]
    );
    console.log(`✅ Updated ${patientsResult.rowCount} patients\n`);

    // Step 2: Update guardians (has clinic_id)
    console.log('Step 2: Updating guardians to San Nicolas Health Center...');
    const guardiansResult = await db.query(
      'UPDATE guardians SET clinic_id = $1 WHERE clinic_id IS NOT NULL AND clinic_id != $1 RETURNING id',
      [SAN_NICOLAS_CLINIC_ID]
    );
    console.log(`✅ Updated ${guardiansResult.rowCount} guardians\n`);

    // Step 3: Update users (only has clinic_id, no facility_id)
    console.log('Step 3: Updating users to San Nicolas Health Center...');
    const usersResult = await db.query(
      'UPDATE users SET clinic_id = $1 WHERE clinic_id IS NOT NULL AND clinic_id != $1 RETURNING id',
      [SAN_NICOLAS_CLINIC_ID]
    );
    console.log(`✅ Updated ${usersResult.rowCount} users\n`);

    // Step 4: Update appointments (if has clinic_id or facility_id)
    console.log('Step 4: Updating appointments to San Nicolas Health Center...');
    try {
      // Check which column exists
      const appointmentCols = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'appointments' 
          AND column_name IN ('clinic_id', 'facility_id')
      `);
      
      if (appointmentCols.rows.some(r => r.column_name === 'clinic_id')) {
        const appointmentsResult = await db.query(
          'UPDATE appointments SET clinic_id = $1 WHERE clinic_id IS NOT NULL AND clinic_id != $1 RETURNING id',
          [SAN_NICOLAS_CLINIC_ID]
        );
        console.log(`✅ Updated ${appointmentsResult.rowCount} appointments (clinic_id)\n`);
      } else if (appointmentCols.rows.some(r => r.column_name === 'facility_id')) {
        const appointmentsResult = await db.query(
          'UPDATE appointments SET facility_id = $1 WHERE facility_id IS NOT NULL AND facility_id != $1 RETURNING id',
          [SAN_NICOLAS_CLINIC_ID]
        );
        console.log(`✅ Updated ${appointmentsResult.rowCount} appointments (facility_id)\n`);
      } else {
        console.log('⚠️  Appointments table has no clinic/facility column\n');
      }
    } catch (err) {
      console.log(`⚠️  Could not update appointments: ${err.message}\n`);
    }

    // Step 5: Update immunization records (if has clinic_id or facility_id)
    console.log('Step 5: Updating immunization records to San Nicolas Health Center...');
    try {
      const immunizationCols = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'immunization_records' 
          AND column_name IN ('clinic_id', 'facility_id')
      `);
      
      if (immunizationCols.rows.some(r => r.column_name === 'clinic_id')) {
        const immunizationResult = await db.query(
          'UPDATE immunization_records SET clinic_id = $1 WHERE clinic_id IS NOT NULL AND clinic_id != $1 RETURNING id',
          [SAN_NICOLAS_CLINIC_ID]
        );
        console.log(`✅ Updated ${immunizationResult.rowCount} immunization records (clinic_id)\n`);
      } else if (immunizationCols.rows.some(r => r.column_name === 'facility_id')) {
        const immunizationResult = await db.query(
          'UPDATE immunization_records SET facility_id = $1 WHERE facility_id IS NOT NULL AND facility_id != $1 RETURNING id',
          [SAN_NICOLAS_CLINIC_ID]
        );
        console.log(`✅ Updated ${immunizationResult.rowCount} immunization records (facility_id)\n`);
      } else {
        console.log('⚠️  Immunization records table has no clinic/facility column\n');
      }
    } catch (err) {
      console.log(`⚠️  Could not update immunization records: ${err.message}\n`);
    }

    // Step 6: Verify current data counts
    console.log('Step 6: Verifying data counts...\n');
    
    const counts = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM patients WHERE is_active = true) as total_patients,
        (SELECT COUNT(*) FROM patients WHERE is_active = true AND facility_id = $1) as san_nicolas_patients,
        (SELECT COUNT(*) FROM guardians) as total_guardians,
        (SELECT COUNT(*) FROM guardians WHERE clinic_id = $1) as san_nicolas_guardians,
        (SELECT COUNT(*) FROM immunization_records WHERE is_active = true) as total_vaccinations,
        (SELECT COUNT(*) FROM appointments WHERE is_active = true) as total_appointments,
        (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users,
        (SELECT COUNT(*) FROM users WHERE is_active = true AND clinic_id = $1) as san_nicolas_users
    `, [SAN_NICOLAS_CLINIC_ID]);

    console.log('Current Data Counts:');
    console.log('═'.repeat(70));
    console.table(counts.rows[0]);

    // Step 7: Update admin user to use San Nicolas Health Center
    console.log('\nStep 7: Ensuring admin user uses San Nicolas Health Center...');
    const adminUpdate = await db.query(`
      UPDATE users 
      SET clinic_id = $1 
      WHERE username LIKE '%admin%' 
        OR email LIKE '%admin%'
        OR role_id IN (SELECT id FROM roles WHERE name IN ('SYSTEM_ADMIN', 'admin', 'system_admin'))
      RETURNING id, username, clinic_id
    `, [SAN_NICOLAS_CLINIC_ID]);
    
    console.log(`✅ Updated ${adminUpdate.rowCount} admin users`);
    if (adminUpdate.rows.length > 0) {
      console.table(adminUpdate.rows);
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ ANALYTICS FIX & CLINIC UNIFICATION COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(70));
    console.log(`\nAll data now unified to: San Nicolas Health Center, Pasig City (ID: ${SAN_NICOLAS_CLINIC_ID})`);
    console.log('\nNext steps:');
    console.log('1. Restart the backend server');
    console.log('2. Login as admin');
    console.log('3. Check Analytics and Reports - metrics should now display correctly');
    console.log('4. Verify dashboard shows San Nicolas Health Center data\n');

  } catch (error) {
    console.error('\n❌ Error during fix:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the script
fixAnalyticsAndUnifyClinic()
  .then(() => {
    console.log('✅ Script completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  });
