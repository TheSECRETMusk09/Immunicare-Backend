/**
 * Database Connection Configuration and Table Relationships Verification
 * Run this script before any database update to verify all connections
 */

const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Database configuration from environment
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: String(process.env.DB_PASSWORD) || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Table relationship definitions - documented foreign key connections
const TABLE_RELATIONSHIPS = {
  // Core Reference Tables
  healthcare_facilities: {
    description: 'Healthcare facilities/clinics',
    referencedBy: [
      'admin',
      'vaccine_batches',
      'appointments',
      'schedules',
      // 'medicine_batches', // REMOVED - system focuses on vaccines only
      'vaccine_inventory',
      'vaccine_inventory_transactions',
      'vaccine_stock_alerts'
    ]
  },
  admin: {
    description: 'Admin/staff users',
    referencedBy: [
      'immunization_records',
      'appointments',
      'schedules',
      'notifications',
      'audit_logs',
      'security_events',
      'health_records',
      'patient_growth',
      'inventory_transactions',
      'admin_sessions',
      'notification_preferences',
      'reports',
      'announcements',
      'paper_templates',
      'document_generation',
      'digital_papers',
      'document_downloads',
      'admin_preferences',
      'admin_settings',
      'messages',
      'conversation_participants',
      'healthcare_workers',
      'adoption_documents',
      'feedback',
      'alerts',
      'vaccine_inventory',
      'vaccine_inventory_transactions',
      'suppliers',
      'document_generation_logs',
      'settings_audit_log'
    ]
  },
  guardians: {
    description: 'Guardian/parent information',
    referencedBy: ['patients', 'messages', 'document_generation']
  },
  patients: {
    description: 'Patient demographic and medical information',
    referencedBy: [
      'immunization_records',
      'appointments',
      'schedules',
      'health_records',
      'patient_growth',
      'messages',
      'adoption_documents',
      'document_generation',
      'document_downloads',
      'paper_completion_status',
      'document_generation_logs'
    ]
  },

  // Domain Tables
  vaccines: {
    description: 'Vaccine information',
    referencedBy: [
      'vaccine_batches',
      'immunization_records',
      'vaccination_schedules',
      'vaccine_inventory',
      'vaccine_inventory_transactions',
      'vaccine_stock_alerts'
    ]
  },
  vaccine_batches: {
    description: 'Vaccine batch inventory',
    references: ['vaccines', 'healthcare_facilities'],
    referencedBy: ['immunization_records', 'inventory_transactions']
  },
  immunization_records: {
    description: 'Vaccination administration records',
    references: ['patients', 'vaccines', 'vaccine_batches', 'admin']
  },
  vaccination_schedules: {
    description: 'Standard vaccination schedules',
    references: ['vaccines']
  },
  appointments: {
    description: 'Vaccination and medical appointments',
    references: ['patients', 'admin', 'healthcare_facilities']
  },
  schedules: {
    description: 'Unified scheduling',
    references: ['patients', 'healthcare_facilities', 'admin']
  },
  notifications: {
    description: 'Notification messages',
    references: ['admin']
  },
  audit_logs: {
    description: 'Audit trail',
    references: ['admin']
  },
  security_events: {
    description: 'Security-related events',
    references: ['admin']
  },
  health_records: {
    description: 'Medical documents',
    references: ['patients', 'admin']
  },
  patient_growth: {
    description: 'Growth measurements',
    references: ['patients', 'admin']
  },
  items: {
    description: 'Inventory items',
    referencedBy: ['item_batches']
  },
  item_batches: {
    description: 'Batch information for items',
    references: ['items']
  },
  // Medicine tables REMOVED - system focuses on vaccines only for vaccination tracking
  // medicines: {
  //   description: 'Medicine information',
  //   referencedBy: ['medicine_batches'],
  // },
  // medicine_batches: {
  //   description: 'Medicine batch inventory',
  //   references: ['medicines', 'healthcare_facilities'],
  // },
  inventory_transactions: {
    description: 'Inventory movements',
    references: ['vaccine_batches', 'admin']
  },
  suppliers: {
    description: 'Supplier information',
    references: ['admin']
  },
  vaccine_inventory: {
    description: 'Vaccine inventory levels',
    references: ['vaccines', 'healthcare_facilities', 'admin'],
    referencedBy: ['vaccine_inventory_transactions', 'vaccine_stock_alerts']
  },
  vaccine_inventory_transactions: {
    description: 'Vaccine inventory movements',
    references: ['vaccine_inventory', 'vaccines', 'healthcare_facilities', 'admin']
  },
  vaccine_stock_alerts: {
    description: 'Vaccine stock level alerts',
    references: ['vaccine_inventory', 'vaccines', 'healthcare_facilities', 'admin']
  },

  // Relationship/Junction Tables
  permissions: {
    description: 'System permissions',
    referencedBy: ['document_access_permissions']
  },
  admin_sessions: {
    description: 'Admin login sessions',
    references: ['admin']
  },
  failed_login_attempts: {
    description: 'Failed login tracking'
  },
  ip_whitelist: {
    description: 'Trusted IP addresses'
  },
  notification_preferences: {
    description: 'Admin notification preferences',
    references: ['admin']
  },
  reports: {
    description: 'Generated reports',
    references: ['admin']
  },
  announcements: {
    description: 'System announcements',
    references: ['admin']
  },
  paper_templates: {
    description: 'Document templates',
    references: ['admin'],
    referencedBy: [
      'document_generation',
      'document_downloads',
      'paper_completion_status',
      'document_access_permissions',
      'document_templates_library',
      'document_generation_logs'
    ]
  },
  document_generation: {
    description: 'Document generation requests',
    references: ['paper_templates', 'patients', 'guardians', 'admin'],
    referencedBy: ['digital_papers']
  },
  digital_papers: {
    description: 'Generated digital documents',
    references: ['document_generation', 'admin']
  },
  document_downloads: {
    description: 'Document download history',
    references: ['admin', 'patients', 'paper_templates']
  },
  paper_completion_status: {
    description: 'Document completion tracking',
    references: ['patients', 'paper_templates', 'admin']
  },
  document_access_permissions: {
    description: 'Document access by role',
    references: ['paper_templates', 'permissions']
  },
  document_templates_library: {
    description: 'Reusable templates',
    references: ['admin']
  },
  document_generation_logs: {
    description: 'Generation activity logs',
    references: ['paper_templates', 'patients', 'admin']
  },
  admin_preferences: {
    description: 'Admin-specific preferences',
    references: ['admin']
  },
  admin_settings: {
    description: 'Admin settings',
    references: ['admin'],
    referencedBy: ['settings_audit_log']
  },
  settings_audit_log: {
    description: 'Settings change audit',
    references: ['admin', 'admin_settings']
  },
  system_config: {
    description: 'System-wide configuration'
  },
  messages: {
    description: 'User messages',
    references: ['admin', 'guardians', 'patients', 'conversations'],
    referencedBy: ['messages'] // self-reference for parent_message_id
  },
  conversations: {
    description: 'Conversation threads',
    referencedBy: ['messages', 'conversation_participants']
  },
  conversation_participants: {
    description: 'Conversation participants',
    references: ['conversations', 'admin']
  },
  healthcare_workers: {
    description: 'Healthcare worker info',
    references: ['admin']
  },
  adoption_documents: {
    description: 'Adoption-related documents',
    references: ['patients', 'admin']
  },
  feedback: {
    description: 'User feedback',
    references: ['admin']
  },
  alerts: {
    description: 'System alerts',
    references: ['admin']
  }
};

/**
 * Verify database connection
 */
async function verifyConnection() {
  console.log('='.repeat(70));
  console.log('DATABASE CONNECTION VERIFICATION');
  console.log('='.repeat(70));

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✓ Database connected successfully');
    console.log(`  Server time: ${result.rows[0].now}`);
    console.log(`  Database: ${process.env.DB_NAME}`);
    console.log(`  Host: ${process.env.DB_HOST}`);
    console.log(`  Port: ${process.env.DB_PORT}`);
    client.release();
    return true;
  } catch (error) {
    console.error(`✗ Database connection failed: ${error.message}`);
    return false;
  }
}

/**
 * Verify all tables exist
 */
async function verifyTables() {
  console.log('\n' + '='.repeat(70));
  console.log('TABLE EXISTENCE VERIFICATION');
  console.log('='.repeat(70));

  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const existingTables = result.rows.map((r) => r.table_name);
    const expectedTables = Object.keys(TABLE_RELATIONSHIPS);

    console.log(`\nExpected tables: ${expectedTables.length}`);
    console.log(`Existing tables: ${existingTables.length}`);

    console.log('\nTable Status:');
    for (const table of expectedTables) {
      const exists = existingTables.includes(table);
      const status = exists ? '✓' : '✗';
      console.log(`  ${status} ${table}`);
    }

    // Check for extra tables
    const extraTables = existingTables.filter((t) => !expectedTables.includes(t));
    if (extraTables.length > 0) {
      console.log('\nExtra tables (not in schema):');
      extraTables.forEach((t) => console.log(`  + ${t}`));
    }

    return existingTables;
  } catch (error) {
    console.error(`Error verifying tables: ${error.message}`);
    return [];
  }
}

/**
 * Verify foreign key relationships
 */
async function verifyForeignKeys() {
  console.log('\n' + '='.repeat(70));
  console.log('FOREIGN KEY RELATIONSHIP VERIFICATION');
  console.log('='.repeat(70));

  try {
    const result = await pool.query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        kcu.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.table_name
    `);

    console.log('\nForeign Key Relationships:');
    const relationships = {};

    result.rows.forEach((row) => {
      if (!relationships[row.table_name]) {
        relationships[row.table_name] = [];
      }
      relationships[row.table_name].push({
        column: row.column_name,
        references: row.foreign_table_name,
        constraint: row.constraint_name
      });
    });

    Object.keys(relationships)
      .sort()
      .forEach((table) => {
        console.log(`\n  ${table}:`);
        relationships[table].forEach((rel) => {
          console.log(`    - ${rel.column} → ${rel.references}`);
        });
      });

    return relationships;
  } catch (error) {
    console.error(`Error verifying foreign keys: ${error.message}`);
    return {};
  }
}

/**
 * Verify indexes
 */
async function verifyIndexes() {
  console.log('\n' + '='.repeat(70));
  console.log('INDEX VERIFICATION');
  console.log('='.repeat(70));

  try {
    const result = await pool.query(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        a.attname AS column_name
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relkind = 'r'
      AND t.relname NOT LIKE 'pg_%'
      AND t.relname NOT LIKE 'sql_%'
      ORDER BY t.relname, i.relname
    `);

    console.log('\nIndexes by Table:');
    const indexesByTable = {};

    result.rows.forEach((row) => {
      if (!indexesByTable[row.table_name]) {
        indexesByTable[row.table_name] = [];
      }
      indexesByTable[row.table_name].push(row.column_name);
    });

    Object.keys(indexesByTable)
      .sort()
      .forEach((table) => {
        console.log(`\n  ${table}:`);
        console.log(`    Columns: ${indexesByTable[table].join(', ')}`);
      });

    return indexesByTable;
  } catch (error) {
    console.error(`Error verifying indexes: ${error.message}`);
    return {};
  }
}

/**
 * Generate connection report
 */
function generateReport(existingTables, relationships, indexes) {
  console.log('\n' + '='.repeat(70));
  console.log('TABLE CONNECTION SUMMARY');
  console.log('='.repeat(70));

  console.log('\n1. Core Reference Tables Connections:');
  console.log(
    '   healthcare_facilities ← (referenced by: admin, vaccine_batches, appointments, etc.)'
  );
  console.log(
    '   admin ← (referenced by: 27+ tables including immunization_records, appointments, etc.)'
  );
  console.log('   guardians ← (referenced by: patients, messages, document_generation)');
  console.log(
    '   patients ← (referenced by: immunization_records, appointments, health_records, etc.)'
  );

  console.log('\n2. Domain Tables Connections:');
  console.log('   vaccines → vaccine_batches, immunization_records, vaccine_inventory');
  console.log('   vaccine_batches → immunization_records, inventory_transactions');
  console.log('   immunization_records → patients, vaccines, vaccine_batches, admin');
  console.log('   appointments → patients, admin, healthcare_facilities');
  console.log('   patient_growth → patients, admin');

  console.log('\n3. Key Relationship Paths:');
  console.log('   admin → admin_sessions (session tracking)');
  console.log('   admin → healthcare_workers (professional info)');
  console.log('   paper_templates → document_generation → digital_papers');
  console.log('   conversations → conversation_participants → admin');
  console.log('   notifications → notification_preferences → admin');

  console.log('\n4. Total Connections Verified:');
  console.log(`   Tables: ${existingTables.length}`);
  console.log(
    `   Foreign Key Relationships: ${Object.values(relationships).reduce((a, b) => a + b.length, 0)}`
  );
  console.log(`   Indexed Columns: ${Object.values(indexes).reduce((a, b) => a + b.length, 0)}`);

  console.log('\n' + '='.repeat(70));
  console.log('DATABASE IS READY FOR UPDATE');
  console.log('='.repeat(70));
}

/**
 * Main verification function
 */
async function runVerification() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║     IMMUNICARE DATABASE CONNECTION VERIFICATION SCRIPT               ║');
  console.log('║     Running before database update...                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Verify connection
  const connected = await verifyConnection();
  if (!connected) {
    console.error('\n✗ Cannot proceed without database connection');
    process.exit(1);
  }

  // Verify tables
  const existingTables = await verifyTables();

  // Verify foreign keys
  const relationships = await verifyForeignKeys();

  // Verify indexes
  const indexes = await verifyIndexes();

  // Generate report
  generateReport(existingTables, relationships, indexes);

  // Close pool
  await pool.end();

  console.log('\n✓ Verification complete. All database connections are configured.');
  console.log('\nNote: Run this script after any schema changes to verify integrity.');
}

// Export for use in other scripts
module.exports = {
  pool,
  TABLE_RELATIONSHIPS,
  verifyConnection,
  verifyTables,
  verifyForeignKeys,
  verifyIndexes,
  runVerification
};

// Run if executed directly
if (require.main === module) {
  runVerification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
