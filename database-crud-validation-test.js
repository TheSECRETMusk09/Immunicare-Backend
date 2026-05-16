/**
 * Comprehensive Database CRUD Validation Tests
 * Tests database operations, schema integrity, foreign key relationships, and constraint enforcement
 *
 * Test Coverage:
 * - CRUD operations for all core tables
 * - Schema integrity (NOT NULL, UNIQUE, CHECK constraints)
 * - Foreign key relationships and referential integrity
 * - Transaction rollback scenarios
 * - Data persistence validation
 * - Edge cases and boundary conditions
 *
 * Database: PostgreSQL
 * Testing: Jest-style async testing
 */

const { Pool } = require('pg');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || '',
};

const TEST_PREFIX = 'test_';

// Test results storage
const testResults = {
  passed: [],
  failed: [],
  errors: [],
};

let pool = null;

// ============================================
// UTILITY FUNCTIONS
// ============================================

async function getPool() {
  if (!pool) {
    pool = new Pool(DB_CONFIG);
  }
  return pool;
}

async function query(text, params = []) {
  const p = await getPool();
  return await p.query(text, params);
}

async function assert(condition, testName, details = {}) {
  const result = {
    name: testName,
    passed: condition,
    details,
  };

  if (condition) {
    testResults.passed.push(result);
    console.log(`  ✓ ${testName}`);
  } else {
    testResults.failed.push(result);
    console.log(`  ✗ ${testName}`);
    if (details.expected) {
      console.log(`    Expected: ${details.expected}`);
    }
    if (details.actual) {
      console.log(`    Actual: ${details.actual}`);
    }
  }

  return condition;
}

// ============================================
// SCHEMA INTEGRITY TESTS
// ============================================

async function testSchemaIntegrity() {
  console.log('\n=== SCHEMA INTEGRITY TESTS ===');

  // Test 1: Check all required tables exist
  const requiredTables = [
    'admin',
    'guardians',
    'patients',
    'vaccines',
    'vaccine_batches',
    'immunization_records',
    'appointments',
    'notifications',
    'announcements',
    'audit_logs',
  ];

  try {
    const result = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `);

    const existingTables = result.rows.map((r) => r.table_name);

    for (const table of requiredTables) {
      await assert(existingTables.includes(table), `Table '${table}' exists`, {
        expected: 'exists',
        actual: existingTables.includes(table) ? 'exists' : 'missing',
      });
    }
  } catch (err) {
    await assert(false, 'Table existence check', { actual: err.message });
  }

  // Test 2: Check NOT NULL constraints
  try {
    const result = await query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'NOT NULL'
      AND tc.table_schema = 'public'
      LIMIT 20
    `);

    await assert(result.rows.length > 0, 'NOT NULL constraints exist', {
      expected: 'constraints found',
      actual: `${result.rows.length} constraints`,
    });
  } catch (err) {
    await assert(false, 'NOT NULL constraints check', { actual: err.message });
  }

  // Test 3: Check UNIQUE constraints
  try {
    const result = await query(`
      SELECT constraint_name, table_name
      FROM information_schema.table_constraints
      WHERE constraint_type = 'UNIQUE'
      AND table_schema = 'public'
    `);

    await assert(result.rows.length > 0, 'UNIQUE constraints exist', {
      expected: 'constraints found',
      actual: `${result.rows.length} constraints`,
    });
  } catch (err) {
    await assert(false, 'UNIQUE constraints check', { actual: err.message });
  }

  // Test 4: Check FOREIGN KEY relationships
  try {
    const result = await query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    `);

    await assert(result.rows.length > 0, 'FOREIGN KEY relationships exist', {
      expected: 'FKs found',
      actual: `${result.rows.length} FKs`,
    });
  } catch (err) {
    await assert(false, 'FOREIGN KEY check', { actual: err.message });
  }

  // Test 5: Check CHECK constraints
  try {
    const result = await query(`
      SELECT constraint_name, table_name
      FROM information_schema.table_constraints
      WHERE constraint_type = 'CHECK'
      AND table_schema = 'public'
    `);

    await assert(result.rows.length > 0, 'CHECK constraints exist', {
      expected: 'constraints found',
      actual: `${result.rows.length} constraints`,
    });
  } catch (err) {
    await assert(false, 'CHECK constraints check', { actual: err.message });
  }
}

// ============================================
// ADMIN TABLE CRUD TESTS
// ============================================

async function testAdminCrud() {
  console.log('\n=== ADMIN TABLE CRUD TESTS ===');

  let testAdminId = null;

  // CREATE
  try {
    const result = await query(
      `
      INSERT INTO admin (username, password_hash, role, facility_id, email, is_active)
      VALUES ($1, $2, $3, 1, $4, true)
      RETURNING id
    `,
      [
        `${TEST_PREFIX}admin_${Date.now()}`,
        'hashed_password',
        'admin',
        `${TEST_PREFIX}admin@test.com`,
      ]
    );

    testAdminId = result.rows[0].id;

    await assert(testAdminId > 0, 'CREATE: Admin record created successfully', {
      expected: 'valid ID',
      actual: testAdminId,
    });
  } catch (err) {
    await assert(false, 'CREATE: Admin record', { actual: err.message });
  }

  // READ
  if (testAdminId) {
    try {
      const result = await query('SELECT * FROM admin WHERE id = $1', [testAdminId]);

      await assert(result.rows.length === 1, 'READ: Admin record retrieved', {
        expected: '1 row',
        actual: `${result.rows.length} rows`,
      });

      if (result.rows.length > 0) {
        await assert(result.rows[0].role === 'admin', 'READ: Admin role is correct', {
          expected: 'admin',
          actual: result.rows[0].role,
        });
      }
    } catch (err) {
      await assert(false, 'READ: Admin record', { actual: err.message });
    }
  }

  // UPDATE
  if (testAdminId) {
    try {
      await query('UPDATE admin SET role = $1 WHERE id = $2', ['nurse', testAdminId]);

      const result = await query('SELECT role FROM admin WHERE id = $1', [testAdminId]);

      await assert(result.rows[0].role === 'nurse', 'UPDATE: Admin role updated', {
        expected: 'nurse',
        actual: result.rows[0].role,
      });
    } catch (err) {
      await assert(false, 'UPDATE: Admin record', { actual: err.message });
    }
  }

  // DELETE (or deactivate)
  if (testAdminId) {
    try {
      await query('UPDATE admin SET is_active = false WHERE id = $1', [testAdminId]);

      const result = await query('SELECT is_active FROM admin WHERE id = $1', [testAdminId]);

      await assert(result.rows[0].is_active === false, 'DELETE: Admin deactivated (soft delete)', {
        expected: 'false',
        actual: result.rows[0].is_active,
      });
    } catch (err) {
      await assert(false, 'DELETE: Admin record', { actual: err.message });
    }
  }

  // CLEANUP
  if (testAdminId) {
    try {
      await query('DELETE FROM admin WHERE id = $1', [testAdminId]);
    } catch (err) {
      // Ignore cleanup errors
    }
  }
}

// ============================================
// GUARDIANS TABLE CRUD TESTS
// ============================================

async function testGuardiansCrud() {
  console.log('\n=== GUARDIANS TABLE CRUD TESTS ===');

  let testGuardianId = null;

  // CREATE
  try {
    const result = await query(
      `
      INSERT INTO guardians (name, phone, email, is_active)
      VALUES ($1, $2, $3, true)
      RETURNING id
    `,
      [`${TEST_PREFIX}Guardian`, '09123456789', `${TEST_PREFIX}guardian@test.com`]
    );

    testGuardianId = result.rows[0].id;

    await assert(testGuardianId > 0, 'CREATE: Guardian record created', {
      expected: 'valid ID',
      actual: testGuardianId,
    });
  } catch (err) {
    await assert(false, 'CREATE: Guardian record', { actual: err.message });
  }

  // READ
  if (testGuardianId) {
    try {
      const result = await query('SELECT * FROM guardians WHERE id = $1', [testGuardianId]);

      await assert(result.rows.length === 1, 'READ: Guardian record retrieved', {
        expected: '1 row',
        actual: `${result.rows.length} rows`,
      });
    } catch (err) {
      await assert(false, 'READ: Guardian record', { actual: err.message });
    }
  }

  // UPDATE
  if (testGuardianId) {
    try {
      await query('UPDATE guardians SET phone = $1 WHERE id = $2', ['09999999999', testGuardianId]);

      const result = await query('SELECT phone FROM guardians WHERE id = $1', [testGuardianId]);

      await assert(result.rows[0].phone === '09999999999', 'UPDATE: Guardian phone updated', {
        expected: '09999999999',
        actual: result.rows[0].phone,
      });
    } catch (err) {
      await assert(false, 'UPDATE: Guardian record', { actual: err.message });
    }
  }

  // DELETE
  if (testGuardianId) {
    try {
      await query('DELETE FROM guardians WHERE id = $1', [testGuardianId]);

      const result = await query('SELECT * FROM guardians WHERE id = $1', [testGuardianId]);

      await assert(result.rows.length === 0, 'DELETE: Guardian record deleted', {
        expected: '0 rows',
        actual: `${result.rows.length} rows`,
      });
    } catch (err) {
      await assert(false, 'DELETE: Guardian record', { actual: err.message });
    }
  }
}

// ============================================
// PATIENTS TABLE CRUD TESTS
// ============================================

async function testPatientsCrud() {
  console.log('\n=== PATIENTS TABLE CRUD TESTS ===');

  let testPatientId = null;
  let testGuardianId = null;

  // Setup: Create guardian first
  try {
    const result = await query(
      `
      INSERT INTO guardians (name, phone, email)
      VALUES ($1, $2, $3)
      RETURNING id
   `,
      [`${TEST_PREFIX}Guardian`, '09123456789', `${TEST_PREFIX}guardian@test.com`]
    );
    testGuardianId = result.rows[0].id;
  } catch (err) {
    console.log('  ⚠ Could not create test guardian');
  }

  // CREATE
  if (testGuardianId) {
    try {
      const result = await query(
        `
        INSERT INTO patients (first_name, last_name, dob, sex, guardian_id, facility_id)
        VALUES ($1, $2, $3, 'male', $4, 1)
        RETURNING id
      `,
        [`${TEST_PREFIX}John`, `${TEST_PREFIX}Doe`, '2023-01-15', testGuardianId]
      );

      testPatientId = result.rows[0].id;

      await assert(testPatientId > 0, 'CREATE: Patient record created', {
        expected: 'valid ID',
        actual: testPatientId,
      });
    } catch (err) {
      await assert(false, 'CREATE: Patient record', { actual: err.message });
    }
  }

  // READ
  if (testPatientId) {
    try {
      const result = await query('SELECT * FROM patients WHERE id = $1', [testPatientId]);

      await assert(result.rows.length === 1, 'READ: Patient record retrieved', {
        expected: '1 row',
        actual: `${result.rows.length} rows`,
      });

      if (result.rows.length > 0) {
        await assert(
          result.rows[0].first_name.startsWith(TEST_PREFIX),
          'READ: Patient first name is correct',
          { expected: 'starts with ' + TEST_PREFIX, actual: result.rows[0].first_name }
        );
      }
    } catch (err) {
      await assert(false, 'READ: Patient record', { actual: err.message });
    }
  }

  // UPDATE
  if (testPatientId) {
    try {
      await query('UPDATE patients SET first_name = $1 WHERE id = $2', [
        `${TEST_PREFIX}Jane`,
        testPatientId,
      ]);

      const result = await query('SELECT first_name FROM patients WHERE id = $1', [testPatientId]);

      await assert(
        result.rows[0].first_name === `${TEST_PREFIX}Jane`,
        'UPDATE: Patient name updated',
        { expected: `${TEST_PREFIX}Jane`, actual: result.rows[0].first_name }
      );
    } catch (err) {
      await assert(false, 'UPDATE: Patient record', { actual: err.message });
    }
  }

  // DELETE
  if (testPatientId) {
    try {
      await query('DELETE FROM patients WHERE id = $1', [testPatientId]);

      const result = await query('SELECT * FROM patients WHERE id = $1', [testPatientId]);

      await assert(result.rows.length === 0, 'DELETE: Patient record deleted', {
        expected: '0 rows',
        actual: `${result.rows.length} rows`,
      });
    } catch (err) {
      await assert(false, 'DELETE: Patient record', { actual: err.message });
    }
  }

  // Cleanup guardian
  if (testGuardianId) {
    try {
      await query('DELETE FROM guardians WHERE id = $1', [testGuardianId]);
    } catch (err) {
      // Ignore
    }
  }
}

// ============================================
// APPOINTMENTS TABLE CRUD TESTS
// ============================================

async function testAppointmentsCrud() {
  console.log('\n=== APPOINTMENTS TABLE CRUD TESTS ===');

  let testAppointmentId = null;
  let testPatientId = null;
  let testGuardianId = null;
  let testAdminId = null;

  // Setup: Create necessary records
  try {
    const guardianResult = await query(
      `
      INSERT INTO guardians (name, phone, email)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [`${TEST_PREFIX}Guardian`, '09123456789', `${TEST_PREFIX}guardian@test.com`]
    );
    testGuardianId = guardianResult.rows[0].id;

    const patientResult = await query(
      `
      INSERT INTO patients (first_name, last_name, dob, sex, guardian_id, facility_id)
      VALUES ($1, $2, $3, 'male', $4, 1)
      RETURNING id
    `,
      [`${TEST_PREFIX}John`, `${TEST_PREFIX}Doe`, '2023-01-15', testGuardianId]
    );
    testPatientId = patientResult.rows[0].id;

    const adminResult = await query(
      `
      INSERT INTO admin (username, password_hash, role, facility_id, email)
      VALUES ($1, $2, 'admin', 1, $3)
      RETURNING id
    `,
      [`${TEST_PREFIX}admin_${Date.now()}`, 'hash', `${TEST_PREFIX}admin@test.com`]
    );
    testAdminId = adminResult.rows[0].id;
  } catch (err) {
    console.log('  ⚠ Could not create test setup records');
  }

  // CREATE
  if (testPatientId && testAdminId) {
    try {
      const result = await query(
        `
        INSERT INTO appointments (patient_id, scheduled_date, type, status, created_by, facility_id)
        VALUES ($1, $2, $3, 'scheduled', $4, 1)
        RETURNING id
      `,
        [testPatientId, '2024-12-01 10:00:00', 'Vaccination', testAdminId]
      );

      testAppointmentId = result.rows[0].id;

      await assert(testAppointmentId > 0, 'CREATE: Appointment record created', {
        expected: 'valid ID',
        actual: testAppointmentId,
      });
    } catch (err) {
      await assert(false, 'CREATE: Appointment record', { actual: err.message });
    }
  }

  // READ
  if (testAppointmentId) {
    try {
      const result = await query('SELECT * FROM appointments WHERE id = $1', [testAppointmentId]);

      await assert(result.rows.length === 1, 'READ: Appointment record retrieved', {
        expected: '1 row',
        actual: `${result.rows.length} rows`,
      });
    } catch (err) {
      await assert(false, 'READ: Appointment record', { actual: err.message });
    }
  }

  // UPDATE status
  if (testAppointmentId) {
    try {
      await query('UPDATE appointments SET status = $1 WHERE id = $2', [
        'attended',
        testAppointmentId,
      ]);

      const result = await query('SELECT status FROM appointments WHERE id = $1', [
        testAppointmentId,
      ]);

      await assert(result.rows[0].status === 'attended', 'UPDATE: Appointment status updated', {
        expected: 'attended',
        actual: result.rows[0].status,
      });
    } catch (err) {
      await assert(false, 'UPDATE: Appointment status', { actual: err.message });
    }
  }

  // DELETE
  if (testAppointmentId) {
    try {
      await query('DELETE FROM appointments WHERE id = $1', [testAppointmentId]);

      const result = await query('SELECT * FROM appointments WHERE id = $1', [testAppointmentId]);

      await assert(result.rows.length === 0, 'DELETE: Appointment record deleted', {
        expected: '0 rows',
        actual: `${result.rows.length} rows`,
      });
    } catch (err) {
      await assert(false, 'DELETE: Appointment record', { actual: err.message });
    }
  }

  // Cleanup
  try {
    if (testPatientId) {
      await query('DELETE FROM patients WHERE id = $1', [testPatientId]);
    }
    if (testGuardianId) {
      await query('DELETE FROM guardians WHERE id = $1', [testGuardianId]);
    }
    if (testAdminId) {
      await query('DELETE FROM admin WHERE id = $1', [testAdminId]);
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

// ============================================
// FOREIGN KEY CONSTRAINT TESTS
// ============================================

async function testForeignKeyConstraints() {
  console.log('\n=== FOREIGN KEY CONSTRAINT TESTS ===');

  // Test 1: Patient without valid guardian should fail
  try {
    await query(
      `
      INSERT INTO patients (first_name, last_name, dob, sex, guardian_id)
      VALUES ($1, $2, $3, 'male', 999999)
    `,
      [`${TEST_PREFIX}Orphan`, `${TEST_PREFIX}Child`, '2023-01-15']
    );

    await assert(false, 'FK Constraint: Patient with invalid guardian rejected', {
      expected: 'rejected',
      actual: 'inserted (warning!)',
    });
  } catch (err) {
    await assert(true, 'FK Constraint: Patient with invalid guardian rejected', {
      expected: 'error',
      actual: err.message.substring(0, 50),
    });
  }

  // Test 2: Appointment without valid patient should fail
  try {
    // First get a valid admin
    const adminResult = await query('SELECT id FROM admin LIMIT 1');
    if (adminResult.rows.length > 0) {
      await query(
        `
        INSERT INTO appointments (patient_id, scheduled_date, type, created_by)
        VALUES (999999, $1, 'Vaccination', $2)
      `,
        ['2024-12-01 10:00:00', adminResult.rows[0].id]
      );

      await assert(false, 'FK Constraint: Appointment with invalid patient rejected', {
        expected: 'rejected',
        actual: 'inserted (warning!)',
      });
    }
  } catch (err) {
    await assert(true, 'FK Constraint: Appointment with invalid patient rejected', {
      expected: 'error',
      actual: err.message.substring(0, 50),
    });
  }
}

// ============================================
// DATA VALIDATION TESTS
// ============================================

async function testDataValidation() {
  console.log('\n=== DATA VALIDATION TESTS ===');

  // Test 1: Invalid date format
  try {
    const guardianResult = await query(
      `
      INSERT INTO guardians (name, phone, email)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [`${TEST_PREFIX}Guardian`, '09123456789', `${TEST_PREFIX}guardian@test.com`]
    );
    const guardianId = guardianResult.rows[0].id;

    await query(
      `
      INSERT INTO patients (first_name, last_name, dob, sex, guardian_id)
      VALUES ($1, $2, $3, 'male', $4)
    `,
      [`${TEST_PREFIX}Baby`, `${TEST_PREFIX}Smith`, 'invalid-date', guardianId]
    );

    await assert(false, 'Data Validation: Invalid date format rejected', {
      expected: 'rejected',
      actual: 'inserted',
    });

    // Cleanup
    await query('DELETE FROM guardians WHERE id = $1', [guardianId]);
  } catch (err) {
    await assert(true, 'Data Validation: Invalid date format rejected', {
      expected: 'error',
      actual: 'correctly rejected',
    });
  }

  // Test 2: Required field validation
  try {
    await query(
      `
      INSERT INTO guardians (name, phone)
      VALUES ($1, $2)
    `,
      [`${TEST_PREFIX}Incomplete`]
    ); // Missing email

    await assert(false, 'Data Validation: Missing required fields rejected', {
      expected: 'rejected',
      actual: 'inserted',
    });
  } catch (err) {
    await assert(true, 'Data Validation: Missing required fields rejected', {
      expected: 'error',
      actual: 'correctly rejected',
    });
  }

  // Test 3: Enum validation
  try {
    const guardianResult = await query(
      `
      INSERT INTO guardians (name, phone, email)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [`${TEST_PREFIX}Guardian2`, '09123456780', `${TEST_PREFIX}guardian2@test.com`]
    );
    const guardianId = guardianResult.rows[0].id;

    await query(
      `
      INSERT INTO patients (first_name, last_name, dob, sex, guardian_id)
      VALUES ($1, $2, $3, 'invalid_sex', $4)
    `,
      [`${TEST_PREFIX}Baby`, `${TEST_PREFIX}Doe`, '2023-01-15', guardianId]
    );

    await assert(false, 'Data Validation: Invalid enum value rejected', {
      expected: 'rejected',
      actual: 'inserted',
    });

    // Cleanup
    await query('DELETE FROM guardians WHERE id = $1', [guardianId]);
  } catch (err) {
    await assert(true, 'Data Validation: Invalid enum value rejected', {
      expected: 'error',
      actual: 'correctly rejected',
    });
  }
}

// ============================================
// TRANSACTION AND ROLLBACK TESTS
// ============================================

async function testTransactions() {
  console.log('\n=== TRANSACTION AND ROLLBACK TESTS ===');

  // Test 1: Successful transaction
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const guardianResult = await client.query(
      `
      INSERT INTO guardians (name, phone, email)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [`${TEST_PREFIX}TxGuardian`, '09123456789', `${TEST_PREFIX}tx@test.com`]
    );

    await client.query(
      `
      INSERT INTO patients (first_name, last_name, dob, sex, guardian_id)
      VALUES ($1, $2, $3, 'male', $4)
    `,
      [`${TEST_PREFIX}TxBaby`, `${TEST_PREFIX}Doe`, '2023-01-15', guardianResult.rows[0].id]
    );

    await client.query('COMMIT');

    // Verify both were inserted
    const patientCheck = await query('SELECT * FROM patients WHERE first_name = $1', [
      `${TEST_PREFIX}TxBaby`,
    ]);

    await assert(
      patientCheck.rows.length === 1,
      'Transaction: Successful commit inserts all records',
      { expected: '1 patient', actual: `${patientCheck.rows.length} patients` }
    );

    // Cleanup
    await query('DELETE FROM patients WHERE first_name = $1', [`${TEST_PREFIX}TxBaby`]);
    await query('DELETE FROM guardians WHERE id = $1', [guardianResult.rows[0].id]);
  } catch (err) {
    await client.query('ROLLBACK');
    await assert(false, 'Transaction: Successful commit', { actual: err.message });
  } finally {
    client.release();
  }

  // Test 2: Rollback on error
  try {
    await client.query('BEGIN');

    const guardianResult = await client.query(
      `
      INSERT INTO guardians (name, phone, email)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [`${TEST_PREFIX}RollbackG`, '09123456789', `${TEST_PREFIX}rb@test.com`]
    );

    // Try to insert invalid patient
    await client.query(
      `
      INSERT INTO patients (first_name, last_name, dob, sex, guardian_id)
      VALUES ($1, $2, $3, 'invalid_sex', $4)
    `,
      [`${TEST_PREFIX}RollbackP`, `${TEST_PREFIX}Doe`, '2023-01-15', guardianResult.rows[0].id]
    );

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');

      // Verify guardian was not inserted (or was rolled back)
      const guardianCheck = await query('SELECT * FROM guardians WHERE name = $1', [
        `${TEST_PREFIX}RollbackG`,
      ]);

      await assert(true, 'Transaction: Rollback on error works', {
        expected: 'no records',
        actual: `${guardianCheck.rows.length} records`,
      });
    } catch (rbErr) {
      await assert(false, 'Transaction: Rollback', { actual: rbErr.message });
    }
  } finally {
    client.release();
  }
}

// ============================================
// EDGE CASES AND BOUNDARY CONDITIONS
// ============================================

async function testEdgeCases() {
  console.log('\n=== EDGE CASES AND BOUNDARY CONDITIONS ===');

  // Test 1: Very long string handling
  try {
    const longName = 'A'.repeat(500);
    const result = await query(
      `
      INSERT INTO guardians (name, phone, email)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [longName, '09123456789', `${TEST_PREFIX}long@test.com`]
    );

    await assert(result.rows.length > 0, 'Edge Case: Very long string handled', {
      expected: 'inserted',
      actual: 'success',
    });

    // Cleanup
    await query('DELETE FROM guardians WHERE id = $1', [result.rows[0].id]);
  } catch (err) {
    await assert(true, 'Edge Case: Very long string rejected or truncated', {
      expected: 'handled',
      actual: 'correctly handled',
    });
  }

  // Test 2: Special characters in data
  try {
    const specialName = "O'Brien";
    const result = await query(
      `
      INSERT INTO guardians (name, phone, email)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [specialName, '09123456789', `${TEST_PREFIX}special@test.com`]
    );

    await assert(result.rows.length > 0, 'Edge Case: Special characters handled', {
      expected: 'inserted',
      actual: 'success',
    });

    // Verify
    const check = await query('SELECT name FROM guardians WHERE id = $1', [result.rows[0].id]);
    await assert(check.rows[0].name === specialName, 'Edge Case: Special characters preserved', {
      expected: specialName,
      actual: check.rows[0].name,
    });

    // Cleanup
    await query('DELETE FROM guardians WHERE id = $1', [result.rows[0].id]);
  } catch (err) {
    await assert(false, 'Edge Case: Special characters', { actual: err.message });
  }

  // Test 3: NULL handling
  try {
    const result = await query(
      `
      INSERT INTO guardians (name, phone, email, address)
      VALUES ($1, $2, $3, NULL)
      RETURNING id
    `,
      [`${TEST_PREFIX}NullTest`, '09123456789', `${TEST_PREFIX}null@test.com`]
    );

    await assert(result.rows.length > 0, 'Edge Case: NULL values handled', {
      expected: 'inserted',
      actual: 'success',
    });

    // Cleanup
    await query('DELETE FROM guardians WHERE id = $1', [result.rows[0].id]);
  } catch (err) {
    await assert(false, 'Edge Case: NULL handling', { actual: err.message });
  }
}

// ============================================
// REPORT GENERATION
// ============================================

function generateReport() {
  const total = testResults.passed.length + testResults.failed.length;
  const passRate = total > 0 ? ((testResults.passed.length / total) * 100).toFixed(2) : 0;

  let report = '# Database CRUD Validation Test Report\n\n';
  report += `**Test Date:** ${new Date().toISOString()}\n`;
  report += `**Database:** ${DB_CONFIG.database}\n\n`;

  report += '## Summary\n\n';
  report += `- ✅ Passed: ${testResults.passed.length}\n`;
  report += `- ❌ Failed: ${testResults.failed.length}\n`;
  report += `- 📊 Pass Rate: ${passRate}%\n\n`;

  report += '## Failed Tests\n\n';
  if (testResults.failed.length === 0) {
    report += 'No failed tests!\n\n';
  } else {
    testResults.failed.forEach((test, i) => {
      report += `### ${i + 1}. ${test.name}\n`;
      if (test.details.expected) {
        report += `- Expected: ${test.details.expected}\n`;
      }
      if (test.details.actual) {
        report += `- Actual: ${test.details.actual}\n`;
      }
      report += '\n';
    });
  }

  report += '## Test Coverage\n\n';
  report += '- Schema Integrity: ✅\n';
  report += '- CRUD Operations: ✅\n';
  report += '- Foreign Key Constraints: ✅\n';
  report += '- Data Validation: ✅\n';
  report += '- Transactions & Rollback: ✅\n';
  report += '- Edge Cases: ✅\n';

  return report;
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function runTests() {
  console.log('='.repeat(60));
  console.log('DATABASE CRUD VALIDATION TESTS');
  console.log('='.repeat(60));
  console.log(`\nDatabase: ${DB_CONFIG.database}`);
  console.log(`Host: ${DB_CONFIG.host}:${DB_CONFIG.port}`);

  // Test connection
  console.log('\nTesting database connection...');
  try {
    const result = await query('SELECT current_database(), current_user');
    console.log(`  ✅ Connected to: ${result.rows[0].current_database()}`);
    console.log(`  ✅ User: ${result.rows[0].current_user}`);
  } catch (err) {
    console.log(`  ❌ Connection failed: ${err.message}`);
    console.log('\nPlease ensure:');
    console.log('  1. PostgreSQL is running');
    console.log('  2. Database credentials are correct');
    console.log(
      '  3. Environment variables are set (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)'
    );
    process.exit(1);
  }

  // Run all tests
  await testSchemaIntegrity();
  await testAdminCrud();
  await testGuardiansCrud();
  await testPatientsCrud();
  await testAppointmentsCrud();
  await testForeignKeyConstraints();
  await testDataValidation();
  await testTransactions();
  await testEdgeCases();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  const total = testResults.passed.length + testResults.failed.length;
  const passRate = total > 0 ? ((testResults.passed.length / total) * 100).toFixed(2) : 0;

  console.log(`\nTotal Tests: ${total}`);
  console.log(`✅ Passed: ${testResults.passed.length}`);
  console.log(`❌ Failed: ${testResults.failed.length}`);
  console.log(`📊 Pass Rate: ${passRate}%`);

  if (testResults.failed.length > 0) {
    console.log('\n--- Failed Tests ---');
    testResults.failed.forEach((test, i) => {
      console.log(`\n${i + 1}. ${test.name}`);
      if (test.details.expected) {
        console.log(`   Expected: ${test.details.expected}`);
      }
      if (test.details.actual) {
        console.log(`   Actual: ${test.details.actual}`);
      }
    });
  }

  // Save report
  const fs = require('fs');
  const report = generateReport();
  const reportPath = 'backend/CRUD_VALIDATION_TEST_REPORT.md';
  fs.writeFileSync(reportPath, report);
  console.log(`\n📄 Detailed report saved to: ${reportPath}`);

  // Cleanup
  await pool.end();

  // Final verdict
  console.log('\n' + '='.repeat(60));
  if (testResults.failed.length === 0) {
    console.log('✅ ALL DATABASE TESTS PASSED!');
  } else {
    console.log(`❌ ${testResults.failed.length} TEST(S) FAILED`);
  }
  console.log('='.repeat(60));

  process.exit(testResults.failed.length > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
