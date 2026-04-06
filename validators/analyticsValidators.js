const PERIOD_OPTIONS = new Set(['today', 'week', 'month', 'custom']);
const {
  resolveClinicDateRange,
} = require('../utils/clinicCalendar');

const VACCINE_KEYS = Object.freeze([
  'ALL',
  'BCG',
  'HEPB',
  'PENTA',
  'OPV',
  'IPV',
  'PCV',
  'MMR',
]);

const VACCINATION_STATUS_OPTIONS = new Set([
  'all',
  'completed',
  'attended',
  'pending',
  'scheduled',
  'overdue',
  'cancelled',
  'no_show',
]);

const clampNumber = (value, { min, max, fallback }) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
};

const normalizeVaccineType = (input) => {
  if (!input) {
    return 'ALL';
  }

  const compact = String(input)
    .trim()
    .toUpperCase()
    .replace(/[_\s-]+/g, '');

  const mappings = {
    ALL: 'ALL',
    BCG: 'BCG',
    HEPB: 'HEPB',
    HEPATITISB: 'HEPB',
    PENTA: 'PENTA',
    PENTAVALENT: 'PENTA',
    OPV: 'OPV',
    ORALPOLIO: 'OPV',
    IPV: 'IPV',
    INACTIVATEDPOLIO: 'IPV',
    PCV: 'PCV',
    PNEUMOCOCCALCONJUGATE: 'PCV',
    MMR: 'MMR',
  };

  return mappings[compact] || null;
};

const normalizeVaccinationStatus = (input) => {
  const normalized = String(input || 'all').trim().toLowerCase().replace(/-/g, '_');
  return normalized || 'all';
};

const resolveDateRange = ({ period, startDateInput, endDateInput }) => {
  return resolveClinicDateRange({
    period,
    startDateInput,
    endDateInput,
  });
};

const normalizeFacilityId = (query, user) => {
  const candidate =
    query?.facilityId || query?.facility_id || query?.clinicId || query?.clinic_id || user?.clinic_id || user?.facility_id || null;

  if (candidate === null || candidate === undefined || candidate === '') {
    return { facilityId: null, error: null };
  }

  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { facilityId: null, error: 'facilityId must be a positive integer' };
  }

  return { facilityId: parsed, error: null };
};

const validateAndNormalizeAnalyticsQuery = (query = {}, user = {}) => {
  const rawPeriod = String(query.period || 'month').trim().toLowerCase();
  const period = PERIOD_OPTIONS.has(rawPeriod) ? rawPeriod : 'month';

  const dateRange = resolveDateRange({
    period,
    startDateInput: query.startDate || query.start_date,
    endDateInput: query.endDate || query.end_date,
  });

  const vaccineType = normalizeVaccineType(query.vaccineType || query.vaccine_type || 'ALL');
  const vaccinationStatus = normalizeVaccinationStatus(
    query.vaccinationStatus || query.vaccination_status || 'all',
  );

  const { facilityId, error: facilityError } = normalizeFacilityId(query, user);

  const activityLimit = clampNumber(query.activityLimit || query.activity_limit, {
    min: 1,
    max: 50,
    fallback: 10,
  });

  const alertLimit = clampNumber(query.alertLimit || query.alert_limit, {
    min: 1,
    max: 50,
    fallback: 8,
  });

  const errors = [...dateRange.errors];

  if (!vaccineType) {
    errors.push(`vaccineType must be one of: ${VACCINE_KEYS.join(', ')}`);
  }

  if (!VACCINATION_STATUS_OPTIONS.has(vaccinationStatus)) {
    errors.push(
      `vaccinationStatus must be one of: ${Array.from(VACCINATION_STATUS_OPTIONS).join(', ')}`,
    );
  }

  if (facilityError) {
    errors.push(facilityError);
  }

  return {
    isValid: errors.length === 0,
    errors,
    filters: {
      period,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      vaccineType: vaccineType || 'ALL',
      vaccinationStatus,
      facilityId,
      activityLimit,
      alertLimit,
    },
  };
};

module.exports = {
  PERIOD_OPTIONS,
  VACCINE_KEYS,
  VACCINATION_STATUS_OPTIONS,
  validateAndNormalizeAnalyticsQuery,
};
