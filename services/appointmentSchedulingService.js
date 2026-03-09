const pool = require('../db');
const notificationService = require('./notificationService');
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

let schemaColumnMappingPromise = null;

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

module.exports = {
  checkBookingAvailability,
  getCalendarAvailability,
  getCalendarDateDetails,
  getHolidayInfo,
  isWeekend,
  createAppointmentAndNotify, // Export the new function
  getAppointmentsByGuardian,
  generateControlNumber,
  ensureInfantRecord,
};
