/**
 * Cascading Delete Stress Test
 * Tests database behavior when deleting records with 100+ foreign keys
 *
 * Run with: node preproduction/tests/test_cascading_delete.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10,
});

async function testCascadingDelete() {
  console.log('=== Cascading Delete Stress Test ===\n');

  try {
    // Test 1: Check FK constraints count
    console.log('1. Checking foreign key constraints...');
    const fkResult = await pool.query(`
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

    // Create test guardian - use timestamp for unique email
    const testEmail = `test_delete_${Date.now()}@example.com`;
    const testPhone = `0999${Date.now().toString().slice(-7)}`;

    // Insert guardian
    const guardianResult = await pool.query(`
      INSERT INTO guardians (email, password_hash, name, first_name, last_name, phone)
      VALUES ($1, 'hash123', 'Test Delete', 'Test', 'Delete', $2)
      RETURNING id
    `, [testEmail, testPhone]);
    const guardianId = guardianResult.rows[0].id;
    console.log(`  Created guardian ID: ${guardianId}`);

    // Create test infant with guardian
    const infantResult = await pool.query(`
      INSERT INTO infants (first_name, last_name, dob, guardian_id, birth_weight, birth_height, sex)
      VALUES ('Cascade', 'Test', '2024-01-01', $1, 3.5, 50.0, 'M')
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [guardianId]);
    const infantId = infantResult.rows[0]?.id;

    if (!infantId) {
      const existing = await pool.query('SELECT id FROM infants WHERE guardian_id = $1 LIMIT 1', [guardianId]);
      infantId = existing.rows[0].id;
    }
    console.log(`  Created infant ID: ${infantId}`);

    // Create multiple appointments
    console.log('\n3. Creating 100+ test appointments...');
    const appointmentValues = [];
    for (let i = 0; i < 100; i++) {
      appointmentValues.push(`('${new Date().toISOString()}', 'scheduled', ${infantId}, 'Test Appointment ${i}')`);
    }

    await pool.query(`
      INSERT INTO appointments (scheduled_date, status, infant_id, notes)
      VALUES ${appointmentValues.join(', ')}
    `);
    console.log('  Created 100 appointments');

    // Create vaccinations
    console.log('\n4. Creating test vaccinations...');
    const vaccineResult = await pool.query('SELECT id FROM vaccines LIMIT 1');
    const vaccineId = vaccineResult.rows[0]?.id || 1;

    const vaccinationValues = [];
    for (let i = 0; i < 50; i++) {
      vaccinationValues.push(`(${infantId}, ${vaccineId}, '${new Date().toISOString()}', 'administered', 'Batch${i}')`);
    }

    await pool.query(`
      INSERT INTO vaccinations (infant_id, vaccine_id, date_administered, status, batch_number)
      VALUES ${vaccinationValues.join(', ')}
    `);
    console.log('  Created 50 vaccinations');

    // Test 3: Test cascading delete under stress
    console.log('\n5. Testing cascading delete under concurrent load...');

    const startTime = Date.now();
    const concurrentDeletes = 10;
    const promises = [];

    for (let i = 0; i < concurrentDeletes; i++) {
      promises.push(
        pool.query('DELETE FROM guardians WHERE id = $1', [guardianId])
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
    const integrityCheck = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM appointments WHERE infant_id = $1) as appointment_count,
        (SELECT COUNT(*) FROM vaccinations WHERE infant_id = $1) as vaccination_count
    `, [infantId]);

    console.log(`  Remaining appointments for infant ${infantId}: ${integrityCheck.rows[0].appointment_count}`);
    console.log(`  Remaining vaccinations for infant ${infantId}: ${integrityCheck.rows[0].vaccination_count}`);

    // Cleanup
    console.log('\n7. Cleaning up test data...');
    await pool.query('DELETE FROM guardians WHERE email = $1', [testEmail]);
    console.log('  Test data cleaned up');

    console.log('\n=== Test Complete ===');
    console.log(`Result: ${successful > 0 ? 'PASS' : 'FAIL'}`);

  } catch (error) {
    console.error('Test error:', error.message);
  } finally {
    await pool.end();
  }
}

testCascadingDelete();
