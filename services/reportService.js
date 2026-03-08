const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const pool = require('../db');

const REPORT_TYPES = Object.freeze([
  'vaccination',
  'inventory',
  'appointment',
  'guardian',
  'infant',
  'system',
  'barangay',
  'compliance',
  'healthcenter',
  'consolidated',
]);

const REPORT_FORMATS = Object.freeze(['pdf', 'excel', 'csv']);

const FORMAT_ALIASES = Object.freeze({
  pdf: 'pdf',
  csv: 'csv',
  excel: 'excel',
  xlsx: 'excel',
});

const FILE_EXTENSION_BY_FORMAT = Object.freeze({
  pdf: 'pdf',
  csv: 'csv',
  excel: 'xlsx',
});

const MIME_TYPE_BY_FORMAT = Object.freeze({
  pdf: 'application/pdf',
  csv: 'text/csv',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

const REPORT_TITLES = Object.freeze({
  vaccination: 'Vaccination Report',
  inventory: 'Inventory Report',
  appointment: 'Appointment Report',
  guardian: 'Guardian Report',
  infant: 'Infant Health Report',
  system: 'System Report',
  barangay: 'Barangay Health Report',
  compliance: 'Compliance Report',
  healthcenter: 'Health Center Report',
  consolidated: 'Consolidated Report',
});

const REPORT_DESCRIPTIONS = Object.freeze({
  vaccination: 'Comprehensive vaccination administration and compliance report',
  inventory: 'Vaccine inventory tracking report with stock movement and threshold context',
  appointment: 'Appointment scheduling and attendance analysis',
  guardian: 'Guardian registration and engagement statistics',
  infant: 'Infant health monitoring and vaccination status',
  system: 'System users and operational export',
  barangay: 'Barangay-level health statistics',
  compliance: 'Vaccination compliance and coverage analysis',
  healthcenter: 'Health center user-level reporting export',
  consolidated: 'All-in-one comprehensive report composed from selected modules',
});

const REPORT_HEADERS = Object.freeze({
  vaccination: [
    'Child Name',
    'Vaccine',
    'Dose',
    'Date Administered',
    'Next Due Date',
    'Status',
  ],
  appointment: ['Infant', 'Guardian', 'Date & Time', 'Type', 'Status'],
  inventory: [
    'A',
    'Items',
    'Beginning Balance',
    'Received',
    'Lot Batch Number',
    'Stock Movement In Out',
    'Expired Wasted',
    'Total Available',
    'Issued',
    'Stock On Hand',
  ],
  guardian: [
    'Name',
    'Phone',
    'Email',
    'Relationship',
    'Infants',
    'Password Status',
    'Address',
  ],
  system: ['Username', 'Role', 'Password', 'Clinic', 'Contact', 'Status'],
  healthcenter: ['Username', 'Role', 'Password', 'Clinic', 'Contact', 'Status'],
  infant: [
    'Infant Name',
    'Date of Birth',
    'Sex',
    'Guardian',
    'Vaccination Status',
    'Last Vaccination Date',
  ],
  barangay: [
    'Barangay',
    'Infants',
    'Guardians',
    'Vaccinations',
    'Coverage Percent',
    'Appointments',
  ],
  compliance: ['Vaccine', 'Target Group', 'Due', 'Completed', 'Overdue', 'Compliance Percent'],
});

const TEMPLATE_DEFINITIONS = Object.freeze([
  {
    type: 'vaccination',
    name: 'Vaccination Report',
    description: 'Comprehensive vaccination administration and compliance report',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
      { name: 'vaccineType', type: 'string', required: false, label: 'Vaccine Type' },
      { name: 'status', type: 'string', required: false, label: 'Status' },
      { name: 'barangay', type: 'string', required: false, label: 'Barangay' },
      { name: 'ageGroup', type: 'string', required: false, label: 'Age Group' },
    ],
  },
  {
    type: 'inventory',
    name: 'Inventory Report',
    description: 'Vaccine and supply inventory report',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
      { name: 'itemType', type: 'string', required: false, label: 'Item Type' },
      { name: 'lowStockOnly', type: 'boolean', required: false, label: 'Low Stock Only' },
      { name: 'category', type: 'string', required: false, label: 'Category' },
    ],
  },
  {
    type: 'appointment',
    name: 'Appointment Report',
    description: 'Appointment scheduling and attendance analysis',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
      { name: 'status', type: 'string', required: false, label: 'Status' },
      { name: 'type', type: 'string', required: false, label: 'Appointment Type' },
      { name: 'healthCenter', type: 'string', required: false, label: 'Health Center' },
    ],
  },
  {
    type: 'guardian',
    name: 'Guardian Report',
    description: 'Guardian registration and engagement statistics',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
      { name: 'barangay', type: 'string', required: false, label: 'Barangay' },
      { name: 'status', type: 'string', required: false, label: 'Status' },
    ],
  },
  {
    type: 'infant',
    name: 'Infant Health Report',
    description: 'Infant health monitoring and vaccination status',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
      { name: 'ageGroup', type: 'string', required: false, label: 'Age Group' },
      {
        name: 'vaccinationStatus',
        type: 'string',
        required: false,
        label: 'Vaccination Status',
      },
      { name: 'barangay', type: 'string', required: false, label: 'Barangay' },
    ],
  },
  {
    type: 'system',
    name: 'System Report',
    description: 'System usage and user export report',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
    ],
  },
  {
    type: 'barangay',
    name: 'Barangay Health Report',
    description: 'Comprehensive report for barangay health statistics',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
      { name: 'barangay', type: 'string', required: false, label: 'Barangay' },
    ],
  },
  {
    type: 'compliance',
    name: 'Compliance Report',
    description: 'Vaccination compliance and coverage by target group',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
      { name: 'vaccineType', type: 'string', required: false, label: 'Vaccine Type' },
      { name: 'targetGroup', type: 'string', required: false, label: 'Target Group' },
    ],
  },
  {
    type: 'healthcenter',
    name: 'Health Center Report',
    description: 'Health center user-level export report',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
      { name: 'healthCenter', type: 'string', required: false, label: 'Health Center' },
    ],
  },
  {
    type: 'consolidated',
    name: 'Consolidated Report',
    description: 'All-in-one comprehensive report with all data modules',
    availableFormats: ['pdf', 'excel', 'csv'],
    filters: [
      { name: 'startDate', type: 'date', required: false, label: 'Start Date' },
      { name: 'endDate', type: 'date', required: false, label: 'End Date' },
      {
        name: 'includeVaccination',
        type: 'boolean',
        required: false,
        label: 'Include Vaccination Data',
      },
      {
        name: 'includeInventory',
        type: 'boolean',
        required: false,
        label: 'Include Inventory Data',
      },
      {
        name: 'includeAppointments',
        type: 'boolean',
        required: false,
        label: 'Include Appointments Data',
      },
      {
        name: 'includeGuardians',
        type: 'boolean',
        required: false,
        label: 'Include Guardians Data',
      },
      {
        name: 'includeInfants',
        type: 'boolean',
        required: false,
        label: 'Include Infants Data',
      },
    ],
  },
]);

class ReportService {
  constructor(options = {}) {
    this.pool = options.pool || pool;
    this.reportDir =
      options.reportDir || path.join(__dirname, '..', 'uploads', 'reports');
    this.schemaCache = {
      columns: new Map(),
      tables: new Map(),
    };
  }

  createHttpError(message, statusCode = 400, code = 'REPORT_VALIDATION_ERROR') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
  }

  getReportTypes() {
    return [...REPORT_TYPES];
  }

  getReportFormats() {
    return [...REPORT_FORMATS];
  }

  getReportTemplates() {
    return TEMPLATE_DEFINITIONS.map((template) => ({ ...template }));
  }

  normalizeReportType(value) {
    const normalized = this.sanitizeFilterText(value, 50).toLowerCase();
    return REPORT_TYPES.includes(normalized) ? normalized : null;
  }

  normalizeReportFormat(value) {
    const normalized = this.sanitizeFilterText(value, 20).toLowerCase();
    return FORMAT_ALIASES[normalized] || null;
  }

  sanitizeFilterText(value, maxLength = 120) {
    if (value === undefined || value === null) {
      return '';
    }

    return String(value)
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, maxLength);
  }

  normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value === 1;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }

    return fallback;
  }

  normalizeAgeGroup(value) {
    const normalized = this.sanitizeFilterText(value, 40).toLowerCase();
    const map = {
      '0-6 months': '0_6_months',
      '0_6_months': '0_6_months',
      '6-12 months': '6_12_months',
      '6_12_months': '6_12_months',
      '1-2 years': '1_2_years',
      '1_2_years': '1_2_years',
      '2-5 years': '2_5_years',
      '2_5_years': '2_5_years',
      '5+ years': '5_plus_years',
      '5_plus_years': '5_plus_years',
    };
    return map[normalized] || '';
  }

  normalizeVaccinationStatus(value) {
    const normalized = this.sanitizeFilterText(value, 40).toLowerCase();
    const map = {
      up_to_date: 'up_to_date',
      'up to date': 'up_to_date',
      completed: 'up_to_date',
      partially_vaccinated: 'partially_vaccinated',
      partial: 'partially_vaccinated',
      not_vaccinated: 'not_vaccinated',
      none: 'not_vaccinated',
      overdue: 'overdue',
    };
    return map[normalized] || '';
  }

  normalizeDateInput(value, fieldName) {
    const text = this.sanitizeFilterText(value, 32);
    if (!text) {
      return '';
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      throw this.createHttpError(`${fieldName} is invalid.`, 400, 'REPORT_INVALID_DATE');
    }

    return date.toISOString().slice(0, 10);
  }

  normalizeReportFilters(reportType, rawFilters = {}) {
    const startDate = this.normalizeDateInput(rawFilters.startDate, 'Start date');
    const endDate = this.normalizeDateInput(rawFilters.endDate, 'End date');

    if (startDate && endDate && endDate < startDate) {
      throw this.createHttpError(
        'End date cannot be earlier than start date.',
        400,
        'REPORT_INVALID_DATE_RANGE',
      );
    }

    const normalized = {
      startDate,
      endDate,
      userId: Number.isInteger(Number(rawFilters.userId))
        ? Number(rawFilters.userId)
        : null,
    };

    switch (reportType) {
    case 'vaccination':
      normalized.vaccineType = this.sanitizeFilterText(rawFilters.vaccineType, 100);
      normalized.status = this.sanitizeFilterText(rawFilters.status, 40).toLowerCase();
      normalized.barangay = this.sanitizeFilterText(rawFilters.barangay, 120);
      normalized.ageGroup = this.normalizeAgeGroup(rawFilters.ageGroup);
      break;
    case 'inventory':
      normalized.itemType = this.sanitizeFilterText(rawFilters.itemType, 50).toLowerCase();
      normalized.lowStockOnly = this.normalizeBoolean(rawFilters.lowStockOnly, false);
      normalized.category = this.sanitizeFilterText(rawFilters.category, 100);
      break;
    case 'appointment':
      normalized.status = this.sanitizeFilterText(rawFilters.status, 40).toLowerCase();
      normalized.type = this.sanitizeFilterText(rawFilters.type, 80);
      normalized.healthCenter = this.sanitizeFilterText(rawFilters.healthCenter, 120);
      break;
    case 'guardian':
      normalized.barangay = this.sanitizeFilterText(rawFilters.barangay, 120);
      normalized.status = this.sanitizeFilterText(rawFilters.status, 40).toLowerCase();
      break;
    case 'infant':
      normalized.ageGroup = this.normalizeAgeGroup(rawFilters.ageGroup);
      normalized.vaccinationStatus = this.normalizeVaccinationStatus(
        rawFilters.vaccinationStatus,
      );
      normalized.barangay = this.sanitizeFilterText(rawFilters.barangay, 120);
      break;
    case 'barangay':
      normalized.barangay = this.sanitizeFilterText(rawFilters.barangay, 120);
      break;
    case 'compliance':
      normalized.vaccineType = this.sanitizeFilterText(rawFilters.vaccineType, 100);
      normalized.targetGroup = this.normalizeAgeGroup(rawFilters.targetGroup);
      break;
    case 'healthcenter':
      normalized.healthCenter = this.sanitizeFilterText(rawFilters.healthCenter, 120);
      break;
    case 'consolidated':
      normalized.includeVaccination = this.normalizeBoolean(
        rawFilters.includeVaccination,
        true,
      );
      normalized.includeInventory = this.normalizeBoolean(rawFilters.includeInventory, true);
      normalized.includeAppointments = this.normalizeBoolean(
        rawFilters.includeAppointments,
        true,
      );
      normalized.includeGuardians = this.normalizeBoolean(rawFilters.includeGuardians, true);
      normalized.includeInfants = this.normalizeBoolean(rawFilters.includeInfants, true);
      break;
    default:
      break;
    }

    return normalized;
  }

  async ensureReportDirectory() {
    await fs.mkdir(this.reportDir, { recursive: true });
  }

  async hasColumn(tableName, columnName) {
    const key = `${tableName}:${columnName}`;
    if (this.schemaCache.columns.has(key)) {
      return this.schemaCache.columns.get(key);
    }

    const result = await this.pool.query(
      `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        LIMIT 1
      `,
      [tableName, columnName],
    );

    const exists = result.rows.length > 0;
    this.schemaCache.columns.set(key, exists);
    return exists;
  }

  async resolveFirstExistingColumn(tableName, candidates, fallback = null) {
    for (const candidate of candidates) {

      const exists = await this.hasColumn(tableName, candidate);
      if (exists) {
        return candidate;
      }
    }
    return fallback;
  }

  async resolveFirstExistingTable(candidates, fallback = null) {
    const key = candidates.join('|');
    if (this.schemaCache.tables.has(key)) {
      return this.schemaCache.tables.get(key);
    }

    const result = await this.pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [candidates],
    );

    const available = new Set(result.rows.map((row) => row.table_name));
    const resolved = candidates.find((table) => available.has(table)) || fallback;
    this.schemaCache.tables.set(key, resolved);
    return resolved;
  }

  async getPatientsTableName() {
    return this.resolveFirstExistingTable(['patients', 'infants'], null);
  }

  async getUsersTableName() {
    return this.resolveFirstExistingTable(['users', 'admin'], null);
  }

  async getRolesTableName() {
    return this.resolveFirstExistingTable(['roles'], null);
  }

  async getClinicsTableName() {
    return this.resolveFirstExistingTable(['clinics', 'healthcare_facilities'], null);
  }

  async getAppointmentsPatientColumn() {
    return this.resolveFirstExistingColumn(
      'appointments',
      ['patient_id', 'infant_id'],
      null,
    );
  }

  async getAppointmentsDateColumn() {
    return this.resolveFirstExistingColumn(
      'appointments',
      ['scheduled_date', 'appointment_date'],
      null,
    );
  }

  async getAppointmentsTypeColumn() {
    return this.resolveFirstExistingColumn('appointments', ['type', 'appointment_type'], 'type');
  }

  async getAppointmentsFacilityColumn() {
    return this.resolveFirstExistingColumn('appointments', ['clinic_id', 'facility_id'], null);
  }

  async getInventoryFacilityColumn() {
    return this.resolveFirstExistingColumn(
      'vaccine_inventory',
      ['clinic_id', 'facility_id'],
      null,
    );
  }

  ensureResolvedSchemaValue(value, message) {
    if (!value) {
      throw this.createHttpError(
        message,
        500,
        'REPORT_SCHEMA_MISMATCH',
      );
    }

    return value;
  }

  async getStatusExpressionForImmunizationRecords(alias = 'ir') {
    const hasStatus = await this.hasColumn('immunization_records', 'status');
    if (hasStatus) {
      return `COALESCE(${alias}.status::text, CASE WHEN ${alias}.admin_date IS NOT NULL THEN 'completed' ELSE 'pending' END)`;
    }

    return `CASE WHEN ${alias}.admin_date IS NOT NULL THEN 'completed' ELSE 'pending' END`;
  }

  buildAgeMonthsCondition(tableAlias, ageGroup) {
    if (!ageGroup) {
      return '';
    }

    const ageMonthsExpression = `(
      EXTRACT(YEAR FROM AGE(CURRENT_DATE, ${tableAlias}.dob)) * 12
      + EXTRACT(MONTH FROM AGE(CURRENT_DATE, ${tableAlias}.dob))
    )`;

    switch (ageGroup) {
    case '0_6_months':
      return `${ageMonthsExpression} BETWEEN 0 AND 6`;
    case '6_12_months':
      return `${ageMonthsExpression} BETWEEN 6 AND 12`;
    case '1_2_years':
      return `${ageMonthsExpression} BETWEEN 12 AND 24`;
    case '2_5_years':
      return `${ageMonthsExpression} BETWEEN 24 AND 60`;
    case '5_plus_years':
      return `${ageMonthsExpression} > 60`;
    default:
      return '';
    }
  }

  getReportTitle(reportType) {
    return REPORT_TITLES[reportType] || 'Report';
  }

  getReportDescription(reportType) {
    return REPORT_DESCRIPTIONS[reportType] || 'System report';
  }

  getHeadersForReportType(reportType) {
    return REPORT_HEADERS[reportType] ? [...REPORT_HEADERS[reportType]] : [];
  }

  formatFilenameTimestamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
  }

  buildFilename(reportType, format, generatedAt = new Date()) {
    const safeType = reportType.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const extension = FILE_EXTENSION_BY_FORMAT[format] || format;
    const timestamp = this.formatFilenameTimestamp(generatedAt);
    return `${safeType}-report-${timestamp}.${extension}`;
  }

  getMimeType(format) {
    return MIME_TYPE_BY_FORMAT[format] || 'application/octet-stream';
  }

  toInteger(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  formatNullableDate(value) {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toISOString().slice(0, 10);
  }

  buildDisplayFilters(filters = {}) {
    return Object.entries(filters).reduce((accumulator, [key, value]) => {
      if (key === 'userId') {
        return accumulator;
      }

      if (value === undefined || value === null || value === '') {
        return accumulator;
      }

      accumulator[key] = value;
      return accumulator;
    }, {});
  }

  buildInventoryMovementLabel(row = {}) {
    const inValue = this.toInteger(row.transferred_in, 0);
    const outValue = this.toInteger(row.transferred_out, 0);
    const markers = [];

    if (row.critical_stock_breach) {
      markers.push('CRITICAL');
    } else if (row.low_stock_breach) {
      markers.push('LOW');
    }

    if (row.expiry_risk) {
      markers.push('EXPIRY_RISK');
    }

    return `${inValue}/${outValue}${markers.length > 0 ? ` (${markers.join(', ')})` : ''}`;
  }

  mapRowForExport(reportType, row, index = 0) {
    switch (reportType) {
    case 'vaccination':
      return [
        row.child_name || '',
        row.vaccine || '',
        this.toInteger(row.dose, 0),
        this.formatNullableDate(row.date_administered),
        this.formatNullableDate(row.next_due_date),
        row.status || '',
      ];
    case 'appointment':
      return [
        row.infant || '',
        row.guardian || '',
        row.date_time ? new Date(row.date_time).toISOString() : '',
        row.type || '',
        row.status || '',
      ];
    case 'inventory':
      return [
        this.toInteger(row.a, index + 1),
        row.items || '',
        this.toInteger(row.beginning_balance, 0),
        this.toInteger(row.received, 0),
        row.lot_batch_number || '',
        this.buildInventoryMovementLabel(row),
        this.toInteger(row.expired_wasted, 0),
        this.toInteger(row.total_available, 0),
        this.toInteger(row.issued, 0),
        this.toInteger(row.stock_on_hand, 0),
      ];
    case 'guardian':
      return [
        row.name || '',
        row.phone || '',
        row.email || '',
        row.relationship || '',
        this.toInteger(row.infants, 0),
        row.password_status || '',
        row.address || '',
      ];
    case 'system':
    case 'healthcenter':
      return [
        row.username || '',
        row.role || '',
        row.password || 'Protected',
        row.clinic || '',
        row.contact || '',
        row.status || '',
      ];
    case 'infant':
      return [
        row.infant_name || '',
        this.formatNullableDate(row.date_of_birth),
        row.sex || '',
        row.guardian || '',
        row.vaccination_status || '',
        this.formatNullableDate(row.last_vaccination_date),
      ];
    case 'barangay':
      return [
        row.barangay || '',
        this.toInteger(row.infants, 0),
        this.toInteger(row.guardians, 0),
        this.toInteger(row.vaccinations, 0),
        Number(row.coverage_percent || 0).toFixed(2),
        this.toInteger(row.appointments, 0),
      ];
    case 'compliance':
      return [
        row.vaccine || '',
        row.target_group || '',
        this.toInteger(row.due, 0),
        this.toInteger(row.completed, 0),
        this.toInteger(row.overdue, 0),
        Number(row.compliance_percent || 0).toFixed(2),
      ];
    default:
      return Object.values(row || {});
    }
  }

  buildReportSummary(reportType, rows = []) {
    const totalRows = rows.length;

    switch (reportType) {
    case 'vaccination': {
      const completed = rows.filter((row) => String(row.status || '').toLowerCase() === 'completed')
        .length;
      const pending = rows.filter((row) => String(row.status || '').toLowerCase() === 'pending').length;
      return { totalRows, completed, pending };
    }
    case 'inventory': {
      const lowStockItems = rows.filter((row) => row.low_stock_breach).length;
      const criticalStockItems = rows.filter((row) => row.critical_stock_breach).length;
      return { totalRows, lowStockItems, criticalStockItems };
    }
    case 'appointment': {
      const completed = rows.filter((row) => String(row.status || '').toLowerCase() === 'attended')
        .length;
      const cancelled = rows.filter((row) => String(row.status || '').toLowerCase() === 'cancelled')
        .length;
      return { totalRows, completed, cancelled };
    }
    case 'guardian': {
      const active = rows.filter((row) => String(row.status || '').toLowerCase() === 'active').length;
      return { totalRows, active };
    }
    case 'infant': {
      const upToDate = rows.filter(
        (row) => String(row.vaccination_status || '').toLowerCase() === 'up to date',
      ).length;
      return { totalRows, upToDate };
    }
    case 'barangay': {
      const totalVaccinations = rows.reduce(
        (accumulator, row) => accumulator + this.toInteger(row.vaccinations, 0),
        0,
      );
      return { totalRows, totalVaccinations };
    }
    case 'compliance': {
      const averageCompliance =
        totalRows === 0
          ? 0
          : rows.reduce(
            (accumulator, row) => accumulator + this.toNumber(row.compliance_percent, 0),
            0,
          ) / totalRows;
      return { totalRows, averageCompliance: Number(averageCompliance.toFixed(2)) };
    }
    default:
      return { totalRows };
    }
  }

  buildConsolidatedSummary(sections = []) {
    return {
      sections: sections.length,
      totalRows: sections.reduce((sum, section) => sum + section.rows.length, 0),
      sectionNames: sections.map((section) => section.sectionTitle),
    };
  }

  async generateReport(reportType, filters = {}, format = 'pdf', userId = null) {
    const normalizedType = this.normalizeReportType(reportType);
    if (!normalizedType) {
      throw this.createHttpError(
        `Invalid report type. Allowed values: ${REPORT_TYPES.join(', ')}`,
        400,
        'REPORT_INVALID_TYPE',
      );
    }

    const normalizedFormat = this.normalizeReportFormat(format);
    if (!normalizedFormat) {
      throw this.createHttpError(
        `Invalid report format. Allowed values: ${REPORT_FORMATS.join(', ')}`,
        400,
        'REPORT_INVALID_FORMAT',
      );
    }

    const normalizedFilters = this.normalizeReportFilters(normalizedType, {
      ...(filters || {}),
      userId: userId || filters.userId,
    });

    await this.ensureReportDirectory();

    const reportData = await this.getReportData(normalizedType, normalizedFilters);
    const hasRows = Array.isArray(reportData.rows) && reportData.rows.length > 0;
    const hasSections =
      Array.isArray(reportData.sections) &&
      reportData.sections.some((section) => Array.isArray(section.rows) && section.rows.length > 0);

    if (!hasRows && !hasSections) {
      throw this.createHttpError(
        'No data found for selected filters. Please adjust filter criteria and try again.',
        400,
        'REPORT_EMPTY_DATASET',
      );
    }

    const generatedAt = new Date();
    const filename = this.buildFilename(normalizedType, normalizedFormat, generatedAt);
    const filePath = path.join(this.reportDir, filename);
    const buffer = await this.buildReportBuffer(reportData, normalizedFormat);

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw this.createHttpError(
        'Failed to generate report file content.',
        500,
        'REPORT_FILE_GENERATION_FAILED',
      );
    }

    await fs.writeFile(filePath, buffer);
    const fileStats = await fs.stat(filePath);

    try {
      const savedReport = await this.saveReportToDatabase({
        type: normalizedType,
        title: this.getReportTitle(normalizedType),
        description: this.getReportDescription(normalizedType),
        parameters: this.buildDisplayFilters(normalizedFilters),
        file_path: filePath,
        file_format: normalizedFormat,
        file_size: this.toInteger(fileStats.size, buffer.length),
        generated_by: normalizedFilters.userId || null,
        date_generated: generatedAt,
        status: 'completed',
      });

      return savedReport;
    } catch (error) {
      await fs.unlink(filePath).catch(() => {});
      throw error;
    }
  }

  async buildReportBuffer(reportData, format) {
    switch (format) {
    case 'csv':
      return this.buildCsvBuffer(reportData);
    case 'excel':
      return this.buildExcelBuffer(reportData);
    case 'pdf':
      return this.buildPdfBuffer(reportData);
    default:
      throw this.createHttpError(
        `Unsupported output format: ${format}`,
        400,
        'REPORT_UNSUPPORTED_FORMAT',
      );
    }
  }

  escapeCsvCell(value) {
    const text = value === undefined || value === null ? '' : String(value);
    const escaped = text.replace(/"/g, '""');
    if (/[",\n\r]/.test(escaped)) {
      return `"${escaped}"`;
    }
    return escaped;
  }

  buildCsvRow(values = []) {
    return values.map((value) => this.escapeCsvCell(value)).join(',');
  }

  buildCsvBuffer(reportData) {
    const lines = [];
    lines.push(this.buildCsvRow(['Title', reportData.title]));
    lines.push(this.buildCsvRow(['Generated At', reportData.generatedAt.toISOString()]));
    lines.push('');

    if (reportData.sections && reportData.sections.length > 0) {
      for (const section of reportData.sections) {
        lines.push(this.buildCsvRow([section.sectionTitle]));
        lines.push(this.buildCsvRow(section.headers));

        section.rows.forEach((row, rowIndex) => {
          lines.push(this.buildCsvRow(this.mapRowForExport(section.reportType, row, rowIndex)));
        });

        lines.push('');
      }
    } else {
      lines.push(this.buildCsvRow(reportData.headers));
      reportData.rows.forEach((row, rowIndex) => {
        lines.push(this.buildCsvRow(this.mapRowForExport(reportData.reportType, row, rowIndex)));
      });
    }

    return Buffer.from(lines.join('\n'), 'utf8');
  }

  buildSheetName(rawName, fallback = 'Report') {
    const cleaned = String(rawName || fallback)
      .replace(/[\\/?*\[\]:]/g, ' ')
      .trim();

    if (!cleaned) {
      return fallback;
    }

    return cleaned.slice(0, 31);
  }

  populateWorksheet({ worksheet, title, generatedAt, headers, reportType, rows }) {
    worksheet.addRow([title]);
    worksheet.addRow([`Generated: ${generatedAt.toISOString()}`]);
    worksheet.addRow([]);

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };

    rows.forEach((row, index) => {
      worksheet.addRow(this.mapRowForExport(reportType, row, index));
    });

    worksheet.columns.forEach((column) => {
      column.width = Math.min(Math.max((column.header || '').length + 4, 14), 42);
    });
  }

  async buildExcelBuffer(reportData) {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.creator = 'Immunicare';

    if (reportData.sections && reportData.sections.length > 0) {
      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.addRow([reportData.title]);
      summarySheet.addRow([`Generated: ${reportData.generatedAt.toISOString()}`]);
      summarySheet.addRow([]);
      summarySheet.addRow(['Section', 'Rows']);
      reportData.sections.forEach((section) => {
        summarySheet.addRow([section.sectionTitle, section.rows.length]);
      });

      reportData.sections.forEach((section, index) => {
        const worksheet = workbook.addWorksheet(
          this.buildSheetName(section.sectionTitle, `Section ${index + 1}`),
        );
        this.populateWorksheet({
          worksheet,
          title: section.sectionTitle,
          generatedAt: reportData.generatedAt,
          headers: section.headers,
          reportType: section.reportType,
          rows: section.rows,
        });
      });
    } else {
      const worksheet = workbook.addWorksheet(this.buildSheetName(reportData.title, 'Report Data'));
      this.populateWorksheet({
        worksheet,
        title: reportData.title,
        generatedAt: reportData.generatedAt,
        headers: reportData.headers,
        reportType: reportData.reportType,
        rows: reportData.rows,
      });
    }

    const output = await workbook.xlsx.writeBuffer();
    return Buffer.from(output);
  }

  normalizePdfCell(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return text.replace(/\s+/g, ' ').trim();
  }

  writePdfSection({ doc, title, headers, reportType, rows }) {
    if (doc.y > doc.page.height - 100) {
      doc.addPage();
    }

    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('black').text(title);
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(9).text(headers.join(' | '));
    doc.moveDown(0.1);
    doc.font('Helvetica').fontSize(9);

    rows.forEach((row, index) => {
      if (doc.y > doc.page.height - 60) {
        doc.addPage();
      }

      const line = this.mapRowForExport(reportType, row, index)
        .map((cell) => this.normalizePdfCell(cell))
        .join(' | ')
        .slice(0, 320);

      doc.text(line);
    });
  }

  buildPdfBuffer(reportData) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const doc = new PDFDocument({ size: 'A4', margin: 40 });

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (error) => reject(error));

      doc.font('Helvetica-Bold').fontSize(18).text(reportData.title);
      doc.moveDown(0.2);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('gray')
        .text(`Generated: ${reportData.generatedAt.toISOString()}`);

      if (reportData.summary && Object.keys(reportData.summary).length > 0) {
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text('Summary');
        doc.font('Helvetica').fontSize(10);
        Object.entries(reportData.summary).forEach(([key, value]) => {
          doc.text(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
        });
      }

      if (reportData.sections && reportData.sections.length > 0) {
        reportData.sections.forEach((section) => {
          this.writePdfSection({
            doc,
            title: section.sectionTitle,
            headers: section.headers,
            reportType: section.reportType,
            rows: section.rows,
          });
        });
      } else {
        this.writePdfSection({
          doc,
          title: 'Details',
          headers: reportData.headers,
          reportType: reportData.reportType,
          rows: reportData.rows,
        });
      }

      doc.end();
    });
  }

  async saveReportToDatabase(reportData) {
    const hasFileSize = await this.hasColumn('reports', 'file_size');
    const hasGeneratedBy = await this.hasColumn('reports', 'generated_by');
    const hasDateGenerated = await this.hasColumn('reports', 'date_generated');

    const columns = ['type', 'title', 'description', 'parameters', 'file_path', 'file_format', 'status'];
    const values = [
      reportData.type,
      reportData.title,
      reportData.description,
      reportData.parameters || {},
      reportData.file_path,
      reportData.file_format,
      reportData.status || 'completed',
    ];

    if (hasGeneratedBy) {
      columns.push('generated_by');
      values.push(reportData.generated_by || null);
    }

    if (hasDateGenerated) {
      columns.push('date_generated');
      values.push(reportData.date_generated || new Date());
    }

    if (hasFileSize) {
      columns.push('file_size');
      values.push(this.toInteger(reportData.file_size, 0));
    }

    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

    const executeInsert = async (insertValues) => {
      const insertQuery = `
        INSERT INTO reports (${columns.join(', ')})
        VALUES (${placeholders})
        RETURNING *
      `;
      const result = await this.pool.query(insertQuery, insertValues);
      return result.rows[0];
    };

    try {
      return await executeInsert(values);
    } catch (error) {
      if (error.code === '23503' && hasGeneratedBy) {
        const generatedByIndex = columns.indexOf('generated_by');
        if (generatedByIndex >= 0) {
          const retryValues = [...values];
          retryValues[generatedByIndex] = null;
          return executeInsert(retryValues);
        }
      }
      throw error;
    }
  }

  async getReportHistory(filters = {}) {
    const normalizedType = filters.type
      ? this.normalizeReportType(filters.type)
      : null;

    if (filters.type && !normalizedType) {
      throw this.createHttpError(
        `Invalid report type filter. Allowed values: ${REPORT_TYPES.join(', ')}`,
        400,
        'REPORT_INVALID_TYPE_FILTER',
      );
    }

    const startDate = filters.startDate
      ? this.normalizeDateInput(filters.startDate, 'Start date')
      : '';
    const endDate = filters.endDate
      ? this.normalizeDateInput(filters.endDate, 'End date')
      : '';

    if (startDate && endDate && endDate < startDate) {
      throw this.createHttpError(
        'End date cannot be earlier than start date.',
        400,
        'REPORT_INVALID_DATE_RANGE',
      );
    }

    const limit = Math.min(Math.max(this.toInteger(filters.limit, 50), 1), 200);
    const offset = Math.max(this.toInteger(filters.offset, 0), 0);
    const generatedBy = this.toInteger(filters.generatedBy, 0) || null;
    const hasFileSize = await this.hasColumn('reports', 'file_size');

    let query = `
      SELECT
        id,
        type,
        title,
        description,
        parameters,
        file_path,
        file_format,
        status,
        generated_by,
        date_generated,
        download_count,
        error_message,
        created_at,
        updated_at
        ${hasFileSize ? ', file_size' : ''}
      FROM reports
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (normalizedType) {
      query += ` AND type = $${paramIndex}`;
      params.push(normalizedType);
      paramIndex += 1;
    }

    if (startDate) {
      query += ` AND date_generated::date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex += 1;
    }

    if (endDate) {
      query += ` AND date_generated::date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex += 1;
    }

    if (generatedBy) {
      query += ` AND generated_by = $${paramIndex}`;
      params.push(generatedBy);
      paramIndex += 1;
    }

    query += ` ORDER BY date_generated DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => ({
      ...row,
      file_size: hasFileSize ? this.toInteger(row.file_size, 0) : 0,
    }));
  }

  async getReportStatus(reportId) {
    const reportIdNumber = this.toInteger(reportId, 0);
    if (!reportIdNumber) {
      throw this.createHttpError('Invalid report ID.', 400, 'REPORT_INVALID_ID');
    }

    const result = await this.pool.query(
      `
        SELECT
          id,
          type,
          status,
          error_message,
          file_format,
          date_generated,
          download_count,
          updated_at
        FROM reports
        WHERE id = $1
        LIMIT 1
      `,
      [reportIdNumber],
    );

    if (result.rows.length === 0) {
      throw this.createHttpError('Report not found.', 404, 'REPORT_NOT_FOUND');
    }

    return result.rows[0];
  }

  async downloadReport(reportId) {
    const reportIdNumber = this.toInteger(reportId, 0);
    if (!reportIdNumber) {
      throw this.createHttpError('Invalid report ID.', 400, 'REPORT_INVALID_ID');
    }

    const result = await this.pool.query(
      `
        SELECT id, type, title, file_path, file_format, status
        FROM reports
        WHERE id = $1
        LIMIT 1
      `,
      [reportIdNumber],
    );

    if (result.rows.length === 0) {
      throw this.createHttpError('Report not found.', 404, 'REPORT_NOT_FOUND');
    }

    const report = result.rows[0];
    if (String(report.status || '').toLowerCase() !== 'completed') {
      throw this.createHttpError(
        'Report is not ready for download.',
        409,
        'REPORT_NOT_COMPLETED',
      );
    }

    const storedPath = this.sanitizeFilterText(report.file_path, 500);
    if (!storedPath) {
      throw this.createHttpError(
        'Report file path is missing.',
        500,
        'REPORT_FILE_PATH_MISSING',
      );
    }

    const absolutePath = path.isAbsolute(storedPath)
      ? storedPath
      : path.join(this.reportDir, storedPath);

    let fileStats;
    try {
      fileStats = await fs.stat(absolutePath);
    } catch (_error) {
      throw this.createHttpError('Report file not found on disk.', 404, 'REPORT_FILE_NOT_FOUND');
    }

    if (!fileStats.isFile()) {
      throw this.createHttpError('Report file is invalid.', 404, 'REPORT_FILE_INVALID');
    }

    const fileFormat = this.normalizeReportFormat(report.file_format) || 'pdf';
    const fallbackFilename = this.buildFilename(report.type || 'report', fileFormat, new Date());
    const filename = path.basename(absolutePath) || fallbackFilename;

    return {
      path: absolutePath,
      filename,
      mimeType: this.getMimeType(fileFormat),
      fileSize: fileStats.size,
    };
  }

  async getAdminSummary({ startDate = '', endDate = '' } = {}) {
    const normalizedStartDate = startDate
      ? this.normalizeDateInput(startDate, 'Start date')
      : '';
    const normalizedEndDate = endDate
      ? this.normalizeDateInput(endDate, 'End date')
      : '';

    if (normalizedStartDate && normalizedEndDate && normalizedEndDate < normalizedStartDate) {
      throw this.createHttpError(
        'End date cannot be earlier than start date.',
        400,
        'REPORT_INVALID_DATE_RANGE',
      );
    }

    const patientsTable = this.ensureResolvedSchemaValue(
      await this.getPatientsTableName(),
      'Unable to resolve patients table for report summary queries.',
    );
    const appointmentsDateColumn = this.ensureResolvedSchemaValue(
      await this.getAppointmentsDateColumn(),
      'Unable to resolve appointment date column for report summary queries.',
    );
    const statusExpression = await this.getStatusExpressionForImmunizationRecords('ir');

    const vaccinationParams = [];
    let vaccinationIndex = 1;
    let vaccinationDateCondition = '';
    if (normalizedStartDate) {
      vaccinationDateCondition += ` AND ir.admin_date::date >= $${vaccinationIndex}`;
      vaccinationParams.push(normalizedStartDate);
      vaccinationIndex += 1;
    }
    if (normalizedEndDate) {
      vaccinationDateCondition += ` AND ir.admin_date::date <= $${vaccinationIndex}`;
      vaccinationParams.push(normalizedEndDate);
      vaccinationIndex += 1;
    }

    const vaccinationSummaryQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN LOWER(${statusExpression}) = 'completed' THEN 1 END)::int AS completed,
        COUNT(CASE WHEN LOWER(${statusExpression}) = 'pending' THEN 1 END)::int AS pending,
        COUNT(CASE WHEN LOWER(${statusExpression}) = 'cancelled' THEN 1 END)::int AS cancelled
      FROM immunization_records ir
      WHERE COALESCE(ir.is_active, true) = true
      ${vaccinationDateCondition}
    `;

    const inventorySummaryQuery = `
      SELECT
        COUNT(*)::int AS total_items,
        COUNT(
          CASE
            WHEN (
              COALESCE(beginning_balance, 0)
              + COALESCE(received_during_period, 0)
              + COALESCE(transferred_in, 0)
              - COALESCE(transferred_out, 0)
              - COALESCE(expired_wasted, 0)
              - COALESCE(issuance, 0)
            ) <= COALESCE(low_stock_threshold, 10)
            THEN 1
          END
        )::int AS low_stock_items,
        (
          SELECT COUNT(*)::int
          FROM vaccine_batches vb
          WHERE vb.expiry_date < CURRENT_DATE
            AND COALESCE(vb.is_active, true) = true
        ) AS expired_items,
        0::numeric AS total_value
      FROM vaccine_inventory
    `;

    const appointmentParams = [];
    let appointmentIndex = 1;
    let appointmentDateCondition = '';
    if (normalizedStartDate) {
      appointmentDateCondition += ` AND a.${appointmentsDateColumn}::date >= $${appointmentIndex}`;
      appointmentParams.push(normalizedStartDate);
      appointmentIndex += 1;
    }
    if (normalizedEndDate) {
      appointmentDateCondition += ` AND a.${appointmentsDateColumn}::date <= $${appointmentIndex}`;
      appointmentParams.push(normalizedEndDate);
      appointmentIndex += 1;
    }

    const appointmentSummaryQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN LOWER(COALESCE(a.status::text, '')) = 'scheduled' THEN 1 END)::int AS scheduled,
        COUNT(CASE WHEN LOWER(COALESCE(a.status::text, '')) = 'attended' THEN 1 END)::int AS completed,
        COUNT(CASE WHEN LOWER(COALESCE(a.status::text, '')) = 'cancelled' THEN 1 END)::int AS cancelled,
        COUNT(
          CASE WHEN LOWER(COALESCE(a.status::text, '')) IN ('no_show', 'no-show') THEN 1 END
        )::int AS no_show
      FROM appointments a
      WHERE COALESCE(a.is_active, true) = true
      ${appointmentDateCondition}
    `;

    const guardiansDateCondition = [];
    const guardiansParams = [];
    let guardiansIndex = 1;
    if (normalizedStartDate) {
      guardiansDateCondition.push(`g.created_at::date >= $${guardiansIndex}`);
      guardiansParams.push(normalizedStartDate);
      guardiansIndex += 1;
    }
    if (normalizedEndDate) {
      guardiansDateCondition.push(`g.created_at::date <= $${guardiansIndex}`);
      guardiansParams.push(normalizedEndDate);
      guardiansIndex += 1;
    }

    const hasGuardianIsActive = await this.hasColumn('guardians', 'is_active');
    const guardianActiveExpression = hasGuardianIsActive ? 'COALESCE(g.is_active, true)' : 'true';

    const guardianSummaryQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN ${guardianActiveExpression} THEN 1 END)::int AS active,
        COUNT(CASE WHEN g.created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS new_last_30_days
      FROM guardians g
      ${
  guardiansDateCondition.length > 0
    ? `WHERE ${guardiansDateCondition.join(' AND ')}`
    : ''
}
    `;

    const infantDateConditions = [];
    const infantParams = [];
    let infantIndex = 1;
    if (normalizedStartDate) {
      infantDateConditions.push(`p.created_at::date >= $${infantIndex}`);
      infantParams.push(normalizedStartDate);
      infantIndex += 1;
    }
    if (normalizedEndDate) {
      infantDateConditions.push(`p.created_at::date <= $${infantIndex}`);
      infantParams.push(normalizedEndDate);
      infantIndex += 1;
    }

    const hasPatientIsActive = await this.hasColumn(patientsTable, 'is_active');
    const patientActiveExpression = hasPatientIsActive ? 'COALESCE(p.is_active, true)' : 'true';
    const childStatusExpression = await this.getStatusExpressionForImmunizationRecords('irx');

    const infantSummaryQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN ${patientActiveExpression} THEN 1 END)::int AS active,
        COUNT(
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM immunization_records irx
              WHERE irx.patient_id = p.id
                AND COALESCE(irx.is_active, true) = true
                AND LOWER(${childStatusExpression}) = 'completed'
            ) THEN 1
          END
        )::int AS up_to_date,
        COUNT(
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM immunization_records irx
              WHERE irx.patient_id = p.id
                AND COALESCE(irx.is_active, true) = true
            )
            AND NOT EXISTS (
              SELECT 1
              FROM immunization_records irx
              WHERE irx.patient_id = p.id
                AND COALESCE(irx.is_active, true) = true
                AND LOWER(${childStatusExpression}) = 'completed'
            ) THEN 1
          END
        )::int AS partially_vaccinated,
        COUNT(
          CASE
            WHEN NOT EXISTS (
              SELECT 1
              FROM immunization_records irx
              WHERE irx.patient_id = p.id
                AND COALESCE(irx.is_active, true) = true
            ) THEN 1
          END
        )::int AS not_vaccinated
      FROM ${patientsTable} p
      ${infantDateConditions.length > 0 ? `WHERE ${infantDateConditions.join(' AND ')}` : ''}
    `;

    const reportActivityQuery = `
      SELECT
        COUNT(*)::int AS total_reports,
        COALESCE(SUM(download_count), 0)::int AS total_downloads,
        COUNT(CASE WHEN date_generated >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS reports_last_7_days,
        COUNT(CASE WHEN date_generated >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS reports_last_30_days
      FROM reports
    `;

    const [vaccination, inventory, appointments, guardians, infants, reports] = await Promise.all([
      this.pool.query(vaccinationSummaryQuery, vaccinationParams),
      this.pool.query(inventorySummaryQuery),
      this.pool.query(appointmentSummaryQuery, appointmentParams),
      this.pool.query(guardianSummaryQuery, guardiansParams),
      this.pool.query(infantSummaryQuery, infantParams),
      this.pool.query(reportActivityQuery),
    ]);

    return {
      vaccination: vaccination.rows[0] || { total: 0, completed: 0, pending: 0, cancelled: 0 },
      inventory:
        inventory.rows[0] || { total_items: 0, low_stock_items: 0, expired_items: 0, total_value: 0 },
      appointments:
        appointments.rows[0] || {
          total: 0,
          scheduled: 0,
          completed: 0,
          cancelled: 0,
          no_show: 0,
        },
      guardians: guardians.rows[0] || { total: 0, active: 0, new_last_30_days: 0 },
      infants:
        infants.rows[0] || {
          total: 0,
          active: 0,
          up_to_date: 0,
          partially_vaccinated: 0,
          not_vaccinated: 0,
        },
      reports:
        reports.rows[0] || {
          total_reports: 0,
          total_downloads: 0,
          reports_last_7_days: 0,
          reports_last_30_days: 0,
        },
    };
  }

  async getReportData(reportType, filters) {
    const generatedAt = new Date();
    const title = this.getReportTitle(reportType);
    const description = this.getReportDescription(reportType);

    if (reportType === 'consolidated') {
      const sections = await this.queryConsolidatedSections(filters);
      return {
        reportType,
        title,
        description,
        generatedAt,
        filters: this.buildDisplayFilters(filters),
        rows: [],
        headers: [],
        sections,
        summary: this.buildConsolidatedSummary(sections),
      };
    }

    let rows = [];

    switch (reportType) {
    case 'vaccination':
      rows = await this.queryVaccinationRows(filters);
      break;
    case 'inventory':
      rows = await this.queryInventoryRows(filters);
      break;
    case 'appointment':
      rows = await this.queryAppointmentRows(filters);
      break;
    case 'guardian':
      rows = await this.queryGuardianRows(filters);
      break;
    case 'infant':
      rows = await this.queryInfantRows(filters);
      break;
    case 'system':
      rows = await this.querySystemRows(filters);
      break;
    case 'barangay':
      rows = await this.queryBarangayRows(filters);
      break;
    case 'compliance':
      rows = await this.queryComplianceRows(filters);
      break;
    case 'healthcenter':
      rows = await this.querySystemRows(filters, { isHealthcenter: true });
      break;
    default:
      throw this.createHttpError(
        `Unknown report type: ${reportType}`,
        400,
        'REPORT_UNKNOWN_TYPE',
      );
    }

    return {
      reportType,
      title,
      description,
      generatedAt,
      filters: this.buildDisplayFilters(filters),
      headers: this.getHeadersForReportType(reportType),
      rows,
      summary: this.buildReportSummary(reportType, rows),
      sections: [],
    };
  }

  async queryVaccinationRows(filters) {
    const patientsTable = this.ensureResolvedSchemaValue(
      await this.getPatientsTableName(),
      'Unable to resolve patients table for vaccination report.',
    );
    const hasBarangay = await this.hasColumn(patientsTable, 'barangay');
    const hasDob = await this.hasColumn(patientsTable, 'dob');
    const statusExpression = await this.getStatusExpressionForImmunizationRecords('ir');

    let query = `
      SELECT
        p.first_name || ' ' || p.last_name AS child_name,
        v.name AS vaccine,
        COALESCE(ir.dose_no, 0) AS dose,
        ir.admin_date AS date_administered,
        ir.next_due_date,
        ${statusExpression} AS status
      FROM immunization_records ir
      JOIN ${patientsTable} p ON p.id = ir.patient_id
      JOIN vaccines v ON v.id = ir.vaccine_id
      WHERE COALESCE(ir.is_active, true) = true
    `;

    const params = [];
    let paramIndex = 1;

    if (filters.startDate) {
      query += ` AND ir.admin_date::date >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex += 1;
    }

    if (filters.endDate) {
      query += ` AND ir.admin_date::date <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex += 1;
    }

    if (filters.vaccineType) {
      query += ` AND LOWER(v.name) LIKE $${paramIndex}`;
      params.push(`%${filters.vaccineType.toLowerCase()}%`);
      paramIndex += 1;
    }

    if (filters.status) {
      query += ` AND LOWER(${statusExpression}) = $${paramIndex}`;
      params.push(filters.status);
      paramIndex += 1;
    }

    if (filters.barangay && hasBarangay) {
      query += ` AND LOWER(COALESCE(p.barangay, '')) = $${paramIndex}`;
      params.push(filters.barangay.toLowerCase());
      paramIndex += 1;
    }

    const ageCondition = hasDob ? this.buildAgeMonthsCondition('p', filters.ageGroup) : '';
    if (ageCondition) {
      query += ` AND ${ageCondition}`;
    }

    query += ' ORDER BY ir.admin_date DESC NULLS LAST, child_name ASC';

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  async queryAppointmentRows(filters) {
    const patientsTable = this.ensureResolvedSchemaValue(
      await this.getPatientsTableName(),
      'Unable to resolve patients table for appointment report.',
    );
    const dateColumn = this.ensureResolvedSchemaValue(
      await this.getAppointmentsDateColumn(),
      'Unable to resolve appointment date column for appointment report.',
    );
    const patientColumn = this.ensureResolvedSchemaValue(
      await this.getAppointmentsPatientColumn(),
      'Unable to resolve appointment patient column for appointment report.',
    );
    const typeColumn = await this.getAppointmentsTypeColumn();
    const appointmentsFacilityColumn = await this.getAppointmentsFacilityColumn();
    const clinicsTable = await this.getClinicsTableName();
    const hasPatientHealthCenter = await this.hasColumn(patientsTable, 'health_center');

    let query = `
      SELECT
        p.first_name || ' ' || p.last_name AS infant,
        COALESCE(g.name, 'N/A') AS guardian,
        a.${dateColumn} AS date_time,
        COALESCE(a.${typeColumn}::text, 'General') AS type,
        COALESCE(a.status::text, 'scheduled') AS status
      FROM appointments a
      JOIN ${patientsTable} p ON p.id = a.${patientColumn}
      LEFT JOIN guardians g ON g.id = p.guardian_id
      ${
  appointmentsFacilityColumn && clinicsTable
    ? `LEFT JOIN ${clinicsTable} c ON c.id = a.${appointmentsFacilityColumn}`
    : ''
}
      WHERE COALESCE(a.is_active, true) = true
    `;

    const params = [];
    let paramIndex = 1;

    if (filters.startDate) {
      query += ` AND a.${dateColumn}::date >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex += 1;
    }

    if (filters.endDate) {
      query += ` AND a.${dateColumn}::date <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex += 1;
    }

    if (filters.status) {
      query += ` AND LOWER(COALESCE(a.status::text, '')) = $${paramIndex}`;
      params.push(filters.status);
      paramIndex += 1;
    }

    if (filters.type) {
      query += ` AND LOWER(COALESCE(a.${typeColumn}::text, '')) LIKE $${paramIndex}`;
      params.push(`%${filters.type.toLowerCase()}%`);
      paramIndex += 1;
    }

    if (filters.healthCenter) {
      let healthCenterFilterApplied = false;
      if (appointmentsFacilityColumn && clinicsTable) {
        query += ` AND LOWER(COALESCE(c.name, '')) LIKE $${paramIndex}`;
        healthCenterFilterApplied = true;
      } else if (hasPatientHealthCenter) {
        query += ` AND LOWER(COALESCE(p.health_center, '')) LIKE $${paramIndex}`;
        healthCenterFilterApplied = true;
      }

      if (healthCenterFilterApplied) {
        params.push(`%${filters.healthCenter.toLowerCase()}%`);
        paramIndex += 1;
      }
    }

    query += ` ORDER BY a.${dateColumn} DESC NULLS LAST, infant ASC`;
    const result = await this.pool.query(query, params);
    return result.rows;
  }

  async queryInventoryRows(filters) {
    const clinicsTable = await this.getClinicsTableName();
    const facilityColumn = await this.getInventoryFacilityColumn();

    const stockOnHandExpression = `(
      COALESCE(vi.beginning_balance, 0)
      + COALESCE(vi.received_during_period, 0)
      + COALESCE(vi.transferred_in, 0)
      - COALESCE(vi.transferred_out, 0)
      - COALESCE(vi.expired_wasted, 0)
      - COALESCE(vi.issuance, 0)
    )`;

    let query = `
      SELECT
        ROW_NUMBER() OVER (ORDER BY v.name, vi.period_start DESC) AS a,
        v.name AS items,
        COALESCE(vi.beginning_balance, 0) AS beginning_balance,
        COALESCE(vi.received_during_period, 0) AS received,
        vi.lot_batch_number,
        COALESCE(vi.transferred_in, 0) AS transferred_in,
        COALESCE(vi.transferred_out, 0) AS transferred_out,
        COALESCE(vi.expired_wasted, 0) AS expired_wasted,
        COALESCE(vi.issuance, 0) AS issued,
        (
          COALESCE(vi.beginning_balance, 0)
          + COALESCE(vi.received_during_period, 0)
        ) AS total_available,
        ${stockOnHandExpression} AS stock_on_hand,
        COALESCE(vi.low_stock_threshold, 10) AS low_stock_threshold,
        COALESCE(vi.critical_stock_threshold, 5) AS critical_stock_threshold,
        (
          ${stockOnHandExpression} <= COALESCE(vi.low_stock_threshold, 10)
        ) AS low_stock_breach,
        (
          ${stockOnHandExpression} <= COALESCE(vi.critical_stock_threshold, 5)
        ) AS critical_stock_breach,
        (
          EXISTS (
            SELECT 1
            FROM vaccine_batches vb
            WHERE vb.vaccine_id = vi.vaccine_id
              AND vb.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
              AND COALESCE(vb.is_active, true) = true
          )
        ) AS expiry_risk,
        ${facilityColumn && clinicsTable ? 'hf.name' : '\'N/A\''} AS health_center,
        vi.period_start,
        vi.period_end
      FROM vaccine_inventory vi
      JOIN vaccines v ON v.id = vi.vaccine_id
      ${
  facilityColumn && clinicsTable
    ? `LEFT JOIN ${clinicsTable} hf ON hf.id = vi.${facilityColumn}`
    : ''
}
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (filters.startDate) {
      query += ` AND vi.period_start::date >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex += 1;
    }

    if (filters.endDate) {
      query += ` AND vi.period_end::date <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex += 1;
    }

    if (filters.category) {
      query += ` AND LOWER(v.name) LIKE $${paramIndex}`;
      params.push(`%${filters.category.toLowerCase()}%`);
      paramIndex += 1;
    }

    if (filters.lowStockOnly) {
      query += ` AND ${stockOnHandExpression} <= COALESCE(vi.low_stock_threshold, 10)`;
    }

    query += ' ORDER BY v.name ASC, vi.period_start DESC';

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  async queryGuardianRows(filters) {
    const patientsTable = this.ensureResolvedSchemaValue(
      await this.getPatientsTableName(),
      'Unable to resolve patients table for guardian report.',
    );
    const hasPatientIsActive = await this.hasColumn(patientsTable, 'is_active');
    const hasPatientBarangay = await this.hasColumn(patientsTable, 'barangay');
    const hasGuardianIsActive = await this.hasColumn('guardians', 'is_active');
    const hasGuardianPasswordSet = await this.hasColumn('guardians', 'is_password_set');
    const hasGuardianPasswordHash = await this.hasColumn('guardians', 'password_hash');

    const passwordStatusExpression = hasGuardianPasswordSet
      ? `CASE WHEN COALESCE(g.is_password_set, false) = true ${
        hasGuardianPasswordHash ? 'OR g.password_hash IS NOT NULL' : ''
      } THEN 'Set' ELSE 'Not Set' END`
      : hasGuardianPasswordHash
        ? 'CASE WHEN g.password_hash IS NOT NULL THEN \'Set\' ELSE \'Not Set\' END'
        : '\'Unknown\'';

    const activeStatusExpression = hasGuardianIsActive
      ? 'CASE WHEN COALESCE(g.is_active, true) THEN \'Active\' ELSE \'Inactive\' END'
      : '\'Active\'';

    let query = `
      SELECT
        g.name,
        g.phone,
        g.email,
        g.relationship,
        g.address,
        COUNT(DISTINCT p.id)::int AS infants,
        ${passwordStatusExpression} AS password_status,
        ${activeStatusExpression} AS status
      FROM guardians g
      LEFT JOIN ${patientsTable} p
        ON p.guardian_id = g.id
        ${hasPatientIsActive ? 'AND COALESCE(p.is_active, true) = true' : ''}
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (filters.startDate) {
      query += ` AND g.created_at::date >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex += 1;
    }

    if (filters.endDate) {
      query += ` AND g.created_at::date <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex += 1;
    }

    if (filters.status && hasGuardianIsActive) {
      if (filters.status === 'active') {
        query += ' AND COALESCE(g.is_active, true) = true';
      }
      if (filters.status === 'inactive') {
        query += ' AND COALESCE(g.is_active, true) = false';
      }
    }

    if (filters.barangay && hasPatientBarangay) {
      query += ` AND LOWER(COALESCE(p.barangay, '')) = $${paramIndex}`;
      params.push(filters.barangay.toLowerCase());
      paramIndex += 1;
    }

    query += `
      GROUP BY g.id, g.name, g.phone, g.email, g.relationship, g.address
      ORDER BY g.name ASC
    `;

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  async querySystemRows(filters, options = {}) {
    const { isHealthcenter = false } = options;
    const usersTable = this.ensureResolvedSchemaValue(
      await this.getUsersTableName(),
      'Unable to resolve system users table for report generation.',
    );
    const clinicsTable = await this.getClinicsTableName();

    const hasRoleId = await this.hasColumn(usersTable, 'role_id');
    const hasClinicId = await this.hasColumn(usersTable, 'clinic_id');
    const hasFacilityId = await this.hasColumn(usersTable, 'facility_id');
    const hasHealthCenterColumn = await this.hasColumn(usersTable, 'health_center');
    const hasRoleEnum = await this.hasColumn(usersTable, 'role');
    const hasIsActive = await this.hasColumn(usersTable, 'is_active');
    const facilityColumn = hasClinicId ? 'clinic_id' : hasFacilityId ? 'facility_id' : null;
    const hasClinicJoin = Boolean(clinicsTable && facilityColumn);
    const rolesTable = hasRoleId ? await this.getRolesTableName() : null;

    let query = '';
    if (hasRoleId && rolesTable) {
      query = `
        SELECT
          u.username,
          COALESCE(r.display_name, r.name, 'System User') AS role,
          'Protected' AS password,
          ${hasClinicJoin ? 'COALESCE(c.name, \'N/A\')' : '\'N/A\''} AS clinic,
          COALESCE(u.contact, '') AS contact,
          ${
  hasIsActive
    ? 'CASE WHEN COALESCE(u.is_active, true) THEN \'Active\' ELSE \'Inactive\' END'
    : '\'Active\''
} AS status,
          u.created_at
        FROM ${usersTable} u
        LEFT JOIN ${rolesTable} r ON r.id = u.role_id
        ${hasClinicJoin ? `LEFT JOIN ${clinicsTable} c ON c.id = u.${facilityColumn}` : ''}
        WHERE 1=1
      `;
    } else {
      query = `
        SELECT
          u.username,
          ${hasRoleEnum ? 'u.role::text' : '\'System User\''} AS role,
          'Protected' AS password,
          ${hasClinicJoin ? 'COALESCE(c.name, \'N/A\')' : '\'N/A\''} AS clinic,
          COALESCE(u.contact, '') AS contact,
          ${
  hasIsActive
    ? 'CASE WHEN COALESCE(u.is_active, true) THEN \'Active\' ELSE \'Inactive\' END'
    : '\'Active\''
} AS status,
          u.created_at
        FROM ${usersTable} u
        ${hasClinicJoin ? `LEFT JOIN ${clinicsTable} c ON c.id = u.${facilityColumn}` : ''}
        WHERE 1=1
      `;
    }

    const params = [];
    let paramIndex = 1;

    if (filters.startDate) {
      query += ` AND u.created_at::date >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex += 1;
    }

    if (filters.endDate) {
      query += ` AND u.created_at::date <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex += 1;
    }

    if (filters.healthCenter || isHealthcenter) {
      if (filters.healthCenter) {
        if (hasClinicJoin) {
          query += ` AND LOWER(COALESCE(c.name, '')) LIKE $${paramIndex}`;
          params.push(`%${filters.healthCenter.toLowerCase()}%`);
          paramIndex += 1;
        } else if (hasHealthCenterColumn) {
          query += ` AND LOWER(COALESCE(u.health_center, '')) LIKE $${paramIndex}`;
          params.push(`%${filters.healthCenter.toLowerCase()}%`);
          paramIndex += 1;
        }
      }
    }

    if (filters.status && hasIsActive) {
      if (filters.status === 'active') {
        query += ' AND COALESCE(u.is_active, true) = true';
      }
      if (filters.status === 'inactive') {
        query += ' AND COALESCE(u.is_active, true) = false';
      }
    }

    query += ' ORDER BY u.username ASC';

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  computeInfantVaccinationStatus(row) {
    const total = this.toInteger(row.total_vaccinations, 0);
    const completed = this.toInteger(row.completed_vaccinations, 0);

    if (total === 0) {
      return 'Not Vaccinated';
    }

    if (completed >= total) {
      return 'Up To Date';
    }

    return 'Partially Vaccinated';
  }

  async queryInfantRows(filters) {
    const patientsTable = this.ensureResolvedSchemaValue(
      await this.getPatientsTableName(),
      'Unable to resolve patients table for infant report.',
    );
    const hasBarangay = await this.hasColumn(patientsTable, 'barangay');
    const hasDob = await this.hasColumn(patientsTable, 'dob');
    const statusExpression = await this.getStatusExpressionForImmunizationRecords('ir');

    let query = `
      SELECT
        p.id,
        p.first_name || ' ' || p.last_name AS infant_name,
        p.dob AS date_of_birth,
        p.sex,
        COALESCE(g.name, 'N/A') AS guardian,
        MAX(ir.admin_date) AS last_vaccination_date,
        COUNT(ir.id)::int AS total_vaccinations,
        COUNT(CASE WHEN LOWER(${statusExpression}) = 'completed' THEN 1 END)::int AS completed_vaccinations
      FROM ${patientsTable} p
      LEFT JOIN guardians g ON g.id = p.guardian_id
      LEFT JOIN immunization_records ir
        ON ir.patient_id = p.id
        AND COALESCE(ir.is_active, true) = true
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (filters.startDate) {
      query += ` AND p.created_at::date >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex += 1;
    }

    if (filters.endDate) {
      query += ` AND p.created_at::date <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex += 1;
    }

    if (filters.barangay && hasBarangay) {
      query += ` AND LOWER(COALESCE(p.barangay, '')) = $${paramIndex}`;
      params.push(filters.barangay.toLowerCase());
      paramIndex += 1;
    }

    const ageCondition = hasDob ? this.buildAgeMonthsCondition('p', filters.ageGroup) : '';
    if (ageCondition) {
      query += ` AND ${ageCondition}`;
    }

    query += `
      GROUP BY p.id, p.first_name, p.last_name, p.dob, p.sex, g.name
      ORDER BY infant_name ASC
    `;

    const result = await this.pool.query(query, params);
    const rows = result.rows.map((row) => ({
      ...row,
      vaccination_status: this.computeInfantVaccinationStatus(row),
    }));

    if (!filters.vaccinationStatus) {
      return rows;
    }

    return rows.filter((row) => {
      const normalized = String(row.vaccination_status || '').toLowerCase();
      if (filters.vaccinationStatus === 'up_to_date') {
        return normalized === 'up to date';
      }
      if (filters.vaccinationStatus === 'partially_vaccinated') {
        return normalized === 'partially vaccinated';
      }
      if (filters.vaccinationStatus === 'not_vaccinated') {
        return normalized === 'not vaccinated';
      }
      return true;
    });
  }

  async queryBarangayRows(filters) {
    const patientsTable = this.ensureResolvedSchemaValue(
      await this.getPatientsTableName(),
      'Unable to resolve patients table for barangay report.',
    );
    const hasBarangay = await this.hasColumn(patientsTable, 'barangay');
    const appointmentPatientColumn = this.ensureResolvedSchemaValue(
      await this.getAppointmentsPatientColumn(),
      'Unable to resolve appointment patient column for barangay report.',
    );
    const appointmentDateColumn = this.ensureResolvedSchemaValue(
      await this.getAppointmentsDateColumn(),
      'Unable to resolve appointment date column for barangay report.',
    );

    const barangayExpression = hasBarangay
      ? 'COALESCE(NULLIF(p.barangay, \'\'), \'Unknown\')'
      : '\'Unknown\'';

    let query = `
      SELECT
        ${barangayExpression} AS barangay,
        COUNT(DISTINCT p.id)::int AS infants,
        COUNT(DISTINCT p.guardian_id)::int AS guardians,
        COUNT(DISTINCT ir.id)::int AS vaccinations,
        COUNT(DISTINCT a.id)::int AS appointments
      FROM ${patientsTable} p
      LEFT JOIN immunization_records ir
        ON ir.patient_id = p.id
        AND COALESCE(ir.is_active, true) = true
      LEFT JOIN appointments a
        ON a.${appointmentPatientColumn} = p.id
        AND COALESCE(a.is_active, true) = true
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (filters.startDate) {
      query += ` AND (
        ir.admin_date::date >= $${paramIndex}
        OR a.${appointmentDateColumn}::date >= $${paramIndex}
      )`;
      params.push(filters.startDate);
      paramIndex += 1;
    }

    if (filters.endDate) {
      query += ` AND (
        ir.admin_date::date <= $${paramIndex}
        OR a.${appointmentDateColumn}::date <= $${paramIndex}
      )`;
      params.push(filters.endDate);
      paramIndex += 1;
    }

    if (filters.barangay && hasBarangay) {
      query += ` AND LOWER(COALESCE(p.barangay, '')) = $${paramIndex}`;
      params.push(filters.barangay.toLowerCase());
      paramIndex += 1;
    }

    query += `
      GROUP BY ${barangayExpression}
      ORDER BY barangay ASC
    `;

    const result = await this.pool.query(query, params);

    return result.rows.map((row) => {
      const infants = this.toInteger(row.infants, 0);
      const vaccinations = this.toInteger(row.vaccinations, 0);
      const coveragePercent =
        infants === 0 ? 0 : Number(((vaccinations / infants) * 100).toFixed(2));

      return {
        ...row,
        coverage_percent: coveragePercent,
      };
    });
  }

  async queryComplianceRows(filters) {
    const patientsTable = this.ensureResolvedSchemaValue(
      await this.getPatientsTableName(),
      'Unable to resolve patients table for compliance report.',
    );
    const hasDob = await this.hasColumn(patientsTable, 'dob');
    const statusExpression = await this.getStatusExpressionForImmunizationRecords('ir');

    let query = `
      SELECT
        v.name AS vaccine,
        COUNT(ir.id)::int AS due,
        COUNT(CASE WHEN LOWER(${statusExpression}) = 'completed' THEN 1 END)::int AS completed,
        COUNT(
          CASE
            WHEN ir.next_due_date < CURRENT_DATE
              AND LOWER(${statusExpression}) <> 'completed'
            THEN 1
          END
        )::int AS overdue
      FROM vaccines v
      LEFT JOIN immunization_records ir
        ON ir.vaccine_id = v.id
        AND COALESCE(ir.is_active, true) = true
      LEFT JOIN ${patientsTable} p ON p.id = ir.patient_id
      WHERE COALESCE(v.is_active, true) = true
    `;

    const params = [];
    let paramIndex = 1;

    if (filters.startDate) {
      query += ` AND ir.admin_date::date >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex += 1;
    }

    if (filters.endDate) {
      query += ` AND ir.admin_date::date <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex += 1;
    }

    if (filters.vaccineType) {
      query += ` AND LOWER(v.name) LIKE $${paramIndex}`;
      params.push(`%${filters.vaccineType.toLowerCase()}%`);
      paramIndex += 1;
    }

    if (filters.targetGroup && hasDob) {
      const ageCondition = this.buildAgeMonthsCondition('p', filters.targetGroup);
      if (ageCondition) {
        query += ` AND ${ageCondition}`;
      }
    }

    query += `
      GROUP BY v.name
      HAVING COUNT(ir.id) > 0
      ORDER BY v.name ASC
    `;

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => {
      const due = this.toInteger(row.due, 0);
      const completed = this.toInteger(row.completed, 0);
      const targetGroupLabel = filters.targetGroup
        ? filters.targetGroup.replace(/_/g, ' ')
        : 'All';

      return {
        vaccine: row.vaccine,
        target_group: targetGroupLabel,
        due,
        completed,
        overdue: this.toInteger(row.overdue, 0),
        compliance_percent: due === 0 ? 0 : Number(((completed / due) * 100).toFixed(2)),
      };
    });
  }

  async queryConsolidatedSections(filters) {
    const sections = [];

    const sectionDefinitions = [
      {
        enabled: filters.includeVaccination !== false,
        type: 'vaccination',
        title: this.getReportTitle('vaccination'),
      },
      {
        enabled: filters.includeInventory !== false,
        type: 'inventory',
        title: this.getReportTitle('inventory'),
      },
      {
        enabled: filters.includeAppointments !== false,
        type: 'appointment',
        title: this.getReportTitle('appointment'),
      },
      {
        enabled: filters.includeGuardians !== false,
        type: 'guardian',
        title: this.getReportTitle('guardian'),
      },
      {
        enabled: filters.includeInfants !== false,
        type: 'infant',
        title: this.getReportTitle('infant'),
      },
    ];

    for (const sectionDefinition of sectionDefinitions) {
      if (!sectionDefinition.enabled) {
        continue;
      }


      const sectionData = await this.getReportData(sectionDefinition.type, filters);
      if (!Array.isArray(sectionData.rows) || sectionData.rows.length === 0) {
        continue;
      }

      sections.push({
        reportType: sectionDefinition.type,
        sectionTitle: sectionDefinition.title,
        headers: this.getHeadersForReportType(sectionDefinition.type),
        rows: sectionData.rows,
      });
    }

    return sections;
  }
}

module.exports = ReportService;
