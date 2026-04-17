const pool = require('../db');
const NotificationService = require('./notificationService');
const smsService = require('./smsService');
const blockedDatesService = require('./blockedDatesService');
const {
  generateControlNumber: generateInfantControlNumber,
  resolveOrCreateInfantPatient,
} = require('./infantControlNumberService');
const {
  getHolidayInfo: getHolidayInfoFromConfig,
  isDateAvailableForBooking,
} = require('../config/holidays');
const {
  CLINIC_TODAY_SQL,
  CLINIC_TIMEZONE,
  MAX_VACCINATION_APPOINTMENTS_PER_DAY,
  getClinicBlockedDateKeys,
  endOfClinicMonthKey,
  getClinicTodayDateKey,
  isVaccinationAppointmentType,
  isWeekendDateKey,
  parseClinicDate,
  startOfClinicMonthKey,
  toClinicDateKey,
} = require('../utils/clinicCalendar');
const {
  combineClinicDateTime,
  formatClinicDateTime,
  formatClinicTime,
  isAllowedAppointmentTimeSlot,
  normalizeAppointmentDateTimeForDisplay,
  normalizeAppointmentRecordForResponse,
  parseAppointmentDateTimeInput,
} = require('../utils/appointmentDateTime');

const FALLBACK_SCHEMA_COLUMNS = Object.freeze({
  appointmentsPatient: 'infant_id',
  appointmentsScope: 'clinic_id',
  patientsScope: 'clinic_id',
  vaccineBatchesScope: 'clinic_id',
  appointmentsVaccine: null,
});

const notificationService = new NotificationService();

let schemaColumnMappingPromise = null;
let notificationColumnsCache = null;
let notificationColumnsCachedAt = 0;
const NOTIFICATION_COLUMNS_CACHE_TTL_MS = 5 * 60 * 1000;

const resolveSchemaColumnMappings = async () => {
  const mappings = { ...FALLBACK_SCHEMA_COLUMNS };

  try {
    const result = await pool.query(
      `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])
          AND column_name = ANY($2::text[])
      `,
      [
        ['appointments', 'patients', 'vaccine_batches'],
        ['patient_id', 'infant_id', 'facility_id', 'clinic_id', 'vaccine_id'],
      ],
    );

    const available = new Set(
      (result.rows || []).map((row) => `${row.table_name}.${row.column_name}`),
    );

    if (available.has('appointments.patient_id')) {
      mappings.appointmentsPatient = 'patient_id';
    } else if (available.has('appointments.infant_id')) {
      mappings.appointmentsPatient = 'infant_id';
    }

    if (available.has('appointments.facility_id')) {
      mappings.appointmentsScope = 'facility_id';
    } else if (available.has('appointments.clinic_id')) {
      mappings.appointmentsScope = 'clinic_id';
    }

    if (available.has('appointments.vaccine_id')) {
      mappings.appointmentsVaccine = 'vaccine_id';
    }

    if (available.has('patients.facility_id')) {
      mappings.patientsScope = 'facility_id';
    } else if (available.has('patients.clinic_id')) {
      mappings.patientsScope = 'clinic_id';
    }

    if (available.has('vaccine_batches.facility_id')) {
      mappings.vaccineBatchesScope = 'facility_id';
    } else if (available.has('vaccine_batches.clinic_id')) {
      mappings.vaccineBatchesScope = 'clinic_id';
    }
  } catch (error) {
    console.error('Error resolving appointment schema column mappings:', error);
  }

  return mappings;
};

const getSchemaColumnMappings = async () => {
  if (!schemaColumnMappingPromise) {
    schemaColumnMappingPromise = resolveSchemaColumnMappings();
  }

  return schemaColumnMappingPromise;
};

const toDateKey = (value) => {
  return toClinicDateKey(value);
};

const parseDate = (value) => {
  return parseClinicDate(value);
};

const getNotificationColumns = async () => {
  const now = Date.now();
  if (notificationColumnsCache && now - notificationColumnsCachedAt < NOTIFICATION_COLUMNS_CACHE_TTL_MS) {
    return notificationColumnsCache;
  }

  try {
    const result = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notifications'
      `,
    );

    notificationColumnsCache = new Set(result.rows.map((row) => row.column_name));
    notificationColumnsCachedAt = now;
    return notificationColumnsCache;
  } catch (error) {
    console.error('Error resolving notification columns:', error);
    return new Set();
  }
};

const TIME_SLOT_CONFIG = Object.freeze({
  start: '08:00',
  end: '16:00',
  intervalMinutes: 30,
  lunchStart: '12:00',
  lunchEnd: '13:00',
});

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

const isWeekend = (value) => {
  return isWeekendDateKey(value);
};

const getHolidayInfo = (value) => {
  const dateKey = toDateKey(value);
  if (!dateKey) {
    return null;
  }

  return getHolidayInfoFromConfig(new Date(`${dateKey}T12:00:00`));
};

const resolveDateRange = ({ month, startDate, endDate }) => {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const firstDayKey = startOfClinicMonthKey(`${month}-01`);
    const lastDayKey = endOfClinicMonthKey(`${month}-01`);
    const firstDay = parseDate(firstDayKey);
    const lastDay = parseDate(lastDayKey);
    if (!firstDay || !lastDay) {
      return null;
    }
    return { start: firstDay, end: lastDay };
  }

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (start && end) {
    return { start, end };
  }

  const todayKey = getClinicTodayDateKey();
  const firstDay = parseDate(startOfClinicMonthKey(todayKey));
  const lastDay = parseDate(endOfClinicMonthKey(todayKey));

  return { start: firstDay, end: lastDay };
};

const toMonthKey = (value) => {
  const dateKey = toDateKey(value);
  return dateKey ? dateKey.slice(0, 7) : null;
};

const buildVaccinationAppointmentPredicate = (mappings, alias = 'a') => {
  const textPredicates = [
    `LOWER(COALESCE(${alias}.type::text, '')) LIKE '%vacc%'`,
    `LOWER(COALESCE(${alias}.type::text, '')) LIKE '%immun%'`,
    `LOWER(COALESCE(${alias}.type::text, '')) LIKE '%follow%'`,
  ];

  if (mappings.appointmentsVaccine) {
    textPredicates.unshift(`${alias}.${mappings.appointmentsVaccine} IS NOT NULL`);
  }

  return `(${textPredicates.join(' OR ')})`;
};

const getVaccineStockSummary = async (clinicId = null) => {
  try {
    const { vaccineBatchesScope } = await getSchemaColumnMappings();

    // Build query based on whether clinicId is provided
    let query;
    let params = [];

    if (clinicId) {
      query = `
        SELECT
          v.id AS vaccine_id,
          v.name AS vaccine_name,
          COALESCE(SUM(vb.qty_current), 0)::int AS available_stock
        FROM vaccines v
        LEFT JOIN vaccine_batches vb
         ON vb.vaccine_id = v.id
         AND vb.status = 'active'
         AND (vb.expiry_date IS NULL OR vb.expiry_date >= ${CLINIC_TODAY_SQL})
         AND vb.${vaccineBatchesScope} = $1
        WHERE v.is_active = true
        GROUP BY v.id, v.name
        ORDER BY v.name ASC
      `;
      params = [clinicId];
    } else {
      query = `
        SELECT
          v.id AS vaccine_id,
          v.name AS vaccine_name,
          COALESCE(SUM(vb.qty_current), 0)::int AS available_stock
        FROM vaccines v
        LEFT JOIN vaccine_batches vb
         ON vb.vaccine_id = v.id
         AND vb.status = 'active'
         AND (vb.expiry_date IS NULL OR vb.expiry_date >= ${CLINIC_TODAY_SQL})
        WHERE v.is_active = true
        GROUP BY v.id, v.name
        ORDER BY v.name ASC
      `;
    }

    const result = await pool.query(query, params);

    const rows = result.rows || [];
    const totalAvailableStock = rows.reduce((sum, row) => sum + parseInt(row.available_stock || 0, 10), 0);
    const availableVaccines = rows.filter((row) => parseInt(row.available_stock || 0, 10) > 0).length;

    return {
      vaccines: rows,
      totalAvailableStock,
      availableVaccines,
    };
  } catch (error) {
    console.error('Error in getVaccineStockSummary:', error);
    return {
      vaccines: [],
      totalAvailableStock: 0,
      availableVaccines: 0,
    };
  }
};

/**
 * Check vaccine stock availability for a specific date, time, and vaccine
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} time - Time in HH:MM format
 * @param {number} vaccineId - Vaccine ID
 * @param {number} clinicId - Clinic ID
 * @returns {Object} Availability information
 */
const checkVaccineStockForDateTime = async ({ date, time, vaccineId, clinicId }) => {
  try {
    // Validate inputs
    if (!date || !time || !vaccineId) {
      return {
        available: false,
        code: 'MISSING_PARAMETERS',
        message: 'Date, time, and vaccine ID are required',
      };
    }

    if (!isAllowedAppointmentTimeSlot(time)) {
      return {
        available: false,
        code: 'INVALID_TIME',
        message: 'Appointments can only be scheduled between 8:00 AM and 4:00 PM in 30-minute slots.',
      };
    }

    // Parse the date and time
    const appointmentDateTime = combineClinicDateTime(date, time);
    if (!appointmentDateTime) {
      return {
        available: false,
        code: 'INVALID_DATE_TIME',
        message: 'Invalid date or time format',
      };
    }

    // Get vaccine stock summary
    const stockSummary = await getVaccineStockSummary(clinicId);
    const vaccineStock = stockSummary.vaccines.find(
      v => parseInt(v.vaccine_id, 10) === parseInt(vaccineId, 10),
    );

    if (!vaccineStock) {
      return {
        available: false,
        code: 'VACCINE_NOT_FOUND',
        message: 'Vaccine not found or not active',
      };
    }

    const totalStock = parseInt(vaccineStock.available_stock || 0, 10);

    // Block booking only when stock is actually depleted
    if (totalStock <= 0) {
      return {
        available: false,
        code: 'SELECTED_VACCINE_OUT_OF_STOCK',
        message: 'No vaccines available for the selected vaccine. Please choose another vaccine.',
        stock: totalStock,
      };
    }

    // Check how many appointments are already scheduled for this vaccine at this date/time
    const {
      appointmentsPatient,
      appointmentsScope,
      appointmentsVaccine,
      patientsScope,
    } = await getSchemaColumnMappings();
    const appointmentDateExpr = `(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::date`;
    const appointmentTimeExpr = `(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::time`;
    const appointmentVaccineFilter = appointmentsVaccine
      ? `AND a.${appointmentsVaccine} = $3`
      : `AND ${buildVaccinationAppointmentPredicate({ appointmentsVaccine: null }, 'a')}`;

    const appointmentCountResult = await pool.query(
      `
        SELECT COUNT(*) as count
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.${appointmentsPatient}
        WHERE ${appointmentDateExpr} = $1::date
          AND ${appointmentTimeExpr} = $2::time
          ${appointmentVaccineFilter}
          AND a.is_active = true
          AND a.status NOT IN ('cancelled', 'completed')
          ${clinicId ? `AND COALESCE(p.${patientsScope}, a.${appointmentsScope}) = $4` : ''}
      `,
      clinicId
        ? [date, time, vaccineId, clinicId]
        : [date, time, vaccineId],
    );

    const appointmentCount = parseInt(appointmentCountResult.rows[0].count, 10);
    const availableSlots = totalStock - appointmentCount;

    return {
      available: availableSlots > 0,
      code: availableSlots > 0 ? 'STOCK_AVAILABLE' : 'NO_STOCK_AVAILABLE',
      message: availableSlots > 0
        ? `${availableSlots} dose(s) available for ${vaccineStock.vaccine_name} at ${date} ${time}`
        : `No stock available for ${vaccineStock.vaccine_name} at ${date} ${time}. ${appointmentCount} appointment(s) already scheduled.`,
      stock: totalStock,
      booked: appointmentCount,
      availableSlots,
    };
  } catch (error) {
    console.error('Error in checkVaccineStockForDateTime:', error);
    return {
      available: false,
      code: 'STOCK_CHECK_FAILED',
      message: 'Failed to check vaccine stock availability',
    };
  }
};

const getDailyVaccinationAppointmentCount = async ({
  scheduledDate,
  clinicId = null,
  excludeAppointmentId = null,
} = {}) => {
  const dateKey = toDateKey(scheduledDate);
  if (!dateKey) {
    return 0;
  }

  const {
    appointmentsPatient,
    appointmentsScope,
    patientsScope,
    appointmentsVaccine,
  } = await getSchemaColumnMappings();

  const appointmentDateExpr = `(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::date`;
  const vaccinationPredicate = buildVaccinationAppointmentPredicate(
    { appointmentsVaccine },
    'a',
  );
  const params = [dateKey];
  let query = `
    SELECT COUNT(*)::int AS count
    FROM appointments a
    LEFT JOIN patients p ON p.id = a.${appointmentsPatient}
    WHERE ${appointmentDateExpr} = $1::date
      AND COALESCE(a.is_active, true) = true
      AND ${vaccinationPredicate}
      AND LOWER(COALESCE(a.status::text, '')) NOT IN ('cancelled')
  `;

  if (excludeAppointmentId) {
    query += ` AND a.id <> $${params.length + 1}`;
    params.push(excludeAppointmentId);
  }

  if (clinicId) {
    query += ` AND COALESCE(p.${patientsScope}, a.${appointmentsScope}) = $${params.length + 1}`;
    params.push(clinicId);
  }

  const result = await pool.query(query, params);
  return Number.parseInt(result.rows[0]?.count, 10) || 0;
};

const checkBookingAvailability = async ({
  scheduledDate,
  vaccineId = null,
  clinicId = null,
  time = null,
  appointmentType = null,
  excludeAppointmentId = null,
}) => {
  try {
    const parsedAppointmentDate = parseAppointmentDateTimeInput(scheduledDate, {
      requireTime: false,
    });
    if (!parsedAppointmentDate) {
      return {
        available: false,
        code: 'INVALID_DATE',
        message: 'Invalid appointment date',
      };
    }

    const effectiveTime = time || (parsedAppointmentDate.hasTime ? parsedAppointmentDate.time : null);
    if (effectiveTime && !isAllowedAppointmentTimeSlot(effectiveTime)) {
      return {
        available: false,
        code: 'INVALID_TIME',
        message: 'Appointments can only be scheduled between 8:00 AM and 4:00 PM in 30-minute slots.',
      };
    }

    const dateOnly = parseDate(parsedAppointmentDate.dateKey);
    if (!dateOnly) {
      return {
        available: false,
        code: 'INVALID_DATE',
        message: 'Invalid appointment date',
      };
    }

    const todayManila = getClinicTodayDateKey();
    const scheduledManila = parsedAppointmentDate.dateKey;

    if (scheduledManila < todayManila) {
      return {
        available: false,
        code: 'DATE_IN_PAST',
        message: 'Cannot schedule appointments in the past',
      };
    }

    const dateAvailability = isDateAvailableForBooking(dateOnly, {
      allowPast: true,
    });
    if (!dateAvailability.isAvailable) {
      return {
        available: false,
        code: dateAvailability.code,
        message: dateAvailability.reason,
        holiday: dateAvailability.holiday || null,
        blockedDate: dateAvailability.blockedDate || null,
      };
    }

    // Check if date is blocked by admin
    try {
      const blockedDate = await blockedDatesService.isDateBlocked({
        date: toDateKey(dateOnly),
        clinicId,
      });

      if (blockedDate) {
        const blockedAvailability = isDateAvailableForBooking(dateOnly, {
          allowPast: true,
          blockedDate,
        });
        return {
          available: false,
          code: blockedAvailability.code,
          message: blockedAvailability.reason,
          holiday: blockedAvailability.holiday || null,
          blockedDate,
        };
      }
    } catch (blockError) {
      console.error('Error checking blocked date:', blockError.message);
      // Continue with availability check if blocked date check fails
    }

    if (
      isVaccinationAppointmentType(appointmentType, { treatMissingTypeAsVaccination: Boolean(vaccineId) })
      || Number.isInteger(Number.parseInt(vaccineId, 10))
    ) {
      const vaccinationCount = await getDailyVaccinationAppointmentCount({
        scheduledDate: scheduledManila,
        clinicId,
        excludeAppointmentId,
      });

      if (vaccinationCount >= MAX_VACCINATION_APPOINTMENTS_PER_DAY) {
        return {
          available: false,
          code: 'DAILY_CAPACITY_REACHED',
          message: `Daily vaccination capacity is limited to ${MAX_VACCINATION_APPOINTMENTS_PER_DAY} appointments on active weekdays.`,
          capacity: {
            current: vaccinationCount,
            maximum: MAX_VACCINATION_APPOINTMENTS_PER_DAY,
            remaining: 0,
          },
        };
      }
    }

    // If time is provided, use stock-aware checking for specific date/time
    if (effectiveTime && vaccineId) {
      const stockCheck = await checkVaccineStockForDateTime({
        date: scheduledManila,
        time: effectiveTime,
        vaccineId,
        clinicId,
      });

      if (stockCheck.code === 'STOCK_CHECK_FAILED') {
        console.warn('[checkBookingAvailability] Vaccine stock check failed; allowing booking with stock_warning:', stockCheck.message);
        return {
          available: true,
          code: 'STOCK_UNVERIFIED',
          message: 'Booking date is available (vaccine stock could not be verified)',
          stock_warning: 'Could not verify vaccine stock availability',
        };
      }

      return {
        available: stockCheck.available,
        code: stockCheck.code,
        message: stockCheck.message,
        stock: stockCheck.stock,
        booked: stockCheck.booked,
        availableSlots: stockCheck.availableSlots,
      };
    }

    const stock = await getVaccineStockSummary(clinicId);

    if (vaccineId) {
      const selected = stock.vaccines.find((row) => parseInt(row.vaccine_id, 10) === parseInt(vaccineId, 10));
      const selectedStock = parseInt(selected?.available_stock || 0, 10);

      // Block booking only when stock is actually depleted
      if (selectedStock <= 0) {
        return {
          available: false,
          code: 'SELECTED_VACCINE_OUT_OF_STOCK',
          message: 'No vaccines available for the selected vaccine. Please choose another vaccine.',
          stock,
        };
      }
    }

    return {
      available: true,
      code: 'BOOKING_AVAILABLE',
      message: 'Booking date is available',
      stock,
    };
  } catch (error) {
    console.error('Error in checkBookingAvailability:', error);
    return {
      available: true,
      code: 'CHECK_FAILED',
      message: 'Availability check failed, but booking is allowed',
    };
  }
};

const getDailyAppointmentCounts = async ({ startDate, endDate, guardianId = null, clinicId = null }) => {
  try {
    const { appointmentsPatient, appointmentsScope, patientsScope } = await getSchemaColumnMappings();
    const appointmentDateExpr = `(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::date`;

    const params = [toDateKey(startDate), toDateKey(endDate)];
    let query = `
      SELECT
        ${appointmentDateExpr} AS schedule_date,
        COUNT(*)::int AS total_appointments
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.${appointmentsPatient}
      WHERE ${appointmentDateExpr} BETWEEN $1::date AND $2::date
        AND a.is_active = true
        AND a.status <> 'cancelled'
    `;

    if (guardianId) {
      query += ` AND p.guardian_id = $${params.length + 1}`;
      params.push(guardianId);
    }

    if (clinicId) {
      query += ` AND COALESCE(p.${patientsScope}, a.${appointmentsScope}) = $${params.length + 1}`;
      params.push(clinicId);
    }

    query += ` GROUP BY ${appointmentDateExpr}`;

    const result = await pool.query(query, params);
    const counts = {};

    result.rows.forEach((row) => {
      counts[toDateKey(row.schedule_date)] = parseInt(row.total_appointments || 0, 10);
    });

    return counts;
  } catch (error) {
    console.error('Error in getDailyAppointmentCounts:', error);
    return {};
  }
};

const getCalendarAvailability = async ({ month, startDate, endDate, guardianId = null, clinicId = null }) => {
  try {
    const range = resolveDateRange({ month, startDate, endDate });
    if (!range) {
      // Return safe default instead of throwing
      return {
        startDate: null,
        endDate: null,
        dates: [],
        inventory: {
          totalAvailableStock: 0,
          availableVaccines: 0,
          vaccines: [],
        },
      };
    }

    const { start, end } = range;

    // Get data with error handling - if either fails, continue with empty data
    let dailyCounts = {};
    let stock = { vaccines: [], totalAvailableStock: 0, availableVaccines: 0 };

    try {
      const countsResult = await getDailyAppointmentCounts({ startDate: start, endDate: end, guardianId, clinicId });
      dailyCounts = countsResult || {};
    } catch (countsError) {
      console.error('Error getting daily counts:', countsError.message);
    }

    try {
      const stockResult = await getVaccineStockSummary(clinicId);
      stock = stockResult || { vaccines: [], totalAvailableStock: 0, availableVaccines: 0 };
    } catch (stockError) {
      console.error('Error getting stock summary:', stockError.message);
    }

    const days = [];
    const cursor = new Date(start);
    const blockedDateKeys = new Set(
      await getClinicBlockedDateKeys({
        startDate: start,
        endDate: end,
        clinicId,
      }),
    );

    while (cursor <= end) {
      const dateKey = toDateKey(cursor);
      const weekend = isWeekend(cursor);
      const holiday = getHolidayInfo(cursor);
      const noVaccineAvailability = stock.totalAvailableStock <= 0;

      let blockedReason = null;

      if (weekend) {
        blockedReason = 'weekend';
      } else if (holiday) {
        blockedReason = 'holiday';
      } else if (blockedDateKeys.has(dateKey)) {
        blockedReason = 'admin_blocked';
      } else if (noVaccineAvailability) {
        blockedReason = 'no_vaccine_available';
      }

      days.push({
        date: dateKey,
        totalAppointments: blockedReason ? 0 : (dailyCounts[dateKey] || 0),
        isWeekend: weekend,
        isHoliday: Boolean(holiday),
        holidayName: holiday?.name || null,
        noVaccineAvailability,
        hasVaccineAvailability: stock.totalAvailableStock > 0,
        isAdminBlocked: blockedDateKeys.has(dateKey) && !weekend && !holiday,
        adminBlockReason: blockedDateKeys.has(dateKey) && !weekend && !holiday
          ? 'blocked by clinic rule'
          : null,
        blocked: Boolean(blockedReason),
        blockedReason,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      startDate: toDateKey(start),
      endDate: toDateKey(end),
      dates: days,
      inventory: {
        totalAvailableStock: stock.totalAvailableStock,
        availableVaccines: stock.availableVaccines,
        vaccines: stock.vaccines,
      },
    };
  } catch (error) {
    console.error('Error in getCalendarAvailability:', error);
    throw error;
  }
};

const getCalendarDateDetails = async ({ date, guardianId = null, clinicId = null }) => {
  try {
    const { appointmentsPatient, appointmentsScope, patientsScope } = await getSchemaColumnMappings();

    const parsedDate = parseDate(date);
    if (!parsedDate) {
      throw new Error('Invalid date');
    }

    const dateKey = toDateKey(parsedDate);
    const blockedDate = await blockedDatesService.isDateBlocked({
      date: dateKey,
      clinicId,
    });
    const availability = isDateAvailableForBooking(parsedDate, {
      allowPast: true,
      blockedDate,
    });

    if (!availability.isAvailable) {
      const stock = await getVaccineStockSummary(clinicId);
      return {
        date: dateKey,
        isWeekend: isWeekend(parsedDate),
        holiday: getHolidayInfo(parsedDate),
        availability,
        summary: {
          total: 0,
          byStatus: {},
        },
        appointments: [],
        inventory: {
          totalAvailableStock: stock.totalAvailableStock,
          availableVaccines: stock.availableVaccines,
          vaccines: stock.vaccines,
        },
      };
    }

    const params = [dateKey];
    const appointmentDateExpr = `(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::date`;
    let query = `
      SELECT
        a.*,
        p.first_name AS first_name,
        p.last_name AS last_name,
        p.control_number AS control_number,
        g.name AS guardian_name,
        g.phone AS guardian_phone
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.${appointmentsPatient}
      LEFT JOIN guardians g ON g.id = p.guardian_id
      WHERE ${appointmentDateExpr} = $1::date
        AND a.is_active = true
    `;

    if (guardianId) {
      query += ` AND p.guardian_id = $${params.length + 1}`;
      params.push(guardianId);
    }

    if (clinicId) {
      query += ` AND COALESCE(p.${patientsScope}, a.${appointmentsScope}) = $${params.length + 1}`;
      params.push(clinicId);
    }

    query += ' ORDER BY a.scheduled_date ASC';

    const [appointmentsResult, stock] = await Promise.all([
      pool.query(query, params),
      getVaccineStockSummary(clinicId),
    ]);

    const appointments = (appointmentsResult.rows || []).map(normalizeAppointmentRecordForResponse);

    const summary = appointments.reduce(
      (acc, appointment) => {
        const status = appointment.status || 'unknown';
        acc.total += 1;
        acc.byStatus[status] = (acc.byStatus[status] || 0) + 1;
        return acc;
      },
      { total: 0, byStatus: {} },
    );

    return {
      date: dateKey,
      isWeekend: isWeekend(parsedDate),
      holiday: getHolidayInfo(parsedDate),
      availability,
      summary,
      appointments,
      inventory: {
        totalAvailableStock: stock.totalAvailableStock,
        availableVaccines: stock.availableVaccines,
        vaccines: stock.vaccines,
      },
    };
  } catch (error) {
    console.error('Error in getCalendarDateDetails:', error);
    throw error;
  }
};

const getBookedTimeSlots = async ({ scheduledDate, clinicId = null, excludeAppointmentId = null }) => {
  try {
    const { appointmentsPatient, appointmentsScope, patientsScope } = await getSchemaColumnMappings();
    const dateKey = toDateKey(scheduledDate);
    if (!dateKey) {
      return [];
    }

    const params = [dateKey];
    const appointmentDateExpr = `(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::date`;
    let query = `
      SELECT a.id, a.scheduled_date
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.${appointmentsPatient}
      WHERE ${appointmentDateExpr} = $1::date
        AND a.is_active = true
        AND a.status <> 'cancelled'
    `;

    if (excludeAppointmentId) {
      query += ` AND a.id <> $${params.length + 1}`;
      params.push(excludeAppointmentId);
    }

    if (clinicId) {
      query += ` AND COALESCE(p.${patientsScope}, a.${appointmentsScope}) = $${params.length + 1}`;
      params.push(clinicId);
    }

    const result = await pool.query(query, params);

    return (result.rows || [])
      .map((row) => {
        if (!row.scheduled_date) {
          return null;
        }

        const value = normalizeAppointmentDateTimeForDisplay(row.scheduled_date)
          || (row.scheduled_date instanceof Date
            ? row.scheduled_date
            : new Date(row.scheduled_date));
        if (Number.isNaN(value.getTime())) {
          return null;
        }

        const timeValue = new Intl.DateTimeFormat('en-GB', {
          timeZone: CLINIC_TIMEZONE,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(value);

        return timeValue || null;
      })
      .filter(Boolean);
  } catch (error) {
    console.error('Error getting booked time slots:', error);
    return [];
  }
};

const getAvailableTimeSlots = async ({
  scheduledDate,
  vaccineId = null,
  clinicId = null,
  excludeAppointmentId = null,
} = {}) => {
  try {
    const dateOnly = parseDate(scheduledDate);
    if (!dateOnly) {
      return {
        available: false,
        code: 'INVALID_DATE',
        message: 'Invalid appointment date',
        slots: [],
        bookedSlots: [],
      };
    }

    const availability = await checkBookingAvailability({
      scheduledDate,
      vaccineId,
      clinicId,
      excludeAppointmentId,
    });

    if (!availability.available) {
      return {
        available: false,
        code: availability.code,
        message: availability.message,
        slots: [],
        bookedSlots: [],
        availability,
      };
    }

    const slots = buildDailyTimeSlots();
    const bookedSlots = await getBookedTimeSlots({
      scheduledDate: dateOnly,
      clinicId,
      excludeAppointmentId,
    });

    let availableSlots = slots.filter((slot) => !bookedSlots.includes(slot));

    const todayKey = getClinicTodayDateKey();
    const selectedKey = toDateKey(dateOnly);
    if (todayKey && selectedKey && todayKey === selectedKey) {
      const currentTimeInManila = new Intl.DateTimeFormat('en-GB', {
        timeZone: CLINIC_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date());
      const currentMinutes = timeToMinutes(currentTimeInManila);
      availableSlots = availableSlots.filter((slot) => {
        const slotMinutes = timeToMinutes(slot);
        return slotMinutes !== null && currentMinutes !== null && slotMinutes > currentMinutes;
      });
    }

    const hasSlots = availableSlots.length > 0;

    return {
      available: hasSlots,
      code: hasSlots ? 'SLOTS_AVAILABLE' : 'NO_SLOTS_AVAILABLE',
      message: hasSlots
        ? 'Available time slots loaded.'
        : 'No available time slots for the selected date.',
      date: toDateKey(dateOnly),
      slots: availableSlots,
      bookedSlots,
      workingHours: TIME_SLOT_CONFIG,
      availability,
    };
  } catch (error) {
    console.error('Error getting available time slots:', error);
    return {
      available: false,
      code: 'SLOT_LOOKUP_FAILED',
      message: 'Failed to load time slots. Please try again.',
      slots: [],
      bookedSlots: [],
    };
  }
};

/**
 * Retrieves upcoming appointments for a specific guardian.
 * @param {number} guardianId - The ID of the guardian.
 * @param {number} limit - Number of appointments to return.
 */
const getAppointmentsByGuardian = async (guardianId, limit = 5) => {
  try {
  const query = `
      SELECT
        a.id,
        a.scheduled_date,
        a.status,
        p.first_name || ' ' || p.last_name as infant_name,
        p.control_number,
        v.name as vaccine_name,
        c.name as clinic_name
      FROM appointments a
      JOIN patients p ON a.infant_id = p.id
      LEFT JOIN vaccines v ON a.vaccine_id = v.id
      LEFT JOIN clinics c ON a.clinic_id = c.id
      WHERE p.guardian_id = $1
      AND (a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::date >= (CURRENT_TIMESTAMP AT TIME ZONE '${CLINIC_TIMEZONE}')::date
      AND a.status NOT IN ('cancelled', 'completed')
      ORDER BY a.scheduled_date ASC
      LIMIT $2
    `;
    const result = await pool.query(query, [guardianId, limit]);
    return (result.rows || []).map(normalizeAppointmentRecordForResponse);
  } catch (error) {
    console.error('Error fetching guardian appointments:', error);
    return [];
  }
};

const findConflictingActiveAppointment = async ({
  infantId,
  scheduledDate,
  excludeAppointmentId = null,
} = {}) => {
  const parsedDate = parseDate(scheduledDate);
  if (!infantId || !parsedDate) {
    return null;
  }

  const { appointmentsPatient } = await getSchemaColumnMappings();
  const params = [infantId, toDateKey(parsedDate)];
  let query = `
    SELECT id, scheduled_date, status
    FROM appointments
    WHERE ${appointmentsPatient} = $1
      AND (scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::date = $2::date
      AND is_active = true
      AND status IN ('pending', 'scheduled')
  `;

  if (excludeAppointmentId) {
    query += ` AND id <> $3`;
    params.push(excludeAppointmentId);
  }

  query += ' ORDER BY scheduled_date ASC LIMIT 1';

  const result = await pool.query(query, params);
  return result.rows[0] || null;
};

/**
 * Creates a new appointment and sends notifications.
 * This is a new, production-ready function demonstrating the usage of the notification service.
 * @param {object} appointmentData - The data for the new appointment.
 * @returns {Promise<object>} The created appointment record.
 */
const createAppointmentAndNotify = async (appointmentData) => {
  const { infant_id, scheduled_date, vaccine_id, clinic_id, notes } = appointmentData;

  // In a real app, you would wrap this in a database transaction
  try {
    const parsedScheduledDate = parseAppointmentDateTimeInput(scheduled_date, {
      requireTime: true,
    });

    if (!parsedScheduledDate || !isAllowedAppointmentTimeSlot(parsedScheduledDate.time)) {
      const error = new Error('Appointments can only be scheduled between 8:00 AM and 4:00 PM in 30-minute slots.');
      error.statusCode = 400;
      error.code = 'INVALID_TIME';
      throw error;
    }

    const normalizedScheduledDate = parsedScheduledDate.normalizedIsoString;

    // 1. Insert the appointment into the database
    const insertQuery = `
      INSERT INTO appointments (infant_id, scheduled_date, vaccine_id, clinic_id, notes, status)
      VALUES ($1, $2, $3, $4, $5, 'scheduled')
      RETURNING *;
    `;
    const result = await pool.query(insertQuery, [infant_id, normalizedScheduledDate, vaccine_id, clinic_id, notes]);
    const newAppointment = normalizeAppointmentRecordForResponse(result.rows[0]);

    // 2. Fetch related data for notifications
    const detailsQuery = `
      SELECT
        p.first_name AS "infantName",
        p.control_number AS "controlNumber",
        g.name AS "guardianName",
        g.phone AS "guardianPhone",
        g.email AS "guardianEmail",
        v.name AS "vaccineName",
        c.name AS "clinicName"
      FROM patients p
      JOIN guardians g ON p.guardian_id = g.id
      JOIN vaccines v ON v.id = $1
      JOIN clinics c ON c.id = $2
      WHERE p.id = $3;
    `;
    const detailsResult = await pool.query(detailsQuery, [vaccine_id, clinic_id, infant_id]);
    const details = detailsResult.rows[0];

    // 3. Send notifications (offloaded, doesn't block the response)
    if (details && details.guardianPhone) {
      const appointmentDate = formatClinicDateTime(normalizedScheduledDate);
      const appointmentTime = formatClinicTime(normalizedScheduledDate);

      // Send SMS using the improved smsService
      const smsService = require('./smsService');
      smsService.sendAppointmentConfirmation({
        phoneNumber: details.guardianPhone,
        guardianName: details.guardianName,
        childName: details.infantName,
        vaccineName: details.vaccineName,
        scheduledDate: normalizedScheduledDate,
        location: details.clinicName,
      }).catch(err => console.error('Appointment confirmation SMS failed:', err.message));

      // Send Email
      const notificationService = require('./notificationService');
      notificationService.sendEmail(
        details.guardianEmail,
        'Immunicare Appointment Confirmation',
        'appointmentConfirmation',
        { ...details, appointmentDate, appointmentTime },
      ).catch(err => console.error('Appointment confirmation email failed:', err.message));
    }

    return newAppointment;
  } catch (error) {
    console.error('Error creating appointment and notifying:', error);
    throw error;
  }
};

/**
 * Generate a unique control number for a new infant
 * Format: INF-YYYY-XXXXXX (e.g., INF-2024-000001)
 * Uses PostgreSQL sequence for atomicity
 */
const generateControlNumber = async (client = null) => {
  return generateInfantControlNumber(client || pool);
};

/**
 * Ensure an infant record exists for appointment scheduling
 * Checks by name/DOB/guardian or creates a new one with a control number
 */
const ensureInfantRecord = async (infantData, guardianId, client = null) => {
  const dbClient = client || pool;

  const resolved = await resolveOrCreateInfantPatient(
    {
      guardianId,
      firstName: infantData?.first_name,
      lastName: infantData?.last_name,
      dob: infantData?.dob,
      sex: infantData?.sex,
      initialValues: {
        middle_name: infantData?.middle_name || null,
      },
    },
    dbClient,
  );

  return {
    id: resolved.id,
    control_number: resolved.control_number,
  };
};

const resolveGuardianContact = async (guardianId) => {
  if (!guardianId) {
    return null;
  }

  try {
    const result = await pool.query(
      `
        SELECT g.id, g.name, g.phone, g.email
        FROM guardians g
        WHERE g.id = $1
        LIMIT 1
      `,
      [guardianId],
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching guardian contact:', error);
    return null;
  }
};

const resolveVaccineName = async (vaccineId) => {
  if (!vaccineId) {
    return 'selected vaccine';
  }

  try {
    const result = await pool.query(
      `
        SELECT name
        FROM vaccines
        WHERE id = $1
        LIMIT 1
      `,
      [vaccineId],
    );

    return result.rows[0]?.name || 'selected vaccine';
  } catch (error) {
    console.error('Error fetching vaccine name:', error);
    return 'selected vaccine';
  }
};

const buildUnavailableNotificationMessage = ({ guardianName, vaccineName, scheduledDate }) => {
  const dateLabel = scheduledDate
    ? new Date(scheduledDate).toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    : 'your selected date';

  return `Hi ${guardianName}, ${vaccineName} is currently unavailable for ${dateLabel}. We'll notify you once stock is replenished.`;
};

const VACCINE_UNAVAILABLE_NOTIFICATION_TYPE = 'vaccine_unavailable';

const buildGuardianNotificationScopeClause = (notificationColumns, guardianId, params) => {
  if (notificationColumns.has('guardian_id')) {
    params.push(guardianId);
    return `guardian_id = $${params.length}`;
  }

  if (notificationColumns.has('target_type') && notificationColumns.has('target_id')) {
    params.push('guardian');
    const targetTypePlaceholder = `$${params.length}`;
    params.push(guardianId);
    const targetIdPlaceholder = `$${params.length}`;
    return `target_type = ${targetTypePlaceholder} AND target_id = ${targetIdPlaceholder}`;
  }

  return null;
};

const shouldDedupeUnavailableNotification = async ({ guardianId, vaccineId, dateKey }) => {
  try {
    const notificationColumns = await getNotificationColumns();
    const params = [VACCINE_UNAVAILABLE_NOTIFICATION_TYPE];
    const guardianScopeClause = buildGuardianNotificationScopeClause(
      notificationColumns,
      guardianId,
      params,
    );

    if (!guardianScopeClause) {
      return false;
    }

    const hasMetadata = notificationColumns.has('metadata');

    let metadataClause = '';
    if (hasMetadata) {
      params.push(dateKey);
      const datePlaceholder = `$${params.length}`;
      params.push(String(vaccineId));
      const vaccinePlaceholder = `$${params.length}`;
      metadataClause = `
        AND COALESCE(metadata->>'date_key', '') = ${datePlaceholder}
        AND COALESCE(metadata->>'vaccine_id', '') = ${vaccinePlaceholder}
      `;
    }

    const result = await pool.query(
      `
        SELECT id
        FROM notifications
        WHERE notification_type = $1
          AND ${guardianScopeClause}
          AND created_at >= DATE_TRUNC('day', NOW())
          ${metadataClause}
        ORDER BY created_at DESC
        LIMIT 1
      `,
      params,
    );

    return (result.rows || []).length > 0;
  } catch (error) {
    console.error('Error checking dedupe for vaccine unavailability:', error);
    return false;
  }
};

const buildVaccineUnavailableMetadata = ({ guardianId, infantId, vaccineId, dateKey, clinicId }) => ({
  guardian_id: guardianId,
  infant_id: infantId || null,
  vaccine_id: vaccineId,
  date_key: dateKey,
  clinic_id: clinicId || null,
  reason: 'out_of_stock',
});

const withVaccineUnavailableLock = async ({ guardianId, vaccineId, dateKey }, callback) => {
  const lockKey = `vaccine_unavailable:${guardianId}:${vaccineId}:${dateKey}`;
  let lockAcquired = false;

  try {
    const lockResult = await pool.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [lockKey],
    );

    lockAcquired = Boolean(lockResult.rows[0]?.locked);
    if (!lockAcquired) {
      return { notified: false, reason: 'duplicate_in_progress' };
    }

    return await callback();
  } finally {
    if (lockAcquired) {
      try {
        await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      } catch (unlockError) {
        console.error('Failed to release vaccine unavailable notification lock:', unlockError.message);
      }
    }
  }
};

const notifyGuardianVaccineUnavailable = async ({
  guardianId,
  infantId,
  vaccineId,
  scheduledDate,
  clinicId,
} = {}) => {
  if (!guardianId || !vaccineId) {
    return { notified: false, reason: 'missing_guardian_or_vaccine' };
  }

  const dateKey = toDateKey(scheduledDate);
  if (!dateKey) {
    return { notified: false, reason: 'invalid_date' };
  }

  return withVaccineUnavailableLock(
    { guardianId, vaccineId, dateKey },
    async () => {
      const shouldSkip = await shouldDedupeUnavailableNotification({
        guardianId,
        vaccineId,
        dateKey,
      });

      if (shouldSkip) {
        return { notified: false, reason: 'duplicate' };
      }

      const [guardian, vaccineName] = await Promise.all([
        resolveGuardianContact(guardianId),
        resolveVaccineName(vaccineId),
      ]);

      const guardianName = guardian?.name || `Guardian #${guardianId}`;
      const message = buildUnavailableNotificationMessage({
        guardianName,
        vaccineName,
        scheduledDate,
      });

      const metadata = buildVaccineUnavailableMetadata({
        guardianId,
        infantId,
        vaccineId,
        dateKey,
        clinicId,
      });

      try {
        const dispatchResult = await notificationService.sendNotification({
          notification_type: VACCINE_UNAVAILABLE_NOTIFICATION_TYPE,
          target_type: 'guardian',
          target_id: guardianId,
          recipient_name: guardianName,
          recipient_phone: guardian?.phone || null,
          recipient_email: guardian?.email || null,
          channel: 'sms',
          priority: 'high',
          subject: 'Vaccine Unavailable',
          message,
          created_by: null,
          guardian_id: guardianId,
          target_role: 'guardian',
          title: 'Vaccine Unavailable',
          type: 'alert',
          category: 'inventory',
          is_read: false,
          metadata,
          template_data: {
            guardian_name: guardianName,
            vaccine_name: vaccineName,
            date_key: dateKey,
          },
        });

        const notificationId = dispatchResult?.notification?.id || null;
        let persistedNotification = null;

        if (notificationId) {
          try {
            persistedNotification = await notificationService.getNotification(notificationId);
          } catch (readError) {
            console.error('Failed to fetch vaccine unavailable notification status:', readError.message);
          }
        }

        const finalStatus =
          persistedNotification?.status || dispatchResult?.notification?.status || null;

        return {
          notified: Boolean(notificationId),
          notificationId,
          smsSent: finalStatus === 'sent',
          status: finalStatus,
        };
      } catch (notificationError) {
        console.error('Failed to trigger vaccine unavailable notification pipeline:', notificationError.message);
        return {
          notified: false,
          reason: 'notification_pipeline_failed',
          error: notificationError.message,
        };
      }
    },
  );
};

/**
 * Process missed appointments and send SMS notifications
 * This should be called periodically (e.g., daily) to detect and notify about missed appointments
 */
const processMissedAppointments = async () => {
  try {
    const { appointmentsPatient } = await getSchemaColumnMappings();

    // Find appointments that were scheduled but not attended
    const query = `
      SELECT
        a.id as appointment_id,
        a.scheduled_date,
        a.type as appointment_type,
        a.status,
        a.location,
        p.id as infant_id,
        p.first_name as infant_first_name,
        p.last_name as infant_last_name,
        g.id as guardian_id,
        g.name as guardian_name,
        g.phone as guardian_phone
      FROM appointments a
      JOIN patients p ON a.${appointmentsPatient} = p.id
      JOIN guardians g ON p.guardian_id = g.id
      WHERE a.scheduled_date < NOW() - INTERVAL '2 hours'
        AND a.status IN ('scheduled', 'no-show')
        AND a.is_active = true
        AND (a.sms_missed_notification_sent IS NULL OR a.sms_missed_notification_sent = FALSE)
    `;

    const result = await pool.query(query);
    const missedAppointments = result.rows;

    if (missedAppointments.length === 0) {
      return { processed: 0, message: 'No missed appointments found' };
    }

    let sentCount = 0;
    let failedCount = 0;
    let rescheduledCount = 0;

    for (const appointment of missedAppointments) {
      if (!appointment.guardian_phone) {
        console.warn(`No guardian phone for missed appointment ${appointment.appointment_id}, skipping SMS`);
        failedCount++;
        continue;
      }

      // Format phone number to E.164 before sending SMS
      const formattedPhone = smsService.formatPhoneNumber(appointment.guardian_phone);
      if (!formattedPhone) {
        console.warn(`Invalid phone number for appointment ${appointment.appointment_id}: ${appointment.guardian_phone}`);
        failedCount++;
        continue;
      }

      try {
        const result = await smsService.sendMissedAppointmentNotification({
          phoneNumber: formattedPhone,
          guardianName: appointment.guardian_name,
          childName: `${appointment.infant_first_name} ${appointment.infant_last_name}`,
          vaccineType: appointment.appointment_type || 'vaccination',
          scheduledDate: appointment.scheduled_date,
          location: appointment.location,
        });

        if (result.success) {
          // Mark notification as sent
          await pool.query(
            'UPDATE appointments SET sms_missed_notification_sent = TRUE WHERE id = $1',
            [appointment.appointment_id],
          );
          sentCount++;

          // Attempt to auto-reschedule the missed appointment
          try {
            const rescheduleResult = await autoRescheduleMissedAppointment(appointment.appointment_id);
            if (rescheduleResult.success) {
              rescheduledCount++;
              console.log(`Auto-rescheduled missed appointment ${appointment.appointment_id}`);
            } else {
              console.warn(`Failed to auto-reschedule missed appointment ${appointment.appointment_id}: ${rescheduleResult.error}`);
            }
          } catch (rescheduleError) {
            console.error(`Error auto-rescheduling missed appointment ${appointment.appointment_id}:`, rescheduleError.message);
          }
        } else {
          console.warn(
            `Missed appointment SMS was not sent for appointment ${appointment.appointment_id}: ${result.error || 'unknown reason'}`,
          );
          failedCount++;
        }
      } catch (error) {
        console.error('Failed to send missed appointment SMS:', error.message);
        failedCount++;
      }
    }

    return {
      processed: missedAppointments.length,
      sent: sentCount,
      failed: failedCount,
      rescheduled: rescheduledCount,
    };
  } catch (error) {
    console.error('Error processing missed appointments:', error);
    return { error: error.message };
  }
};

/**
 * Automatically reschedule a missed appointment to the next available slot
 * @param {number} appointmentId - The ID of the missed appointment
 * @returns {Object} Result of the rescheduling attempt
 */
const autoRescheduleMissedAppointment = async (appointmentId) => {
  try {
    // Get the missed appointment details
    const appointment = await fetchAppointmentById(appointmentId);
    if (!appointment) {
      return {
        success: false,
        error: 'Appointment not found',
      };
    }

    // Check if appointment is actually missed (scheduled in past and not attended)
    const appointmentDate = normalizeAppointmentDateTimeForDisplay(appointment.scheduled_date)
      || new Date(appointment.scheduled_date);
    const now = new Date();
    if (appointmentDate >= now || !['scheduled', 'no-show'].includes(appointment.status)) {
      return {
        success: false,
        error: 'Appointment is not eligible for auto-rescheduling',
      };
    }

    // Get infant and vaccine details
    const infantResult = await pool.query(
      'SELECT id, first_name, last_name, dob, guardian_id FROM patients WHERE id = $1',
      [appointment.infant_id],
    );

    if (infantResult.rows.length === 0) {
      return {
        success: false,
        error: 'Infant not found',
      };
    }

    const infant = infantResult.rows[0];

    // Get vaccination history to determine next due vaccine
    const vaccinationsResult = await pool.query(
      `SELECT vr.vaccine_id, vr.dose_no, vr.administered_at, v.name as vaccine_name
       FROM vaccination_records vr
       JOIN vaccines v ON vr.vaccine_id = v.id
       WHERE vr.infant_id = $1
       ORDER BY vr.administered_at`,
      [infant.id],
    );

    const vaccinationHistory = vaccinationsResult.rows.map(record => ({
      vaccine: record.vaccine_name,
      dose_no: record.dose_no,
      date_administered: record.administered_at,
    }));

    // Calculate next valid dose
    const nextDoseInfo = calculateNextValidDose(infant.dob, vaccinationHistory);

    if (!nextDoseInfo) {
      return {
        success: false,
        error: 'No upcoming vaccines due for this child',
      };
    }

    // Find earliest valid date for the vaccine
    const earliestValidDate = findEarliestValidDate(
      getClinicTodayDateKey(),
      appointment.resolved_clinic_id,
    );

    if (!earliestValidDate) {
      return {
        success: false,
        error: 'No valid appointment dates available in the next 3 months',
      };
    }

    // Get available time slots for that date and vaccine
    const availabilityResult = await getAvailableTimeSlots({
      scheduledDate: earliestValidDate,
      vaccineId: appointment.vaccine_id,
      clinicId: appointment.resolved_clinic_id,
    });

    if (!availabilityResult.available || !availabilityResult.slots || availabilityResult.slots.length === 0) {
      return {
        success: false,
        error: 'No time slots available on the earliest valid date',
      };
    }

    // Use the first available slot
    const newTime = availabilityResult.slots[0];
    const newDateTime = `${earliestValidDate} ${newTime}:00`;

    // Update the appointment with new date/time
    const { _appointmentsScope } = await getSchemaColumnMappings();

    const updateResult = await pool.query(
      `
        UPDATE appointments
        SET scheduled_date = $1,
            status = 'scheduled',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `,
      [newDateTime, appointmentId],
    );

    if (updateResult.rows.length === 0) {
      return {
        success: false,
        error: 'Failed to update appointment',
      };
    }

    const updatedAppointment = updateResult.rows[0];

    // Send rescheduling notification
    if (updatedAppointment.guardian_phone) {
      try {
        await smsService.sendAppointmentRescheduledNotification({
          phoneNumber: updatedAppointment.guardian_phone,
          guardianName: updatedAppointment.guardian_name || 'Guardian',
          childName: `${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim(),
          vaccineName: updatedAppointment.type || 'Vaccination',
          oldScheduledDate: appointment.scheduled_date,
          newScheduledDate: updatedAppointment.scheduled_date,
          location: updatedAppointment.location || 'Main Health Center',
        });
      } catch (notificationError) {
        console.warn(`Failed to send rescheduling notification: ${notificationError.message}`);
        // Don't fail the rescheduling if notification fails
      }
    }

    return {
      success: true,
      appointment: updatedAppointment,
      message: `Appointment rescheduled to ${earliestValidDate} at ${newTime}`,
    };
  } catch (error) {
    console.error('Error in autoRescheduleMissedAppointment:', error);
    return {
      success: false,
      error: 'Failed to auto-reschedule missed appointment',
    };
  }
};

/**
 * Auto-approve appointment if all validation rules pass
 * @param {Object} appointmentData - The appointment data
 * @returns {Object} Result with autoApproval status and reason
 */
const checkAutoApprovalEligibility = async (appointmentData) => {
  const { infant_id, scheduled_date, vaccine_id, clinic_id } = appointmentData;

  try {
    // Step 1: Check if infant exists and is active
    const infantResult = await pool.query(
      'SELECT id, first_name, last_name, dob, guardian_id FROM patients WHERE id = $1 AND is_active = true',
      [infant_id],
    );

    if (infantResult.rows.length === 0) {
      return {
        eligible: false,
        autoApproved: false,
        reason: 'Infant not found or inactive',
      };
    }

    // Step 2: Check for duplicate/pending appointments
    const existingAppointmentResult = await pool.query(
      `SELECT id FROM appointments
       WHERE infant_id = $1 AND is_active = true
       AND status IN ('scheduled', 'pending')
       AND (scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::date = $2::date`,
      [infant_id, scheduled_date],
    );

    if (existingAppointmentResult.rows.length > 0) {
      return {
        eligible: false,
        autoApproved: false,
        reason: 'Child already has a pending appointment on this date',
      };
    }

    // Step 3: Check vaccine stock availability
    const parsedAppointmentDate = parseAppointmentDateTimeInput(scheduled_date, {
      requireTime: true,
    });
    if (!parsedAppointmentDate || !isAllowedAppointmentTimeSlot(parsedAppointmentDate.time)) {
      return {
        eligible: false,
        autoApproved: false,
        reason: 'Appointments can only be scheduled between 8:00 AM and 4:00 PM in 30-minute slots.',
      };
    }

    const scheduledDateKey = parsedAppointmentDate.dateKey;
    const scheduledTime = parsedAppointmentDate.time;
    const stockCheck = await checkVaccineStockForDateTime({
      date: scheduledDateKey,
      time: scheduledTime,
      vaccineId: vaccine_id,
      clinicId: clinic_id,
    });

    if (!stockCheck.available) {
      return {
        eligible: false,
        autoApproved: false,
        reason: stockCheck.message || 'Vaccine stock unavailable',
      };
    }

    // Step 4: Check if child is ready for this vaccine
    const { calculateVaccineReadiness } = require('./vaccineRulesEngine');
    const readinessResult = await calculateVaccineReadiness(infant_id);

    if (!readinessResult.success) {
      return {
        eligible: false,
        autoApproved: false,
        reason: 'Unable to verify vaccine readiness',
      };
    }

    const readiness = readinessResult.data;

    // If there are due or overdue vaccines, auto-approve
    if (readiness.readinessStatus === 'READY' || readiness.readinessStatus === 'OVERDUE') {
      return {
        eligible: true,
        autoApproved: true,
        reason: 'All validation rules passed - appointment auto-approved',
        readinessStatus: readiness.readinessStatus,
      };
    }

    // If no vaccines are due yet, still allow booking but mark for confirmation
    if (readiness.readinessStatus === 'UPCOMING') {
      return {
        eligible: true,
        autoApproved: false,
        reason: 'Vaccine not yet due - requires admin confirmation',
        readinessStatus: readiness.readinessStatus,
      };
    }

    // Default: require manual review
    return {
      eligible: true,
      autoApproved: false,
      reason: 'Requires admin review',
      readinessStatus: readiness.readinessStatus,
    };
  } catch (error) {
    console.error('Error in checkAutoApprovalEligibility:', error);
    return {
      eligible: false,
      autoApproved: false,
      reason: 'Error validating appointment eligibility',
    };
  }
};

module.exports = {
  checkBookingAvailability,
  getDailyVaccinationAppointmentCount,
  getAvailableTimeSlots,
  getCalendarAvailability,
  getCalendarDateDetails,
  getHolidayInfo,
  isWeekend,
  createAppointmentAndNotify, // Export the new function
  getAppointmentsByGuardian,
  generateControlNumber,
  ensureInfantRecord,
  getSchemaColumnMappings,
  notifyGuardianVaccineUnavailable,
  processMissedAppointments, // Export missed appointment processor
  checkAutoApprovalEligibility, // Export auto-approval checker
  findConflictingActiveAppointment,
};
