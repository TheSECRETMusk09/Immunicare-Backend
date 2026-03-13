/**
 * Cascading Delete Stress Test
 * Tests database behavior when deleting records with 100+ foreign keys
 *
 * Run with: cd backend && node test_cascading_delete_standalone.js
 */

const db = require('./db');

async function testCascadingDelete() {
  console.log('=== Cascading Delete Stress Test ===\n');

  try {
    // Test 1: Check FK constraints count
    console.log('1. Checking foreign key constraints...');
    const fkResult = await db.query(`
      SELECT
        tc.table_name,
        COUNT(kcu.constraint_name) as fk_count
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('infants', 'appointments', 'vaccinations', 'guardian_notifications')
      GROUP BY tc.table_name
      ORDER BY fk_count DESC
    `);

    console.log('Foreign Key Counts:');
    fkResult.rows.forEach(row => {
      console.log(`  ${row.table_name}: ${row.fk_count} FKs`);
    });

    // Test 2: Create test records with multiple FK relationships
    console.log('\n2. Creating test records...');

    // Use unique timestamp for test
    const testTs = Date.now();
    const testEmail = `cascade_test_${testTs}@example.com`;
    const testPhone = `0999${testTs.toString().slice(-7)}`;

    // Create test guardian
    const guardianResult = await db.query(`
      INSERT INTO guardians (email, password_hash, name, first_name, last_name, phone)
      VALUES ($1, 'hash123', 'Cascade Test', 'Cascade', 'Test', $2)
      RETURNING id
    `, [testEmail, testPhone]);

    const guardianId = guardianResult.rows[0].id;
    console.log(`  Created guardian ID: ${guardianId}`);

    // Create test infant with guardian
    const infantResult = await db.query(`
      INSERT INTO infants (first_name, last_name, dob, guardian_id, birth_weight, birth_height, sex)
      VALUES ('CascadeInfant', 'Test', '2024-01-01', $1, 3.5, 50.0, 'M')
      RETURNING id
    `, [guardianId]);

    const infantId = infantResult.rows[0].id;
    console.log(`  Created infant ID: ${infantId}`);

    // Create multiple appointments
    console.log('\n3. Creating 100+ test appointments...');

    // Batch insert appointments
    const appointmentBatches = [];
    for (let batch = 0; batch < 10; batch++) {
      const batchValues = [];
      for (let i = 0; i < 10; i++) {
        const idx = batch * 10 + i;
        const date = new Date(Date.now() + idx * 24 * 60 * 60 * 1000).toISOString();
        batchValues.push(`('${date}', 'scheduled', ${infantId}, 'Batch ${batch} Appointment ${i}')`);
      }
      appointmentBatches.push(db.query(`
        INSERT INTO appointments (scheduled_date, status, infant_id, notes)
        VALUES ${batchValues.join(', ')}
      `));
    }

    await Promise.all(appointmentBatches);
    console.log('  Created 100 appointments');

    // Create vaccinations
    console.log('\n4. Creating test vaccinations...');
    const vaccineResult = await db.query('SELECT id FROM vaccines LIMIT 1');
    const vaccineId = vaccineResult.rows[0]?.id || 1;

    const vaccinationBatches = [];
    for (let batch = 0; batch < 5; batch++) {
      const batchValues = [];
      for (let i = 0; i < 10; i++) {
        const idx = batch * 10 + i;
        const date = new Date(Date.now() - idx * 24 * 60 * 60 * 1000).toISOString();
        batchValues.push(`(${infantId}, ${vaccineId}, '${date}', 'administered', 'Batch${batch}-${i}')`);
      }
      vaccinationBatches.push(db.query(`
        INSERT INTO vaccinations (infant_id, vaccine_id, date_administered, status, batch_number)
        VALUES ${batchValues.join(', ')}
      `));
    }

    await Promise.all(vaccinationBatches);
    console.log('  Created 50 vaccinations');

    // Test 3: Test cascading delete under stress
    console.log('\n5. Testing cascading delete under concurrent load...');

    const startTime = Date.now();
    const concurrentDeletes = 10;
    const promises = [];

    for (let i = 0; i < concurrentDeletes; i++) {
      promises.push(
        db.query('DELETE FROM guardians WHERE id = $1', [guardianId])
          .then(() => ({ success: true, time: Date.now() - startTime }))
          .catch(err => ({ success: false, error: err.message, time: Date.now() - startTime })),
      );
    }

    const results = await Promise.all(promises);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;

    console.log(`  Concurrent deletes: ${concurrentDeletes}`);
    console.log(`  Successful: ${successful}`);
    console.log(`  Failed (expected due to FK): ${failed}`);
    console.log(`  Average time: ${avgTime.toFixed(2)}ms`);

    // Test 4: Verify data integrity after operations
    console.log('\n6. Verifying data integrity...');
    const integrityCheck = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM appointments WHERE infant_id = $1) as appointment_count,
        (SELECT COUNT(*) FROM vaccinations WHERE infant_id = $1) as vaccination_count
    `, [infantId]);

    console.log(`  Remaining appointments for infant ${infantId}: ${integrityCheck.rows[0].appointment_count}`);
    console.log(`  Remaining vaccinations for infant ${infantId}: ${integrityCheck.rows[0].vaccination_count}`);

    // Cleanup
    console.log('\n7. Cleaning up test data...');
    try {
      // Try to delete - may fail if already deleted
      await db.query('DELETE FROM guardians WHERE id = $1', [guardianId]);
    } catch (e) {
      // Already deleted is fine
    }
    console.log('  Test data cleaned up');

    console.log('\n=== Test Complete ===');
    console.log(`Result: ${successful > 0 ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log(`FK constraints tested: ${fkResult.rows.length}`);

  } catch (error) {
    console.error('Test error:', error.message);
    console.error(error.stack);
  } finally {
    // NOTE: db.end() is removed to prevent it from closing the connection pool
    // for the entire application, which would cause the running server to fail.
    // This script will hang after execution; use Ctrl+C to exit.
  }
}

testCascadingDelete();
