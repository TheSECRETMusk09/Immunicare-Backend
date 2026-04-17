const { CLINIC_TIMEZONE, toClinicDateKey } = require('./clinicCalendar');

const CLINIC_TIMEZONE_OFFSET_MINUTES = 8 * 60;

const TIME_SLOT_CONFIG = Object.freeze({
  start: '08:00',
  end: '16:00',
  intervalMinutes: 30,
  lunchStart: '12:00',
  lunchEnd: '13:00',
});

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const TIMEZONE_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

const padDatePart = (value) => String(value).padStart(2, '0');

const timeToMinutes = (timeValue) => {
  if (!timeValue) {
    return null;
  }

  const [hours, minutes] = String(timeValue).split(':').map((part) => parseInt(part, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
};

const minutesToTime = (totalMinutes) => {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const buildDailyTimeSlots = () => {
  const startMinutes = timeToMinutes(TIME_SLOT_CONFIG.start);
  const endMinutes = timeToMinutes(TIME_SLOT_CONFIG.end);
  const lunchStartMinutes = timeToMinutes(TIME_SLOT_CONFIG.lunchStart);
  const lunchEndMinutes = timeToMinutes(TIME_SLOT_CONFIG.lunchEnd);

  if (
    startMinutes === null ||
    endMinutes === null ||
    lunchStartMinutes === null ||
    lunchEndMinutes === null
  ) {
    return [];
  }

  const slots = [];
  for (let current = startMinutes; current <= endMinutes; current += TIME_SLOT_CONFIG.intervalMinutes) {
    if (current >= lunchStartMinutes && current < lunchEndMinutes) {
      continue;
    }
    slots.push(minutesToTime(current));
  }

  return slots;
};

const DAILY_TIME_SLOTS = buildDailyTimeSlots();
const DAILY_TIME_SLOT_SET = new Set(DAILY_TIME_SLOTS);
const DAILY_TIME_SLOT_MINUTES = DAILY_TIME_SLOTS
  .map((slot) => timeToMinutes(slot))
  .filter((value) => Number.isFinite(value));

const clinicDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const clinicDateLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TIMEZONE,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const clinicDateTimeLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TIMEZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const clinicTimeLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const buildClinicDateTimeFromParts = (dateKey, timeValue) => {
  if (!dateKey || !timeValue) {
    return null;
  }

  const dateMatch = String(dateKey).trim().match(DATE_ONLY_PATTERN);
  const timeMinutes = timeToMinutes(timeValue);
  if (!dateMatch || timeMinutes === null) {
    return null;
  }

  const [, year, month, day] = dateMatch;
  const hours = Math.floor(timeMinutes / 60);
  const minutes = timeMinutes % 60;

  const utcDate = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hours - (CLINIC_TIMEZONE_OFFSET_MINUTES / 60),
    minutes,
    0,
    0,
  ));

  return Number.isNaN(utcDate.getTime()) ? null : utcDate;
};

const extractClinicDateTimeParts = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = clinicDateTimeFormatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);

  if (
    [year, month, day, hour, minute, second].some((part) => Number.isNaN(part))
  ) {
    return null;
  }

  return {
    dateKey: `${year}-${padDatePart(month)}-${padDatePart(day)}`,
    time: `${padDatePart(hour)}:${padDatePart(minute)}`,
    minutesOfDay: hour * 60 + minute,
    date,
  };
};

const parseAppointmentDateTimeInput = (value, { requireTime = false } = {}) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    const parts = extractClinicDateTimeParts(value);
    if (!parts) {
      return null;
    }

    return {
      instant: new Date(value.getTime()),
      dateKey: parts.dateKey,
      time: parts.time,
      minutesOfDay: parts.minutesOfDay,
      hasTime: true,
      normalizedIsoString: new Date(value.getTime()).toISOString(),
    };
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const dateOnlyMatch = text.match(DATE_ONLY_PATTERN);
  if (dateOnlyMatch) {
    if (requireTime) {
      return null;
    }

    const [, year, month, day] = dateOnlyMatch;
    const instant = new Date(`${year}-${month}-${day}T00:00:00+08:00`);
    const parts = extractClinicDateTimeParts(instant);
    if (!parts) {
      return null;
    }

    return {
      instant,
      dateKey: parts.dateKey,
      time: parts.time,
      minutesOfDay: parts.minutesOfDay,
      hasTime: false,
      normalizedIsoString: instant.toISOString(),
    };
  }

  const dateTimeMatch = text.match(DATE_TIME_PATTERN);
  if (dateTimeMatch) {
    const hasTimezone = TIMEZONE_PATTERN.test(text);
    const [, year, month, day, hour, minute, second = '00', millisecond = '000'] = dateTimeMatch;
    const normalizedMillisecond = String(millisecond).padEnd(3, '0').slice(0, 3);
    const instant = hasTimezone
      ? new Date(text)
      : new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${normalizedMillisecond}+08:00`);

    if (Number.isNaN(instant.getTime())) {
      return null;
    }

    const parts = extractClinicDateTimeParts(instant);
    if (!parts) {
      return null;
    }

    return {
      instant,
      dateKey: parts.dateKey,
      time: parts.time,
      minutesOfDay: parts.minutesOfDay,
      hasTime: true,
      normalizedIsoString: instant.toISOString(),
    };
  }

  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) {
    return null;
  }

  const parts = extractClinicDateTimeParts(instant);
  if (!parts) {
    return null;
  }

  return {
    instant,
    dateKey: parts.dateKey,
    time: parts.time,
    minutesOfDay: parts.minutesOfDay,
    hasTime: true,
    normalizedIsoString: instant.toISOString(),
  };
};

const normalizeAppointmentTimeToAllowedSlot = (timeValue) => {
  const minutes = timeToMinutes(timeValue);
  if (minutes === null || DAILY_TIME_SLOT_MINUTES.length === 0) {
    return TIME_SLOT_CONFIG.start;
  }

  let bestIndex = 0;
  let bestDiff = Number.POSITIVE_INFINITY;

  DAILY_TIME_SLOT_MINUTES.forEach((slotMinutes, index) => {
    const diff = Math.abs(slotMinutes - minutes);
    if (diff < bestDiff || (diff === bestDiff && slotMinutes < DAILY_TIME_SLOT_MINUTES[bestIndex])) {
      bestDiff = diff;
      bestIndex = index;
    }
  });

  return DAILY_TIME_SLOTS[bestIndex] || TIME_SLOT_CONFIG.start;
};

const isAllowedAppointmentTimeSlot = (timeValue) =>
  DAILY_TIME_SLOT_SET.has(String(timeValue || '').trim());

const normalizeAppointmentDateTimeForDisplay = (value) => {
  const parsed = parseAppointmentDateTimeInput(value, { requireTime: false });
  if (!parsed) {
    return null;
  }

  const normalizedTime = isAllowedAppointmentTimeSlot(parsed.time)
    ? parsed.time
    : normalizeAppointmentTimeToAllowedSlot(parsed.time);

  return buildClinicDateTimeFromParts(parsed.dateKey, normalizedTime);
};

const formatClinicDateLabel = (value) => {
  const normalized = normalizeAppointmentDateTimeForDisplay(value);
  if (!normalized) {
    return '';
  }

  return clinicDateLabelFormatter.format(normalized);
};

const formatClinicDateTime = (value) => {
  const normalized = normalizeAppointmentDateTimeForDisplay(value);
  if (!normalized) {
    return '';
  }

  return clinicDateTimeLabelFormatter.format(normalized);
};

const formatClinicTime = (value) => {
  if (!value) {
    return '';
  }

  if (/^\d{2}:\d{2}$/.test(String(value).trim())) {
    const combined = buildClinicDateTimeFromParts('2000-01-01', value);
    return combined ? clinicTimeLabelFormatter.format(combined) : String(value);
  }

  const normalized = normalizeAppointmentDateTimeForDisplay(value);
  if (!normalized) {
    return '';
  }

  return clinicTimeLabelFormatter.format(normalized);
};

const formatClinicTimeSlotLabel = (value) => formatClinicTime(value);

const combineClinicDateTime = (dateKey, timeValue) => {
  const normalizedTime = String(timeValue || '').trim();
  if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
    return '';
  }

  const date = String(dateKey || '').trim();
  if (!DATE_ONLY_PATTERN.test(date)) {
    return '';
  }

  const instant = buildClinicDateTimeFromParts(date, normalizedTime);
  return instant ? instant.toISOString() : '';
};

const normalizeAppointmentRecordForResponse = (appointment) => {
  if (!appointment || typeof appointment !== 'object') {
    return appointment;
  }

  const normalizedScheduledDate = normalizeAppointmentDateTimeForDisplay(appointment.scheduled_date);

  return {
    ...appointment,
    scheduled_date: normalizedScheduledDate
      ? normalizedScheduledDate.toISOString()
      : appointment.scheduled_date,
  };
};

module.exports = {
  CLINIC_TIMEZONE,
  TIME_SLOT_CONFIG,
  buildDailyTimeSlots,
  buildClinicDateTimeFromParts,
  combineClinicDateTime,
  extractClinicDateTimeParts,
  formatClinicDateLabel,
  formatClinicDateTime,
  formatClinicTime,
  formatClinicTimeSlotLabel,
  isAllowedAppointmentTimeSlot,
  minutesToTime,
  normalizeAppointmentDateTimeForDisplay,
  normalizeAppointmentRecordForResponse,
  normalizeAppointmentTimeToAllowedSlot,
  parseAppointmentDateTimeInput,
  timeToMinutes,
  toClinicDateKey,
};
