const blockedDatesService = require('../services/blockedDatesService');
const { getHolidayInfo: getHolidayInfoFromConfig } = require('../config/holidays');

const CLINIC_TIMEZONE = 'Asia/Manila';
const MAX_VACCINATION_APPOINTMENTS_PER_DAY = 83;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const clinicDateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: CLINIC_TIMEZONE,
});

const padDatePart = (value) => String(value).padStart(2, '0');

const createUtcDate = (year, monthIndex, day) => {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

const normalizeDateOnlyInput = (value) => {
  if (!value) {
    return null;
  }

  const match = String(value).trim().match(DATE_ONLY_PATTERN);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = createUtcDate(Number(year), Number(month) - 1, Number(day));
  if (!date) {
    return null;
  }

  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
};

const toClinicDateKey = (value) => {
  const dateOnly = normalizeDateOnlyInput(value);
  if (dateOnly) {
    return dateOnly;
  }

  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return clinicDateFormatter.format(date);
};

const parseClinicDate = (value) => {
  const dateKey = toClinicDateKey(value);
  if (!dateKey) {
    return null;
  }

  return new Date(`${dateKey}T00:00:00.000Z`);
};

const shiftClinicDateKey = (value, days) => {
  const date = parseClinicDate(value);
  if (!date || !Number.isFinite(days)) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return toClinicDateKey(date);
};

const startOfClinicMonthKey = (value) => {
  const date = parseClinicDate(value);
  if (!date) {
    return null;
  }

  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-01`;
};

const endOfClinicMonthKey = (value) => {
  const date = parseClinicDate(value);
  if (!date) {
    return null;
  }

  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return toClinicDateKey(end);
};

const getClinicTodayDateKey = (now = new Date()) => toClinicDateKey(now);

const getClinicDayOfWeek = (value) => {
  const date = parseClinicDate(value);
  if (!date) {
    return null;
  }

  return date.getUTCDay();
};

const isWeekendDateKey = (value) => {
  const dow = getClinicDayOfWeek(value);
  return dow === 0 || dow === 6;
};

const getClinicBlockedDateKeys = async ({
  startDate,
  endDate,
  clinicId = null,
} = {}) => {
  const startKey = toClinicDateKey(startDate);
  const endKey = toClinicDateKey(endDate);
  if (!startKey || !endKey || startKey > endKey) {
    return [];
  }

  const blockedKeys = new Set();
  const cursor = parseClinicDate(startKey);
  const finalDate = parseClinicDate(endKey);

  while (cursor && finalDate && cursor <= finalDate) {
    const dateKey = toClinicDateKey(cursor);
    if (dateKey) {
      if (isWeekendDateKey(dateKey)) {
        blockedKeys.add(dateKey);
      } else if (getHolidayInfoFromConfig(cursor)) {
        blockedKeys.add(dateKey);
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  try {
    const blockedDates = await blockedDatesService.getBlockedDates({
      startDate: startKey,
      endDate: endKey,
      clinicId,
    });

    blockedDates.forEach((record) => {
      if (record?.is_blocked && record.blocked_date) {
        blockedKeys.add(record.blocked_date);
      }
    });
  } catch (_error) {
    // Fall back to weekend and holiday rules if the blocked-date lookup fails.
  }

  return Array.from(blockedKeys).sort();
};

const rollForwardWeekendDateKey = (value) => {
  const dateKey = toClinicDateKey(value);
  if (!dateKey) {
    return null;
  }

  const dayOfWeek = getClinicDayOfWeek(dateKey);
  if (dayOfWeek === 6) {
    return shiftClinicDateKey(dateKey, 2);
  }

  if (dayOfWeek === 0) {
    return shiftClinicDateKey(dateKey, 1);
  }

  return dateKey;
};

const resolveClinicDateRange = ({
  period,
  startDateInput,
  endDateInput,
  now = new Date(),
}) => {
  const today = getClinicTodayDateKey(now);
  if (!today) {
    return {
      startDate: null,
      endDate: null,
      errors: ['Unable to resolve clinic date range'],
    };
  }

  if (period === 'today') {
    return { startDate: today, endDate: today, errors: [] };
  }

  if (period === 'week') {
    return {
      startDate: shiftClinicDateKey(today, -6),
      endDate: today,
      errors: [],
    };
  }

  if (period === 'month') {
    return {
      startDate: startOfClinicMonthKey(today),
      endDate: endOfClinicMonthKey(today),
      errors: [],
    };
  }

  const startDate = toClinicDateKey(startDateInput);
  const endDate = toClinicDateKey(endDateInput);
  const errors = [];

  if (!startDate) {
    errors.push('startDate is required and must be a valid date for custom period');
  }

  if (!endDate) {
    errors.push('endDate is required and must be a valid date for custom period');
  }

  if (startDate && endDate && startDate > endDate) {
    errors.push('startDate cannot be later than endDate');
  }

  return {
    startDate,
    endDate,
    errors,
  };
};

const isVaccinationAppointmentType = (
  value,
  { treatMissingTypeAsVaccination = false } = {},
) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return treatMissingTypeAsVaccination;
  }

  return normalized.includes('vacc') || normalized.includes('immun');
};

const CLINIC_TODAY_SQL = `(CURRENT_TIMESTAMP AT TIME ZONE '${CLINIC_TIMEZONE}')::date`;

const toClinicDateSql = (expression, { dateOnly = false } = {}) =>
  dateOnly ? `(${expression})::date` : `((${expression}) AT TIME ZONE '${CLINIC_TIMEZONE}')::date`;

const weekendPredicateSql = (dateExpression) => `EXTRACT(DOW FROM ${dateExpression}) IN (0, 6)`;

const weekdayPredicateSql = (dateExpression) => `EXTRACT(DOW FROM ${dateExpression}) NOT IN (0, 6)`;

const rollForwardWeekendDateSql = (dateExpression) => `
  (
    CASE
      WHEN ${dateExpression} IS NULL THEN NULL
      WHEN EXTRACT(DOW FROM ${dateExpression}) = 6 THEN (${dateExpression} + INTERVAL '2 days')::date
      WHEN EXTRACT(DOW FROM ${dateExpression}) = 0 THEN (${dateExpression} + INTERVAL '1 day')::date
      ELSE (${dateExpression})::date
    END
  )
`;

const appointmentVaccinationPredicateSql = (alias = 'a') => `
  (
    LOWER(COALESCE(${alias}.type::text, '')) LIKE '%vacc%'
    OR LOWER(COALESCE(${alias}.type::text, '')) LIKE '%immun%'
    OR LOWER(COALESCE(${alias}.type::text, '')) LIKE '%follow%'
  )
`;

const excludeWeekendVaccinationAppointmentsSql = (
  alias = 'a',
  localDateExpression = toClinicDateSql(`${alias}.scheduled_date`),
) => `
  NOT (
    ${appointmentVaccinationPredicateSql(alias)}
    AND ${weekendPredicateSql(localDateExpression)}
  )
`;

module.exports = {
  CLINIC_TIMEZONE,
  MAX_VACCINATION_APPOINTMENTS_PER_DAY,
  CLINIC_TODAY_SQL,
  DATE_ONLY_PATTERN,
  appointmentVaccinationPredicateSql,
  excludeWeekendVaccinationAppointmentsSql,
  getClinicDayOfWeek,
  getClinicTodayDateKey,
  isVaccinationAppointmentType,
  isWeekendDateKey,
  getClinicBlockedDateKeys,
  parseClinicDate,
  resolveClinicDateRange,
  rollForwardWeekendDateKey,
  rollForwardWeekendDateSql,
  shiftClinicDateKey,
  startOfClinicMonthKey,
  endOfClinicMonthKey,
  toClinicDateKey,
  toClinicDateSql,
  weekdayPredicateSql,
  weekendPredicateSql,
};
