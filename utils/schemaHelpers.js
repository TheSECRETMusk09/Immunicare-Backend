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
  schemaCache.lastChecked = null;
};

module.exports = {
  resolvePatientColumn,
  resolvePatientTable,
  buildAppointmentPatientJoin,
  buildAppointmentPatientFilter,
  clearSchemaCache,
};
