const db = require('../db');

const schemaCache = {
  patientColumn: null,
  patientTable: null,
  patientScopeColumns: null,
  systemAccountTable: null,
  authSchemaCompatibility: null,
  lastChecked: null,
  cacheDuration: 3600000,
};

const resolvePatientColumn = async () => {
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

    schemaCache.patientColumn = columnName;
    schemaCache.lastChecked = now;

    return columnName;
  } catch (error) {
    console.error('Error resolving patient column:', error);
    return 'infant_id';
  }
};

const resolvePatientTable = async () => {
  const now = Date.now();
  if (schemaCache.patientTable && schemaCache.lastChecked) {
    if (now - schemaCache.lastChecked < schemaCache.cacheDuration) {
      return schemaCache.patientTable;
    }
  }

  const column = await resolvePatientColumn();

  try {
    const result = await db.query(
      `
        SELECT ccu.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'appointments'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = $1
          AND ccu.table_name IN ('patients', 'infants')
        ORDER BY CASE ccu.table_name
          WHEN 'patients' THEN 1
          WHEN 'infants' THEN 2
        END
        LIMIT 1
      `,
      [column],
    );

    const tableName = result.rows[0]?.table_name || 'patients';

    schemaCache.patientTable = tableName;
    schemaCache.lastChecked = now;
    return tableName;
  } catch (error) {
    console.error('Error resolving patient table:', error);
    return 'patients';
  }
};

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

const buildAppointmentPatientJoin = async (appointmentAlias = 'a', patientAlias = 'i') => {
  const patientColumn = await resolvePatientColumn();
  const patientTable = await resolvePatientTable();

  return `JOIN ${patientTable} ${patientAlias} ON ${appointmentAlias}.${patientColumn} = ${patientAlias}.id`;
};

const buildAppointmentPatientFilter = async (appointmentAlias = 'a', parameterIndex = '$1') => {
  const patientColumn = await resolvePatientColumn();
  return `${appointmentAlias}.${patientColumn} = ${parameterIndex}`;
};

const clearSchemaCache = () => {
  schemaCache.patientColumn = null;
  schemaCache.patientTable = null;
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
