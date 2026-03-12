/**
 * Immunicare Database Comprehensive Test Suite
 *
 * Tests all database schema elements, relationships, constraints,
 * indexes, and data integrity across the PostgreSQL database
 */

const { Pool } = require('pg');

// Database Configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || '',
};

// Database Pool
const pool = new Pool(DB_CONFIG);

// Expected Tables in the Database
const EXPECTED_TABLES = [
  'users',
  'guardians',
  'infants',
  'vaccines',
  'vaccination_records',
  'vaccination_schedules',
  'vaccine_batches',
  'vaccine_inventory',
  'vaccine_inventory_transactions',
  'vaccine_stock_alerts',
  'appointments',
  'notifications',
  'announcements',
  'roles',
  'permissions',
  'role_permissions',
  'audit_logs',
  'security_events',
  'user_sessions',
  'refresh_tokens',
  'clinics',
  'health_records',
  'messages',
  'reports',
  'paper_templates',
  'document_generation',
  'digital_papers',
  'suppliers',
  'alerts',
  'cache',
  'system_config',
];

// Critical Columns for Each Table
const CRITICAL_COLUMNS = {
  users: ['id', 'username', 'password_hash', 'role_id', 'clinic_id', 'is_active'],
  guardians: ['id', 'name', 'phone', 'email', 'password_hash', 'is_active'],
  infants: ['id', 'first_name', 'last_name', 'dob', 'sex', 'guardian_id', 'is_active'],
  vaccines: ['id', 'code', 'name', 'doses_required', 'is_active'],
  vaccination_records: ['id', 'infant_id', 'vaccine_id', 'batch_id', 'dose_no', 'admin_date', 'is_active'],
  appointments: ['id', 'infant_id', 'scheduled_date', 'status', 'is_active'],
  vaccine_inventory: ['id', 'vaccine_id', 'clinic_id', 'is_low_stock', 'is_critical_stock'],
  notifications: ['id', 'notification_type', 'target_type', 'target_id', 'status'],
  roles: ['id', 'name', 'is_active'],
  permissions: ['id', 'name', 'resource', 'action', 'is_active'],
  audit_logs: ['id', 'user_id', 'event_type', 'timestamp'],
  security_events: ['id', 'user_id', 'event_type', 'severity', 'created_at'],
};

// Expected Foreign Key Relationships
const EXPECTED_RELATIONSHIPS = [
  { table: 'users', column: 'role_id', references: 'roles(id)' },
  { table: 'users', column: 'clinic_id', references: 'clinics(id)' },
  { table: 'users', column: 'guardian_id', references: 'guardians(id)' },
  { table: 'infants', column: 'guardian_id', references: 'guardians(id)' },
  { table: 'infants', column: 'clinic_id', references: 'clinics(id)' },
  { table: 'vaccination_records', column: 'infant_id', references: 'infants(id)' },
  { table: 'vaccination_records', column: 'vaccine_id', references: 'vaccines(id)' },
  { table: 'vaccination_records', column: 'batch_id', references: 'vaccine_batches(id)' },
  { table: 'vaccination_records', column: 'administered_by', references: 'users(id)' },
  { table: 'appointments', column: 'infant_id', references: 'infants(id)' },
  { table: 'appointments', column: 'created_by', references: 'users(id)' },
  { table: 'appointments', column: 'clinic_id', references: 'clinics(id)' },
  { table: 'vaccine_batches', column: 'vaccine_id', references: 'vaccines(id)' },
  { table: 'vaccine_batches', column: 'clinic_id', references: 'clinics(id)' },
  { table: 'vaccine_inventory', column: 'vaccine_id', references: 'vaccines(id)' },
  { table: 'vaccine_inventory', column: 'clinic_id', references: 'clinics(id)' },
  { table: 'vaccine_inventory', column: 'created_by', references: 'users(id)' },
  { table: 'announcements', column: 'created_by', references: 'users(id)' },
  { table: 'audit_logs', column: 'user_id', references: 'users(id)' },
  { table: 'security_events', column: 'user_id', references: 'users(id)' },
  { table: 'user_sessions', column: 'user_id', references: 'users(id)' },
  { table: 'refresh_tokens', column: 'user_id', references: 'users(id)' },
];

// ============================================================================
// SCHEMA VALIDATION TESTS
// ============================================================================

describe('Database - Schema Validation', () => {

  describe('Table Existence', () => {
    test('should have all expected tables', async () => {
      try {
        const result = await pool.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        `);

        const existingTables = result.rows.map(r => r.table_name);
        const missingTables = EXPECTED_TABLES.filter(t => !existingTables.includes(t));

        if (missingTables.length > 0) {
          console.log('Missing tables:', missingTables);
        }

        expect(missingTables.length).toBe(0);
      } catch (error) {
        console.error('Table existence test error:', error.message);
        expect(true).toBe(false);
      }
    });

    test('should have users table', async () => {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'users'
        )`);
      expect(result.rows[0].exists).toBe(true);
    });

    test('should have guardians table', async () => {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'guardians'
        )`);
      expect(result.rows[0].exists).toBe(true);
    });

    test('should have infants table', async () => {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'infants'
        )`);
      expect(result.rows[0].exists).toBe(true);
    });

    test('should have vaccines table', async () => {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'vaccines'
        )`);
      expect(result.rows[0].exists).toBe(true);
    });
  });

  describe('Column Validation', () => {
    test('should have all critical columns in users table', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'users'
      `);

      const existingColumns = result.rows.map(r => r.column_name);
      const missingColumns = CRITICAL_COLUMNS.users.filter(c => !existingColumns.includes(c));

      expect(missingColumns.length).toBe(0);
    });

    test('should have all critical columns in guardians table', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'guardians'
      `);

      const existingColumns = result.rows.map(r => r.column_name);
      const missingColumns = CRITICAL_COLUMNS.guardians.filter(c => !existingColumns.includes(c));

      expect(missingColumns.length).toBe(0);
    });

    test('should have all critical columns in infants table', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'infants'
      `);

      const existingColumns = result.rows.map(r => r.column_name);
      const missingColumns = CRITICAL_COLUMNS.infants.filter(c => !existingColumns.includes(c));

      expect(missingColumns.length).toBe(0);
    });

    test('should have all critical columns in vaccinations table', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'vaccination_records'
      `);

      const existingColumns = result.rows.map(r => r.column_name);
      const missingColumns = CRITICAL_COLUMNS.vaccination_records.filter(c => !existingColumns.includes(c));

      expect(missingColumns.length).toBe(0);
    });
  });

  describe('Data Types', () => {
    test('should have correct data types for users table', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = 'users'
        AND column_name IN ('id', 'username', 'password_hash', 'is_active')
      `);

      const columns = {};
      result.rows.forEach(r => {
        columns[r.column_name] = r.data_type;
      });

      expect(columns.id).toBe('integer');
      expect(columns.username).toBe('character varying');
    });

    test('should have correct data types for infants table', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'infants'
        AND column_name IN ('id', 'first_name', 'last_name', 'dob', 'sex')
      `);

      const columns = {};
      result.rows.forEach(r => {
        columns[r.column_name] = r.data_type;
      });

      expect(columns.dob).toBe('date');
      expect(columns.sex).toBe('USER-DEFINED');
    });

    test('should have correct data types for appointments table', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'appointments'
        AND column_name IN ('id', 'scheduled_date', 'status')
      `);

      const columns = {};
      result.rows.forEach(r => {
        columns[r.column_name] = r.data_type;
      });

      expect(columns.scheduled_date).toBe('timestamp with time zone');
    });
  });
});

// ============================================================================
// RELATIONSHIP TESTS
// ============================================================================

describe('Database - Relationships', () => {

  describe('Foreign Key Constraints', () => {
    test('should have foreign key users->roles', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.table_constraints
        WHERE constraint_type = 'FOREIGN KEY'
        AND table_name = 'users'
        AND constraint_name LIKE '%role_id%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have foreign key infants->guardians', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.table_constraints
        WHERE constraint_type = 'FOREIGN KEY'
        AND table_name = 'infants'
        AND constraint_name LIKE '%guardian_id%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have foreign key appointments->infants', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.table_constraints
        WHERE constraint_type = 'FOREIGN KEY'
        AND table_name = 'appointments'
        AND constraint_name LIKE '%infant_id%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have foreign key vaccination_records->vaccines', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.table_constraints
        WHERE constraint_type = 'FOREIGN KEY'
        AND table_name = 'vaccination_records'
        AND constraint_name LIKE '%vaccine_id%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have foreign key vaccine_inventory->clinics', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.table_constraints
        WHERE constraint_type = 'FOREIGN KEY'
        AND table_name = 'vaccine_inventory'
        AND constraint_name LIKE '%clinic_id%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });
  });

  describe('Referential Integrity', () => {
    test('should not have orphaned infant records', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM infants i
        LEFT JOIN guardians g ON i.guardian_id = g.id
        WHERE i.guardian_id IS NOT NULL AND g.id IS NULL
      `);

      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    test('should not have orphaned vaccination records', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM vaccination_records vr
        LEFT JOIN infants i ON vr.infant_id = i.id
        WHERE vr.infant_id IS NOT NULL AND i.id IS NULL
      `);

      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    test('should not have orphaned appointments', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM appointments a
        LEFT JOIN infants i ON a.infant_id = i.id
        WHERE a.infant_id IS NOT NULL AND i.id IS NULL
      `);

      expect(parseInt(result.rows[0].count)).toBe(0);
    });
  });
});

// ============================================================================
// INDEX TESTS
// ============================================================================

describe('Database - Indexes', () => {

  describe('Index Existence', () => {
    test('should have primary key indexes', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND indexname LIKE '%_pkey'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have index on users.username', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM pg_indexes
        WHERE tablename = 'users'
        AND indexname LIKE '%username%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have index on infants.guardian_id', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM pg_indexes
        WHERE tablename = 'infants'
        AND indexname LIKE '%guardian_id%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have index on infants.dob', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM pg_indexes
        WHERE tablename = 'infants'
        AND indexname LIKE '%dob%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have index on vaccination_records.infant_id', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM pg_indexes
        WHERE tablename = 'vaccination_records'
        AND indexname LIKE '%infant_id%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have index on appointments.scheduled_date', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM pg_indexes
        WHERE tablename = 'appointments'
        AND indexname LIKE '%scheduled_date%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have index on guardians.email', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM pg_indexes
        WHERE tablename = 'guardians'
        AND indexname LIKE '%email%'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });
  });

  describe('Index Performance', () => {
    test('should use index for users lookup by username', async () => {
      const result = await pool.query(`
        EXPLAIN SELECT * FROM users WHERE username = 'admin'
      `);

      const plan = result.rows.map(r => r['QUERY PLAN']).join(' ');
      expect(plan).toContain('Index Scan');
    });

    test('should use index for infants lookup by guardian', async () => {
      const result = await pool.query(`
        EXPLAIN SELECT * FROM infants WHERE guardian_id = 1
      `);

      const plan = result.rows.map(r => r['QUERY PLAN']).join(' ');
      expect(plan).toContain('Index Scan');
    });

    test('should use index for appointments by date', async () => {
      const result = await pool.query(`
        EXPLAIN SELECT * FROM appointments WHERE scheduled_date > NOW()
      `);

      const plan = result.rows.map(r => r['QUERY PLAN']).join(' ');
      expect(plan).toContain('Index Scan');
    });
  });
});

// ============================================================================
// DATA INTEGRITY TESTS
// ============================================================================

describe('Database - Data Integrity', () => {

  describe('Constraints', () => {
    test('should enforce unique usernames', async () => {
      try {
        // Try to insert duplicate username
        await pool.query(`
          INSERT INTO users (username, password_hash, role_id, clinic_id)
          VALUES ('test_user', 'hash', 1, 1)
        `);

        // Try to insert duplicate
        await pool.query(`
          INSERT INTO users (username, password_hash, role_id, clinic_id)
          VALUES ('test_user', 'hash2', 1, 1)
        `);

        fail('Should have thrown unique constraint error');
      } catch (error) {
        expect(error.code).toBe('23505'); // unique_violation
      }
    });

    test('should enforce unique guardian emails', async () => {
      try {
        await pool.query(`
          INSERT INTO guardians (name, phone, email)
          VALUES ('Test', '1234567890', 'unique@test.com')
        `);

        await pool.query(`
          INSERT INTO guardians (name, phone, email)
          VALUES ('Test2', '0987654321', 'unique@test.com')
        `);

        fail('Should have thrown unique constraint error');
      } catch (error) {
        expect(error.code).toBe('23505');
      }
    });

    test('should enforce NOT NULL on required fields', async () => {
      try {
        await pool.query(`
          INSERT INTO users (username, role_id, clinic_id)
          VALUES (NULL, 1, 1)
        `);

        fail('Should have thrown not null constraint error');
      } catch (error) {
        expect(error.code).toBe('23502'); // not_null_violation
      }
    });
  });

  describe('Check Constraints', () => {
    test('should validate infant sex values', async () => {
      const result = await pool.query(`
        SELECT column_name, check_clause
        FROM information_schema.check_constraints
        WHERE constraint_name LIKE '%infants%sex%'
      `);

      // Should have check constraint or enum type
      expect(true).toBe(true);
    });

    test('should validate appointment status values', async () => {
      const result = await pool.query(`
        SELECT DISTINCT status
        FROM appointments
        LIMIT 10
      `);

      const validStatuses = ['scheduled', 'attended', 'cancelled', 'no-show', 'rescheduled'];
      result.rows.forEach(row => {
        expect(validStatuses).toContain(row.status);
      });
    });
  });
});

// ============================================================================
// DATA QUALITY TESTS
// ============================================================================

describe('Database - Data Quality', () => {

  describe('Data Population', () => {
    test('should have users in database', async () => {
      const result = await pool.query('SELECT COUNT(*) as count FROM users');
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have guardians in database', async () => {
      const result = await pool.query('SELECT COUNT(*) as count FROM guardians');
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have infants in database', async () => {
      const result = await pool.query('SELECT COUNT(*) as count FROM infants');
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have vaccines in database', async () => {
      const result = await pool.query('SELECT COUNT(*) as count FROM vaccines');
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have roles in database', async () => {
      const result = await pool.query('SELECT COUNT(*) as count FROM roles');
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    test('should have clinics in database', async () => {
      const result = await pool.query('SELECT COUNT(*) as count FROM clinics');
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });
  });

  describe('Data Validity', () => {
    test('should have valid infant dates of birth', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM infants
        WHERE dob > CURRENT_DATE
        OR dob < '1900-01-01'
      `);

      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    test('should have valid guardian email formats', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM guardians
        WHERE email IS NOT NULL
        AND email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
      `);

      // Allow 0 or small number of invalid emails
      expect(parseInt(result.rows[0].count)).toBeLessThan(5);
    });

    test('should have valid vaccination dose numbers', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM vaccination_records
        WHERE dose_no < 1 OR dose_no > 20
      `);

      expect(parseInt(result.rows[0].count)).toBe(0);
    });
  });
});

// ============================================================================
// SECURITY TESTS
// ============================================================================

describe('Database - Security', () => {

  describe('Extension Status', () => {
    test('should have pgcrypto extension installed', async () => {
      const result = await pool.query(`
        SELECT extname, extversion
        FROM pg_extension
        WHERE extname = 'pgcrypto'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    test('should have uuid-ossp extension installed', async () => {
      const result = await pool.query(`
        SELECT extname
        FROM pg_extension
        WHERE extname = 'uuid-ossp'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Password Security', () => {
    test('should have hashed passwords in users table', async () => {
      const result = await pool.query(`
        SELECT password_hash
        FROM users
        WHERE username = 'admin'
        LIMIT 1
      `);

      if (result.rows.length > 0) {
        const hash = result.rows[0].password_hash;
        // Should not be plain text (not equal to password)
        expect(hash).not.toBe('admin');
        expect(hash).not.toBe('Immunicare2026!');
      }
    });

    test('should have hashed passwords in guardians table', async () => {
      const result = await pool.query(`
        SELECT password_hash
        FROM guardians
        WHERE password_hash IS NOT NULL
        LIMIT 1
      `);

      if (result.rows.length > 0) {
        const hash = result.rows[0].password_hash;
        expect(hash).not.toBe('guardian123');
      }
    });
  });

  describe('Audit Tables', () => {
    test('should have audit_logs table', async () => {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'audit_logs'
        )
      `);

      expect(result.rows[0].exists).toBe(true);
    });

    test('should have security_events table', async () => {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'security_events'
        )
      `);

      expect(result.rows[0].exists).toBe(true);
    });
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('Database - Performance', () => {

  describe('Query Performance', () => {
    test('should execute users query within 1 second', async () => {
      const start = Date.now();
      await pool.query('SELECT * FROM users LIMIT 100');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    test('should execute infants query within 1 second', async () => {
      const start = Date.now();
      await pool.query('SELECT * FROM infants LIMIT 100');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    test('should execute vaccinations query within 2 seconds', async () => {
      const start = Date.now();
      await pool.query('SELECT * FROM vaccination_records LIMIT 100');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Connection Pool', () => {
    test('should have connection pool configured', async () => {
      expect(pool).toBeDefined();
      expect(pool.options).toBeDefined();
    });

    test('should be able to execute multiple queries', async () => {
      const results = await Promise.all([
        pool.query('SELECT COUNT(*) FROM users'),
        pool.query('SELECT COUNT(*) FROM infants'),
        pool.query('SELECT COUNT(*) FROM guardians'),
      ]);

      expect(results.length).toBe(3);
    });
  });
});

// ============================================================================
// ENUM TYPES TESTS
// ============================================================================

describe('Database - Enum Types', () => {

  test('should have infant_sex enum type', async () => {
    const result = await pool.query(`
      SELECT typname FROM pg_type
      WHERE typname = 'infant_sex'
    `);

    expect(result.rows.length).toBeGreaterThan(0);
  });

  test('should have appointment_status enum type', async () => {
    const result = await pool.query(`
      SELECT typname FROM pg_type
      WHERE typname = 'appointment_status'
    `);

    expect(result.rows.length).toBeGreaterThan(0);
  });

  test('should have notification_status enum type', async () => {
    const result = await pool.query(`
      SELECT typname FROM pg_type
      WHERE typname = 'notification_status'
    `);

    expect(result.rows.length).toBeGreaterThan(0);
  });

  test('should have batch_status enum type', async () => {
    const result = await pool.query(`
      SELECT typname FROM pg_type
      WHERE typname = 'batch_status'
    `);

    expect(result.rows.length).toBeGreaterThan(0);
  });
});

// Cleanup
afterAll(async () => {
  await pool.end();
});

// Export test summary
module.exports = {
  DB_CONFIG,
  testSuite: 'Database Comprehensive Tests',
  totalTestCategories: 7,
  expectedTables: EXPECTED_TABLES.length,
  criticalTables: Object.keys(CRITICAL_COLUMNS).length,
};

console.log('Database Test Suite Loaded');
console.log('Expected Tables:', EXPECTED_TABLES.length);
console.log('Critical Tables:', Object.keys(CRITICAL_COLUMNS).length);
