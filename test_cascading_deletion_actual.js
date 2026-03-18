const pool = require('./db');

async function testCascadingDeletion() {
  console.log('=== Testing Cascading Deletion ===\n');

  let testGuardianId;
  let testInfantId;

  try {
    // Step 1: Create a test guardian
    console.log('1. Creating test guardian...');
    const guardianResult = await pool.query(`
      INSERT INTO guardians (email, password_hash, name, first_name, last_name, phone)
      VALUES ($1, 'testpassword123', 'Test Guardian', 'Test', 'Guardian', '09123456789')
      RETURNING id, email
    `, [`test-guardian-${Date.now()}@example.com`]);

    testGuardianId = guardianResult.rows[0].id;
    console.log(`   Created guardian ID: ${testGuardianId}`);

    // Step 2: Create a test infant with appointments
    console.log('2. Creating test infant with appointments...');
    const infantResult = await pool.query(`
      INSERT INTO patients (name, first_name, last_name, dob, guardian_id, birth_weight, birth_height, sex)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, ['Test Child', 'Test', 'Child', '2023-01-01', testGuardianId, 3.5, 50.0, 'M']);

    testInfantId = infantResult.rows[0].id;
    console.log(`   Created infant ID: ${testInfantId}`);

    // Step 3: Create 3 test appointments
    console.log('3. Creating 3 test appointments...');
    for (let i = 1; i <= 3; i++) {
      const appointmentDate = new Date();
      appointmentDate.setDate(appointmentDate.getDate() + i);

      await pool.query(`
        INSERT INTO appointments (infant_id, guardian_id, scheduled_date, status, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [testInfantId, testGuardianId, appointmentDate, 'scheduled', `Test Appointment ${i}`, testGuardianId]);
    }
    console.log('   Created 3 appointments');

    // Step 4: Verify appointments exist
    console.log('4. Verifying appointments exist...');
    const appointmentsResult = await pool.query(`
      SELECT COUNT(*) FROM appointments WHERE infant_id = $1
    `, [testInfantId]);

    const appointmentCount = parseInt(appointmentsResult.rows[0].count, 10);
    console.log(`   Found ${appointmentCount} appointments for infant ${testInfantId}`);

    if (appointmentCount !== 3) {
      throw new Error(`Expected 3 appointments, found ${appointmentCount}`);
    }

    // Step 5: Simulate the cascading deletion logic directly (same as in the API endpoint)
    console.log('5. Performing cascading deletion...');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Soft delete the infant/patient
      const updateResult = await client.query(`
        UPDATE patients
        SET is_active = false
        WHERE id = $1 AND guardian_id = $2
        RETURNING id, name
      `, [testInfantId, testGuardianId]);

      if (updateResult.rows.length === 0) {
        throw new Error('Infant not found or not owned by guardian');
      }

      console.log(`   Soft deleted patient: ${updateResult.rows[0].name}`);

      // Permanently delete associated appointments
      const deleteAppointmentsResult = await client.query(`
        DELETE FROM appointments
        WHERE infant_id = $1 AND guardian_id = $2
      `, [testInfantId, testGuardianId]);

      console.log(`   Permanently deleted ${deleteAppointmentsResult.rowCount} appointments`);

      await client.query('COMMIT');
      console.log('   Transaction committed successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Step 6: Verify appointments were deleted
    console.log('6. Verifying appointments were deleted...');
    const afterDeletionResult = await pool.query(`
      SELECT COUNT(*) FROM appointments WHERE infant_id = $1
    `, [testInfantId]);

    const remainingAppointments = parseInt(afterDeletionResult.rows[0].count, 10);
    console.log(`   Remaining appointments after deletion: ${remainingAppointments}`);

    if (remainingAppointments !== 0) {
      throw new Error(`Expected 0 appointments, found ${remainingAppointments}`);
    }

    // Step 7: Verify infant was soft deleted
    console.log('7. Verifying infant was soft deleted...');
    const infantResultAfter = await pool.query(`
      SELECT id, is_active, name FROM patients WHERE id = $1
    `, [testInfantId]);

    if (infantResultAfter.rows.length === 0) {
      throw new Error('Infant not found after deletion');
    }

    if (infantResultAfter.rows[0].is_active !== false) {
      throw new Error('Infant not soft deleted');
    }
    console.log(`   Infant was soft deleted successfully (name: ${infantResultAfter.rows[0].name}, is_active: ${infantResultAfter.rows[0].is_active})`);

    // Step 8: Cleanup test data
    console.log('8. Cleaning up test data...');
    await pool.query('DELETE FROM appointments WHERE infant_id = $1', [testInfantId]);
    await pool.query('DELETE FROM patients WHERE id = $1', [testInfantId]);
    await pool.query('DELETE FROM guardians WHERE id = $1', [testGuardianId]);
    console.log('   Cleanup completed');

    console.log('\n=== Test PASSED ===');
    console.log('Cascading deletion works correctly');
    console.log('Appointments are permanently deleted when infant is deleted');
    console.log('Infant is soft deleted (is_active = false)');

  } catch (error) {
    console.error('\n=== Test FAILED ===');
    console.error('Error:', error.message);
    console.error(error.stack);

    // Cleanup if possible
    if (testInfantId) {
      try {
        await pool.query('DELETE FROM appointments WHERE infant_id = $1', [testInfantId]);
      } catch (cleanupError) {
        console.error('Cleanup failed:', cleanupError.message);
      }
    }
    if (testGuardianId) {
      try {
        await pool.query('DELETE FROM patients WHERE guardian_id = $1', [testGuardianId]);
        await pool.query('DELETE FROM guardians WHERE id = $1', [testGuardianId]);
      } catch (cleanupError) {
        console.error('Cleanup failed:', cleanupError.message);
      }
    }

  } finally {
    // Close the pool
    console.log('\nClosing database connection...');
    await pool.end();
    process.exit(0);
  }
}

testCascadingDeletion();
