const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');
const appointmentConfirmationService = require('../services/appointmentConfirmationService');
const appointmentSchedulingService = require('../services/appointmentSchedulingService');
const appointmentControlNumberService = require('../services/appointmentControlNumberService');
const appointmentSuggestionService = require('../services/appointmentSuggestionService');
const blockedDatesService = require('../services/blockedDatesService');
const {
  ensureAppointmentRuntimeSchemaInitialized,
} = require('../services/appointmentRuntimeSchemaService');
const {
  notifyAdminsOfGuardianAppointmentEvent,
} = require('../services/appointmentEventNotificationService');
const {
  sendAppointmentConfirmation,
  sendAppointmentRescheduledNotification,
  sendScheduleDateChangedNotification,
  hasNotificationBeenSent,
} = require('../services/smsService');
const socketService = require('../services/socketService');
const {
  hasFieldErrors,
  normalizeBoolean,
  normalizeEnumValue,
  respondValidationError,
  sanitizeIdentifier,
  sanitizeText,
  validateNumberRange,
} = require('../utils/adminValidation');
const {
  getPatientControlNumberById,
  INFANT_CONTROL_NUMBER_PATTERN,
} = require('../services/infantControlNumberService');
const { writeAuditLog } = require('../services/auditLogService');
const { calculateVaccineReadiness } = require('../services/vaccineRulesEngine');
const logger = require('../config/logger');
const {
  CLINIC_TODAY_SQL,
  getClinicBlockedDateKeys,
  getClinicTodayDateKey,
  toClinicDateKey,
  toClinicDateSql,
} = require('../utils/clinicCalendar');
const {
  isAllowedAppointmentTimeSlot,
  formatClinicDateTime,
  normalizeAppointmentRecordForResponse,
  parseAppointmentDateTimeInput,
} = require('../utils/appointmentDateTime');
const { mergeScopeIds } = require('../services/entityScopeService');

const router = express.Router();

router.use(authenticateToken);

const schemaCache = {
  columns: new Map(),
};

const resolveFirstExistingColumn = async (
  tableName,
  candidateColumns,
  fallback = candidateColumns[0],
) => {
  const cacheKey = `${tableName}:${candidateColumns.join(',')}`;
  if (schemaCache.columns.has(cacheKey)) {
    return schemaCache.columns.get(cacheKey);
  }

  try {
    const result = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = ANY($2::text[])
      `,
      [tableName, candidateColumns],
    );

    const availableColumns = new Set(result.rows.map((row) => row.column_name));
    const resolvedColumn =
      candidateColumns.find((columnName) => availableColumns.has(columnName)) ||
      fallback;

    schemaCache.columns.set(cacheKey, resolvedColumn);
    return resolvedColumn;
  } catch (_error) {
    schemaCache.columns.set(cacheKey, fallback);
    return fallback;
  }
};

const getPatientFacilityColumn = () =>
  resolveFirstExistingColumn('patients', ['facility_id', 'clinic_id'], 'facility_id');

const getAppointmentFacilityColumn = () =>
  resolveFirstExistingColumn('appointments', ['facility_id', 'clinic_id'], 'facility_id');

const getAppointmentPatientColumn = () =>
  resolveFirstExistingColumn('appointments', ['patient_id', 'infant_id'], 'patient_id');

const resolveFallbackColumn = async (tableName, primaryColumn, candidateColumns = []) => {
  const fallbackCandidates = candidateColumns.filter(
    (columnName) => columnName && columnName !== primaryColumn,
  );

  if (fallbackCandidates.length === 0) {
    return null;
  }

  return resolveFirstExistingColumn(tableName, fallbackCandidates, null);
};

const buildScopedColumnExpression = (alias, primaryColumn, fallbackColumn = null) => {
  const primary = primaryColumn ? `${alias}.${primaryColumn}` : null;
  const fallback = fallbackColumn ? `${alias}.${fallbackColumn}` : null;

  if (primary && fallback && primary !== fallback) {
    return `COALESCE(${primary}, ${fallback})`;
  }

  return primary || fallback || 'NULL';
};

const getPatientFacilityColumns = async () => {
  const primary = await getPatientFacilityColumn();
  const fallback = await resolveFallbackColumn('patients', primary, ['facility_id', 'clinic_id']);

  return { primary, fallback };
};

const getAppointmentFacilityColumns = async () => {
  const primary = await getAppointmentFacilityColumn();
  const fallback = await resolveFallbackColumn(
    'appointments',
    primary,
    ['facility_id', 'clinic_id'],
  );

  return { primary, fallback };
};

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;
const requireAppointmentReadAccess = (req, res, next) => {
  if (isGuardian(req)) {
    return next();
  }

  return requirePermission('appointment:view')(req, res, next);
};
const requireAppointmentCreateAccess = (req, res, next) => {
  if (isGuardian(req)) {
    return requirePermission('appointment:create:own')(req, res, next);
  }

  return requirePermission('appointment:create')(req, res, next);
};

const APPOINTMENT_STATUS_VALUES = [
  'pending',
  'scheduled',
  'confirmed',
  'rescheduled',
  'attended',
  'cancelled',
  'no_show',
];
const APPOINTMENT_EDIT_LOCKED_STATUSES = [
  'attended',
  'completed',
  'cancelled',
  'no_show',
];

const normalizeAppointmentStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');

  if (!normalized) {
    return '';
  }

  if (normalized === 'completed') {
    return 'attended';
  }

  if (normalized === 'confirmed' || normalized === 'rescheduled') {
    return 'scheduled';
  }

  return normalized;
};

const APPOINTMENT_STATUS_FILTER_VALUES = Object.freeze({
  pending: ['pending'],
  scheduled: ['scheduled', 'confirmed', 'rescheduled'],
  confirmed: ['confirmed'],
  rescheduled: ['rescheduled'],
  attended: ['attended', 'completed'],
  cancelled: ['cancelled'],
  no_show: ['no_show', 'no-show'],
});

const normalizeAppointmentStatusFilterKey = (value) =>
  String(value || '').trim().toLowerCase().replace(/-/g, '_');

const getAppointmentStatusFilterValues = (status) => {
  const normalizedStatus = normalizeAppointmentStatusFilterKey(status);
  return APPOINTMENT_STATUS_FILTER_VALUES[normalizedStatus] || [];
};

const normalizeAppointmentRecord = (appointment) => {
  if (!appointment || typeof appointment !== 'object') {
    return appointment;
  }

  const normalizedStatus = normalizeAppointmentStatus(appointment.status);
  const normalizedAppointment = normalizeAppointmentRecordForResponse({
    ...appointment,
    raw_status: appointment.status,
    status: normalizedStatus || appointment.status,
  });

  return normalizedAppointment;
};

const hasOwn = (payload, key) => Object.prototype.hasOwnProperty.call(payload || {}, key);

const isVaccinationAppointmentType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return normalized.includes('vacc');
};

const isStockAvailabilityIssue = (availability = {}) => {
  const code = String(availability?.code || '').trim().toUpperCase();
  const message = String(availability?.message || availability?.error || '').trim().toLowerCase();

  return (
    code.includes('STOCK') ||
    code.includes('INVENTORY') ||
    message.includes('stock') ||
    message.includes('inventory') ||
    message.includes('vaccine availability')
  );
};

const getEligibleGuardianVaccines = (readinessData = {}) => {
  return [
    ...(Array.isArray(readinessData.overdueVaccines) ? readinessData.overdueVaccines : []),
    ...(Array.isArray(readinessData.dueVaccines) ? readinessData.dueVaccines : []),
  ]
    .map((entry) => parseInt(entry?.vaccineId, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
};

const READINESS_TIMING_WARN_THRESHOLD_MS = Math.max(
  1,
  Number.parseInt(process.env.APPOINTMENT_READINESS_WARN_MS || '1500', 10) || 1500,
);

const resolveGuardianBookingReadiness = async ({
  infantId,
  vaccineId,
  appointmentType,
  scheduledDate = null,
}) => {
  const startedAt = Date.now();

  try {
    const readinessResult = await calculateVaccineReadiness(infantId, {
      scheduledDate,
    });
    const durationMs = Date.now() - startedAt;
    const readinessStatus = readinessResult?.data?.readinessStatus || null;
    const blockedVaccineCount = Array.isArray(readinessResult?.data?.blockedVaccines)
      ? readinessResult.data.blockedVaccines.length
      : 0;

    logger.logPerformance('guardian_appointment_booking_readiness', durationMs, {
      infantId,
      vaccineId: vaccineId || null,
      appointmentType: appointmentType || null,
      scheduledDate: scheduledDate || null,
      readinessStatus,
      blockedVaccineCount,
      success: Boolean(readinessResult?.success),
    });

    if (durationMs >= READINESS_TIMING_WARN_THRESHOLD_MS) {
      logger.warn('Guardian appointment readiness check exceeded expected duration', {
        infantId,
        vaccineId: vaccineId || null,
        appointmentType: appointmentType || null,
        scheduledDate: scheduledDate || null,
        readinessStatus,
        durationMs,
        thresholdMs: READINESS_TIMING_WARN_THRESHOLD_MS,
      });
    }

    return readinessResult;
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    logger.warn('Guardian appointment readiness check failed', {
      infantId,
      vaccineId: vaccineId || null,
      appointmentType: appointmentType || null,
      scheduledDate: scheduledDate || null,
      durationMs,
      thresholdMs: READINESS_TIMING_WARN_THRESHOLD_MS,
      errorMessage: error?.message || 'Unknown readiness error',
      errorCode: error?.code || error?.statusCode || null,
    });

    throw error;
  }
};

const enforceGuardianVaccinationEligibility = async ({
  infantId,
  vaccineId,
  appointmentType,
  scheduledDate = null,
}) => {
  const vaccinationFlow = isVaccinationAppointmentType(appointmentType) || Number.isInteger(vaccineId);
  if (!vaccinationFlow) {
    return {
      vaccineId: vaccineId || null,
      readiness: null,
    };
  }

  const readinessResult = await resolveGuardianBookingReadiness({
    infantId,
    vaccineId,
    appointmentType,
    scheduledDate,
  });
  if (!readinessResult?.success || !readinessResult?.data) {
    const error = new Error('Failed to resolve vaccination readiness for this child');
    error.statusCode = 500;
    error.code = 'READINESS_UNAVAILABLE';
    throw error;
  }

  const readiness = readinessResult.data;
  const eligibleVaccineIds = getEligibleGuardianVaccines(readiness);
  const eligibleVaccineSet = new Set(eligibleVaccineIds);
  const blockedVaccineSet = new Set(
    (Array.isArray(readiness.blockedVaccines) ? readiness.blockedVaccines : [])
      .map((entry) => parseInt(entry?.vaccineId, 10))
      .filter((value) => Number.isInteger(value) && value > 0),
  );

  if (Number.isInteger(vaccineId) && eligibleVaccineSet.has(vaccineId)) {
    return {
      vaccineId,
      readiness,
    };
  }

  if (!Number.isInteger(vaccineId) && eligibleVaccineIds.length > 0) {
    return {
      vaccineId: eligibleVaccineIds[0],
      readiness,
    };
  }

  const error = new Error(
    readiness.readinessStatus === 'PENDING_CONFIRMATION'
      ? 'This child is waiting for health center confirmation before a vaccination appointment can be booked.'
      : readiness.readinessStatus === 'UPCOMING'
        ? 'This child is not yet eligible for the next vaccination appointment.'
        : 'No eligible vaccine is currently available for booking for this child.',
  );
  error.statusCode = 400;
  error.code =
    readiness.readinessStatus === 'PENDING_CONFIRMATION'
      ? 'PENDING_CONFIRMATION'
      : readiness.readinessStatus === 'UPCOMING'
        ? 'NOT_YET_ELIGIBLE'
        : blockedVaccineSet.has(vaccineId)
          ? 'PENDING_CONFIRMATION'
          : 'NO_ELIGIBLE_VACCINE';
  error.readiness = readiness;
  throw error;
};

const sanitizeAppointmentMutablePayload = (payload = {}, { allowStatus = true } = {}) => {
  const errors = {};
  const normalized = {};

  if (hasOwn(payload, 'scheduled_date')) {
    const scheduledDate = sanitizeText(payload.scheduled_date);
    if (!scheduledDate) {
      errors.scheduled_date = 'scheduled_date is required';
    } else {
      const parsedDate = parseAppointmentDateTimeInput(scheduledDate, { requireTime: true });
      if (!parsedDate) {
        errors.scheduled_date = 'scheduled_date must be a valid date and time';
      } else if (!isAllowedAppointmentTimeSlot(parsedDate.time)) {
        errors.scheduled_date = 'scheduled_date must be between 8:00 AM and 4:00 PM in 30-minute slots';
      } else {
        const todayManila = getClinicTodayDateKey();
        const parsedManila = parsedDate.dateKey;

        if (parsedManila < todayManila) {
          errors.scheduled_date =
            'Cannot schedule appointments in the past. Please select today or a future date.';
        } else {
          normalized.scheduled_date = parsedDate.normalizedIsoString;
        }
      }
    }
  }

  if (hasOwn(payload, 'type')) {
    const type = sanitizeText(payload.type, { maxLength: 100 });
    if (!type) {
      errors.type = 'type is required';
    } else {
      normalized.type = type;
    }
  }

  if (hasOwn(payload, 'duration_minutes')) {
    const durationCheck = validateNumberRange(payload.duration_minutes, {
      label: 'duration_minutes',
      required: true,
      min: 5,
      max: 480,
      integer: true,
    });

    if (durationCheck.error) {
      errors.duration_minutes = durationCheck.error;
    } else {
      normalized.duration_minutes = durationCheck.value;
    }
  }

  if (hasOwn(payload, 'notes')) {
    const notes = sanitizeText(payload.notes, { preserveNewLines: true });
    if (notes.length > 500) {
      errors.notes = 'notes must not exceed 500 characters';
    } else {
      normalized.notes = notes || null;
    }
  }

  if (hasOwn(payload, 'location')) {
    const location = sanitizeText(payload.location);
    if (location.length > 150) {
      errors.location = 'location must not exceed 150 characters';
    } else {
      normalized.location = location || null;
    }
  }

  if (hasOwn(payload, 'status')) {
    if (!allowStatus) {
      errors.status = 'status updates are not allowed for this account';
    } else {
      const statusInput = sanitizeText(payload.status).toLowerCase();
      const status = normalizeEnumValue(statusInput, APPOINTMENT_STATUS_VALUES, '');

      if (!status) {
        errors.status = `status must be one of: ${APPOINTMENT_STATUS_VALUES.join(', ')}`;
      } else {
        normalized.status = status;
      }
    }
  }

  if (hasOwn(payload, 'cancellation_reason')) {
    const cancellationReason = sanitizeText(payload.cancellation_reason, {
      preserveNewLines: true,
    });
    if (cancellationReason.length > 500) {
      errors.cancellation_reason = 'cancellation_reason must not exceed 500 characters';
    } else {
      normalized.cancellation_reason = cancellationReason || null;
    }
  }

  if (hasOwn(payload, 'completion_notes')) {
    const completionNotes = sanitizeText(payload.completion_notes, {
      preserveNewLines: true,
    });
    if (completionNotes.length > 500) {
      errors.completion_notes = 'completion_notes must not exceed 500 characters';
    } else {
      normalized.completion_notes = completionNotes || null;
    }
  }

  return { normalized, errors };
};

const sanitizeLimit = (value, fallback = 10, max = 100) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
};

const sanitizeNullableInt = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
};

const resolveAppointmentScopeContext = (req, explicitScopeIds = []) => {
  const canonicalRole = getCanonicalRole(req);
  const userScopeIds = mergeScopeIds(req.user?.clinic_id, req.user?.facility_id);
  const requestedScopeIds = mergeScopeIds(explicitScopeIds);
  const requestedScope = String(req.query?.scope || '').trim().toLowerCase();
  const allowSystemScope =
    canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN && requestedScope === 'system';

  if (
    canonicalRole !== CANONICAL_ROLES.GUARDIAN &&
    !allowSystemScope &&
    requestedScopeIds.length > 0 &&
    userScopeIds.length > 0 &&
    requestedScopeIds.some((scopeId) => !userScopeIds.includes(scopeId))
  ) {
    return {
      error: 'Cross-facility appointment access is not allowed. Use your assigned facility scope.',
      status: 403,
    };
  }

  if (canonicalRole === CANONICAL_ROLES.GUARDIAN || allowSystemScope) {
    return {
      canonicalRole,
      scopeIds: [],
      useScope: false,
    };
  }

  const scopeIds = requestedScopeIds.length > 0 ? requestedScopeIds : userScopeIds;
  return {
    canonicalRole,
    scopeIds,
    useScope: scopeIds.length > 0,
  };
};

const APPOINTMENT_LIST_SORT_COLUMNS = Object.freeze({
  scheduled_date: 'a.scheduled_date',
  first_name: 'p.first_name',
  status: 'COALESCE(a.status::text, \'\')',
  type: 'COALESCE(a.type::text, \'\')',
});

const APPOINTMENT_LOCAL_DATE_EXPRESSION = toClinicDateSql('a.scheduled_date');

const sanitizeSortDirection = (value, fallback = 'desc') =>
  String(value || fallback).trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';

const resolveSlotClinicId = (req, payloadClinicId) => {
  if (payloadClinicId) {
    return payloadClinicId;
  }
  if (req.user?.clinic_id) {
    return sanitizeNullableInt(req.user.clinic_id);
  }
  return null;
};

const CONTROL_NUMBER_FORMAT_ERROR = 'control_number must match INF-YYYY-######';

const recordAppointmentAuditEvent = async ({
  req,
  eventType,
  appointmentId,
  oldValues = null,
  newValues = null,
  metadata = null,
  severity = 'INFO',
}) => {
  await writeAuditLog({
    req,
    eventType,
    entityType: 'appointment',
    entityId: appointmentId || oldValues?.id || newValues?.id || null,
    oldValues,
    newValues,
    metadata,
    severity,
  });
};

const patientService = require('../services/patientService');

const fetchInfantOwnership = async (infantId) => {
  const patient = await patientService.getPatientById(infantId);
  if (!patient) {
    return null;
  }

  return {
    id: patient.id,
    guardian_id: patient.guardianId,
    clinic_id: patient.clinicId || null,
  };
};

const fetchAppointmentById = async (id) => {
  const {
    primary: patientFacilityColumn,
    fallback: patientFacilityFallbackColumn,
  } = await getPatientFacilityColumns();
  const {
    primary: appointmentFacilityColumn,
    fallback: appointmentFacilityFallbackColumn,
  } = await getAppointmentFacilityColumns();
  const appointmentPatientColumn = await getAppointmentPatientColumn();
  const patientFacilityExpression = buildScopedColumnExpression(
    'p',
    patientFacilityColumn,
    patientFacilityFallbackColumn,
  );
  const appointmentFacilityExpression = buildScopedColumnExpression(
    'a',
    appointmentFacilityColumn,
    appointmentFacilityFallbackColumn,
  );
  const resolvedClinicExpression = `COALESCE(${patientFacilityExpression}, ${appointmentFacilityExpression})`;

  const result = await pool.query(
    `
      SELECT
        a.*,
        a.${appointmentPatientColumn} AS infant_id,
        p.first_name AS first_name,
        p.last_name AS last_name,
        p.control_number AS control_number,
        p.guardian_id AS owner_guardian_id,
        ${resolvedClinicExpression} AS resolved_clinic_id,
        g.name AS guardian_name,
        g.phone AS guardian_phone,
        g.email AS guardian_email
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.${appointmentPatientColumn}
      LEFT JOIN guardians g ON g.id = p.guardian_id
      WHERE a.id = $1
        AND a.is_active = true AND p.is_active = true
      LIMIT 1
    `,
    [id],
  );

  return normalizeAppointmentRecord(result.rows[0] || null);
};

// Get all appointments
router.get('/', requireAppointmentReadAccess, async (req, res) => {
  try {
    const {
      status,
      date,
      search,
      query: searchQuery,
      start_date,
      startDate,
      end_date,
      endDate,
      infant_id,
      clinic_id,
      facility_id,
      page = 1,
      limit = 50,
      sort_field,
      sortField,
      sort_direction,
      sortDirection,
    } = req.query;
    const canonicalRole = getCanonicalRole(req);
    const {
      primary: patientFacilityColumn,
      fallback: patientFacilityFallbackColumn,
    } = await getPatientFacilityColumns();
    const {
      primary: appointmentFacilityColumn,
      fallback: appointmentFacilityFallbackColumn,
    } = await getAppointmentFacilityColumns();
    const appointmentPatientColumn = await getAppointmentPatientColumn();
    const patientFacilityExpression = buildScopedColumnExpression(
      'p',
      patientFacilityColumn,
      patientFacilityFallbackColumn,
    );
    const appointmentFacilityExpression = buildScopedColumnExpression(
      'a',
      appointmentFacilityColumn,
      appointmentFacilityFallbackColumn,
    );
    const resolvedClinicExpression = `COALESCE(${patientFacilityExpression}, ${appointmentFacilityExpression})`;
    const requestedScopeIds = mergeScopeIds(clinic_id, facility_id);
    const scopeContext = resolveAppointmentScopeContext(req, requestedScopeIds);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({ error: scopeContext.error });
    }

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;
    const normalizedSearch = sanitizeText(search ?? searchQuery);
    const normalizedStartDate = sanitizeText(start_date ?? startDate);
    const normalizedEndDate = sanitizeText(end_date ?? endDate);
    const normalizedSortField = APPOINTMENT_LIST_SORT_COLUMNS[sort_field || sortField]
      ? (sort_field || sortField)
      : 'scheduled_date';
    const normalizedSortDirection = sanitizeSortDirection(sort_direction || sortDirection);

    if (normalizedStartDate && Number.isNaN(Date.parse(normalizedStartDate))) {
      return res.status(400).json({ error: 'start_date must be a valid date' });
    }

    if (normalizedEndDate && Number.isNaN(Date.parse(normalizedEndDate))) {
      return res.status(400).json({ error: 'end_date must be a valid date' });
    }

    const blockingClinicId =
      sanitizeNullableInt(clinic_id) ||
      sanitizeNullableInt(facility_id) ||
      sanitizeNullableInt(req.user?.clinic_id) ||
      sanitizeNullableInt(req.user?.facility_id) ||
      null;
    const blockedDateKeys =
      date || normalizedStartDate || normalizedEndDate
        ? await getClinicBlockedDateKeys({
          startDate: normalizedStartDate || date || normalizedEndDate,
          endDate: normalizedEndDate || date || normalizedStartDate,
          clinicId: blockingClinicId,
        })
        : [];

    const params = [];
    let query = `
      SELECT
        a.*,
        a.${appointmentPatientColumn} AS infant_id,
        p.first_name AS first_name,
        p.last_name AS last_name,
        p.control_number AS control_number,
        p.guardian_id AS owner_guardian_id,
        ${resolvedClinicExpression} AS resolved_clinic_id,
        g.name AS guardian_name,
        g.phone AS guardian_phone
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.${appointmentPatientColumn}
      LEFT JOIN guardians g ON g.id = p.guardian_id
      WHERE a.is_active = true
        AND p.is_active = true
    `;

    if (canonicalRole === CANONICAL_ROLES.GUARDIAN) {
      if (!req.user.guardian_id) {
        return res.status(403).json({ error: 'Guardian account mapping is missing' });
      }

      query += ` AND p.guardian_id = $${params.length + 1}`;
      params.push(parseInt(req.user.guardian_id, 10));
    }

    if (
      canonicalRole !== CANONICAL_ROLES.GUARDIAN &&
      scopeContext.useScope
    ) {
      query += ` AND ${resolvedClinicExpression} = ANY($${params.length + 1}::int[])`;
      params.push(scopeContext.scopeIds);
    }

    if (status) {
      const statusFilterValues = getAppointmentStatusFilterValues(status);
      if (statusFilterValues.length === 0) {
        return res.status(400).json({
          error: `status must be one of: ${APPOINTMENT_STATUS_VALUES.join(', ')}`,
          code: 'INVALID_STATUS',
        });
      }

      query += ` AND LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) = ANY($${params.length + 1}::text[])`;
      params.push(statusFilterValues);
    }

    if (date) {
      query += ` AND ${APPOINTMENT_LOCAL_DATE_EXPRESSION} = $${params.length + 1}::date`;
      params.push(date);
    }

    if (normalizedStartDate) {
      query += ` AND ${APPOINTMENT_LOCAL_DATE_EXPRESSION} >= $${params.length + 1}::date`;
      params.push(normalizedStartDate);
    }

    if (normalizedEndDate) {
      query += ` AND ${APPOINTMENT_LOCAL_DATE_EXPRESSION} <= $${params.length + 1}::date`;
      params.push(normalizedEndDate);
    }

    if (blockedDateKeys.length > 0) {
      query += ` AND ${APPOINTMENT_LOCAL_DATE_EXPRESSION} <> ALL($${params.length + 1}::date[])`;
      params.push(blockedDateKeys);
    }

    if (infant_id) {
      query += ` AND a.${appointmentPatientColumn} = $${params.length + 1}`;
      params.push(parseInt(infant_id, 10));
    }

    if (normalizedSearch) {
      query += `
        AND (
          COALESCE(p.first_name, '') ILIKE $${params.length + 1}
          OR COALESCE(p.last_name, '') ILIKE $${params.length + 1}
          OR CONCAT_WS(
            ' ',
            NULLIF(BTRIM(p.first_name), ''),
            NULLIF(BTRIM(p.middle_name), ''),
            NULLIF(BTRIM(p.last_name), '')
          ) ILIKE $${params.length + 1}
          OR COALESCE(g.name, '') ILIKE $${params.length + 1}
          OR COALESCE(p.control_number, '') ILIKE $${params.length + 1}
          OR COALESCE(g.phone, '') ILIKE $${params.length + 1}
          OR COALESCE(TO_CHAR(p.dob, 'YYYY-MM-DD'), '') ILIKE $${params.length + 1}
          OR COALESCE(TO_CHAR(p.dob, 'MM/DD/YYYY'), '') ILIKE $${params.length + 1}
          OR COALESCE(a.type, '') ILIKE $${params.length + 1}
          OR COALESCE(a.status::text, '') ILIKE $${params.length + 1}
        )
      `;
      params.push(`%${normalizedSearch}%`);
    }

    // Get total count for pagination metadata
    const countQuery = `SELECT COUNT(*) as count FROM (${query}) AS subquery`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add a stable secondary sort to prevent duplicate rows across pages when
    // many appointments share the same primary sort value.
    const primarySortColumn = APPOINTMENT_LIST_SORT_COLUMNS[normalizedSortField];
    const secondarySortClause = primarySortColumn === 'a.id'
      ? ''
      : `, a.id ${normalizedSortDirection}`;

    query += ` ORDER BY ${primarySortColumn} ${normalizedSortDirection}${secondarySortClause} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitNum, offset);

    const result = await pool.query(query, params);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      data: result.rows.map(normalizeAppointmentRecord),
      metadata: {
        page: pageNum,
        limit: limitNum,
        total: total,
        totalPages: totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error('List appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Create appointment (SYSTEM_ADMIN full, GUARDIAN own request)
router.post('/', requireAppointmentCreateAccess, async (req, res) => {
  try {
    console.log('[DEBUG] Create appointment request:', JSON.stringify(req.body, null, 2));
    await ensureAppointmentRuntimeSchemaInitialized();
    const payload = req.body || {};
    const { normalized, errors } = sanitizeAppointmentMutablePayload(payload, {
      allowStatus: true,
    });

    // Handle infant identification or creation
    let infantId = payload.infant_id;

    // If no ID but details provided (auto-create flow)
    if (!infantId && payload.infant_details && isGuardian(req)) {
      try {
        // Use canonical patient service to create/validate infant
        const infantRecord = await appointmentSchedulingService.ensureInfantRecord(
          payload.infant_details,
          req.user.guardian_id,
        );
        infantId = infantRecord.id;
      } catch (_err) {
        errors.infant_id = 'Failed to verify or create infant record';
      }
    } else {
      const infantIdCheck = validateNumberRange(payload.infant_id, {
        label: 'infant_id',
        required: true,
        min: 1,
        integer: true,
      });
      if (infantIdCheck.error) {
        errors.infant_id = infantIdCheck.error;
      }
    }

    if (!hasOwn(payload, 'scheduled_date')) {
      errors.scheduled_date = 'scheduled_date is required';
    }

    if (!hasOwn(payload, 'type')) {
      errors.type = 'type is required';
    }

    const clinicIdCheck = validateNumberRange(payload.clinic_id, {
      label: 'clinic_id',
      required: false,
      min: 1,
      integer: true,
    });
    if (hasOwn(payload, 'clinic_id') && clinicIdCheck.error) {
      errors.clinic_id = clinicIdCheck.error;
    }

    const vaccineIdCheck = validateNumberRange(payload.vaccine_id, {
      label: 'vaccine_id',
      required: false,
      min: 1,
      integer: true,
    });
    if (hasOwn(payload, 'vaccine_id') && vaccineIdCheck.error) {
      errors.vaccine_id = vaccineIdCheck.error;
    }

    const controlNumberInput = sanitizeText(payload.control_number);
    const normalizedControlNumber = controlNumberInput
      ? sanitizeIdentifier(controlNumberInput, {
        maxLength: 40,
        allowDash: true,
        upperCase: true,
      })
      : null;

    if (controlNumberInput && !normalizedControlNumber) {
      errors.control_number = 'control_number is invalid';
    } else if (
      normalizedControlNumber &&
      !INFANT_CONTROL_NUMBER_PATTERN.test(normalizedControlNumber)
    ) {
      errors.control_number = CONTROL_NUMBER_FORMAT_ERROR;
    }

    if (hasFieldErrors(errors)) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error: 'Validation failed',
        fields: errors,
        details: errors,
      });
    }

    const normalizedScheduledDate = normalized.scheduled_date;
    const normalizedType = normalized.type;
    const normalizedNotes = hasOwn(normalized, 'notes') ? normalized.notes : null;
    const normalizedDuration = hasOwn(normalized, 'duration_minutes')
      ? normalized.duration_minutes
      : 30;
    const normalizedLocation = hasOwn(normalized, 'location')
      ? normalized.location || null
      : sanitizeText(payload.location, { maxLength: 150 }) || null;
    const sendConfirmationSms = normalizeBoolean(payload.send_confirmation_sms, true);

    const infant = await fetchInfantOwnership(infantId);
    if (!infant) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    const storedControlNumber = String(
      (await getPatientControlNumberById(infantId, pool)) || '',
    )
      .trim()
      .toUpperCase();

    if (normalizedControlNumber && storedControlNumber && normalizedControlNumber !== storedControlNumber) {
      return res.status(400).json({
        error: 'Control number does not match infant record',
        fields: {
          control_number: 'Control number does not match infant record',
        },
      });
    }

    const guardianFlow = isGuardian(req);
    if (guardianFlow) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      if (!guardianId || guardianId !== parseInt(infant.guardian_id, 10)) {
        return res.status(403).json({ error: 'You can only create appointments for your own infant' });
      }
    }

    // Auto-approve all valid appointments passing availability checks
    const finalStatus = normalized.status || 'scheduled';
    const finalClinicId = clinicIdCheck.value || infant.clinic_id || req.user.clinic_id || null;
    let finalVaccineId = vaccineIdCheck.value || null;
    const appointmentPatientColumn = await getAppointmentPatientColumn();
    const appointmentFacilityColumn = await getAppointmentFacilityColumn();

    if (guardianFlow) {
      try {
        const guardianEligibility = await enforceGuardianVaccinationEligibility({
          infantId,
          vaccineId: finalVaccineId,
          appointmentType: normalizedType,
          scheduledDate: normalizedScheduledDate,
        });
        finalVaccineId = guardianEligibility.vaccineId;
      } catch (eligibilityError) {
        if (eligibilityError.statusCode) {
          return res.status(eligibilityError.statusCode).json({
            error: eligibilityError.message,
            code: eligibilityError.code,
            readiness: eligibilityError.readiness || null,
          });
        }

        throw eligibilityError;
      }
    }

    let stockWarning = null;
    let stockUnverified = false;
    let availability = {
      available: true,
      code: 'BOOKING_AVAILABLE',
      message: 'Booking date is available',
    };

    try {
      availability = await appointmentSchedulingService.checkBookingAvailability({
        scheduledDate: normalizedScheduledDate,
        vaccineId: finalVaccineId,
        clinicId: sanitizeNullableInt(finalClinicId),
        appointmentType: normalizedType,
      });
    } catch (availabilityError) {
      if (!guardianFlow) {
        throw availabilityError;
      }

      stockUnverified = true;
      stockWarning = 'Could not verify vaccine stock availability. The health center will confirm stock before the appointment.';
      logger.warn('Guardian appointment availability check failed; continuing with stock warning', {
        infantId,
        vaccineId: finalVaccineId,
        clinicId: finalClinicId,
        scheduledDate: normalizedScheduledDate,
        errorMessage: availabilityError?.message || 'Unknown availability error',
      });
    }

    if (availability?.stock_warning) {
      stockUnverified = true;
      stockWarning =
        availability.stock_warning ||
        'Could not verify vaccine stock availability. The health center will confirm stock before the appointment.';
    }

    if (!availability.available) {
      if (guardianFlow && isStockAvailabilityIssue(availability)) {
        stockUnverified = true;
        stockWarning =
          availability.message ||
          'Could not verify vaccine stock availability. The health center will confirm stock before the appointment.';

        logger.warn('Guardian appointment stock availability issue converted to soft warning', {
          infantId,
          vaccineId: finalVaccineId,
          clinicId: finalClinicId,
          scheduledDate: normalizedScheduledDate,
          availabilityCode: availability.code,
          availabilityMessage: availability.message,
        });

        if (availability.code === 'SELECTED_VACCINE_OUT_OF_STOCK') {
          try {
            await appointmentSchedulingService.notifyGuardianVaccineUnavailable({
              guardianId: parseInt(req.user.guardian_id, 10),
              infantId,
              vaccineId: finalVaccineId,
              scheduledDate: normalizedScheduledDate,
              clinicId: sanitizeNullableInt(finalClinicId),
            });
          } catch (notifyError) {
            console.error('Failed to send vaccine unavailable notification:', notifyError.message);
          }
        }
      } else {
        return res.status(400).json({
          error: availability.message,
          code: availability.code,
          availability,
        });
      }
    }

    if (!stockWarning && stockUnverified) {
      stockWarning = 'Could not verify vaccine stock availability. The health center will confirm stock before the appointment.';
    }

    if (!availability.available && guardianFlow && !stockWarning) {
      stockWarning = availability.message || 'Vaccine stock could not be verified.';
    }

    const conflictingAppointment = await appointmentSchedulingService.findConflictingActiveAppointment({
      infantId,
      scheduledDate: normalizedScheduledDate,
    });

    if (conflictingAppointment) {
      return res.status(409).json({
        error: 'This child already has an active appointment on the selected date.',
        code: 'DUPLICATE_APPOINTMENT',
        conflict: normalizeAppointmentRecord(conflictingAppointment),
      });
    }

    // Generate appointment control number
    let appointmentControlNumber = null;
    try {
      appointmentControlNumber = await appointmentControlNumberService.generateControlNumber();
    } catch (cnError) {
      console.error('Failed to generate control number:', cnError.message);
      // Continue without control number - non-critical
    }

    const result = await pool.query(
      `
        INSERT INTO appointments (
          ${appointmentPatientColumn},
          scheduled_date,
          type,
          vaccine_id,
          duration_minutes,
          notes,
          status,
          created_by,
          ${appointmentFacilityColumn},
          location,
          control_number,
          guardian_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `,
      [
        infantId,
        normalizedScheduledDate,
        normalizedType,
        finalVaccineId,
        normalizedDuration,
        normalizedNotes,
        finalStatus,
        req.user.id,
        finalClinicId,
        normalizedLocation,
        appointmentControlNumber,
        infant.guardian_id,
      ],
    );

    console.log('[DEBUG] Appointment created:', JSON.stringify(result.rows[0], null, 2));

    const appointment = result.rows[0];
    let fullAppointment = appointment;
    try {
      fullAppointment = (await fetchAppointmentById(appointment.id)) || appointment;
    } catch (fetchError) {
      console.error('Failed to fetch full appointment after creation:', fetchError.message);
    }

    if (fullAppointment?.owner_guardian_id) {
      try {
        await appointmentConfirmationService.notifyGuardianAppointmentBooked({
          guardianId: fullAppointment.owner_guardian_id,
          guardianName: fullAppointment.guardian_name || 'Guardian',
          infantName: `${fullAppointment.first_name || ''} ${fullAppointment.last_name || ''}`.trim() || 'Your child',
          appointmentId: appointment.id,
          scheduledDate: fullAppointment.scheduled_date,
          clinicName: fullAppointment.location || fullAppointment.clinic_name || 'Main Health Center',
          appointmentType: fullAppointment.type || 'Vaccination',
        });
      } catch (notificationError) {
        console.error('Failed to create in-app appointment notification:', notificationError.message);
      }
    }

    if (guardianFlow) {
      try {
        await notifyAdminsOfGuardianAppointmentEvent({
          event: 'created',
          appointment: fullAppointment,
          actorUserId: req.user.id,
          guardianName: fullAppointment.guardian_name || null,
          infantName: `${fullAppointment.first_name || ''} ${fullAppointment.last_name || ''}`.trim(),
        });
      } catch (notifyError) {
        console.error('Failed to notify admins of guardian appointment event:', notifyError.message);
      }
    }

    if (sendConfirmationSms) {
      try {
        await appointmentConfirmationService.sendConfirmationSMS(appointment.id);
      } catch (smsError) {
        console.error('Failed to send confirmation SMS:', smsError.message);
      }
    }

    const normalizedAppointment = {
      ...normalizeAppointmentRecord(fullAppointment),
      stock_unverified: stockUnverified,
      stock_warning: stockWarning,
      stockWarning,
    };

    try {
      await recordAppointmentAuditEvent({
        req,
        eventType: guardianFlow ? 'GUARDIAN_APPOINTMENT_CREATED' : 'APPOINTMENT_CREATED',
        appointmentId: appointment.id,
        newValues: normalizedAppointment,
        metadata: {
          guardian_flow: guardianFlow,
          vaccine_id: finalVaccineId,
          clinic_id: finalClinicId,
          control_number: appointmentControlNumber,
          stock_unverified: stockUnverified,
          stock_warning: stockWarning,
        },
      });
    } catch (auditError) {
      console.error('Failed to record appointment audit event:', auditError.message);
    }

    socketService.broadcast('appointment_created', normalizedAppointment);
    res.status(201).json(normalizedAppointment);
  } catch (error) {
    console.error('[DEBUG] Create appointment error:', error);
    console.error('[DEBUG] Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// Check booking availability (GUARDIAN and SYSTEM_ADMIN)
router.get('/availability/check', requireAppointmentReadAccess, async (req, res) => {
  try {
    const { scheduled_date, vaccine_id, clinic_id, type } = req.query;

    if (!scheduled_date) {
      return res.status(400).json({
        error: 'scheduled_date is required',
      });
    }

    const availability = await appointmentSchedulingService.checkBookingAvailability({
      scheduledDate: scheduled_date,
      vaccineId: sanitizeNullableInt(vaccine_id),
      clinicId: sanitizeNullableInt(clinic_id || req.user.clinic_id),
      appointmentType: type || null,
    });

    res.json(availability);
  } catch (error) {
    console.error('Check appointment availability error:', error);
    res.status(500).json({ error: 'Failed to check appointment availability' });
  }
});

// Check vaccine stock for specific date/time (for appointment suggestions)
router.post('/check-stock', requireAppointmentReadAccess, async (req, res) => {
  try {
    const { date, time, vaccine_id, clinic_id } = req.body;

    if (!date || !time || !vaccine_id) {
      return res.status(400).json({
        error: 'Date, time, and vaccine ID are required',
        code: 'MISSING_PARAMETERS',
      });
    }

    const stockCheck = await appointmentSchedulingService.checkVaccineStockForDateTime({
      date,
      time,
      vaccineId: sanitizeNullableInt(vaccine_id),
      clinicId: sanitizeNullableInt(clinic_id || req.user.clinic_id),
    });

    res.json(stockCheck);
  } catch (error) {
    console.error('Check vaccine stock error:', error);
    res.status(500).json({ error: 'Failed to check vaccine stock availability' });
  }
});

// Reschedule an appointment (SYSTEM_ADMIN)
router.put('/:id(\\d+)/reschedule', async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id, 10);
    if (Number.isNaN(appointmentId)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }

    const appointment = await fetchAppointmentById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Use infantId for validation: verify infant still exists and is active using canonical service
    const infant = await patientService.getPatientById(appointment.infant_id);
    if (!infant || !infant.isActive) {
      return res.status(400).json({ error: 'Invalid infant record for this appointment' });
    }

    const guardianFlow = isGuardian(req);
    const canonicalRole = getCanonicalRole(req);

    if (guardianFlow) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      if (!guardianId || guardianId !== parseInt(appointment.owner_guardian_id, 10)) {
        return res.status(403).json({ error: 'You can only reschedule your own appointment requests' });
      }
    } else if (
      canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN &&
      canonicalRole !== CANONICAL_ROLES.CLINIC_MANAGER
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { scheduled_date, vaccine_id, clinic_id, notes } = req.body;

    // Validate required fields
    if (!scheduled_date) {
      return res.status(400).json({ error: 'scheduled_date is required' });
    }

    const parsedScheduledDate = parseAppointmentDateTimeInput(scheduled_date, { requireTime: true });
    if (!parsedScheduledDate) {
      return res.status(400).json({
        error: 'scheduled_date must be a valid date and time',
      });
    }

    if (!isAllowedAppointmentTimeSlot(parsedScheduledDate.time)) {
      return res.status(400).json({
        error: 'scheduled_date must be between 8:00 AM and 4:00 PM in 30-minute slots',
      });
    }

    const normalizedScheduledDate = parsedScheduledDate.normalizedIsoString;

    // Validate vaccine_id if provided
    let finalVaccineId = appointment.vaccine_id; // Keep existing vaccine by default
    if (vaccine_id !== undefined && vaccine_id !== null && vaccine_id !== '') {
      const vaccineIdCheck = validateNumberRange(vaccine_id, {
        label: 'vaccine_id',
        required: true,
        min: 1,
        integer: true,
      });
      if (vaccineIdCheck.error) {
        return res.status(400).json({ error: vaccineIdCheck.error });
      }
      finalVaccineId = parseInt(vaccine_id, 10);
    }

    // Validate clinic_id if provided
    let finalClinicId = appointment.resolved_clinic_id; // Keep existing clinic by default
    if (clinic_id !== undefined && clinic_id !== null && clinic_id !== '') {
      const clinicIdCheck = validateNumberRange(clinic_id, {
        label: 'clinic_id',
        required: false,
        min: 1,
        integer: true,
      });
      if (clinicIdCheck.error) {
        return res.status(400).json({ error: clinicIdCheck.error });
      }
      finalClinicId = parseInt(clinic_id, 10);
    }

    // Check booking availability for the new date
    const availability = await appointmentSchedulingService.checkBookingAvailability({
      scheduledDate: normalizedScheduledDate,
      vaccineId: finalVaccineId,
      clinicId: finalClinicId,
      appointmentType: appointment.type,
      excludeAppointmentId: appointmentId,
    });

    if (!availability.available) {
      if (availability.code === 'SELECTED_VACCINE_OUT_OF_STOCK') {
        try {
          await appointmentSchedulingService.notifyGuardianVaccineUnavailable({
            guardianId: appointment.owner_guardian_id,
            infantId: appointment.infant_id,
            vaccineId: finalVaccineId,
            scheduledDate: normalizedScheduledDate,
            clinicId: finalClinicId,
          });
        } catch (notifyError) {
          console.error('Failed to send vaccine unavailable notification:', notifyError.message);
        }
      }

      return res.status(400).json({
        error: availability.message,
        code: availability.code,
        availability,
      });
    }

    // Update the appointment using schema-aware column names
    const { appointmentsScope } = await appointmentSchedulingService.getSchemaColumnMappings();

    const result = await pool.query(
      `
        UPDATE appointments
        SET scheduled_date = $1,
            vaccine_id = $2,
            ${appointmentsScope} = $3,
            notes = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING *
      `,
      [
        normalizedScheduledDate,
        finalVaccineId,
        finalClinicId,
        notes || null,
        appointmentId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const updatedAppointment = (await fetchAppointmentById(appointmentId)) || result.rows[0];
    const normalizedAppointment = normalizeAppointmentRecord(updatedAppointment);

    await recordAppointmentAuditEvent({
      req,
      eventType: guardianFlow ? 'GUARDIAN_APPOINTMENT_RESCHEDULED' : 'APPOINTMENT_RESCHEDULED',
      appointmentId,
      oldValues: normalizeAppointmentRecord(appointment),
      newValues: normalizedAppointment,
      metadata: {
        previous_scheduled_date: appointment.scheduled_date,
        new_scheduled_date: updatedAppointment.scheduled_date,
        vaccine_id: finalVaccineId,
        clinic_id: finalClinicId,
      },
      severity: 'WARNING',
    });

    // Send rescheduling notification
    if (updatedAppointment.guardian_phone) {
      try {
        await sendAppointmentRescheduledNotification({
          phoneNumber: updatedAppointment.guardian_phone,
          guardianName: updatedAppointment.guardian_name || 'Guardian',
          childName: `${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim(),
          vaccineName: updatedAppointment.type || 'Vaccination',
          oldScheduledDate: appointment.scheduled_date,
          newScheduledDate: updatedAppointment.scheduled_date,
          location: updatedAppointment.location || null,
        });
      } catch (notificationError) {
        console.error('Failed to send rescheduling notification:', notificationError.message);
        // Don't fail the rescheduling if notification fails
      }
    }

    if (updatedAppointment.owner_guardian_id) {
      try {
        await appointmentConfirmationService.createGuardianNotification({
          guardianId: updatedAppointment.owner_guardian_id,
          guardianName: updatedAppointment.guardian_name || 'Guardian',
          infantName: `${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim() || 'Your child',
          appointmentId,
          scheduledDate: updatedAppointment.scheduled_date,
          clinicName: updatedAppointment.location || updatedAppointment.clinic_name || 'Main Health Center',
          appointmentType: updatedAppointment.type || 'Vaccination',
          notificationType: 'appointment_rescheduled',
          category: 'appointment',
          title: 'Appointment Rescheduled',
          message: `${`${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim() || 'Your child'}'s appointment was rescheduled from ${formatClinicDateTime(appointment.scheduled_date)} to ${formatClinicDateTime(updatedAppointment.scheduled_date)}.`,
        });
      } catch (notificationError) {
        console.error('Failed to create reschedule in-app notification:', notificationError.message);
      }
    }

    socketService.broadcast('appointment_updated', normalizedAppointment);
    res.json(normalizedAppointment);
  } catch (error) {
    console.error('Reschedule appointment error:', error);
    res.status(500).json({ error: 'Failed to reschedule appointment' });
  }
});

// Available time slots for a selected date
router.get('/availability/slots', requireAppointmentReadAccess, async (req, res) => {
  try {
    const { scheduled_date, vaccine_id, clinic_id, exclude_appointment_id } = req.query;

    if (!scheduled_date) {
      return res.status(400).json({
        error: 'scheduled_date is required',
        code: 'SCHEDULED_DATE_REQUIRED',
      });
    }

    const result = await appointmentSchedulingService.getAvailableTimeSlots({
      scheduledDate: scheduled_date,
      vaccineId: sanitizeNullableInt(vaccine_id),
      clinicId: resolveSlotClinicId(req, sanitizeNullableInt(clinic_id)),
      excludeAppointmentId: sanitizeNullableInt(exclude_appointment_id),
    });

    res.json(result);
  } catch (error) {
    console.error('Availability slots error:', error);
    res.status(500).json({
      error: 'Failed to fetch available slots',
      code: 'AVAILABILITY_SLOTS_ERROR',
    });
  }
});

// Calendar availability with per-date counts and block markers
router.get('/availability/calendar', requireAppointmentReadAccess, async (req, res) => {
  try {
    const canonicalRole = getCanonicalRole(req);
    const guardianId =
      canonicalRole === CANONICAL_ROLES.GUARDIAN ? sanitizeNullableInt(req.user.guardian_id || req.user.id) : null;

    // Validate month parameter format (YYYY-MM)
    const { month } = req.query;
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        error: 'Invalid month format. Expected YYYY-MM',
        code: 'INVALID_MONTH_FORMAT',
      });
    }

    // Validate start_date and end_date if provided
    const { start_date: startDate, end_date: endDate } = req.query;
    if (startDate && Number.isNaN(Date.parse(startDate))) {
      return res.status(400).json({
        error: 'Invalid start_date format',
        code: 'INVALID_DATE_FORMAT',
      });
    }
    if (endDate && Number.isNaN(Date.parse(endDate))) {
      return res.status(400).json({
        error: 'Invalid end_date format',
        code: 'INVALID_DATE_FORMAT',
      });
    }

    const clinicId = sanitizeNullableInt(req.query.clinic_id || req.user.clinic_id);

    const calendar = await appointmentSchedulingService.getCalendarAvailability({
      month,
      startDate,
      endDate,
      guardianId,
      clinicId,
    });

    // Combine blocked dates into the same payload to avoid duplicate network requests
    const blockedDates = await blockedDatesService.getBlockedDatesForCalendar({ month, clinicId });

    res.json({
      ...calendar,
      blockedDates: blockedDates || [],
    });
  } catch (error) {
    console.error('Calendar availability error:', error);
    // Return detailed error in development
    const errorResponse = {
      error: 'Failed to fetch calendar availability',
      code: 'CALENDAR_AVAILABILITY_ERROR',
    };
    if (process.env.NODE_ENV === 'development') {
      errorResponse.message = error.message;
      errorResponse.stack = error.stack;
    }
    res.status(500).json(errorResponse);
  }
});

// Date drill-down details for calendar click panel/modal
router.get('/availability/date/:date', requireAppointmentReadAccess, async (req, res) => {
  try {
    const canonicalRole = getCanonicalRole(req);
    const guardianId =
      canonicalRole === CANONICAL_ROLES.GUARDIAN ? sanitizeNullableInt(req.user.guardian_id || req.user.id) : null;

    // Validate date parameter
    const { date } = req.params;
    if (!date || Number.isNaN(Date.parse(date))) {
      return res.status(400).json({
        error: 'Invalid date format. Expected YYYY-MM-DD',
        code: 'INVALID_DATE_FORMAT',
      });
    }

    const details = await appointmentSchedulingService.getCalendarDateDetails({
      date,
      guardianId,
      clinicId: sanitizeNullableInt(req.query.clinic_id || req.user.clinic_id),
    });

    res.json(details);
  } catch (error) {
    console.error('Calendar date details error:', error);
    // Return detailed error in development
    const errorResponse = {
      error: 'Failed to fetch calendar date details',
      code: 'DATE_DETAILS_ERROR',
    };
    if (process.env.NODE_ENV === 'development') {
      errorResponse.message = error.message;
      errorResponse.stack = error.stack;
    }
    res.status(500).json(errorResponse);
  }
});

// Get appointments for a specific date
router.get('/date/:date', requirePermission('appointment:view'), async (req, res) => {
  try {
    const { date } = req.params;
    const {
      primary: patientFacilityColumn,
      fallback: patientFacilityFallbackColumn,
    } = await getPatientFacilityColumns();
    const {
      primary: appointmentFacilityColumn,
      fallback: appointmentFacilityFallbackColumn,
    } = await getAppointmentFacilityColumns();
    const appointmentPatientColumn = await getAppointmentPatientColumn();
    const patientFacilityExpression = buildScopedColumnExpression(
      'p',
      patientFacilityColumn,
      patientFacilityFallbackColumn,
    );
    const appointmentFacilityExpression = buildScopedColumnExpression(
      'a',
      appointmentFacilityColumn,
      appointmentFacilityFallbackColumn,
    );
    const resolvedClinicExpression = `COALESCE(${patientFacilityExpression}, ${appointmentFacilityExpression})`;
    const scopeContext = resolveAppointmentScopeContext(req);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({ error: scopeContext.error });
    }

    const blockingClinicId =
      sanitizeNullableInt(req.query?.clinic_id) ||
      sanitizeNullableInt(req.query?.facility_id) ||
      sanitizeNullableInt(req.user?.clinic_id) ||
      sanitizeNullableInt(req.user?.facility_id) ||
      null;
    const blockedDateKeys = await getClinicBlockedDateKeys({
      startDate: date,
      endDate: date,
      clinicId: blockingClinicId,
    });

    if (blockedDateKeys.includes(date)) {
      return res.json({ data: [] });
    }

    const params = [date];
    let scopeClause = '';
    if (scopeContext.useScope) {
      scopeClause = ` AND ${resolvedClinicExpression} = ANY($${params.length + 1}::int[])`;
      params.push(scopeContext.scopeIds);
    }

    const result = await pool.query(
      `
        SELECT
          a.*,
          p.first_name AS first_name,
          p.last_name AS last_name,
          p.control_number AS control_number,
          ${resolvedClinicExpression} AS resolved_clinic_id,
          g.name AS guardian_name,
          g.phone AS guardian_phone
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.${appointmentPatientColumn}
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE ${APPOINTMENT_LOCAL_DATE_EXPRESSION} = $1::date
          AND a.is_active = true AND p.is_active = true
          ${scopeClause}
        ORDER BY a.scheduled_date ASC
      `,
      params,
    );

    res.json({ data: result.rows.map(normalizeAppointmentRecord) });
  } catch (error) {
    console.error('Appointments by date error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments by date' });
  }
});

// Get upcoming appointments
router.get('/upcoming', requirePermission('appointment:view'), async (req, res) => {
  try {
    const limit = sanitizeLimit(req.query.limit, 10, 100);
    const {
      primary: patientFacilityColumn,
      fallback: patientFacilityFallbackColumn,
    } = await getPatientFacilityColumns();
    const {
      primary: appointmentFacilityColumn,
      fallback: appointmentFacilityFallbackColumn,
    } = await getAppointmentFacilityColumns();
    const appointmentPatientColumn = await getAppointmentPatientColumn();
    const patientFacilityExpression = buildScopedColumnExpression(
      'p',
      patientFacilityColumn,
      patientFacilityFallbackColumn,
    );
    const appointmentFacilityExpression = buildScopedColumnExpression(
      'a',
      appointmentFacilityColumn,
      appointmentFacilityFallbackColumn,
    );
    const resolvedClinicExpression = `COALESCE(${patientFacilityExpression}, ${appointmentFacilityExpression})`;
    const scopeContext = resolveAppointmentScopeContext(req);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({ error: scopeContext.error });
    }

    const params = [];
    let scopeClause = '';
    if (scopeContext.useScope) {
      scopeClause = ` AND ${resolvedClinicExpression} = ANY($${params.length + 1}::int[])`;
      params.push(scopeContext.scopeIds);
    }

    const result = await pool.query(
      `
        SELECT
          a.*,
          p.first_name AS first_name,
          p.last_name AS last_name,
          p.control_number AS control_number,
          ${resolvedClinicExpression} AS resolved_clinic_id,
          g.name AS guardian_name,
          g.phone AS guardian_phone
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.${appointmentPatientColumn}
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE ${APPOINTMENT_LOCAL_DATE_EXPRESSION} >= ${CLINIC_TODAY_SQL}
          AND a.status = 'scheduled'
          AND a.is_active = true AND p.is_active = true
          ${scopeClause}
        ORDER BY a.scheduled_date ASC
        LIMIT $${params.length + 1}
      `,
      [...params, limit],
    );

    res.json({ data: result.rows.map(normalizeAppointmentRecord) });
  } catch (error) {
    console.error('Upcoming appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming appointments' });
  }
});

// Generate appointment suggestions based on vaccine due dates
router.get('/suggestions/:infantId', requireAppointmentReadAccess, async (req, res) => {
  try {
    const { infantId } = req.params;
    const { guardianId, clinicId } = req.query;

    // Validate infantId
    const infantIdNum = parseInt(infantId, 10);
    if (Number.isNaN(infantIdNum) || infantIdNum <= 0) {
      return res.status(400).json({
        error: 'Invalid infant ID',
        code: 'INVALID_INFANT_ID',
      });
    }

    // Generate suggestions
    const suggestions = await appointmentSuggestionService.generateAppointmentSuggestions({
      infantId: infantIdNum,
      guardianId: guardianId ? parseInt(guardianId, 10) : null,
      clinicId: clinicId ? parseInt(clinicId, 10) : null,
    });

    res.json({
      success: true,
      data: suggestions,
    });
  } catch (error) {
    console.error('Generate appointment suggestions error:', error);
    res.status(500).json({
      error: 'Failed to generate appointment suggestions',
      code: 'SUGGESTION_GENERATION_FAILED',
    });
  }
});

// Get appointment statistics
router.get('/stats/overview', requirePermission('appointment:view'), async (req, res) => {
  try {
    const {
      primary: patientFacilityColumn,
      fallback: patientFacilityFallbackColumn,
    } = await getPatientFacilityColumns();
    const {
      primary: appointmentFacilityColumn,
      fallback: appointmentFacilityFallbackColumn,
    } = await getAppointmentFacilityColumns();
    const appointmentPatientColumn = await getAppointmentPatientColumn();
    const patientFacilityExpression = buildScopedColumnExpression(
      'p',
      patientFacilityColumn,
      patientFacilityFallbackColumn,
    );
    const appointmentFacilityExpression = buildScopedColumnExpression(
      'a',
      appointmentFacilityColumn,
      appointmentFacilityFallbackColumn,
    );
    const resolvedClinicExpression = `COALESCE(${patientFacilityExpression}, ${appointmentFacilityExpression})`;
    const scopeContext = resolveAppointmentScopeContext(req);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({ error: scopeContext.error });
    }

    const params = [];
    const todayKey = getClinicTodayDateKey();
    const monthStartKey = todayKey ? `${todayKey.slice(0, 7)}-01` : null;
    let baseWhere = `
      WHERE a.is_active = true
        AND p.is_active = true
    `;
    if (scopeContext.useScope) {
      baseWhere += ` AND ${resolvedClinicExpression} = ANY($${params.length + 1}::int[])`;
      params.push(scopeContext.scopeIds);
    }

    const [today, scheduled, completed, cancelled, thisMonth] = await Promise.all([
      pool.query(
        `
          SELECT COUNT(*) as count
          FROM appointments a
          LEFT JOIN patients p ON p.id = a.${appointmentPatientColumn}
          ${baseWhere}
            AND ${APPOINTMENT_LOCAL_DATE_EXPRESSION} = $${params.length + 1}::date
        `,
        [...params, todayKey],
      ),
      pool.query(
        `
          SELECT COUNT(*) as count
          FROM appointments a
          LEFT JOIN patients p ON p.id = a.${appointmentPatientColumn}
          ${baseWhere}
            AND a.status = 'scheduled'
        `,
        params,
      ),
      pool.query(
        `
          SELECT COUNT(*) as count
          FROM appointments a
          LEFT JOIN patients p ON p.id = a.${appointmentPatientColumn}
          ${baseWhere}
            AND a.status = 'attended'
        `,
        params,
      ),
      pool.query(
        `
          SELECT COUNT(*) as count
          FROM appointments a
          LEFT JOIN patients p ON p.id = a.${appointmentPatientColumn}
          ${baseWhere}
            AND a.status = 'cancelled'
        `,
        params,
      ),
      pool.query(
        `
          SELECT COUNT(*) as count
          FROM appointments a
          LEFT JOIN patients p ON p.id = a.${appointmentPatientColumn}
          ${baseWhere}
            AND ${APPOINTMENT_LOCAL_DATE_EXPRESSION} BETWEEN $${params.length + 1}::date AND $${params.length + 2}::date
        `,
        [...params, monthStartKey, todayKey],
      ),
    ]);

    res.json({
      today: parseInt(today.rows[0].count, 10),
      scheduled: parseInt(scheduled.rows[0].count, 10),
      completed: parseInt(completed.rows[0].count, 10),
      cancelled: parseInt(cancelled.rows[0].count, 10),
      thisMonth: parseInt(thisMonth.rows[0].count, 10),
    });
  } catch (error) {
    console.error('Appointment stats error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment statistics' });
  }
});

// Get appointment types
router.get('/types', requirePermission('appointment:view'), async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT DISTINCT type
        FROM appointments
        WHERE type IS NOT NULL
        ORDER BY type
      `,
    );

    res.json({ data: result.rows.map((row) => row.type) });
  } catch (error) {
    console.error('Appointment types error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment types' });
  }
});

// Get appointment by ID (SYSTEM_ADMIN full, GUARDIAN own)
router.get('/:id(\\d+)', requireAppointmentReadAccess, async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id, 10);
    if (Number.isNaN(appointmentId)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }

    const appointment = await fetchAppointmentById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      if (!guardianId || guardianId !== parseInt(appointment.owner_guardian_id, 10)) {
        return res.status(403).json({ error: 'Access denied for this appointment' });
      }
    } else {
      const scopeContext = resolveAppointmentScopeContext(req);
      if (scopeContext.error) {
        return res.status(scopeContext.status).json({ error: scopeContext.error });
      }

      const resolvedClinicId = sanitizeNullableInt(appointment.resolved_clinic_id);
      if (
        scopeContext.useScope &&
        (!resolvedClinicId || !scopeContext.scopeIds.includes(resolvedClinicId))
      ) {
        return res.status(403).json({ error: 'Access denied for this appointment scope' });
      }
    }

    res.json(appointment);
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
});

// Update appointment (SYSTEM_ADMIN)
router.put('/:id(\\d+)', async (req, res) => {
  let appointmentId = null;
  try {
    appointmentId = parseInt(req.params.id, 10);
    if (Number.isNaN(appointmentId)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }

    const appointment = await fetchAppointmentById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const guardianFlow = isGuardian(req);
    const canonicalRole = getCanonicalRole(req);

    const payload = req.body || {};

    if (guardianFlow) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      if (!guardianId || guardianId !== parseInt(appointment.owner_guardian_id, 10)) {
        return res.status(403).json({ error: 'You can only edit your own appointment requests' });
      }

      if (APPOINTMENT_EDIT_LOCKED_STATUSES.includes(normalizeAppointmentStatus(appointment.status))) {
        return res.status(400).json({ error: 'This appointment can no longer be edited' });
      }
    } else if (
      canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN &&
      canonicalRole !== CANONICAL_ROLES.CLINIC_MANAGER
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const adminAllowedFields = [
      'scheduled_date',
      'type',
      'duration_minutes',
      'notes',
      'status',
      'cancellation_reason',
      'completion_notes',
      'location',
    ];

    const guardianAllowedFields = [
      'scheduled_date',
      'type',
      'duration_minutes',
      'notes',
      'location',
    ];

    const allowedFields = guardianFlow ? guardianAllowedFields : adminAllowedFields;

    if (guardianFlow) {
      const hasRestrictedFields = Object.keys(payload).some((key) => !guardianAllowedFields.includes(key));
      if (hasRestrictedFields) {
        return res.status(403).json({
          error: 'Guardians can only update date, type, duration, notes, and location',
        });
      }
    }

    const { normalized: normalizedUpdates, errors } = sanitizeAppointmentMutablePayload(payload, {
      allowStatus: !guardianFlow,
    });

    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    if (hasOwn(normalizedUpdates, 'scheduled_date')) {
      const availability = await appointmentSchedulingService.checkBookingAvailability({
        scheduledDate: normalizedUpdates.scheduled_date,
        vaccineId: appointment.vaccine_id,
        clinicId: sanitizeNullableInt(appointment.resolved_clinic_id || req.user.clinic_id),
        appointmentType: normalizedUpdates.type || appointment.type,
        excludeAppointmentId: appointment.id,
      });

      if (!availability.available) {
        return res.status(400).json({
          error: availability.message,
          code: availability.code,
          availability,
        });
      }
    }

    if (hasOwn(normalizedUpdates, 'scheduled_date')) {
      const conflictingAppointment = await appointmentSchedulingService.findConflictingActiveAppointment({
        infantId: appointment.infant_id,
        scheduledDate: normalizedUpdates.scheduled_date,
        excludeAppointmentId: appointmentId,
      });

      if (conflictingAppointment) {
        return res.status(409).json({
          error: 'This child already has an active appointment on the selected date.',
          code: 'DUPLICATE_APPOINTMENT',
          conflict: normalizeAppointmentRecord(conflictingAppointment),
        });
      }
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    allowedFields.forEach((field) => {
      if (hasOwn(normalizedUpdates, field)) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(normalizedUpdates[field]);
        paramIndex += 1;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid update fields provided' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(appointmentId);

    const result = await pool.query(
      `
        UPDATE appointments
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `,
      values,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const updatedAppointment = (await fetchAppointmentById(appointmentId)) || result.rows[0];

    // Send SMS confirmation when admin confirms an appointment (status changed to 'scheduled')
    if (!guardianFlow &&
        normalizedUpdates.status === 'scheduled' &&
        normalizeAppointmentStatus(appointment.status) !== 'scheduled' &&
        updatedAppointment.guardian_phone) {
      try {
        const smsResult = await sendAppointmentConfirmation({
          phoneNumber: updatedAppointment.guardian_phone,
          guardianName: updatedAppointment.guardian_name || 'Guardian',
          childName: `${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim() || 'Your Child',
          vaccineName: updatedAppointment.type || 'Vaccination',
          scheduledDate: updatedAppointment.scheduled_date,
          location: updatedAppointment.location || null,
          id: updatedAppointment.id,
        });

        if (smsResult.success) {
          console.log(`SMS sent successfully to ${updatedAppointment.guardian_phone} for appointment ${appointmentId}`);
        } else {
          console.error(`Failed to send SMS to ${updatedAppointment.guardian_phone}:`, smsResult.error);
        }
      } catch (smsError) {
        // Log error but don't fail the request - SMS is non-critical
        console.error('SMS sending error:', smsError.message);
      }
    }

    // Check if scheduled_date was changed and send notification with dedupe
    const scheduledDateChanged = hasOwn(normalizedUpdates, 'scheduled_date') &&
      appointment.scheduled_date !== updatedAppointment.scheduled_date;

    if (scheduledDateChanged) {
      // Check dedupe: only send if not already sent for this appointment + date
      const alreadySent = await hasNotificationBeenSent(
        appointmentId,
        updatedAppointment.scheduled_date,
        'schedule_date_changed',
      );

      if (!alreadySent && updatedAppointment.guardian_phone) {
        try {
          await sendScheduleDateChangedNotification({
            appointmentId: appointmentId,
            phoneNumber: updatedAppointment.guardian_phone,
            guardianName: updatedAppointment.guardian_name || 'Guardian',
            childName: `${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim() || 'your child',
            scheduledDate: updatedAppointment.scheduled_date,
            newScheduledDate: updatedAppointment.scheduled_date,
            previousDate: appointment.scheduled_date,
            previous_scheduled_date: appointment.scheduled_date,
            location: updatedAppointment.location || null,
            type: updatedAppointment.type || 'Vaccination',
          });
        } catch (notifyError) {
          console.error('Failed to send schedule date changed notification:', notifyError.message);
        }
      }
    }

    if (guardianFlow) {
      await notifyAdminsOfGuardianAppointmentEvent({
        event: 'updated',
        appointment: updatedAppointment,
        actorUserId: req.user.id,
        guardianName: updatedAppointment.guardian_name || null,
        infantName: `${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim(),
        previousAppointment: appointment,
      });
    }

    if (updatedAppointment.owner_guardian_id) {
      try {
        await appointmentConfirmationService.createGuardianNotification({
          guardianId: updatedAppointment.owner_guardian_id,
          guardianName: updatedAppointment.guardian_name || 'Guardian',
          infantName: `${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim() || 'Your child',
          appointmentId,
          scheduledDate: updatedAppointment.scheduled_date,
          clinicName: updatedAppointment.location || updatedAppointment.clinic_name || 'Main Health Center',
          appointmentType: updatedAppointment.type || 'Vaccination',
          notificationType: 'appointment_updated',
          category: 'appointment',
          title: 'Appointment Updated',
          message: `${`${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim() || 'Your child'}'s appointment details were updated. Current schedule: ${formatClinicDateTime(updatedAppointment.scheduled_date)}.`,
        });
      } catch (notificationError) {
        console.error('Failed to create appointment update notification:', notificationError.message);
      }
    }

    const normalizedAppointment = normalizeAppointmentRecord(updatedAppointment);

    await recordAppointmentAuditEvent({
      req,
      eventType: guardianFlow ? 'GUARDIAN_APPOINTMENT_UPDATED' : 'APPOINTMENT_UPDATED',
      appointmentId,
      oldValues: normalizeAppointmentRecord(appointment),
      newValues: normalizedAppointment,
      metadata: {
        updated_fields: Object.keys(normalizedUpdates),
      },
    });

    socketService.broadcast('appointment_updated', normalizedAppointment);
    res.json(normalizedAppointment);
  } catch (error) {
    console.error('Update appointment error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      appointmentId,
    });
    res.status(500).json({
      error: 'Failed to update appointment',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Cancel appointment (SYSTEM_ADMIN any, GUARDIAN own)
router.put('/:id(\\d+)/cancel', async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id, 10);
    if (Number.isNaN(appointmentId)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }

    const appointment = await fetchAppointmentById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const guardianFlow = isGuardian(req);
    const canonicalRole = getCanonicalRole(req);

    if (guardianFlow) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      if (!guardianId || guardianId !== parseInt(appointment.owner_guardian_id, 10)) {
        return res.status(403).json({ error: 'You can only cancel your own appointment requests' });
      }
    } else if (
      canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN &&
      canonicalRole !== CANONICAL_ROLES.CLINIC_MANAGER
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const cancellationReasonInput = sanitizeText(req.body?.cancellation_reason, {
      preserveNewLines: true,
    });

    if (cancellationReasonInput.length > 500) {
      return respondValidationError(res, {
        cancellation_reason: 'cancellation_reason must not exceed 500 characters',
      });
    }

    const cancellationReason = cancellationReasonInput || 'Cancelled by user';

    const result = await pool.query(
      `
        UPDATE appointments
        SET status = 'cancelled',
            cancellation_reason = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `,
      [cancellationReason, appointmentId],
    );

    const cancelledAppointment = (await fetchAppointmentById(appointmentId)) || result.rows[0];

    if (guardianFlow) {
      await notifyAdminsOfGuardianAppointmentEvent({
        event: 'cancelled',
        appointment: cancelledAppointment,
        actorUserId: req.user.id,
        guardianName: cancelledAppointment.guardian_name || null,
        infantName: `${cancelledAppointment.first_name || ''} ${cancelledAppointment.last_name || ''}`.trim(),
      });
    }

    if (cancelledAppointment.owner_guardian_id) {
      try {
        await appointmentConfirmationService.createGuardianNotification({
          guardianId: cancelledAppointment.owner_guardian_id,
          guardianName: cancelledAppointment.guardian_name || 'Guardian',
          infantName: `${cancelledAppointment.first_name || ''} ${cancelledAppointment.last_name || ''}`.trim() || 'Your child',
          appointmentId,
          scheduledDate: cancelledAppointment.scheduled_date,
          clinicName: cancelledAppointment.location || cancelledAppointment.clinic_name || 'Main Health Center',
          appointmentType: cancelledAppointment.type || 'Vaccination',
          notificationType: 'appointment_cancelled',
          category: 'appointment',
          title: 'Appointment Cancelled',
          message: `${`${cancelledAppointment.first_name || ''} ${cancelledAppointment.last_name || ''}`.trim() || 'Your child'}'s appointment on ${formatClinicDateTime(cancelledAppointment.scheduled_date)} was cancelled.`,
        });
      } catch (notificationError) {
        console.error('Failed to create appointment cancellation notification:', notificationError.message);
      }
    }

    const normalizedAppointment = normalizeAppointmentRecord(cancelledAppointment);

    await recordAppointmentAuditEvent({
      req,
      eventType: guardianFlow ? 'GUARDIAN_APPOINTMENT_CANCELLED' : 'APPOINTMENT_CANCELLED',
      appointmentId,
      oldValues: normalizeAppointmentRecord(appointment),
      newValues: normalizedAppointment,
      metadata: {
        cancellation_reason: cancellationReason,
      },
      severity: 'WARNING',
    });

    socketService.broadcast('appointment_updated', normalizedAppointment);
    res.json(normalizedAppointment);
  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(500).json({ error: 'Failed to cancel appointment' });
  }
});

// Complete appointment (SYSTEM_ADMIN)
router.put('/:id(\\d+)/complete', requirePermission('appointment:update'), async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id, 10);
    if (Number.isNaN(appointmentId)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }

    const appointment = await fetchAppointmentById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const completionNotes = sanitizeText(req.body?.completion_notes, {
      preserveNewLines: true,
    });

    if (completionNotes.length > 500) {
      return respondValidationError(res, {
        completion_notes: 'completion_notes must not exceed 500 characters',
      });
    }

    const result = await pool.query(
      `
        UPDATE appointments
        SET status = 'attended',
            completion_notes = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `,
      [completionNotes || null, appointmentId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const completedAppointment = (await fetchAppointmentById(appointmentId)) || result.rows[0];
    const normalizedAppointment = normalizeAppointmentRecord(completedAppointment);

    await recordAppointmentAuditEvent({
      req,
      eventType: 'APPOINTMENT_COMPLETED',
      appointmentId,
      oldValues: normalizeAppointmentRecord(appointment),
      newValues: normalizedAppointment,
      metadata: {
        completion_notes: completionNotes || null,
      },
    });

    socketService.broadcast('appointment_updated', normalizedAppointment);
    res.json(normalizedAppointment);
  } catch (error) {
    console.error('Complete appointment error:', error);
    res.status(500).json({ error: 'Failed to complete appointment' });
  }
});

// Bulk update appointments (SYSTEM_ADMIN)
router.put('/bulk-update', requirePermission('appointment:update'), async (req, res) => {
  try {
    const { appointment_ids, updates } = req.body;

    if (!Array.isArray(appointment_ids) || appointment_ids.length === 0) {
      return res.status(400).json({ error: 'Appointment IDs array is required' });
    }

    const sanitizedIds = appointment_ids.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));
    if (sanitizedIds.length === 0) {
      return res.status(400).json({ error: 'No valid appointment IDs provided' });
    }

    const allowedFields = new Set([
      'scheduled_date',
      'type',
      'duration_minutes',
      'notes',
      'status',
      'cancellation_reason',
      'completion_notes',
      'location',
    ]);

    const { normalized: normalizedUpdates, errors } = sanitizeAppointmentMutablePayload(
      updates || {},
      { allowStatus: true },
    );

    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    const updateEntries = Object.entries(normalizedUpdates).filter(([key]) => allowedFields.has(key));
    if (updateEntries.length === 0) {
      return res.status(400).json({ error: 'No valid update fields provided' });
    }

    if (hasOwn(normalizedUpdates, 'scheduled_date')) {
      const existingAppointmentsResult = await pool.query(
        `
          SELECT id, infant_id, type, vaccine_id, clinic_id, facility_id, resolved_clinic_id
          FROM appointments
          WHERE id = ANY($1)
        `,
        [sanitizedIds],
      );

      for (const appointment of existingAppointmentsResult.rows || []) {
        const resolvedClinicId = sanitizeNullableInt(
          appointment.resolved_clinic_id || appointment.clinic_id || appointment.facility_id || req.user.clinic_id,
        );

        const availability = await appointmentSchedulingService.checkBookingAvailability({
          scheduledDate: normalizedUpdates.scheduled_date,
          vaccineId: appointment.vaccine_id,
          clinicId: resolvedClinicId,
          appointmentType: normalizedUpdates.type || appointment.type,
          excludeAppointmentId: appointment.id,
        });

        if (!availability.available) {
          return res.status(400).json({
            error: availability.message,
            code: availability.code,
            availability,
            appointmentId: appointment.id,
          });
        }
      }
    }

    const setClause = updateEntries
      .map(([key], index) => `${key} = $${index + 2}`)
      .join(', ');

    const result = await pool.query(
      `
        UPDATE appointments
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1)
        RETURNING *
      `,
      [sanitizedIds, ...updateEntries.map(([, value]) => value)],
    );

    // Broadcast updates for all modified appointments
    const normalizedAppointments = result.rows.map(normalizeAppointmentRecord);

    normalizedAppointments.forEach((appointment) => {
      socketService.broadcast('appointment_updated', appointment);
    });
    res.json({
      updated: normalizedAppointments.length,
      appointments: normalizedAppointments,
    });
  } catch (error) {
    console.error('Bulk update appointments error:', error);
    res.status(500).json({ error: 'Failed to bulk update appointments' });
  }
});

// Delete appointment (SYSTEM_ADMIN)
router.delete('/:id(\\d+)', requirePermission('appointment:delete'), async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id, 10);
    if (Number.isNaN(appointmentId)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }

    const existingAppointment = await fetchAppointmentById(appointmentId);
    if (!existingAppointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const result = await pool.query(
      `
        UPDATE appointments
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND COALESCE(is_active, true) = true
        RETURNING id
      `,
      [appointmentId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    await recordAppointmentAuditEvent({
      req,
      eventType: 'APPOINTMENT_DELETED',
      appointmentId,
      oldValues: normalizeAppointmentRecord(existingAppointment),
      newValues: {
        id: appointmentId,
        is_active: false,
        is_deleted: true,
      },
      severity: 'WARNING',
    });

    socketService.broadcast('appointment_deleted', { id: appointmentId });
    res.json({ message: 'Appointment archived successfully' });
  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

// ============ BLOCKED DATES MANAGEMENT ============

// Get all blocked dates for a month. Read-only and available to authenticated
// guardians so booking can validate unavailable dates without admin permissions.
router.get('/blocked-dates', async (req, res) => {
  try {
    const { month, clinic_id } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        error: 'Invalid month format. Expected YYYY-MM',
        code: 'INVALID_MONTH_FORMAT',
      });
    }

    const clinicId = sanitizeNullableInt(clinic_id) || req.user.clinic_id || null;
    const blockedDates = await blockedDatesService.getBlockedDatesForCalendar({ month, clinicId });

    res.json({
      month,
      blockedDates,
    });
  } catch (error) {
    console.error('Get blocked dates error:', error);
    res.status(500).json({ error: 'Failed to fetch blocked dates' });
  }
});

// Toggle blocked status of a specific date (admin can click to block/unblock)
router.post('/blocked-dates/toggle', requirePermission('appointment:create'), async (req, res) => {
  try {
    const { date, reason, clinic_id } = req.body;

    if (!date || Number.isNaN(Date.parse(date))) {
      return res.status(400).json({
        error: 'Invalid date format. Expected YYYY-MM-DD',
        code: 'INVALID_DATE_FORMAT',
      });
    }

    const clinicId = sanitizeNullableInt(clinic_id) || req.user.clinic_id || null;
    const result = await blockedDatesService.toggleDateBlocked({
      date,
      reason: reason || null,
      blockedBy: req.user.id,
      clinicId,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to toggle blocked date' });
    }

    res.json({
      success: true,
      action: result.action,
      blockedDate: result.blockedDate,
      message: result.blockedDate.is_blocked
        ? `Date ${date} has been blocked`
        : `Date ${date} has been unblocked`,
    });
  } catch (error) {
    console.error('Toggle blocked date error:', error);
    res.status(500).json({ error: 'Failed to toggle blocked date' });
  }
});

// Set blocked status of a specific date (admin can explicitly block/unblock)
router.post('/blocked-dates/set', requirePermission('appointment:create'), async (req, res) => {
  try {
    const { date, is_blocked, reason, clinic_id } = req.body;

    if (!date || Number.isNaN(Date.parse(date))) {
      return res.status(400).json({
        error: 'Invalid date format. Expected YYYY-MM-DD',
        code: 'INVALID_DATE_FORMAT',
      });
    }

    if (is_blocked === undefined || typeof is_blocked !== 'boolean') {
      return res.status(400).json({
        error: 'is_blocked is required and must be a boolean',
        code: 'MISSING_IS_BLOCKED',
      });
    }

    const clinicId = sanitizeNullableInt(clinic_id) || req.user.clinic_id || null;
    const result = await blockedDatesService.setDateBlocked({
      date,
      isBlocked: is_blocked,
      reason: reason || null,
      blockedBy: req.user.id,
      clinicId,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to set blocked date' });
    }

    res.json({
      success: true,
      action: result.action,
      blockedDate: result.blockedDate,
      message: is_blocked
        ? `Date ${date} has been blocked`
        : `Date ${date} has been unblocked`,
    });
  } catch (error) {
    console.error('Set blocked date error:', error);
    res.status(500).json({ error: 'Failed to set blocked date' });
  }
});

// Delete a blocked date record
router.delete('/blocked-dates/:id', requirePermission('appointment:delete'), async (req, res) => {
  try {
    const { id } = req.params;
    const blockedDateId = parseInt(id, 10);

    if (Number.isNaN(blockedDateId)) {
      return res.status(400).json({ error: 'Invalid blocked date ID' });
    }

    const success = await blockedDatesService.deleteBlockedDate(blockedDateId);

    if (!success) {
      return res.status(500).json({ error: 'Failed to delete blocked date' });
    }

    res.json({ message: 'Blocked date deleted successfully' });
  } catch (error) {
    console.error('Delete blocked date error:', error);
    res.status(500).json({ error: 'Failed to delete blocked date' });
  }
});

// Check if a specific date is blocked (for guardians)
router.get('/blocked-dates/check', requireAppointmentReadAccess, async (req, res) => {
  try {
    const { date, clinic_id } = req.query;

    if (!date || Number.isNaN(Date.parse(date))) {
      return res.status(400).json({
        error: 'Invalid date format. Expected YYYY-MM-DD',
        code: 'INVALID_DATE_FORMAT',
      });
    }

    const clinicId = sanitizeNullableInt(clinic_id) || null;
    const blockedRecord = await blockedDatesService.isDateBlocked({ date, clinicId });

    res.json({
      date,
      isBlocked: !!blockedRecord,
      reason: blockedRecord?.reason || null,
    });
  } catch (error) {
    console.error('Check blocked date error:', error);
    res.status(500).json({ error: 'Failed to check blocked date' });
  }
});

module.exports = router;
module.exports.__testables = {
  enforceGuardianVaccinationEligibility,
  getEligibleGuardianVaccines,
  isVaccinationAppointmentType,
  resolveGuardianBookingReadiness,
};
