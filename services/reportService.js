const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const pool = require('../db');
const { validateApprovedVaccineName } = require('../utils/approvedVaccines');
const { getAdminMetricsSummary } = require('./adminMetricsService');
const inventoryCalculationService = require('./inventoryCalculationService');
const { resolveStorageRoot } = require('../utils/runtimeStorage');

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

const APPOINTMENT_STATUS_FILTER_VALUES = Object.freeze({
  pending: ['pending'],
  scheduled: ['scheduled', 'confirmed', 'rescheduled'],
  confirmed: ['confirmed'],
  rescheduled: ['rescheduled'],
  attended: ['attended', 'completed'],
  completed: ['attended', 'completed'],
  cancelled: ['cancelled'],
  no_show: ['no_show', 'no-show'],
});

const normalizeAppointmentStatusFilterKey = (value) =>
  String(value || '').trim().toLowerCase().replace(/-/g, '_');

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
        options.reportDir || resolveStorageRoot('uploads', 'reports');
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
      normalized.vaccineType =
        typeof rawFilters.vaccineType === 'string'
          ? rawFilters.vaccineType.slice(0, 100)
          : '';
      normalized.status = this.sanitizeFilterText(rawFilters.status, 40).toLowerCase();
      normalized.barangay = this.sanitizeFilterText(rawFilters.barangay, 120);
      normalized.ageGroup = this.normalizeAgeGroup(rawFilters.ageGroup);
      break;
    case 'inventory':
      normalized.itemType = this.sanitizeFilterText(rawFilters.itemType, 50).toLowerCase();
      normalized.lowStockOnly = this.normalizeBoolean(rawFilters.lowStockOnly, false);
      normalized.category =
        typeof rawFilters.category === 'string' ? rawFilters.category.slice(0, 100) : '';
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
      normalized.vaccineType =
        typeof rawFilters.vaccineType === 'string'
          ? rawFilters.vaccineType.slice(0, 100)
          : '';
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
    try {
      await fs.mkdir(this.reportDir, { recursive: true });
    } catch (_mkdirError) {
      // Ignore directory bootstrap failures in read-only/serverless runtimes.
    }
  }

  getReportFileCandidates(storedPath = '') {
    const sanitizedPath = this.sanitizeFilterText(storedPath, 500);
    if (!sanitizedPath) {
      return [];
    }

    const normalizedPath = sanitizedPath.replace(/\\/g, '/');
    const isLegacyVirtualPath =
      normalizedPath.startsWith('/reports/') ||
      normalizedPath.startsWith('reports/') ||
      normalizedPath.startsWith('/uploads/reports/') ||
      normalizedPath.startsWith('uploads/reports/');

    const candidates = [];

    if (!isLegacyVirtualPath && path.isAbsolute(sanitizedPath)) {
      candidates.push(sanitizedPath);
    }

    const reportRelativePath = normalizedPath
      .replace(/^\/?uploads\/reports\//i, '')
      .replace(/^\/?reports\//i, '');

    if (reportRelativePath) {
      candidates.push(path.join(this.reportDir, reportRelativePath));
    }

    if (!path.isAbsolute(sanitizedPath)) {
      const trimmedRelativePath = sanitizedPath.replace(/^[\\/]+/, '');
      if (trimmedRelativePath) {
        candidates.push(path.join(this.reportDir, trimmedRelativePath));
      }
    }

    const fileName = path.basename(normalizedPath);
    if (fileName) {
      candidates.push(path.join(this.reportDir, fileName));
    }

    return Array.from(new Set(candidates.filter(Boolean)));
  }

  async resolveExistingReportFile(storedPath = '') {
    const candidates = this.getReportFileCandidates(storedPath);

    for (const candidate of candidates) {
      try {
        const fileStats = await fs.stat(candidate);
        if (fileStats.isFile()) {
          return {
            path: candidate,
            fileStats,
          };
        }
      } catch {
        // Try the next candidate path.
      }
    }

    return null;
  }

  expandLegacyMonthFilter(rawMonth = '') {
    const normalizedMonth = this.sanitizeFilterText(rawMonth, 16);
    if (!/^\d{4}-\d{2}$/.test(normalizedMonth)) {
      return {};
    }

    const [yearValue, monthValue] = normalizedMonth.split('-').map((part) => Number(part));
    if (!Number.isInteger(yearValue) || !Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) {
      return {};
    }

    const startDate = new Date(Date.UTC(yearValue, monthValue - 1, 1));
    const endDate = new Date(Date.UTC(yearValue, monthValue, 0));

    return {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    };
  }

  normalizeStoredReportParameters(reportType, rawParameters = {}, reportMetadata = {}) {
    let parsedParameters = rawParameters;
    if (typeof rawParameters === 'string') {
      try {
        parsedParameters = JSON.parse(rawParameters);
      } catch {
        parsedParameters = {};
      }
    }

    const source =
      parsedParameters &&
      typeof parsedParameters === 'object' &&
      !Array.isArray(parsedParameters)
        ? { ...parsedParameters }
        : {};

    const monthRange = this.expandLegacyMonthFilter(source.month);
    const normalizedSource = {
      ...source,
      ...monthRange,
      vaccineType: source.vaccineType || source.vaccine || source.category || '',
      healthCenter: source.healthCenter || source.health_center || source.clinic || '',
      type: source.type || source.appointmentType || '',
      itemType: source.itemType || source.item_type || '',
      lowStockOnly: source.lowStockOnly ?? source.low_stock_only ?? false,
      userId: reportMetadata.generated_by || source.userId || null,
    };

    return this.normalizeReportFilters(reportType, normalizedSource);
  }

  async persistRecoveredReportFile(reportId, absolutePath, fileFormat, fileSize) {
    const updates = [
      'file_path = $2',
      'file_format = $3',
      'status = $4',
    ];
    const values = [reportId, absolutePath, fileFormat, 'completed'];
    let placeholderIndex = 5;

    if (await this.hasColumn('reports', 'file_size')) {
      updates.push(`file_size = $${placeholderIndex}`);
      values.push(this.toInteger(fileSize, 0));
      placeholderIndex += 1;
    }

    if (await this.hasColumn('reports', 'updated_at')) {
      updates.push('updated_at = NOW()');
    }

    await this.pool.query(
      `UPDATE reports SET ${updates.join(', ')} WHERE id = $1`,
      values,
    );
  }

  async regenerateStoredReportFile(report = {}) {
    const reportType = this.normalizeReportType(report.type);
    const fileFormat = this.normalizeReportFormat(report.file_format) || 'pdf';

    if (!reportType) {
      throw this.createHttpError(
        'Report file is missing and the report type is invalid for regeneration.',
        404,
        'REPORT_REGENERATION_TYPE_INVALID',
      );
    }

    const normalizedFilters = this.normalizeStoredReportParameters(
      reportType,
      report.parameters,
      report,
    );

    const reportData = await this.getReportData(reportType, normalizedFilters);
    if (!this.hasRenderableData(reportData)) {
      throw this.createHttpError(
        'Report file not found on disk and there is no data available to regenerate it.',
        404,
        'REPORT_REGENERATION_EMPTY',
      );
    }

    await this.ensureReportDirectory();

    const recoveredFilename =
      path.basename(this.sanitizeFilterText(report.file_path, 500) || '') ||
      this.buildFilename(
        reportType,
        fileFormat,
        report.date_generated ? new Date(report.date_generated) : new Date(),
      );
    const recoveredPath = path.join(this.reportDir, recoveredFilename);
    const buffer = await this.buildReportBuffer(reportData, fileFormat);

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw this.createHttpError(
        'Report file not found on disk and regeneration produced no file content.',
        500,
        'REPORT_REGENERATION_FAILED',
      );
    }

    await fs.writeFile(recoveredPath, buffer);
    await this.persistRecoveredReportFile(report.id, recoveredPath, fileFormat, buffer.length);

    return {
      path: recoveredPath,
      filename: path.basename(recoveredPath),
      mimeType: this.getMimeType(fileFormat),
      fileSize: buffer.length,
    };
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

  async getInventoryIssuedColumn() {
    return this.resolveFirstExistingColumn(
      'vaccine_inventory',
      ['issuance', 'doses_administered', 'issued'],
      null,
    );
  }

  async getInventoryWastedColumn() {
    return this.resolveFirstExistingColumn(
      'vaccine_inventory',
      ['expired_wasted', 'doses_wasted', 'wasted_expired'],
      null,
    );
  }

  async getInventoryStockColumn() {
    return this.resolveFirstExistingColumn(
      'vaccine_inventory',
      ['stock_on_hand', 'ending_balance'],
      null,
    );
  }

  async getInventoryLotBatchColumn() {
    return this.resolveFirstExistingColumn(
      'vaccine_inventory',
      ['lot_batch_number', 'lot_number'],
      null,
    );
  }

  async getInventoryLowStockThresholdColumn() {
    return this.resolveFirstExistingColumn(
      'vaccine_inventory',
      ['low_stock_threshold'],
      null,
    );
  }

  async getInventoryCriticalStockThresholdColumn() {
    return this.resolveFirstExistingColumn(
      'vaccine_inventory',
      ['critical_stock_threshold'],
      null,
    );
  }

  async getInventoryPeriodStartColumn() {
    return this.resolveFirstExistingColumn(
      'vaccine_inventory',
      ['period_start', 'created_at'],
      'created_at',
    );
  }

  async getInventoryPeriodEndColumn() {
    return this.resolveFirstExistingColumn(
      'vaccine_inventory',
      ['period_end', 'updated_at', 'created_at'],
      'created_at',
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

  normalizeScopeIds(scopeIds = []) {
    const rawScopeIds = Array.isArray(scopeIds) ? scopeIds : [scopeIds];
    return Array.from(
      new Set(
        rawScopeIds
          .map((scopeId) => this.toInteger(scopeId, 0))
          .filter((scopeId) => scopeId > 0),
      ),
    );
  }

  buildScopeFilter(expressions = [], scopeIds = [], params = []) {
    const normalizedScopeIds = this.normalizeScopeIds(scopeIds);
    const scopedExpressions = expressions.filter(Boolean);

    if (normalizedScopeIds.length === 0 || scopedExpressions.length === 0) {
      return '';
    }

    const scopeParam = normalizedScopeIds.length === 1
      ? normalizedScopeIds[0]
      : normalizedScopeIds;
    params.push(scopeParam);

    const placeholder = `$${params.length}`;
    const predicate = (expression) =>
      normalizedScopeIds.length === 1
        ? `${expression} = ${placeholder}`
        : `${expression} = ANY(${placeholder}::int[])`;

    return ` AND (${scopedExpressions.map(predicate).join(' OR ')})`;
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

  hasRenderableData(reportData = {}) {
    if (Array.isArray(reportData.sections) && reportData.sections.length > 0) {
      return reportData.sections.some(
        (section) => Array.isArray(section.rows) && section.rows.length > 0,
      );
    }

    return Array.isArray(reportData.rows) && reportData.rows.length > 0;
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
    if (!this.hasRenderableData(reportData)) {
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

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  isInventoryLayout(reportType) {
    return reportType === 'inventory';
  }

  buildExportRows(reportType, rows = []) {
    return rows.map((row, index) => this.mapRowForExport(reportType, row, index));
  }

  normalizePdfCell(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return text.replace(/\s+/g, ' ').trim();
  }

  normalizeDisplayCell(value) {
    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    return this.normalizePdfCell(value);
  }

  formatDisplayDate(value) {
    if (!value) {
      return '';
    }

    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [year, month, day] = text.split('-').map((part) => Number(part));
      const date = new Date(Date.UTC(year, month - 1, day));
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        month: 'long',
        day: '2-digit',
        year: 'numeric',
      }).format(date);
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      return text;
    }

    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'long',
      day: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  formatDisplayTimestamp(value) {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'long',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);

    return `${formatted} UTC`;
  }

  formatReportPeriod(filters = {}) {
    const startDate = this.formatDisplayDate(filters.startDate);
    const endDate = this.formatDisplayDate(filters.endDate);

    if (startDate && endDate) {
      return startDate === endDate ? startDate : `${startDate} to ${endDate}`;
    }

    if (startDate) {
      return `From ${startDate}`;
    }

    if (endDate) {
      return `Up to ${endDate}`;
    }

    return 'All Dates';
  }

  formatSummaryLabel(key) {
    const labelMap = {
      totalRows: 'Total Records',
      completed: 'Completed Records',
      pending: 'Pending Records',
      cancelled: 'Cancelled Records',
      active: 'Active Records',
      upToDate: 'Up-to-Date Records',
      lowStockItems: 'Low Stock Items',
      criticalStockItems: 'Critical Stock Items',
      totalVaccinations: 'Total Vaccinations',
      averageCompliance: 'Average Compliance',
      sections: 'Section Count',
      sectionNames: 'Included Sections',
    };

    if (labelMap[key]) {
      return labelMap[key];
    }

    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  formatSummaryValue(key, value) {
    if (Array.isArray(value)) {
      const formatted = value
        .map((item) => this.formatSummaryValue(key, item))
        .filter(Boolean);
      return formatted.length > 0 ? formatted.join(', ') : 'None';
    }

    if (value && typeof value === 'object') {
      const formatted = Object.entries(value)
        .map(
          ([nestedKey, nestedValue]) =>
            `${this.formatSummaryLabel(nestedKey)}: ${this.formatSummaryValue(
              nestedKey,
              nestedValue,
            )}`,
        )
        .filter(Boolean);
      return formatted.length > 0 ? formatted.join(', ') : 'None';
    }

    if (value === undefined || value === null || value === '') {
      return 'None';
    }

    if (typeof value === 'number' && /percent|compliance/i.test(key)) {
      return `${value}%`;
    }

    return String(value);
  }

  buildSummaryEntries(summary = {}, options = {}) {
    const entries = [];

    if (options.generatedAt) {
      entries.push({
        label: 'Generated At',
        value: this.formatDisplayTimestamp(options.generatedAt),
      });
    }

    Object.entries(summary || {}).forEach(([key, value]) => {
      entries.push({
        label: this.formatSummaryLabel(key),
        value: this.formatSummaryValue(key, value),
      });
    });

    return entries;
  }

  buildConsolidatedSummaryRows(reportData) {
    const rows = this.buildSummaryEntries(reportData.summary, {
      generatedAt: reportData.generatedAt,
    }).map((entry) => [entry.label, entry.value]);

    (reportData.sections || []).forEach((section) => {
      rows.push([`${section.sectionTitle} Records`, section.rows.length]);
    });

    return rows;
  }

  getEmptyStateMessage(title) {
    const safeTitle = this.normalizePdfCell(title || 'report');
    return `No data available for ${safeTitle.toLowerCase()} for the selected filters.`;
  }

  getColumnMetrics(headers = [], mappedRows = []) {
    const sampleRows = mappedRows.slice(0, 60);
    const maxLengths = headers.map((header, columnIndex) => {
      const headerLength = this.normalizePdfCell(header).length;
      const cellLength = sampleRows.reduce((longest, row) => {
        const value = row[columnIndex];
        return Math.max(longest, this.normalizePdfCell(value).length);
      }, 0);
      return Math.max(headerLength, cellLength, 1);
    });

    const weights = maxLengths.map((length, columnIndex) => {
      const columnValues = sampleRows.map((row) => row[columnIndex]);
      const isNumericColumn =
          columnValues.length > 0 &&
          columnValues.every((value) => {
            const text = this.normalizePdfCell(value);
            return !text || /^-?\d+(\.\d+)?%?$/.test(text);
          });

      if (isNumericColumn) {
        return this.clamp(length + 2, 8, 14);
      }

      return this.clamp(length + 3, 10, 26);
    });

    return {
      maxLengths,
      weights,
      totalWeight: weights.reduce((sum, weight) => sum + weight, 0),
      wideColumnCount: maxLengths.filter((length) => length >= 24).length,
    };
  }

  resolveTableOrientation(headers = [], mappedRows = []) {
    const metrics = this.getColumnMetrics(headers, mappedRows);
    const columnCount = headers.length;

    if (columnCount >= 8) {
      return 'landscape';
    }

    if (metrics.totalWeight > 92) {
      return 'landscape';
    }

    if (columnCount >= 7 && metrics.totalWeight > 82) {
      return 'landscape';
    }

    if (metrics.wideColumnCount >= 2 && columnCount >= 6) {
      return 'landscape';
    }

    return 'portrait';
  }

  getExcelColumnLetter(columnNumber) {
    let current = columnNumber;
    let result = '';

    while (current > 0) {
      const remainder = (current - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      current = Math.floor((current - 1) / 26);
    }

    return result || 'A';
  }

  mergeWorksheetAcrossColumns(worksheet, rowNumber, columnCount) {
    if (columnCount <= 1) {
      return;
    }

    worksheet.mergeCells(`A${rowNumber}:${this.getExcelColumnLetter(columnCount)}${rowNumber}`);
  }

  applyExcelRowHeight(row, values = [], worksheet) {
    const estimatedLines = values.reduce((maxLines, value, valueIndex) => {
      const text = this.normalizePdfCell(value);
      const columnWidth = worksheet.getColumn(valueIndex + 1).width || 12;
      const wrappedLines = text
        ? Math.max(text.split('\n').length, Math.ceil(text.length / Math.max(columnWidth - 2, 1)))
        : 1;
      return Math.max(maxLines, wrappedLines);
    }, 1);

    row.height = this.clamp(estimatedLines * 15 + 4, 18, 84);
  }

  buildExcelColumnWidths(headers = [], mappedRows = [], reportType = '') {
    const metrics = this.getColumnMetrics(headers, mappedRows);
    return metrics.maxLengths.map((length, index) => {
      const header = this.normalizePdfCell(headers[index]);
      const isNumericColumn = /dose|count|percent|rows|records|issued|balance|stock/i.test(header);
      const minimumWidth = isNumericColumn ? 10 : 14;
      const maximumWidth = isNumericColumn ? 14 : 28;

      if (reportType === 'guardian') {
        const normalizedHeader = header.toLowerCase();
        if (normalizedHeader === 'address') {
          return this.clamp(Math.max(length + 10, 34), 34, 48);
        }
        if (normalizedHeader === 'email') {
          return this.clamp(Math.max(length + 4, 24), 22, 34);
        }
        if (normalizedHeader === 'relationship') {
          return this.clamp(Math.max(length + 3, 16), 16, 24);
        }
        if (normalizedHeader === 'phone') {
          return this.clamp(Math.max(length + 3, 18), 18, 24);
        }
      }

      return this.clamp(length + 4, minimumWidth, maximumWidth);
    });
  }

  async populateLegacyWorksheet({ worksheet, title, generatedAt, headers, reportType, rows }) {
    worksheet.addRow([title]);
    worksheet.addRow([`Generated: ${generatedAt.toISOString()}`]);
    worksheet.addRow([]);

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (index > 0 && index % 100 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      worksheet.addRow(this.mapRowForExport(reportType, row, index));
    }

    worksheet.columns.forEach((column) => {
      column.width = Math.min(Math.max((column.header || '').length + 4, 14), 42);
    });
  }

  async populateWorksheet({
    worksheet,
    title,
    generatedAt,
    headers,
    reportType,
    rows,
    filters = {},
    mappedRows = null,
    emptyStateMessage = '',
  }) {
    if (this.isInventoryLayout(reportType)) {
      await this.populateLegacyWorksheet({ worksheet, title, generatedAt, headers, reportType, rows });
      return;
    }

    const exportRows = Array.isArray(mappedRows) ? mappedRows : this.buildExportRows(reportType, rows);
    const normalizedRows = exportRows.map((row) => row.map((value) => this.normalizeDisplayCell(value)));
    const columnCount = Math.max(headers.length, 1);
    const reportPeriod = this.formatReportPeriod(filters);
    const orientation = this.resolveTableOrientation(headers, normalizedRows);
    const columnWidths = this.buildExcelColumnWidths(headers, normalizedRows, reportType);
    const headerRowNumber = 8;
    const titleRangeColumns = Math.max(columnCount, 2);

    worksheet.properties.defaultRowHeight = 18;
    worksheet.pageSetup = {
      paperSize: 9,
      orientation,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: {
        left: 0.35,
        right: 0.35,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
    };
    worksheet.views = [
      {
        state: 'frozen',
        ySplit: headerRowNumber,
        topLeftCell: `A${headerRowNumber + 1}`,
      },
    ];

    worksheet.addRow(['IMMUNICARE HEALTH CENTER']);
    worksheet.addRow(['BARANGAY SAN NICOLAS, PASIG CITY']);
    worksheet.addRow([String(title || 'Report').toUpperCase()]);
    worksheet.addRow([`Report Period: ${reportPeriod}`]);
    worksheet.addRow([`Generated: ${this.formatDisplayTimestamp(generatedAt)}`]);
    worksheet.addRow(['']);
    worksheet.addRow([]);

    [1, 2, 3, 4, 5, 6].forEach((rowNumber) => {
      this.mergeWorksheetAcrossColumns(worksheet, rowNumber, titleRangeColumns);
      const cell = worksheet.getCell(`A${rowNumber}`);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    worksheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1F2937' } };
    worksheet.getRow(1).height = 20;
    worksheet.getCell('A2').font = { size: 11, color: { argb: 'FF4B5563' } };
    worksheet.getRow(2).height = 18;
    worksheet.getCell('A3').font = { bold: true, size: 12, color: { argb: 'FF0F172A' } };
    worksheet.getRow(3).height = 20;
    worksheet.getCell('A4').font = { italic: true, size: 10, color: { argb: 'FF475569' } };
    worksheet.getRow(4).height = 18;
    worksheet.getCell('A5').font = { size: 10, color: { argb: 'FF475569' } };
    worksheet.getRow(5).height = 18;
    worksheet.getRow(6).height = 6;
    worksheet.getCell('A6').border = {
      bottom: { style: 'medium', color: { argb: 'FF1E5AA8' } },
    };
    worksheet.getRow(7).height = 8;

    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E5AA8' },
      };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF1E3A8A' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
    });
    headerRow.height = 24;

    if (normalizedRows.length === 0) {
      const messageRow = worksheet.addRow([
        emptyStateMessage || this.getEmptyStateMessage(title),
      ]);
      this.mergeWorksheetAcrossColumns(worksheet, messageRow.number, columnCount);
      const cell = worksheet.getCell(`A${messageRow.number}`);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.font = { italic: true, color: { argb: 'FF64748B' } };
      cell.border = {
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
      messageRow.height = 28;
    } else {
      for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex++) {
        const rowValues = normalizedRows[rowIndex];
        if (rowIndex > 0 && rowIndex % 100 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        const row = worksheet.addRow(rowValues);
        row.eachCell((cell) => {
          cell.alignment = {
            horizontal: 'left',
            vertical: 'top',
            wrapText: true,
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD6DEE8' } },
            left: { style: 'thin', color: { argb: 'FFD6DEE8' } },
            bottom: { style: 'thin', color: { argb: 'FFD6DEE8' } },
            right: { style: 'thin', color: { argb: 'FFD6DEE8' } },
          };
          if (rowIndex % 2 === 1) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF8FAFC' },
            };
          }
        });
        this.applyExcelRowHeight(row, rowValues, worksheet);
      }
    }

    headers.forEach((_header, index) => {
      worksheet.getColumn(index + 1).width = columnWidths[index] || 14;
    });

    worksheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: columnCount },
    };
    worksheet.pageSetup.printTitlesRow = `1:${headerRowNumber}`;
  }

  async buildExcelBuffer(reportData) {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.creator = 'Immunicare';

    if (reportData.reportType === 'inventory' && (!reportData.sections || reportData.sections.length === 0)) {
      const worksheet = workbook.addWorksheet(this.buildSheetName(reportData.title, 'Report Data'));
      await this.populateLegacyWorksheet({
        worksheet,
        title: reportData.title,
        generatedAt: reportData.generatedAt,
        headers: reportData.headers,
        reportType: reportData.reportType,
        rows: reportData.rows,
      });
      const output = await workbook.xlsx.writeBuffer();
      return Buffer.from(output);
    }

    if (reportData.sections && reportData.sections.length > 0) {
      const summarySheet = workbook.addWorksheet('Summary');
      await this.populateWorksheet({
        worksheet: summarySheet,
        title: `${reportData.title} Summary`,
        generatedAt: reportData.generatedAt,
        headers: ['Summary Metric', 'Value'],
        reportType: 'summary',
        rows: [],
        filters: reportData.filters,
        mappedRows: this.buildConsolidatedSummaryRows(reportData),
        emptyStateMessage: this.getEmptyStateMessage(`${reportData.title} summary`),
      });

      for (let index = 0; index < reportData.sections.length; index++) {
        const section = reportData.sections[index];
        const worksheet = workbook.addWorksheet(
          this.buildSheetName(section.sectionTitle, `Section ${index + 1}`),
        );

        if (this.isInventoryLayout(section.reportType)) {
          await this.populateLegacyWorksheet({
            worksheet,
            title: section.sectionTitle,
            generatedAt: reportData.generatedAt,
            headers: section.headers,
            reportType: section.reportType,
            rows: section.rows,
          });
          continue;
        }

        await this.populateWorksheet({
          worksheet,
          title: section.sectionTitle,
          generatedAt: reportData.generatedAt,
          headers: section.headers,
          reportType: section.reportType,
          rows: section.rows,
          filters: reportData.filters,
        });
      }
    } else {
      const worksheet = workbook.addWorksheet(this.buildSheetName(reportData.title, 'Report Data'));
      await this.populateWorksheet({
        worksheet,
        title: reportData.title,
        generatedAt: reportData.generatedAt,
        headers: reportData.headers,
        reportType: reportData.reportType,
        rows: reportData.rows,
        filters: reportData.filters,
      });
    }

    const output = await workbook.xlsx.writeBuffer();
    return Buffer.from(output);
  }

  addPdfPage(doc, options = {}) {
    const { layout = 'portrait', headerTitle = '', filters = {} } = options;
    doc.addPage({ size: 'A4', layout, margin: 40 });

    if (!headerTitle) {
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
      return;
    }

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const periodLabel = `Report Period: ${this.formatReportPeriod(filters)}`;
    let currentY = 28;

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1F2937').text(
      'IMMUNICARE HEALTH CENTER',
      left,
      currentY,
      { width, align: 'center' },
    );
    currentY += 16;
    doc.font('Helvetica').fontSize(10).fillColor('#4B5563').text(
      'BARANGAY SAN NICOLAS, PASIG CITY',
      left,
      currentY,
      { width, align: 'center' },
    );
    currentY += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0F172A').text(
      String(headerTitle).toUpperCase(),
      left,
      currentY,
      { width, align: 'center' },
    );
    currentY += 15;
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(periodLabel, left, currentY, {
      width,
      align: 'center',
    });
    currentY += 18;
    doc.moveTo(left, currentY).lineTo(right, currentY).lineWidth(1).strokeColor('#1E5AA8').stroke();
    doc.x = left;
    doc.y = currentY + 12;
  }

  buildPdfColumnWidths(doc, headers = [], mappedRows = []) {
    const metrics = this.getColumnMetrics(headers, mappedRows);
    const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const minimumWidth = 42;
    const widths = metrics.weights.map((weight) => {
      const baseWidth = (weight / Math.max(metrics.totalWeight, 1)) * availableWidth;
      return Math.max(baseWidth, minimumWidth);
    });
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);

    if (totalWidth > availableWidth) {
      const scale = availableWidth / totalWidth;
      return widths.map((width) => width * scale);
    }

    const difference = availableWidth - totalWidth;
    if (widths.length > 0 && difference > 0) {
      widths[widths.length - 1] += difference;
    }

    return widths;
  }

  drawPdfTableHeader(doc, headers = [], columnWidths = [], startY) {
    const x = doc.page.margins.left;
    const padding = 6;

    doc.font('Helvetica-Bold').fontSize(9);
    const rowHeight = Math.max(
      ...headers.map((header, index) => {
        const textHeight = doc.heightOfString(this.normalizePdfCell(header), {
          width: Math.max(columnWidths[index] - padding * 2, 20),
          align: 'center',
        });
        return textHeight + padding * 2;
      }),
      22,
    );

    let currentX = x;
    headers.forEach((header, index) => {
      const width = columnWidths[index];
      doc.rect(currentX, startY, width, rowHeight).fillAndStroke('#1E5AA8', '#1E3A8A');
      doc.fillColor('white').text(this.normalizePdfCell(header), currentX + padding, startY + padding, {
        width: width - padding * 2,
        align: 'center',
      });
      currentX += width;
    });

    doc.fillColor('black');
    doc.y = startY + rowHeight;
    return rowHeight;
  }

  drawPdfTableRow(doc, rowValues = [], columnWidths = [], startY, isStriped = false) {
    const padding = 6;
    const x = doc.page.margins.left;

    doc.font('Helvetica').fontSize(9);
    const rowHeight = Math.max(
      ...rowValues.map((value, index) => {
        const textHeight = doc.heightOfString(this.normalizePdfCell(value), {
          width: Math.max(columnWidths[index] - padding * 2, 20),
          align: 'left',
        });
        return textHeight + padding * 2;
      }),
      20,
    );

    let currentX = x;
    rowValues.forEach((value, index) => {
      const width = columnWidths[index];
      doc.rect(currentX, startY, width, rowHeight).fillAndStroke(
        isStriped ? '#F8FAFC' : '#FFFFFF',
        '#CBD5E1',
      );
      doc.fillColor('black').text(this.normalizePdfCell(value), currentX + padding, startY + padding, {
        width: width - padding * 2,
        align: 'left',
      });
      currentX += width;
    });

    doc.y = startY + rowHeight;
    return rowHeight;
  }

  writePdfSummary(doc, summaryEntries = []) {
    if (!Array.isArray(summaryEntries) || summaryEntries.length === 0) {
      return;
    }

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const labelWidth = Math.min(170, width * 0.34);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0F172A').text('Summary', left, doc.y, {
      width,
    });
    doc.moveDown(0.2);
    summaryEntries.forEach((entry) => {
      const startY = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1F2937').text(`${entry.label}:`, left, startY, {
        width: labelWidth,
      });
      doc.font('Helvetica').fontSize(9).fillColor('#334155').text(entry.value, left + labelWidth, startY, {
        width: width - labelWidth,
      });
      doc.moveDown(0.2);
    });
    doc.moveDown(0.4);
  }

  async writeLegacyPdfSection({ doc, title, headers, reportType, rows, startOnNewPage = false }) {
    if (!doc.page || startOnNewPage) {
      this.addPdfPage(doc, { layout: 'portrait' });
    } else if (doc.y > doc.page.height - 100) {
      this.addPdfPage(doc, { layout: 'portrait' });
    }

    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('black').text(title);
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(9).text(headers.join(' | '));
    doc.moveDown(0.1);
    doc.font('Helvetica').fontSize(9);

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (index > 0 && index % 25 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      if (doc.y > doc.page.height - 60) {
        this.addPdfPage(doc, { layout: 'portrait' });
      }

      const line = this.mapRowForExport(reportType, row, index)
        .map((cell) => this.normalizePdfCell(cell))
        .join(' | ')
        .slice(0, 320);

      doc.text(line);
    }
  }

  async writeBrandedPdfSection({
    doc,
    title,
    headers,
    reportType,
    rows,
    filters = {},
    headerTitle,
    mappedRows = null,
    summaryEntries = [],
    startOnNewPage = false,
    emptyStateMessage = '',
  }) {
    const exportRows = Array.isArray(mappedRows) ? mappedRows : this.buildExportRows(reportType, rows);
    const normalizedRows = exportRows.map((row) => row.map((value) => this.normalizeDisplayCell(value)));
    const orientation = this.resolveTableOrientation(headers, normalizedRows);
    const sectionTitle = title || 'Details';

    if (!doc.page || startOnNewPage) {
      this.addPdfPage(doc, {
        layout: orientation,
        headerTitle: headerTitle || sectionTitle,
        filters,
      });
    }

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0F172A').text(sectionTitle, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    });
    doc.moveDown(0.3);

    if (summaryEntries.length > 0) {
      this.writePdfSummary(doc, summaryEntries);
    }

    if (!Array.isArray(headers) || headers.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#64748B').text(
        emptyStateMessage || this.getEmptyStateMessage(sectionTitle),
      );
      return;
    }

    if (normalizedRows.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#64748B').text(
        emptyStateMessage || this.getEmptyStateMessage(sectionTitle),
      );
      return;
    }

    const columnWidths = this.buildPdfColumnWidths(doc, headers, normalizedRows);
    let currentY = doc.y;
    const bottomLimit = doc.page.height - doc.page.margins.bottom - 24;
    const redrawHeader = () => {
      currentY = Math.max(doc.y, doc.page.margins.top + 78);
      const headerHeight = this.drawPdfTableHeader(doc, headers, columnWidths, currentY);
      currentY += headerHeight;
    };

    redrawHeader();

    for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex++) {
      const rowValues = normalizedRows[rowIndex];
      if (rowIndex > 0 && rowIndex % 20 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      const estimatedHeight = Math.max(
        ...rowValues.map((value, columnIndex) => {
          doc.font('Helvetica').fontSize(9);
          return doc.heightOfString(this.normalizePdfCell(value), {
            width: Math.max(columnWidths[columnIndex] - 12, 20),
          });
        }),
        12,
      ) + 12;

      if (currentY + estimatedHeight > bottomLimit) {
        this.addPdfPage(doc, {
          layout: orientation,
          headerTitle: headerTitle || sectionTitle,
          filters,
        });
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#0F172A').text(sectionTitle, {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        });
        doc.moveDown(0.3);
        redrawHeader();
      }

      const rowHeight = this.drawPdfTableRow(
        doc,
        rowValues,
        columnWidths,
        currentY,
        rowIndex % 2 === 1,
      );
      currentY += rowHeight;
    }
  }

  async writePdfSection(options) {
    if (this.isInventoryLayout(options.reportType)) {
      await this.writeLegacyPdfSection(options);
      return;
    }

    await this.writeBrandedPdfSection(options);
  }

  buildLegacyInventoryPdfBuffer(reportData) {
    return new Promise(async (resolve, reject) => {
      const chunks = [];
      const doc = new PDFDocument({ size: 'A4', margin: 40, compress: false });

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (error) => reject(error));

      try {
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

        await this.writeLegacyPdfSection({
          doc,
          title: 'Details',
          headers: reportData.headers,
          reportType: reportData.reportType,
          rows: reportData.rows,
        });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  buildPdfBuffer(reportData) {
    if (reportData.reportType === 'inventory' && (!reportData.sections || reportData.sections.length === 0)) {
      return this.buildLegacyInventoryPdfBuffer(reportData);
    }

    return new Promise(async (resolve, reject) => {
      const chunks = [];
      const doc = new PDFDocument({ autoFirstPage: false, margin: 40, compress: false });

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (error) => reject(error));

      try {
        if (reportData.sections && reportData.sections.length > 0) {
          await this.writePdfSection({
            doc,
            title: `${reportData.title} Summary`,
            headerTitle: reportData.title,
            headers: ['Summary Metric', 'Value'],
            reportType: 'summary',
            rows: [],
            filters: reportData.filters,
            mappedRows: this.buildConsolidatedSummaryRows(reportData),
            startOnNewPage: true,
            emptyStateMessage: this.getEmptyStateMessage(`${reportData.title} summary`),
          });

          for (const section of reportData.sections) {
            await this.writePdfSection({
              doc,
              title: section.sectionTitle,
              headerTitle: section.sectionTitle,
              headers: section.headers,
              reportType: section.reportType,
              rows: section.rows,
              filters: reportData.filters,
              startOnNewPage: true,
            });
          }
        } else {
          await this.writePdfSection({
            doc,
            title: 'Report Details',
            headerTitle: reportData.title,
            headers: reportData.headers,
            reportType: reportData.reportType,
            rows: reportData.rows,
            filters: reportData.filters,
            summaryEntries: this.buildSummaryEntries(reportData.summary, {
              generatedAt: reportData.generatedAt,
            }),
            startOnNewPage: true,
          });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
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
          SELECT
            id,
            type,
            title,
            file_path,
            file_format,
            status,
            parameters,
            generated_by,
            date_generated
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

    const resolvedFile = await this.resolveExistingReportFile(storedPath);
    if (resolvedFile) {
      const fileFormat = this.normalizeReportFormat(report.file_format) || 'pdf';
      const fallbackFilename = this.buildFilename(report.type || 'report', fileFormat, new Date());
      const filename = path.basename(resolvedFile.path) || fallbackFilename;

      return {
        path: resolvedFile.path,
        filename,
        mimeType: this.getMimeType(fileFormat),
        fileSize: resolvedFile.fileStats.size,
      };
    }

    return this.regenerateStoredReportFile(report);
  }

  async getAllTimeTruthSummary({ coreSummary = {}, facilityId = null, scopeIds = [] } = {}) {
    const normalizedScopeIds = this.normalizeScopeIds(
      scopeIds.length > 0 ? scopeIds : [facilityId],
    );
    const patientsTable = await this.getPatientsTableName();
    const patientScopeColumn = patientsTable
      ? await this.resolveFirstExistingColumn(patientsTable, ['facility_id', 'clinic_id'], null)
      : null;
    const guardianScopeColumn = await this.resolveFirstExistingColumn(
      'guardians',
      ['clinic_id', 'facility_id'],
      null,
    );
    const appointmentPatientColumn = await this.getAppointmentsPatientColumn();
    const appointmentScopeColumn = await this.getAppointmentsFacilityColumn();

    const vaccinationParams = [];
    const vaccinationScopeFilter = this.buildScopeFilter(
      [
        patientScopeColumn && patientsTable ? `p.${patientScopeColumn}` : null,
        guardianScopeColumn ? `g.${guardianScopeColumn}` : null,
      ],
      normalizedScopeIds,
      vaccinationParams,
    );
    const vaccinationQuery = `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(ir.status::text, '')) IN ('completed', 'attended')
              OR ir.admin_date IS NOT NULL
          )::int AS completed
        FROM immunization_records ir
        ${patientsTable ? `LEFT JOIN ${patientsTable} p ON p.id = ir.patient_id` : ''}
        LEFT JOIN guardians g ON ${patientsTable ? 'g.id = p.guardian_id' : 'false'}
        WHERE COALESCE(ir.is_active, true) = true
          ${vaccinationScopeFilter}
      `;

    const appointmentParams = [];
    const appointmentScopeFilter = this.buildScopeFilter(
      [
        patientScopeColumn && patientsTable ? `p.${patientScopeColumn}` : null,
        appointmentScopeColumn ? `a.${appointmentScopeColumn}` : null,
      ],
      normalizedScopeIds,
      appointmentParams,
    );
    const appointmentQuery = `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('attended', 'completed')
          )::int AS completed,
          COUNT(*) FILTER (
            WHERE LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('no_show', 'no-show')
          )::int AS no_show
        FROM appointments a
        ${
  patientsTable && appointmentPatientColumn
    ? `LEFT JOIN ${patientsTable} p ON p.id = a.${appointmentPatientColumn}`
    : ''
}
        WHERE COALESCE(a.is_active, true) = true
          ${patientsTable ? 'AND COALESCE(p.is_active, true) = true' : ''}
          ${appointmentScopeFilter}
      `;

    const guardianParams = [];
    const guardianScopeFilter = this.buildScopeFilter(
      [guardianScopeColumn ? `g.${guardianScopeColumn}` : null],
      normalizedScopeIds,
      guardianParams,
    );
    const guardianQuery = `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE COALESCE(g.is_active, true) = true)::int AS active
        FROM guardians g
        WHERE COALESCE(g.is_active, true) = true
          ${guardianScopeFilter}
      `;

    const infantParams = [];
    const infantScopeFilter = this.buildScopeFilter(
      [
        patientScopeColumn && patientsTable ? `p.${patientScopeColumn}` : null,
        guardianScopeColumn ? `g.${guardianScopeColumn}` : null,
      ],
      normalizedScopeIds,
      infantParams,
    );
    const infantQuery = `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE EXISTS (
              SELECT 1
              FROM immunization_records irx
              WHERE irx.patient_id = p.id
                AND COALESCE(irx.is_active, true) = true
                AND (
                  LOWER(COALESCE(irx.status::text, '')) IN ('completed', 'attended')
                  OR irx.admin_date IS NOT NULL
                )
            )
          )::int AS up_to_date
        FROM ${patientsTable} p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE COALESCE(p.is_active, true) = true
          ${infantScopeFilter}
      `;

    const [vaccinationResult, appointmentResult, guardianResult, infantResult] =
      await Promise.all([
        this.pool.query(vaccinationQuery, vaccinationParams),
        this.pool.query(appointmentQuery, appointmentParams),
        this.pool.query(guardianQuery, guardianParams),
        patientsTable
          ? this.pool.query(infantQuery, infantParams)
          : Promise.resolve({ rows: [{ total: 0, up_to_date: 0 }] }),
      ]);

    let inventory = coreSummary.inventory || {
      total_items: 0,
      low_stock_items: 0,
      expired_items: 0,
      total_value: 0,
    };

    if (normalizedScopeIds.length > 0) {
      try {
        const inventorySummary = await inventoryCalculationService.getUnifiedSummary(
          normalizedScopeIds.length === 1 ? normalizedScopeIds[0] : normalizedScopeIds,
        );
        inventory = {
          total_items: this.toInteger(inventorySummary.total_vaccines, 0),
          low_stock_items:
            this.toInteger(inventorySummary.low_stock_count, 0)
            + this.toInteger(inventorySummary.critical_count, 0)
            + this.toInteger(inventorySummary.out_of_stock_count, 0),
          expired_items: this.toInteger(coreSummary.inventory?.expired_items, 0),
          total_value: this.toNumber(inventorySummary.total_value, 0),
        };
      } catch (inventoryError) {
        console.warn('Unable to compute reports inventory truth summary:', inventoryError.message);
      }
    }

    return {
      ...coreSummary,
      vaccination: {
        ...(coreSummary.vaccination || {}),
        all_records: this.toInteger(vaccinationResult.rows[0]?.total, 0),
        total: this.toInteger(vaccinationResult.rows[0]?.completed, 0),
        completed: this.toInteger(vaccinationResult.rows[0]?.completed, 0),
      },
      inventory,
      appointments: {
        ...(coreSummary.appointments || {}),
        total: this.toInteger(appointmentResult.rows[0]?.total, 0),
        completed: this.toInteger(appointmentResult.rows[0]?.completed, 0),
        no_show: this.toInteger(appointmentResult.rows[0]?.no_show, 0),
      },
      guardians: {
        ...(coreSummary.guardians || {}),
        total: this.toInteger(guardianResult.rows[0]?.total, 0),
        active: this.toInteger(guardianResult.rows[0]?.active, 0),
      },
      infants: {
        ...(coreSummary.infants || {}),
        total: this.toInteger(infantResult.rows[0]?.total, 0),
        up_to_date: this.toInteger(infantResult.rows[0]?.up_to_date, 0),
      },
      scope: {
        facilityId: normalizedScopeIds[0] || null,
        type: normalizedScopeIds.length > 0 ? 'clinic' : 'system',
      },
    };
  }

  async getAdminSummary({
    startDate = '',
    endDate = '',
    facilityId = null,
    scopeIds = [],
  } = {}) {
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

    const coreSummary = await getAdminMetricsSummary({
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      facilityId,
      scopeIds,
    });
    const metricsSummary =
      normalizedStartDate || normalizedEndDate
        ? coreSummary
        : await this.getAllTimeTruthSummary({
          coreSummary,
          facilityId,
          scopeIds,
        });

    const reportsTable = await this.resolveFirstExistingTable(['reports'], null);
    const reportActivityQuery = reportsTable
      ? `
          SELECT
            COUNT(*)::int AS total_reports,
            COALESCE(SUM(download_count), 0)::int AS total_downloads,
            COUNT(CASE WHEN date_generated >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS reports_last_7_days,
            COUNT(CASE WHEN date_generated >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS reports_last_30_days
          FROM ${reportsTable}
        `
      : null;
    const transferCasesTable = await this.resolveFirstExistingTable(['transfer_in_cases'], null);
    const [
      transferHasValidationStatus,
      transferHasValidatedAt,
      transferHasUpdatedAt,
      transferHasCreatedAt,
    ] = transferCasesTable
      ? await Promise.all([
        this.hasColumn(transferCasesTable, 'validation_status'),
        this.hasColumn(transferCasesTable, 'validated_at'),
        this.hasColumn(transferCasesTable, 'updated_at'),
        this.hasColumn(transferCasesTable, 'created_at'),
      ])
      : [false, false, false, false];
    const transferStatusExpression = transferHasValidationStatus
      ? 'validation_status'
      : `'pending'`;
    const transferTurnaroundExpressionCandidates = [
      transferHasValidatedAt ? 'validated_at' : null,
      transferHasUpdatedAt ? 'updated_at' : null,
      transferHasCreatedAt ? 'created_at' : null,
    ].filter(Boolean);
    const transferTurnaroundExpression = transferTurnaroundExpressionCandidates.length > 0
      ? `COALESCE(${transferTurnaroundExpressionCandidates.join(', ')})`
      : 'NULL';
    const transferSummaryQuery = transferCasesTable
      ? `
          SELECT
            COUNT(*)::int AS total,
            COUNT(
              CASE
                WHEN ${transferStatusExpression} IN ('pending', 'for_validation', 'needs_clarification')
                THEN 1
              END
            )::int AS open_cases,
            ROUND(
              AVG(
                EXTRACT(EPOCH FROM (${transferTurnaroundExpression} - created_at)) / 86400.0
              ) FILTER (WHERE ${transferStatusExpression} IN ('approved', 'rejected')),
              2
            ) AS avg_turnaround_days
          FROM ${transferCasesTable}
        `
      : null;

    const [reports, transfers] = await Promise.all([
      reportActivityQuery
        ? this.pool.query(reportActivityQuery)
        : Promise.resolve({
          rows: [
            {
              total_reports: 0,
              total_downloads: 0,
              reports_last_7_days: 0,
              reports_last_30_days: 0,
            },
          ],
        }),
      transferSummaryQuery
        ? this.pool.query(transferSummaryQuery)
        : Promise.resolve({
          rows: [
            {
              total: 0,
              open_cases: 0,
              avg_turnaround_days: 0,
            },
          ],
        }),
    ]);

    return {
      vaccination: metricsSummary.vaccination,
      inventory: metricsSummary.inventory,
      appointments: metricsSummary.appointments,
      guardians: metricsSummary.guardians,
      infants: metricsSummary.infants,
      reports:
          reports.rows[0] || {
            total_reports: 0,
            total_downloads: 0,
            reports_last_7_days: 0,
            reports_last_30_days: 0,
          },
      transfers:
          transfers.rows[0] || {
            total: 0,
            open_cases: 0,
            avg_turnaround_days: 0,
          },
      scope: metricsSummary.scope,
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
      const vaccineValidation = validateApprovedVaccineName(filters.vaccineType, {
        fieldName: 'vaccineType',
      });
      if (!vaccineValidation.valid) {
        throw this.createHttpError(vaccineValidation.error, 400, 'REPORT_INVALID_VACCINE_FILTER');
      }

      query += ` AND v.name = $${paramIndex}`;
      params.push(vaccineValidation.vaccineName);
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
      const normalizedStatus = normalizeAppointmentStatusFilterKey(filters.status);
      const statusFilterValues =
        APPOINTMENT_STATUS_FILTER_VALUES[normalizedStatus] || [normalizedStatus];

      query += ` AND LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) = ANY($${paramIndex}::text[])`;
      params.push(statusFilterValues);
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
    const [
      clinicsTable,
      facilityColumn,
      issuedColumn,
      wastedColumn,
      stockColumn,
      lotBatchColumn,
      lowStockThresholdColumn,
      criticalStockThresholdColumn,
      periodStartColumn,
      periodEndColumn,
      batchesTable,
    ] = await Promise.all([
      this.getClinicsTableName(),
      this.getInventoryFacilityColumn(),
      this.getInventoryIssuedColumn(),
      this.getInventoryWastedColumn(),
      this.getInventoryStockColumn(),
      this.getInventoryLotBatchColumn(),
      this.getInventoryLowStockThresholdColumn(),
      this.getInventoryCriticalStockThresholdColumn(),
      this.getInventoryPeriodStartColumn(),
      this.getInventoryPeriodEndColumn(),
      this.resolveFirstExistingTable(['vaccine_batches'], null),
    ]);

    const issuedExpression = issuedColumn ? `COALESCE(vi.${issuedColumn}, 0)` : '0';
    const wastedExpression = wastedColumn ? `COALESCE(vi.${wastedColumn}, 0)` : '0';
    const lowStockThresholdExpression = lowStockThresholdColumn
      ? `COALESCE(vi.${lowStockThresholdColumn}, 10)`
      : '10';
    const criticalStockThresholdExpression = criticalStockThresholdColumn
      ? `COALESCE(vi.${criticalStockThresholdColumn}, 5)`
      : '5';
    const stockOnHandExpression = stockColumn
      ? `COALESCE(vi.${stockColumn}, 0)`
      : `(
        COALESCE(vi.beginning_balance, 0)
        + COALESCE(vi.received_during_period, 0)
        + COALESCE(vi.transferred_in, 0)
        - COALESCE(vi.transferred_out, 0)
        - ${wastedExpression}
        - ${issuedExpression}
      )`;
    const lotBatchExpression = lotBatchColumn ? `vi.${lotBatchColumn}` : 'NULL::text';

    let expiryRiskExpression = 'false';
    if (batchesTable) {
      const [batchExpiryColumn, batchIsActiveColumn] = await Promise.all([
        this.resolveFirstExistingColumn(batchesTable, ['expiry_date'], null),
        this.resolveFirstExistingColumn(batchesTable, ['is_active'], null),
      ]);

      if (batchExpiryColumn) {
        expiryRiskExpression = `
          EXISTS (
            SELECT 1
            FROM ${batchesTable} vb
            WHERE vb.vaccine_id = vi.vaccine_id
              AND vb.${batchExpiryColumn} <= CURRENT_DATE + INTERVAL '30 days'
              ${batchIsActiveColumn ? `AND COALESCE(vb.${batchIsActiveColumn}, true) = true` : ''}
          )
        `;
      }
    }

    let query = `
        SELECT
          ROW_NUMBER() OVER (ORDER BY v.name, vi.${periodStartColumn} DESC) AS a,
          v.name AS items,
          COALESCE(vi.beginning_balance, 0) AS beginning_balance,
          COALESCE(vi.received_during_period, 0) AS received,
          ${lotBatchExpression} AS lot_batch_number,
          COALESCE(vi.transferred_in, 0) AS transferred_in,
          COALESCE(vi.transferred_out, 0) AS transferred_out,
          ${wastedExpression} AS expired_wasted,
          ${issuedExpression} AS issued,
          (
            COALESCE(vi.beginning_balance, 0)
            + COALESCE(vi.received_during_period, 0)
          ) AS total_available,
          ${stockOnHandExpression} AS stock_on_hand,
          ${lowStockThresholdExpression} AS low_stock_threshold,
          ${criticalStockThresholdExpression} AS critical_stock_threshold,
          (
            ${stockOnHandExpression} <= ${lowStockThresholdExpression}
          ) AS low_stock_breach,
          (
            ${stockOnHandExpression} <= ${criticalStockThresholdExpression}
          ) AS critical_stock_breach,
          (${expiryRiskExpression}) AS expiry_risk,
          ${facilityColumn && clinicsTable ? 'hf.name' : '\'N/A\''} AS health_center,
          vi.${periodStartColumn} AS period_start,
          vi.${periodEndColumn} AS period_end
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
      query += ` AND vi.${periodStartColumn}::date >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex += 1;
    }

    if (filters.endDate) {
      query += ` AND vi.${periodEndColumn}::date <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex += 1;
    }

    if (filters.category) {
      const vaccineValidation = validateApprovedVaccineName(filters.category, {
        fieldName: 'category',
      });
      if (!vaccineValidation.valid) {
        throw this.createHttpError(vaccineValidation.error, 400, 'REPORT_INVALID_VACCINE_FILTER');
      }

      query += ` AND v.name = $${paramIndex}`;
      params.push(vaccineValidation.vaccineName);
      paramIndex += 1;
    }

    if (filters.lowStockOnly) {
      query += ` AND ${stockOnHandExpression} <= ${lowStockThresholdExpression}`;
    }

    query += ` ORDER BY v.name ASC, vi.${periodStartColumn} DESC`;

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
      const vaccineValidation = validateApprovedVaccineName(filters.vaccineType, {
        fieldName: 'vaccineType',
      });
      if (!vaccineValidation.valid) {
        throw this.createHttpError(vaccineValidation.error, 400, 'REPORT_INVALID_VACCINE_FILTER');
      }

      query += ` AND v.name = $${paramIndex}`;
      params.push(vaccineValidation.vaccineName);
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
