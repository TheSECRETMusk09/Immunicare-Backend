/**
 * SMS Appointment Reminder Scheduler
 *
 * Automatically sends SMS reminders to guardians when their child's
 * next appointment is approaching (24-48 hours before the scheduled date)
 */

const pool = require('../db');
const smsService = require('./smsService');
const logger = require('../config/logger');

// Scheduler configuration
const SCHEDULER_CONFIG = {
  // Check for appointments every 15 minutes
  checkInterval: 15 * 60 * 1000, // 15 minutes

  // Send reminder X hours before appointment
  reminderHoursBefore: [48, 24], // Send at 48h and 24h before

  // Batch size for processing
  batchSize: 50,

  // Enable/disable reminder types
  enabled: process.env.SMS_REMINDERS_ENABLED !== 'false',
};

// In-memory store for sent reminders (use Redis for production)
const sentReminders = new Map();

/**
 * Check if reminder was already sent
 */
function wasReminderSent(appointmentId, hoursBefore) {
  const key = `${appointmentId}_${hoursBefore}h`;
  return sentReminders.has(key);
}

/**
 * Mark reminder as sent
 */
function markReminderSent(appointmentId, hoursBefore) {
  const key = `${appointmentId}_${hoursBefore}h`;
  sentReminders.set(key, new Date());
}

/**
 * Get appointments that need reminders
 */
async function getAppointmentsNeedingReminders(hoursBefore) {
  const now = new Date();
  const targetTime = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);

  const windowStart = new Date(targetTime.getTime() - 15 * 60 * 1000); // 15 min window
  const windowEnd = new Date(targetTime.getTime() + 15 * 60 * 1000);

  const result = await pool.query(
    `SELECT
       a.id as appointment_id,
       a.scheduled_date,
       a.type as appointment_type,
       a.status,
       a.location,
       p.id as infant_id,
       p.first_name as infant_first_name,
       p.last_name as infant_last_name,
       p.control_number as control_number,
       g.id as guardian_id,
       g.name as guardian_name,
       g.phone as guardian_phone,
       c.name as clinic_name,
       c.address as clinic_address
     FROM appointments a
     JOIN patients p ON a.infant_id = p.id
     JOIN guardians g ON p.guardian_id = g.id
     LEFT JOIN clinics c ON a.clinic_id = c.id
     WHERE a.scheduled_date BETWEEN $1 AND $2
       AND a.status IN ('scheduled', 'confirmed', 'pending')
       AND a.is_active = true
       AND p.is_active = true
       AND g.is_active = true`,
    [windowStart.toISOString(), windowEnd.toISOString()],
  );

  return result.rows;
}

/**
 * Get reminder settings for guardian
 */
async function getReminderSettings(guardianId, infantId) {
  const result = await pool.query(
    `SELECT * FROM appointment_reminder_settings
     WHERE guardian_id = $1 AND (infant_id = $2 OR infant_id IS NULL)
     ORDER BY infant_id DESC
     LIMIT 1`,
    [guardianId, infantId],
  );

  return (
    result.rows[0] || {
      reminder_enabled: true,
      reminder_hours_before: 24,
      sms_notification_enabled: true,
    }
  );
}

/**
 * Send appointment reminder
 */
async function sendAppointmentReminder(appointment) {
  const {
    appointment_id,
    scheduled_date,
    appointment_type,
    guardian_phone,
    infant_first_name,
    infant_last_name,
    clinic_name,
    clinic_address: _clinic_address,
  } = appointment;

  if (!guardian_phone) {
    logger.warn(`No phone number for guardian of infant ${infant_first_name}`);
    return { success: false, reason: 'no_phone' };
  }

  const formattedPhone = smsService.formatPhoneNumber(guardian_phone);
  if (!formattedPhone) {
    logger.warn(`Invalid guardian phone for appointment ${appointment_id}: ${guardian_phone}`);
    return { success: false, reason: 'invalid_phone' };
  }

  const childName = `${infant_first_name} ${infant_last_name}`;

  const message = smsService.createAppointmentReminderMessage(
    appointment_type || 'scheduled vaccine',
    scheduled_date,
  );

  try {
    const result = await smsService.sendSMS(formattedPhone, message, 'appointment_reminder', {
      appointmentId: appointment_id,
      infantName: childName,
      scheduledDate: scheduled_date,
      clinicName: clinic_name,
    });

    logger.info(`Appointment reminder sent to ${formattedPhone} for appointment ${appointment_id}`);

    return {
      success: true,
      messageId: result.messageId,
      provider: result.provider,
      to: formattedPhone,
    };
  } catch (error) {
    logger.error('Failed to send appointment reminder:', error.message);
    return { success: false, reason: error.message };
  }
}

/**
 * Process reminders for a specific hours-before setting
 */
async function processRemindersForHours(hoursBefore) {
  logger.info(`Checking for appointments needing ${hoursBefore}h reminders...`);

  try {
    const appointments = await getAppointmentsNeedingReminders(hoursBefore);
    logger.info(`Found ${appointments.length} appointments for ${hoursBefore}h reminder`);

    let sentCount = 0;
    let failedCount = 0;

    for (const appointment of appointments) {
      // Check if reminder was already sent
      if (wasReminderSent(appointment.appointment_id, hoursBefore)) {
        continue;
      }

      // Check reminder settings
      const settings = await getReminderSettings(appointment.guardian_id, appointment.infant_id);

      if (!settings.reminder_enabled || !settings.sms_notification_enabled) {
        logger.info(`Reminders disabled for guardian ${appointment.guardian_id}`);
        continue;
      }

      // Check if this hours-before setting is enabled
      const enabledHours = settings.reminder_hours_before || 24;
      if (enabledHours !== hoursBefore && enabledHours !== 48 && enabledHours !== 24) {
        // Skip if not the right reminder time
        continue;
      }

      // Send reminder
      const result = await sendAppointmentReminder(appointment);

      if (result.success) {
        sentCount++;
        markReminderSent(appointment.appointment_id, hoursBefore);

        // Persist reminder status to appointment record for idempotency across restarts
        const flagColumn = `reminder_sent_${hoursBefore}h`;
        try {
          await pool.query(
            // Use a dynamic column name safely; hoursBefore is from a controlled array.
            `UPDATE appointments SET ${flagColumn} = TRUE WHERE id = $1`,
            [appointment.appointment_id],
          );
        } catch (dbError) {
          // Gracefully handle if column doesn't exist (code 42703 for undefined column)
          if (dbError.code !== '42703') {
            logger.warn(`Could not update reminder flag ${flagColumn} for appointment ${appointment.appointment_id}`, { error: dbError.message });
          }
        }

        // Log to database
        await pool.query(
          `INSERT INTO sms_logs
           (phone_number, message_content, message_type, status, provider, external_message_id, metadata, sent_at)
           VALUES ($1, $2, $3, 'sent', $4, $5, $6, NOW())`,
          [
            result.to || appointment.guardian_phone,
            'Appointment reminder',
            'appointment_reminder',
            result.provider || 'sms',
            result.messageId,
            JSON.stringify({ appointmentId: appointment.appointment_id }),
          ],
        );
      } else {
        failedCount++;
      }
    }

    logger.info(`Processed ${hoursBefore}h reminders: ${sentCount} sent, ${failedCount} failed`);

    return { sent: sentCount, failed: failedCount };
  } catch (error) {
    logger.error(`Error processing ${hoursBefore}h reminders:`, error);
    return { error: error.message };
  }
}

/**
 * Main reminder processing function
 */
async function processAppointmentReminders() {
  if (!SCHEDULER_CONFIG.enabled) {
    logger.info('SMS appointment reminders are disabled');
    return;
  }

  logger.info('=== Processing appointment reminders ===');

  for (const hoursBefore of SCHEDULER_CONFIG.reminderHoursBefore) {
    const result = await processRemindersForHours(hoursBefore);
    if (result.error) {
      logger.error(`Error for ${hoursBefore}h reminders:`, result.error);
    }
  }

  logger.info('=== Reminder processing complete ===');
}

/**
 * Start the reminder scheduler
 */
function startReminderScheduler() {
  if (!SCHEDULER_CONFIG.enabled) {
    logger.info('SMS reminder scheduler is disabled');
    return;
  }

  logger.info(
    `Starting SMS reminder scheduler (interval: ${SCHEDULER_CONFIG.checkInterval / 60000} minutes)`,
  );
  logger.info(
    `Reminder times: ${SCHEDULER_CONFIG.reminderHoursBefore.join('h, ')}h before appointment`,
  );

  // Initial run
  processAppointmentReminders();

  // Set interval
  const intervalId = setInterval(processAppointmentReminders, SCHEDULER_CONFIG.checkInterval);

  return intervalId;
}

/**
 * Stop the reminder scheduler
 */
function stopReminderScheduler(intervalId) {
  if (intervalId) {
    clearInterval(intervalId);
    logger.info('SMS reminder scheduler stopped');
  }
}

/**
 * Manual trigger for sending reminders (for testing)
 */
async function triggerRemindersNow() {
  logger.info('Manual reminder trigger initiated');
  return processAppointmentReminders();
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
  return {
    enabled: SCHEDULER_CONFIG.enabled,
    checkInterval: SCHEDULER_CONFIG.checkInterval,
    reminderHoursBefore: SCHEDULER_CONFIG.reminderHoursBefore,
    sentRemindersCount: sentReminders.size,
  };
}

module.exports = {
  processAppointmentReminders,
  startReminderScheduler,
  stopReminderScheduler,
  triggerRemindersNow,
  getSchedulerStatus,
  SCHEDULER_CONFIG,
};
