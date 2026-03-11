const pool = require('../db');
const NotificationService = require('./notificationService');
const {
  generateControlNumber: generateInfantControlNumber,
  resolveOrCreateInfantPatient,
} = require('./infantControlNumberService');

const PH_FIXED_HOLIDAYS = [
  { month: 1, day: 1, name: 'New Year\'s Day' },
  { month: 4, day: 9, name: 'Araw ng Kagitingan' },
  { month: 5, day: 1, name: 'Labor Day' },
  { month: 6, day: 12, name: 'Independence Day' },
  { month: 8, day: 21, name: 'Ninoy Aquino Day' },
  { month: 8, day: 31, name: 'National Heroes Day' },
  { month: 11, day: 1, name: 'All Saints Day' },
  { month: 11, day: 30, name: 'Bonifacio Day' },
  { month: 12, day: 8, name: 'Feast of the Immaculate Conception' },
  { month: 12, day: 24, name: 'Christmas Eve' },
  { month: 12, day: 25, name: 'Christmas Day' },
  { month: 12, day: 30, name: 'Rizal Day' },
  { month: 12, day: 31, name: 'New Year\'s Eve' },
];

const FALLBACK_SCHEMA_COLUMNS = Object.freeze({
  appointmentsPatient: 'infant_id',
  appointmentsScope: 'clinic_id',
  patientsScope: 'clinic_id',
  vaccineBatchesScope: 'clinic_id',
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
        ['patient_id', 'infant_id', 'facility_id', 'clinic_id'],
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
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDate = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
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
  end: '16:30',
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
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) {
    return false;
  }

  const day = date.getDay();
  return day === 0 || day === 6;
};

const getHolidayInfo = (value) => {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) {
    return null;
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return PH_FIXED_HOLIDAYS.find((holiday) => holiday.month === month && holiday.day === day) || null;
};

const resolveDateRange = ({ month, startDate, endDate }) => {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const firstDay = parseDate(`${month}-01`);
    if (!firstDay) {
      return null;
    }

    const lastDay = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0);
    lastDay.setHours(0, 0, 0, 0);
    return { start: firstDay, end: lastDay };
  }

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (start && end) {
    return { start, end };
  }

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  firstDay.setHours(0, 0, 0, 0);
  lastDay.setHours(0, 0, 0, 0);

  return { start: firstDay, end: lastDay };
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
         AND (vb.expiry_date IS NULL OR vb.expiry_date >= CURRENT_DATE)
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
         AND (vb.expiry_date IS NULL OR vb.expiry_date >= CURRENT_DATE)
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

const checkBookingAvailability = async ({ scheduledDate, vaccineId = null, clinicId = null }) => {
  try {
    const dateOnly = parseDate(scheduledDate);
    if (!dateOnly) {
      return {
        available: false,
        code: 'INVALID_DATE',
        message: 'Invalid appointment date',
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (dateOnly < today) {
      return {
        available: false,
        code: 'DATE_IN_PAST',
        message: 'Cannot schedule appointments in the past',
      };
    }

    if (isWeekend(dateOnly)) {
      return {
        available: false,
        code: 'WEEKEND_RESTRICTED',
        message: 'Saturdays and Sundays are not available for booking',
      };
    }

    const holiday = getHolidayInfo(dateOnly);
    if (holiday) {
      return {
        available: false,
        code: 'HOLIDAY_RESTRICTED',
        message: `${holiday.name} is not available for booking`,
        holiday,
      };
    }

    const stock = await getVaccineStockSummary(clinicId);

    if (vaccineId) {
      const selected = stock.vaccines.find((row) => parseInt(row.vaccine_id, 10) === parseInt(vaccineId, 10));
      const selectedStock = parseInt(selected?.available_stock || 0, 10);

      // Block booking when stock drops to critical level (10 or below)
      if (selectedStock <= 10) {
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

    const params = [toDateKey(startDate), toDateKey(endDate)];
    let query = `
      SELECT
        DATE(a.scheduled_date) AS schedule_date,
        COUNT(*)::int AS total_appointments
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.${appointmentsPatient}
      WHERE DATE(a.scheduled_date) BETWEEN $1::date AND $2::date
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

    query += ' GROUP BY DATE(a.scheduled_date)';

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

    while (cursor <= end) {
      const dateKey = toDateKey(cursor);
      const weekend = isWeekend(cursor);
      const holiday = getHolidayInfo(cursor);
      const noVaccineAvailability = stock.totalAvailableStock <= 10;

      let blockedReason = null;
      if (weekend) {
        blockedReason = 'weekend';
      } else if (holiday) {
        blockedReason = 'holiday';
      } else if (noVaccineAvailability) {
        blockedReason = 'no_vaccine_available';
      }

      days.push({
        date: dateKey,
        totalAppointments: dailyCounts[dateKey] || 0,
        isWeekend: weekend,
        isHoliday: Boolean(holiday),
        holidayName: holiday?.name || null,
        noVaccineAvailability,
        hasVaccineAvailability: stock.totalAvailableStock > 0,
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
    const params = [dateKey];
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
      WHERE DATE(a.scheduled_date) = $1::date
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

    const [appointmentsResult, availability] = await Promise.all([
      pool.query(query, params),
      checkBookingAvailability({ scheduledDate: dateKey, clinicId }),
    ]);

    const appointments = appointmentsResult.rows || [];

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
    let query = `
      SELECT a.id, a.scheduled_date
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.${appointmentsPatient}
      WHERE DATE(a.scheduled_date) = $1::date
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
        const date = new Date(row.scheduled_date);
        if (Number.isNaN(date.getTime())) {
          return null;
        }
        return date.toTimeString().slice(0, 5);
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

    const todayKey = toDateKey(new Date());
    const selectedKey = toDateKey(dateOnly);
    if (todayKey && selectedKey && todayKey === selectedKey) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      availableSlots = availableSlots.filter((slot) => {
        const slotMinutes = timeToMinutes(slot);
        return slotMinutes !== null && slotMinutes > currentMinutes;
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
      AND a.scheduled_date >= CURRENT_DATE
      AND a.status NOT IN ('cancelled', 'completed')
      ORDER BY a.scheduled_date ASC
      LIMIT $2
    `;
    const result = await pool.query(query, [guardianId, limit]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching guardian appointments:', error);
    return [];
  }
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
    // 1. Insert the appointment into the database
    const insertQuery = `
      INSERT INTO appointments (infant_id, scheduled_date, vaccine_id, clinic_id, notes, status)
      VALUES ($1, $2, $3, $4, $5, 'scheduled')
      RETURNING *;
    `;
    const result = await pool.query(insertQuery, [infant_id, scheduled_date, vaccine_id, clinic_id, notes]);
    const newAppointment = result.rows[0];

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
    if (details) {
      const appointmentDate = new Date(scheduled_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const appointmentTime = new Date(scheduled_date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      // Send SMS
      const smsMessage = `Immunicare Confirmation: Appointment for ${details.infantName} is set for ${appointmentDate} at ${appointmentTime}. Vaccine: ${details.vaccineName}.`;
      notificationService.sendSms(details.guardianPhone, smsMessage);

      // Send Email
      notificationService.sendEmail(details.guardianEmail, 'Immunicare Appointment Confirmation', 'appointmentConfirmation', { ...details, appointmentDate, appointmentTime });
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

module.exports = {
  checkBookingAvailability,
  getAvailableTimeSlots,
  getCalendarAvailability,
  getCalendarDateDetails,
  getHolidayInfo,
  isWeekend,
  createAppointmentAndNotify, // Export the new function
  getAppointmentsByGuardian,
  generateControlNumber,
  ensureInfantRecord,
  notifyGuardianVaccineUnavailable,
};
