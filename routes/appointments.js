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
const {
  notifyAdminsOfGuardianAppointmentEvent,
} = require('../services/appointmentEventNotificationService');
const { sendAppointmentConfirmation } = require('../services/smsService');
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

const router = express.Router();

router.use(authenticateToken);

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

const APPOINTMENT_STATUS_VALUES = [
  'pending',
  'scheduled',
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

const hasOwn = (payload, key) => Object.prototype.hasOwnProperty.call(payload || {}, key);

const sanitizeAppointmentMutablePayload = (payload = {}, { allowStatus = true } = {}) => {
  const errors = {};
  const normalized = {};

  if (hasOwn(payload, 'scheduled_date')) {
    const scheduledDate = sanitizeText(payload.scheduled_date);
    if (!scheduledDate) {
      errors.scheduled_date = 'scheduled_date is required';
    } else {
      const parsedDate = new Date(scheduledDate);
      if (Number.isNaN(parsedDate.getTime())) {
        errors.scheduled_date = 'scheduled_date must be a valid date';
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        parsedDate.setHours(0, 0, 0, 0);

        if (parsedDate < today) {
          errors.scheduled_date =
            'Cannot schedule appointments in the past. Please select today or a future date.';
        } else {
          normalized.scheduled_date = scheduledDate;
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

const fetchInfantOwnership = async (infantId) => {
  const result = await pool.query(
    `
      SELECT id, guardian_id, clinic_id
      FROM patients
      WHERE id = $1 AND is_active = true
      LIMIT 1
    `,
    [infantId],
  );

  return result.rows[0] || null;
};

const fetchAppointmentById = async (id) => {
  const result = await pool.query(
    `
      SELECT
        a.*,
        p.first_name AS first_name,
        p.last_name AS last_name,
        p.control_number AS control_number,
        p.guardian_id AS owner_guardian_id,
        COALESCE(p.clinic_id, a.clinic_id) AS resolved_clinic_id,
        g.name AS guardian_name,
        g.phone AS guardian_phone,
        g.email AS guardian_email
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.infant_id
      LEFT JOIN guardians g ON g.id = p.guardian_id
      WHERE a.id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] || null;
};

// Get all appointments
router.get('/', async (req, res) => {
  try {
    const { status, date, infant_id, clinic_id } = req.query;
    const canonicalRole = getCanonicalRole(req);

    const params = [];
    let query = `
      SELECT
        a.*,
        p.first_name AS first_name,
        p.last_name AS last_name,
        p.control_number AS control_number,
        p.guardian_id AS owner_guardian_id,
        COALESCE(p.clinic_id, a.clinic_id) AS resolved_clinic_id,
        g.name AS guardian_name,
        g.phone AS guardian_phone
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.infant_id
      LEFT JOIN guardians g ON g.id = p.guardian_id
      WHERE a.is_active = true
    `;

    if (canonicalRole === CANONICAL_ROLES.GUARDIAN) {
      if (!req.user.guardian_id) {
        return res.status(403).json({ error: 'Guardian account mapping is missing' });
      }

      query += ` AND p.guardian_id = $${params.length + 1}`;
      params.push(parseInt(req.user.guardian_id, 10));
    }

    if (canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN && clinic_id) {
      query += ` AND COALESCE(p.clinic_id, a.clinic_id) = $${params.length + 1}`;
      params.push(parseInt(clinic_id, 10));
    }

    if (status) {
      query += ` AND a.status = $${params.length + 1}`;
      params.push(status);
    }

    if (date) {
      query += ` AND DATE(a.scheduled_date) = $${params.length + 1}`;
      params.push(date);
    }

    if (infant_id) {
      query += ` AND a.infant_id = $${params.length + 1}`;
      params.push(parseInt(infant_id, 10));
    }

    query += ' ORDER BY a.scheduled_date ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('List appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Create appointment (SYSTEM_ADMIN full, GUARDIAN own request)
router.post('/', requirePermission('appointment:create:own'), async (req, res) => {
  try {
    const payload = req.body || {};
    const { normalized, errors } = sanitizeAppointmentMutablePayload(payload, {
      allowStatus: true,
    });

    // Handle infant identification or creation
    let infantId = payload.infant_id;

    // If no ID but details provided (auto-create flow)
    if (!infantId && payload.infant_details && isGuardian(req)) {
      try {
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
      return respondValidationError(res, errors);
    }

    const normalizedScheduledDate = normalized.scheduled_date;
    const normalizedType = normalized.type;
    const normalizedNotes = hasOwn(normalized, 'notes') ? normalized.notes : null;
    const normalizedDuration = hasOwn(normalized, 'duration_minutes')
      ? normalized.duration_minutes
      : 30;
    const normalizedLocation = hasOwn(normalized, 'location')
      ? normalized.location || 'Main Health Center'
      : sanitizeText(payload.location, { maxLength: 150 }) || 'Main Health Center';
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

    const finalStatus = guardianFlow ? 'pending' : normalized.status || 'scheduled';
    const finalClinicId = clinicIdCheck.value || infant.clinic_id || req.user.clinic_id || null;

    // Generate appointment control number
    let appointmentControlNumber = null;
    try {
      appointmentControlNumber = await appointmentControlNumberService.generateControlNumber();
    } catch (cnError) {
      console.error('Failed to generate control number:', cnError.message);
      // Continue without control number - non-critical
    }

    if (guardianFlow) {
      const availability = await appointmentSchedulingService.checkBookingAvailability({
        scheduledDate: normalizedScheduledDate,
        vaccineId: sanitizeNullableInt(req.body.vaccine_id),
        clinicId: sanitizeNullableInt(finalClinicId),
      });

      if (!availability.available) {
        if (availability.code === 'SELECTED_VACCINE_OUT_OF_STOCK') {
          try {
            await appointmentSchedulingService.notifyGuardianVaccineUnavailable({
              guardianId: parseInt(req.user.guardian_id, 10),
              infantId,
              vaccineId: sanitizeNullableInt(req.body.vaccine_id),
              scheduledDate: normalizedScheduledDate,
              clinicId: sanitizeNullableInt(finalClinicId),
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
    }

    const result = await pool.query(
      `
        INSERT INTO appointments (
          infant_id,
          scheduled_date,
          type,
          duration_minutes,
          notes,
          status,
          created_by,
          clinic_id,
          location,
          control_number
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        infantId,
        normalizedScheduledDate,
        normalizedType,
        normalizedDuration,
        normalizedNotes,
        finalStatus,
        req.user.id,
        finalClinicId,
        normalizedLocation,
        appointmentControlNumber,
      ],
    );

    const appointment = result.rows[0];
    const fullAppointment = (await fetchAppointmentById(appointment.id)) || appointment;

    if (guardianFlow) {
      await notifyAdminsOfGuardianAppointmentEvent({
        event: 'created',
        appointment: fullAppointment,
        actorUserId: req.user.id,
        guardianName: fullAppointment.guardian_name || null,
        infantName: `${fullAppointment.first_name || ''} ${fullAppointment.last_name || ''}`.trim(),
      });
    }

    if (sendConfirmationSms) {
      try {
        await appointmentConfirmationService.sendConfirmationSMS(appointment.id);
      } catch (smsError) {
        console.error('Failed to send confirmation SMS:', smsError.message);
      }
    }

    socketService.broadcast('appointment_created', fullAppointment);
    res.status(201).json(fullAppointment);
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// Check booking availability (GUARDIAN and SYSTEM_ADMIN)
router.get('/availability/check', async (req, res) => {
  try {
    const { scheduled_date, vaccine_id, clinic_id } = req.query;

    if (!scheduled_date) {
      return res.status(400).json({
        error: 'scheduled_date is required',
      });
    }

    const availability = await appointmentSchedulingService.checkBookingAvailability({
      scheduledDate: scheduled_date,
      vaccineId: sanitizeNullableInt(vaccine_id),
      clinicId: sanitizeNullableInt(clinic_id || req.user.clinic_id),
    });

    res.json(availability);
  } catch (error) {
    console.error('Check appointment availability error:', error);
    res.status(500).json({ error: 'Failed to check appointment availability' });
  }
});

// Available time slots for a selected date
router.get('/availability/slots', async (req, res) => {
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
router.get('/availability/calendar', async (req, res) => {
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

    const calendar = await appointmentSchedulingService.getCalendarAvailability({
      month,
      startDate,
      endDate,
      guardianId,
      clinicId: sanitizeNullableInt(req.query.clinic_id || req.user.clinic_id),
    });

    res.json(calendar);
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
router.get('/availability/date/:date', async (req, res) => {
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

// Get appointments for a specific date (SYSTEM_ADMIN)
router.get('/date/:date', requirePermission('appointment:view'), async (req, res) => {
  try {
    const { date } = req.params;
    const result = await pool.query(
      `
        SELECT
          a.*,
          p.first_name AS first_name,
          p.last_name AS last_name,
          p.control_number AS control_number,
          g.name AS guardian_name,
          g.phone AS guardian_phone
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.infant_id
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE DATE(a.scheduled_date) = $1
        ORDER BY a.scheduled_date ASC
      `,
      [date],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Appointments by date error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments by date' });
  }
});

// Get upcoming appointments
router.get('/upcoming', requirePermission('appointment:view'), async (req, res) => {
  try {
    const limit = sanitizeLimit(req.query.limit, 10, 100);
    const result = await pool.query(
      `
        SELECT
          a.*,
          p.first_name AS first_name,
          p.last_name AS last_name,
          p.control_number AS control_number,
          g.name AS guardian_name,
          g.phone AS guardian_phone
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.infant_id
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE a.scheduled_date >= CURRENT_DATE
          AND a.status = 'scheduled'
        ORDER BY a.scheduled_date ASC
        LIMIT $1
      `,
      [limit],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Upcoming appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming appointments' });
  }
});

// Get appointment statistics (SYSTEM_ADMIN)
router.get('/stats/overview', requirePermission('appointment:view'), async (req, res) => {
  try {
    const [today, scheduled, completed, cancelled, thisMonth] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM appointments WHERE DATE(scheduled_date) = CURRENT_DATE'),
      pool.query('SELECT COUNT(*) as count FROM appointments WHERE status = \'scheduled\''),
      pool.query('SELECT COUNT(*) as count FROM appointments WHERE status = \'attended\''),
      pool.query('SELECT COUNT(*) as count FROM appointments WHERE status = \'cancelled\''),
      pool.query(
        'SELECT COUNT(*) as count FROM appointments WHERE DATE_TRUNC(\'month\', scheduled_date) = DATE_TRUNC(\'month\', CURRENT_DATE)',
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

    res.json(result.rows.map((row) => row.type));
  } catch (error) {
    console.error('Appointment types error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment types' });
  }
});

// Get appointment by ID (SYSTEM_ADMIN full, GUARDIAN own)
router.get('/:id(\\d+)', async (req, res) => {
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
    }

    res.json(appointment);
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
});

// Update appointment (SYSTEM_ADMIN)
router.put('/:id(\\d+)', async (req, res) => {
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

    const payload = req.body || {};

    if (guardianFlow) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      if (!guardianId || guardianId !== parseInt(appointment.owner_guardian_id, 10)) {
        return res.status(403).json({ error: 'You can only edit your own appointment requests' });
      }

      if (APPOINTMENT_EDIT_LOCKED_STATUSES.includes(String(appointment.status || '').toLowerCase())) {
        return res.status(400).json({ error: 'This appointment can no longer be edited' });
      }
    } else if (canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN) {
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

    if (hasOwn(normalizedUpdates, 'scheduled_date') && guardianFlow) {
      const availability = await appointmentSchedulingService.checkBookingAvailability({
        scheduledDate: normalizedUpdates.scheduled_date,
        clinicId: sanitizeNullableInt(appointment.resolved_clinic_id || req.user.clinic_id),
      });

      if (!availability.available) {
        return res.status(400).json({
          error: availability.message,
          code: availability.code,
          availability,
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
        appointment.status !== 'scheduled' &&
        updatedAppointment.guardian_phone) {
      try {
        const smsResult = await sendAppointmentConfirmation({
          phoneNumber: updatedAppointment.guardian_phone,
          guardianName: updatedAppointment.guardian_name || 'Guardian',
          childName: `${updatedAppointment.first_name || ''} ${updatedAppointment.last_name || ''}`.trim() || 'Your Child',
          vaccineName: updatedAppointment.type || 'Vaccination',
          scheduledDate: updatedAppointment.scheduled_date,
          location: updatedAppointment.location || 'Main Health Center',
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

    socketService.broadcast('appointment_updated', updatedAppointment);
    res.json(updatedAppointment);
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
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
    } else if (canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN) {
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

    socketService.broadcast('appointment_updated', cancelledAppointment);
    res.json(cancelledAppointment);
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

    socketService.broadcast('appointment_updated', result.rows[0]);
    res.json(result.rows[0]);
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
    result.rows.forEach(appointment => {
      socketService.broadcast('appointment_updated', appointment);
    });
    res.json({
      updated: result.rows.length,
      appointments: result.rows,
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

    const result = await pool.query('DELETE FROM appointments WHERE id = $1 RETURNING id', [appointmentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    socketService.broadcast('appointment_deleted', { id: appointmentId });
    res.json({ message: 'Appointment deleted successfully' });
  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

module.exports = router;
