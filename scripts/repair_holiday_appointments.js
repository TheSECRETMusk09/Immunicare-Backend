require('dotenv').config();

const pool = require('../db');
const appointmentSchedulingService = require('../services/appointmentSchedulingService');
const { writeAuditLog } = require('../services/auditLogService');
const {
  CLINIC_TIMEZONE,
  getPhilippineHolidays,
  getHolidayInfo,
  isDateAvailableForBooking,
} = require('../config/holidays');
const {
  shiftClinicDateKey,
  toClinicDateKey,
} = require('../utils/clinicCalendar');

const DEFAULT_LOOKAHEAD_DAYS = 365;
const REVIEW_NOTE_MARKER = '[HOLIDAY_REVIEW_REQUIRED]';
const SCRIPT_USERNAME = 'maintenance:holiday-appointment-repair';

const parseArgs = (argv) => {
  const options = {
    apply: false,
    json: false,
    limit: null,
    lookaheadDays: DEFAULT_LOOKAHEAD_DAYS,
  };

  argv.forEach((arg) => {
    if (arg === '--apply') {
      options.apply = true;
      return;
    }

    if (arg === '--json') {
      options.json = true;
      return;
    }

    if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        options.limit = parsed;
      }
      return;
    }

    if (arg.startsWith('--lookahead=')) {
      const parsed = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        options.lookaheadDays = parsed;
      }
    }
  });

  return options;
};

const createScriptRequest = () => ({
  user: {
    username: SCRIPT_USERNAME,
    role: 'system_admin',
  },
  ip: '127.0.0.1',
  get: () => 'holiday-repair-script',
});

const toIntOrNull = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const buildHolidayDateKeys = (startYear, endYear) => {
  const keys = new Set();
  const firstYear = Number.isInteger(startYear) ? startYear : new Date().getFullYear();
  const lastYear = Number.isInteger(endYear) ? endYear : firstYear;

  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const holiday of getPhilippineHolidays(year)) {
      const key = toClinicDateKey(holiday.date);
      if (key) {
        keys.add(key);
      }
    }
  }

  return keys;
};

const buildBlockedDateMap = (rows = []) => {
  const map = new Map();

  for (const row of rows) {
    const key = toClinicDateKey(row.blocked_date);
    if (!key) {
      continue;
    }

    map.set(key, {
      ...row,
      clinic_id: toIntOrNull(row.clinic_id),
      blocked_date_key: key,
    });
  }

  return map;
};

const isBlockedForAppointment = (blockedDate, clinicId) => {
  if (!blockedDate || blockedDate.is_blocked === false) {
    return false;
  }

  const blockedClinicId = toIntOrNull(blockedDate.clinic_id);
  if (blockedClinicId === null) {
    return true;
  }

  if (clinicId === null) {
    return true;
  }

  return blockedClinicId === clinicId;
};

const toMinutes = (timeValue) => {
  if (!timeValue) {
    return null;
  }

  const [hours, minutes] = String(timeValue).split(':').map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
};

const chooseClosestTimeSlot = (slots = [], desiredTime = null) => {
  if (!Array.isArray(slots) || slots.length === 0) {
    return null;
  }

  if (desiredTime && slots.includes(desiredTime)) {
    return desiredTime;
  }

  const desiredMinutes = toMinutes(desiredTime);
  if (desiredMinutes === null) {
    return slots[0];
  }

  return slots.reduce((bestSlot, currentSlot) => {
    if (!bestSlot) {
      return currentSlot;
    }

    const currentMinutes = toMinutes(currentSlot);
    const bestMinutes = toMinutes(bestSlot);
    if (currentMinutes === null) {
      return bestSlot;
    }

    const currentDelta = Math.abs(currentMinutes - desiredMinutes);
    const bestDelta = bestMinutes === null ? Number.POSITIVE_INFINITY : Math.abs(bestMinutes - desiredMinutes);
    if (currentDelta < bestDelta) {
      return currentSlot;
    }

    if (currentDelta === bestDelta && currentMinutes < bestMinutes) {
      return currentSlot;
    }

    return bestSlot;
  }, null);
};

const findNextBookableSlot = async ({
  scheduledDateKey,
  clinicId = null,
  vaccineId = null,
  appointmentType = null,
  excludeAppointmentId = null,
  desiredTime = null,
  lookaheadDays = DEFAULT_LOOKAHEAD_DAYS,
}) => {
  if (!scheduledDateKey) {
    return null;
  }

  for (let offset = 1; offset <= lookaheadDays; offset += 1) {
    const candidateDateKey = shiftClinicDateKey(scheduledDateKey, offset);
    if (!candidateDateKey) {
      continue;
    }

    const availability = isDateAvailableForBooking(candidateDateKey, {
      allowPast: true,
    });

    if (!availability.isAvailable) {
      continue;
    }

    const slotResult = await appointmentSchedulingService.getAvailableTimeSlots({
      scheduledDate: candidateDateKey,
      vaccineId,
      clinicId,
      appointmentType,
      excludeAppointmentId,
    });

    if (!slotResult?.available || !Array.isArray(slotResult.slots) || slotResult.slots.length === 0) {
      continue;
    }

    const chosenTime = chooseClosestTimeSlot(slotResult.slots, desiredTime);
    if (!chosenTime) {
      continue;
    }

    return {
      dateKey: candidateDateKey,
      time: chosenTime,
      slotResult,
    };
  }

  return null;
};

const appendReviewNote = (existingNotes, note) => {
  const current = String(existingNotes || '').trim();
  if (current.includes(REVIEW_NOTE_MARKER)) {
    return current;
  }

  if (!current) {
    return note;
  }

  return `${current}\n\n${note}`;
};

const buildReviewNote = ({ holiday, blockedDate, scheduledDateKey }) => {
  const label = holiday?.name || blockedDate?.reason || 'a non-bookable date';
  return `${REVIEW_NOTE_MARKER} Appointment was scheduled on ${label} (${scheduledDateKey}) and requires administrative review.`;
};

const buildAuditContext = () => createScriptRequest();

const updateAppointmentWithAudit = async ({
  appointment,
  newScheduledDate,
  metadata,
  eventType,
  oldValues,
  newValues,
}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updatedResult = await client.query(
      `
        UPDATE appointments
        SET scheduled_date = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `,
      [newScheduledDate, appointment.id],
    );

    if (updatedResult.rows.length === 0) {
      throw new Error('Appointment update returned no rows');
    }

    await writeAuditLog({
      client,
      req: buildAuditContext(),
      eventType,
      entityType: 'appointment',
      entityId: appointment.id,
      oldValues,
      newValues,
      metadata,
      severity: 'WARNING',
    });

    await client.query('COMMIT');
    return updatedResult.rows[0];
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // Ignore rollback failures so the original error can surface.
    }

    throw error;
  } finally {
    client.release();
  }
};

const flagAppointmentForReview = async ({
  appointment,
  reviewNote,
  metadata,
  eventType,
  oldValues,
  newValues,
}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updatedResult = await client.query(
      `
        UPDATE appointments
        SET notes = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `,
      [reviewNote, appointment.id],
    );

    if (updatedResult.rows.length === 0) {
      throw new Error('Appointment review flag update returned no rows');
    }

    await writeAuditLog({
      client,
      req: buildAuditContext(),
      eventType,
      entityType: 'appointment',
      entityId: appointment.id,
      oldValues,
      newValues,
      metadata,
      severity: 'WARNING',
    });

    await client.query('COMMIT');
    return updatedResult.rows[0];
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // Ignore rollback failures so the original error can surface.
    }

    throw error;
  } finally {
    client.release();
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const scriptStart = new Date();

  const yearBoundsResult = await pool.query(`
    SELECT
      COALESCE(MIN(EXTRACT(YEAR FROM scheduled_date))::int, EXTRACT(YEAR FROM CURRENT_DATE)::int) AS min_year,
      COALESCE(MAX(EXTRACT(YEAR FROM scheduled_date))::int, EXTRACT(YEAR FROM CURRENT_DATE)::int) AS max_year
    FROM appointments
    WHERE is_active = true
  `);

  const minYear = yearBoundsResult.rows[0]?.min_year || scriptStart.getFullYear();
  const maxYear = yearBoundsResult.rows[0]?.max_year || scriptStart.getFullYear();
  const holidayDateKeys = buildHolidayDateKeys(minYear, maxYear);

  const blockedDatesResult = await pool.query(`
    SELECT id, blocked_date, is_blocked, reason, blocked_by, clinic_id, created_at, updated_at
    FROM blocked_dates
    WHERE is_blocked = true
  `);
  const blockedDateMap = buildBlockedDateMap(blockedDatesResult.rows || []);
  for (const key of blockedDateMap.keys()) {
    holidayDateKeys.add(key);
  }

  const invalidDateKeys = Array.from(holidayDateKeys);
  if (invalidDateKeys.length === 0) {
    return {
      dryRun: !options.apply,
      scanned: 0,
      matched: 0,
      rescheduled: 0,
      flagged: 0,
      skipped: 0,
      failed: 0,
      items: [],
    };
  }

  const {
    appointmentsPatient,
    appointmentsScope,
    patientsScope,
  } = await appointmentSchedulingService.getSchemaColumnMappings();

  const limitClause = Number.isInteger(options.limit) && options.limit > 0 ? `LIMIT ${options.limit}` : '';
  const candidateResult = await pool.query(
    `
      SELECT
        a.id,
        a.scheduled_date,
        a.status,
        a.notes,
        a.type,
        a.vaccine_id,
        a.is_active,
        COALESCE(p.${patientsScope}, a.${appointmentsScope}) AS resolved_clinic_id,
        p.first_name,
        p.last_name,
        p.control_number,
        g.name AS guardian_name,
        g.phone AS guardian_phone,
        to_char(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}', 'YYYY-MM-DD') AS scheduled_date_key,
        to_char(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}', 'HH24:MI') AS scheduled_time_key
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.${appointmentsPatient}
      LEFT JOIN guardians g ON g.id = p.guardian_id
      WHERE a.is_active = true
        AND to_char(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}', 'YYYY-MM-DD') = ANY($1::text[])
      ORDER BY a.scheduled_date ASC
      ${limitClause}
    `,
    [invalidDateKeys],
  );

  const report = {
    dryRun: !options.apply,
    scanned: candidateResult.rows.length,
    matched: 0,
    rescheduled: 0,
    flagged: 0,
    skipped: 0,
    failed: 0,
    items: [],
  };

  for (const row of candidateResult.rows) {
    const scheduledDateKey = row.scheduled_date_key;
    const holiday = getHolidayInfo(scheduledDateKey);
    const blockedDate = blockedDateMap.get(scheduledDateKey) || null;
    const resolvedClinicId = toIntOrNull(row.resolved_clinic_id);
    const blockedApplies = isBlockedForAppointment(blockedDate, resolvedClinicId);
    const isHoliday = Boolean(holiday);
    const isBlocked = blockedApplies;

    if (!isHoliday && !isBlocked) {
      report.skipped += 1;
      continue;
    }

    report.matched += 1;

    const appointmentDate = new Date(row.scheduled_date);
    const isFuture = appointmentDate.getTime() >= scriptStart.getTime();
    const blockingLabel = holiday?.name || blockedDate?.reason || 'non-bookable date';

    if (!options.apply) {
      const preview = isFuture
        ? 'will reschedule'
        : 'will flag for review';
      report.items.push({
        appointmentId: row.id,
        scheduledDate: row.scheduled_date,
        blockingLabel,
        action: preview,
      });
      continue;
    }

    try {
      if (isFuture) {
        const desiredTime = row.scheduled_time_key || null;
        const slotResult = await findNextBookableSlot({
          scheduledDateKey,
          clinicId: resolvedClinicId,
          vaccineId: row.vaccine_id,
          appointmentType: row.type,
          excludeAppointmentId: row.id,
          desiredTime,
          lookaheadDays: options.lookaheadDays,
        });

        if (slotResult) {
          const newScheduledDate = `${slotResult.dateKey} ${slotResult.time}:00`;
          const updatedAppointment = await updateAppointmentWithAudit({
            appointment: row,
            newScheduledDate,
            eventType: 'APPOINTMENT_HOLIDAY_AUTO_RESCHEDULED',
            oldValues: {
              scheduled_date: row.scheduled_date,
              status: row.status,
              notes: row.notes,
            },
            newValues: {
              scheduled_date: newScheduledDate,
              status: row.status,
              notes: row.notes,
            },
            metadata: {
              action: 'auto_rescheduled',
              holiday_name: holiday?.name || null,
              blocked_reason: blockedDate?.reason || null,
              original_date_key: scheduledDateKey,
              original_time: row.scheduled_time_key || null,
              new_date_key: slotResult.dateKey,
              new_time: slotResult.time,
            },
          });

          report.rescheduled += 1;
          report.items.push({
            appointmentId: row.id,
            action: 'rescheduled',
            originalDate: row.scheduled_date,
            newDate: updatedAppointment.scheduled_date,
            blockingLabel,
          });
          continue;
        }
      }

      const reviewNote = buildReviewNote({
        holiday,
        blockedDate,
        scheduledDateKey,
      });
      const nextNotes = appendReviewNote(row.notes, reviewNote);

      if (String(nextNotes || '').trim() === String(row.notes || '').trim()) {
        report.skipped += 1;
        report.items.push({
          appointmentId: row.id,
          action: 'already_flagged',
          blockingLabel,
        });
        continue;
      }

      const updatedAppointment = await flagAppointmentForReview({
        appointment: row,
        reviewNote: nextNotes,
        eventType: 'APPOINTMENT_HOLIDAY_REVIEW_FLAGGED',
        oldValues: {
          notes: row.notes,
        },
        newValues: {
          notes: nextNotes,
        },
        metadata: {
          action: 'flagged_for_review',
          holiday_name: holiday?.name || null,
          blocked_reason: blockedDate?.reason || null,
          original_date_key: scheduledDateKey,
        },
      });

      report.flagged += 1;
      report.items.push({
        appointmentId: row.id,
        action: 'flagged',
        blockingLabel,
        notes: updatedAppointment.notes,
      });
    } catch (error) {
      report.failed += 1;
      report.items.push({
        appointmentId: row.id,
        action: 'failed',
        blockingLabel,
        error: error.message,
      });
    }
  }

  return report;
};

const printReport = (report, options) => {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Holiday appointment repair ${report.dryRun ? '(dry run)' : '(applied)'}`);
  console.log(`Scanned: ${report.scanned}`);
  console.log(`Matched invalid dates: ${report.matched}`);
  console.log(`Rescheduled: ${report.rescheduled}`);
  console.log(`Flagged for review: ${report.flagged}`);
  console.log(`Skipped: ${report.skipped}`);
  console.log(`Failed: ${report.failed}`);

  if (report.items.length > 0) {
    console.log('');
    console.log('Sample actions:');
    report.items.slice(0, 20).forEach((item) => {
      const suffix = item.error ? ` - ${item.error}` : '';
      console.log(
        `  #${item.appointmentId} ${item.action} (${item.blockingLabel || 'n/a'})${suffix}`,
      );
    });
  }
};

if (require.main === module) {
  main()
    .then((report) => {
      printReport(report, parseArgs(process.argv.slice(2)));
    })
    .catch((error) => {
      console.error('Holiday appointment repair failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await pool.end();
      } catch (_error) {
        // Ignore shutdown errors.
      }
    });
}

module.exports = {
  appendReviewNote,
  buildBlockedDateMap,
  buildHolidayDateKeys,
  buildReviewNote,
  chooseClosestTimeSlot,
  findNextBookableSlot,
  isBlockedForAppointment,
  parseArgs,
};
