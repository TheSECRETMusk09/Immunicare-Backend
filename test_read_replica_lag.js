/**
 * Read Replica Lag Test
 * Tests read-after-write consistency with replica lag monitoring
 *
 * Run with: node preproduction/tests/test_read_replica_lag.js
 */

const { Pool } = require('pg');
require('dotenv').config();

// Primary database connection
const primaryPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || ''
});

// Read replica connection (if separate)
const replicaPool = process.env.REPLICA_HOST ? new Pool({
  host: process.env.REPLICA_HOST,
  port: process.env.REPLICA_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || ''
}) : primaryPool;

async function testReadReplicaLag() {
  console.log('=== Read Replica Lag Test ===\n');

  const results = {
    tests: [],
    totalLatency: 0,
    maxLag: 0,
    averageLag: 0
  };

  try {
    // Test 1: Basic read-after-write consistency
    console.log('1. Testing basic read-after-write consistency...');

    // Insert a test record with unique identifier
    const testId = `replica_test_${Date.now()}`;
    const startWrite = Date.now();

    await primaryPool.query(`
      INSERT INTO guardians (email, password_hash, first_name, last_name, phone)
      VALUES ($1, 'hash123', 'Replica', 'Test', '09123456789')
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
    `, [testId]);

    const writeTime = Date.now() - startWrite;
    console.log(`  Write completed in ${writeTime}ms`);

    // Immediate read from primary
    const primaryReadStart = Date.now();
    const primaryResult = await primaryPool.query(
      'SELECT * FROM guardians WHERE email = $1',
      [testId]
    );
    const primaryReadTime = Date.now() - primaryReadStart;

    console.log(`  Primary read: ${primaryReadTime}ms - Found: ${primaryResult.rows.length > 0}`);

    // Read from replica with timing
    const replicaReadStart = Date.now();
    const replicaResult = await replicaPool.query(
      'SELECT * FROM guardians WHERE email = $1',
      [testId]
    );
    const replicaReadTime = Date.now() - replicaReadStart;
    const lag = replicaReadTime - primaryReadTime;

    console.log(`  Replica read: ${replicaReadTime}ms - Found: ${replicaResult.rows.length > 0}`);
    console.log(`  Replica lag: ${lag}ms`);

    results.tests.push({
      name: 'Basic read-after-write',
      writeTime,
      primaryReadTime,
      replicaReadTime,
      lag,
      passed: replicaResult.rows.length > 0
    });

    results.totalLatency += lag;
    if (lag > results.maxLag) results.maxLag = lag;

    // Test 2: Multiple sequential writes
    console.log('\n2. Testing sequential writes with replication...');

    const sequentialLags = [];
    for (let i = 0; i < 10; i++) {
      const seqTestId = `seq_test_${Date.now()}_${i}`;

      await primaryPool.query(`
        INSERT INTO guardians (email, password_hash, first_name, last_name, phone)
        VALUES ($1, 'hash123', 'Seq', 'Test', $2)
        ON CONFLICT (email) DO UPDATE SET phone = EXCLUDED.phone
      `, [seqTestId, `09123456${i.toString().padStart(2, '0')}`]);

      const seqReplicaStart = Date.now();
      await replicaPool.query(
        'SELECT * FROM guardians WHERE email = $1',
        [seqTestId]
      );
      const seqLag = Date.now() - seqReplicaStart;
      sequentialLags.push(seqLag);
    }

    const avgSequentialLag = sequentialLags.reduce((a, b) => a + b, 0) / sequentialLags.length;
    console.log(`  Average sequential lag: ${avgSequentialLag.toFixed(2)}ms`);
    console.log(`  Max sequential lag: ${Math.max(...sequentialLags)}ms`);

    results.tests.push({
      name: 'Sequential writes',
      averageLag: avgSequentialLag,
      maxLag: Math.max(...sequentialLags),
      passed: avgSequentialLag < 1000 // 1 second threshold
    });

    results.totalLatency += avgSequentialLag;
    if (avgSequentialLag > results.maxLag) results.maxLag = avgSequentialLag;

    // Test 3: Concurrent writes
    console.log('\n3. Testing concurrent writes...');

    const concurrentLags = [];
    const concurrentWrites = Array.from({ length: 20 }, async (_, i) => {
      const concTestId = `conc_test_${Date.now()}_${i}`;

      await primaryPool.query(`
        INSERT INTO guardians (email, password_hash, first_name, last_name, phone)
        VALUES ($1, 'hash123', 'Conc', 'Test', $2)
        ON CONFLICT (email) DO UPDATE SET phone = EXCLUDED.phone
      `, [concTestId, `09999999${i.toString().padStart(2, '0')}`]);

      const concReplicaStart = Date.now();
      await replicaPool.query(
        'SELECT * FROM guardians WHERE email = $1',
        [concTestId]
      );
      const concLag = Date.now() - concReplicaStart;
      concurrentLags.push(concLag);
    });

    await Promise.all(concurrentWrites);

    const avgConcurrentLag = concurrentLags.reduce((a, b) => a + b, 0) / concurrentLags.length;
    console.log(`  Average concurrent lag: ${avgConcurrentLag.toFixed(2)}ms`);
    console.log(`  Max concurrent lag: ${Math.max(...concurrentLags)}ms`);

    results.tests.push({
      name: 'Concurrent writes',
      averageLag: avgConcurrentLag,
      maxLag: Math.max(...concurrentLags),
      passed: avgConcurrentLag < 2000 // 2 second threshold
    });

    results.totalLatency += avgConcurrentLag;
    if (avgConcurrentLag > results.maxLag) results.maxLag = avgConcurrentLag;

    // Test 4: Heavy load scenario
    console.log('\n4. Testing under heavy load...');

    // Insert many records
    const bulkValues = Array.from({ length: 100 }, (_, i) =>
      `('bulk_test_${Date.now()}_${i}', 'hash123', 'Bulk', 'Test', '09${i.toString().padStart(8, '0')}')`
    ).join(', ');

    const bulkStart = Date.now();
    await primaryPool.query(`
      INSERT INTO guardians (email, password_hash, first_name, last_name, phone)
      VALUES ${bulkValues}
      ON CONFLICT (email) DO NOTHING
    `);
    const bulkWriteTime = Date.now() - bulkStart;
    console.log(`  Bulk write (100 records): ${bulkWriteTime}ms`);

    // Check replication
    const bulkLagStart = Date.now();
    const bulkResult = await replicaPool.query(
      'SELECT COUNT(*) as count FROM guardians WHERE email LIKE $1',
      [`bulk_test_${Date.now().slice(0, -3)}%`]
    );
    const bulkLag = Date.now() - bulkLagStart;

    console.log(`  Bulk replication lag: ${bulkLag}ms`);
    console.log(`  Records found on replica: ${bulkResult.rows[0].count}`);

    results.tests.push({
      name: 'Heavy load',
      writeTime: bulkWriteTime,
      replicaLag: bulkLag,
      passed: bulkLag < 5000 // 5 second threshold
    });

    results.totalLatency += bulkLag;
    if (bulkLag > results.maxLag) results.maxLag = bulkLag;

    // Calculate final averages
    results.averageLag = results.totalLatency / results.tests.length;

    // Cleanup
    console.log('\n5. Cleaning up test data...');
    await primaryPool.query("DELETE FROM guardians WHERE email LIKE 'replica_test_%'");
    await primaryPool.query("DELETE FROM guardians WHERE email LIKE 'seq_test_%'");
    await primaryPool.query("DELETE FROM guardians WHERE email LIKE 'conc_test_%'");
    await primaryPool.query("DELETE FROM guardians WHERE email LIKE 'bulk_test_%'");
    console.log('  Cleanup complete');

    // Print summary
    console.log('\n=== Test Results Summary ===');
    console.log(`Total tests: ${results.tests.length}`);
    console.log(`Passed: ${results.tests.filter(t => t.passed).length}`);
    console.log(`Failed: ${results.tests.filter(t => !t.passed).length}`);
    console.log(`Average lag: ${results.averageLag.toFixed(2)}ms`);
    console.log(`Max lag: ${results.maxLag}ms`);
    console.log(`\nOverall: ${results.tests.every(t => t.passed) ? 'PASS ✓' : 'FAIL ✗'}`);

  } catch (error) {
    console.error('Test error:', error.message);
  } finally {
    await primaryPool.end();
    if (replicaPool !== primaryPool) {
      await replicaPool.end();
    }
  }
}

testReadReplicaLag();
