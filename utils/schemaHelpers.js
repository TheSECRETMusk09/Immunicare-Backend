/**
 * Schema Helpers - Dynamic schema resolution utilities
 * 
 * Handles database schema variations (e.g., infant_id vs patient_id)
 * to ensure compatibility across different deployment configurations.
 */

const db = require('../db');

// Cache for resolved schema information
const schemaCache = {
  patientColumn: null,
  patientScopeColumns: null,
  systemAccountTable: null,
  authSchemaCompatibility: null,
  lastChecked: null,
  cacheDuration: 3600000, // 1 hour in milliseconds
};

/**
 * Resolve the patient/infant column name in appointments table
 * Supports both 'infant_id' and 'patient_id' column names
 * 
 * @returns {Promise<string>} - Column name ('infant_id' or 'patient_id')
 */
const resolvePatientColumn = async () => {
  // Return cached value if still valid
  const now = Date.now();
  if (schemaCache.patientColumn && schemaCache.lastChecked) {
    if (now - schemaCache.lastChecked < schemaCache.cacheDuration) {
      return schemaCache.patientColumn;
    }
  }

  try {
    const result = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
        AND table_name = 'appointments' 
        AND column_name IN ('infant_id', 'patient_id')
      ORDER BY 
        CASE column_name 
          WHEN 'patient_id' THEN 1 
          WHEN 'infant_id' THEN 2 
        END
      LIMIT 1
    `);

    const columnName = result.rows[0]?.column_name || 'infant_id';
    
    // Update cache
    schemaCache.patientColumn = columnName;
    schemaCache.lastChecked = now;
    
    return columnName;
  } catch (error) {
    console.error('Error resolving patient column:', error);
    // Fall back to infant_id on error
    return 'infant_id';
  }
};

/**
 * Get the corresponding patients/infants table name
 * 
 * @returns {Promise<string>} - Table name ('infants' or 'patients')
 */
const resolvePatientTable = async () => {
  const column = await resolvePatientColumn();
  return column === 'patient_id' ? 'patients' : 'infants';
};

/**
 * Resolve which scope columns exist on the active patient table.
 *
 * Supports schemas that expose either `facility_id`, `clinic_id`, or both.
 *
 * @returns {Promise<Set<string>>}
 */
const resolvePatientScopeColumns = async () => {
  const now = Date.now();
  if (schemaCache.patientScopeColumns && schemaCache.lastChecked) {
    if (now - schemaCache.lastChecked < schemaCache.cacheDuration) {
      return schemaCache.patientScopeColumns;
    }
  }

  try {
    const patientTable = await resolvePatientTable();
    const result = await db.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name IN ('facility_id', 'clinic_id')
      `,
      [patientTable],
    );

    const availableColumns = new Set((result.rows || []).map((row) => row.column_name));
    schemaCache.patientScopeColumns = availableColumns;
    schemaCache.lastChecked = now;
    return availableColumns;
  } catch (error) {
    console.error('Error resolving patient scope columns:', error);
    return new Set();
  }
};

/**
 * Build a schema-safe patient scope expression for SQL filters.
 *
 * @param {string} alias - SQL table alias for the patient table
 * @returns {Promise<string|null>}
 */
const resolvePatientScopeExpression = async (alias = 'p') => {
  const columns = await resolvePatientScopeColumns();

  if (columns.has('facility_id') && columns.has('clinic_id')) {
    return `COALESCE(${alias}.facility_id, ${alias}.clinic_id)`;
  }

  if (columns.has('facility_id')) {
    return `${alias}.facility_id`;
  }

  if (columns.has('clinic_id')) {
    return `${alias}.clinic_id`;
  }

  return null;
};

/**
 * Build a JOIN clause for appointments with patients/infants
 * 
 * @param {string} appointmentAlias - Alias for appointments table (default: 'a')
 * @param {string} patientAlias - Alias for patients/infants table (default: 'i')
 * @returns {Promise<string>} - JOIN clause
 */
const buildAppointmentPatientJoin = async (appointmentAlias = 'a', patientAlias = 'i') => {
  const patientColumn = await resolvePatientColumn();
  const patientTable = await resolvePatientTable();
  
  return `JOIN ${patientTable} ${patientAlias} ON ${appointmentAlias}.${patientColumn} = ${patientAlias}.id`;
};

/**
 * Build a WHERE clause for filtering appointments by patient/infant ID
 * 
 * @param {string} appointmentAlias - Alias for appointments table (default: 'a')
 * @param {string} parameterIndex - Parameter index for prepared statement (default: '$1')
 * @returns {Promise<string>} - WHERE clause fragment
 */
const buildAppointmentPatientFilter = async (appointmentAlias = 'a', parameterIndex = '$1') => {
  const patientColumn = await resolvePatientColumn();
  return `${appointmentAlias}.${patientColumn} = ${parameterIndex}`;
};

/**
 * Clear the schema cache (useful for testing or after schema changes)
 */
const clearSchemaCache = () => {
  schemaCache.patientColumn = null;
  schemaCache.patientScopeColumns = null;
  schemaCache.systemAccountTable = null;
  schemaCache.authSchemaCompatibility = null;
  schemaCache.lastChecked = null;
};

const resolveSystemAccountTable = async () => {
  const now = Date.now();
  if (schemaCache.systemAccountTable && schemaCache.lastChecked) {
    if (now - schemaCache.lastChecked < schemaCache.cacheDuration) {
      return schemaCache.systemAccountTable;
    }
  }

  try {
    const result = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('users', 'admin')
      ORDER BY CASE table_name
        WHEN 'users' THEN 1
        WHEN 'admin' THEN 2
      END
      LIMIT 1
    `);

    const tableName = result.rows[0]?.table_name || null;
    schemaCache.systemAccountTable = tableName;
    schemaCache.lastChecked = now;
    return tableName;
  } catch (error) {
    console.error('Error resolving system account table:', error);
    return null;
  }
};

const resolveAuthSchemaCompatibility = async () => {
  const now = Date.now();
  if (schemaCache.authSchemaCompatibility && schemaCache.lastChecked) {
    if (now - schemaCache.lastChecked < schemaCache.cacheDuration) {
      return schemaCache.authSchemaCompatibility;
    }
  }

  const accountTable = await resolveSystemAccountTable();

  let compatibility;
  if (accountTable === 'users') {
    compatibility = {
      compatible: true,
      accountTable,
      reason: null,
    };
  } else if (accountTable === 'admin') {
    compatibility = {
      compatible: false,
      accountTable,
      reason:
        'Legacy admin-only account schema detected. This backend deployment expects a users table for guardian authentication and account linkage.',
    };
  } else {
    compatibility = {
      compatible: false,
      accountTable: null,
      reason:
        'No supported account table was found in the active schema. Expected users for the current backend.',
    };
  }

  schemaCache.authSchemaCompatibility = compatibility;
  schemaCache.lastChecked = now;
  return compatibility;
};

module.exports = {
  resolvePatientColumn,
  resolvePatientTable,
  resolvePatientScopeExpression,
  buildAppointmentPatientJoin,
  buildAppointmentPatientFilter,
  resolveSystemAccountTable,
  resolveAuthSchemaCompatibility,
  clearSchemaCache,
};
