/**
 * Scheduler Module
 * Initializes and manages scheduled background jobs for the Immunicare system
 */

const logger = require('../config/logger');
const pool = require('../db');
const appointmentSchedulingService = require('../services/appointmentSchedulingService');
const smsService = require('../services/smsService');

const FATAL_DB_CONFIG_ERROR_CODES = new Set([
  '28P01',
  '28000',
  '3D000',
  '3F000',
  '42501',
]);

const isFatalDbConfigError = (code) => FATAL_DB_CONFIG_ERROR_CODES.has(code);
const isScramPasswordTypeError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('sasl') && message.includes('client password must be a string');
};

const isAuthOrConfigDbError = (error) => isFatalDbConfigError(error?.code) || isScramPasswordTypeError(error);

// Job intervals (in milliseconds)
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const REMINDER_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour - check for appointment reminders
const MISSED_APPOINTMENT_CHECK_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours - check for missed appointments

let jobs = [];
let isInitialized = false;
let dbUnavailableForScheduler = false;

// Cache for table existence checks
const tableExistsCache = new Map();
const TABLE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Check if a table exists in the database
 * @param {string} tableName - Name of the table to check
 * @returns {Promise<boolean>} - True if table exists
 */
async function checkTableExists(tableName) {
  if (dbUnavailableForScheduler) {
    return false;
  }

  const cached = tableExistsCache.get(tableName);
  if (cached && cached.timestamp > Date.now() - TABLE_CACHE_TTL) {
    return cached.exists;
  }

  try {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      )`,
      [tableName],
    );
    const exists = result.rows[0].exists;
    tableExistsCache.set(tableName, { exists, timestamp: Date.now() });
    return exists;
  } catch (error) {
    if (isAuthOrConfigDbError(error)) {
      if (!dbUnavailableForScheduler) {
        dbUnavailableForScheduler = true;
        logger.error('Scheduler detected DB authentication/configuration failure. Disabling scheduled DB cleanup tasks for this process.', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
      }
      return false;
    }

    logger.error(`Error checking table existence for ${tableName}:`, {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return false;
  }
}

/**
 * Cleanup expired sessions from the database
 */
async function cleanupExpiredSessions() {
  const exists = await checkTableExists('user_sessions');
  if (!exists) {
    logger.debug('Skipping session cleanup because \'user_sessions\' table does not exist or DB is unavailable.');
    return;
  }

  try {
    // First check if the expires_at column exists
    const columnCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'user_sessions'
        AND column_name = 'expires_at'
      )`,
    );

    if (!columnCheck.rows[0].exists) {
      logger.warn('Column \'expires_at\' does not exist in \'user_sessions\' table, skipping session cleanup. Run migrations to add it.');
      return;
    }

    const result = await pool.query(
      `DELETE FROM user_sessions
       WHERE expires_at < NOW()
       RETURNING id`,
    );
    if (result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} expired sessions`);
    }
  } catch (error) {
    logger.error('Error during session cleanup execution:', {
      message: error.message,
      code: error.code,
    });
  }
}

/**
 * Cleanup old notification logs
 */
async function cleanupOldNotifications() {
  const exists = await checkTableExists('notification_logs');
  if (!exists) {
    logger.debug('Skipping notification cleanup because \'notification_logs\' table does not exist or DB is unavailable.');
    return;
  }

  try {
    // Keep only last 90 days of notification logs
    const result = await pool.query(
      `DELETE FROM notification_logs
       WHERE created_at < NOW() - INTERVAL '90 days'
       RETURNING id`,
    );
    if (result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} old notification logs`);
    }
  } catch (error) {
    logger.error('Error during old notification cleanup execution:', {
      message: error.message,
      code: error.code,
    });
  }
}

/**
 * Cleanup expired password reset tokens
 */
async function cleanupExpiredTokens() {
  const exists = await checkTableExists('password_reset_otps');
  if (!exists) {
    logger.debug('Skipping token cleanup because \'password_reset_otps\' table does not exist or DB is unavailable.');
    return;
  }

  try {
    const result = await pool.query(
      `DELETE FROM password_reset_otps
       WHERE expires_at < NOW()
       RETURNING id`,
    );
    if (result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} expired password reset tokens`);
    }
  } catch (error) {
    logger.error('Error during expired token cleanup execution:', {
      message: error.message,
      code: error.code,
    });
  }
}

/**
 * Run all cleanup tasks
 */
async function runCleanupTasks() {
  if (dbUnavailableForScheduler) {
    logger.warn('Scheduled cleanup tasks skipped because DB is unavailable for scheduler.');
    return;
  }

  logger.info('Running scheduled cleanup tasks...');
  await Promise.allSettled([
    cleanupExpiredSessions(),
    cleanupOldNotifications(),
    cleanupExpiredTokens(),
  ]);
  logger.info('Scheduled cleanup tasks completed');
}

/**
 * Send appointment reminder SMS to guardians
 * This runs periodically to check for upcoming appointments and send reminders
 */
async function sendAppointmentReminders() {
  const exists = await checkTableExists('appointments');
  if (!exists) {
    logger.debug('Skipping appointment reminders because appointments table does not exist or DB is unavailable.');
    return;
  }

  try {
    // Find appointments scheduled for the next 24-48 hours that haven't been reminded
    const query = `
      SELECT
        a.id as appointment_id,
        a.scheduled_date,
        a.type as appointment_type,
        a.reminder_sent_24h,
        a.reminder_sent_48h,
        p.id as infant_id,
        p.first_name as infant_first_name,
        p.last_name as infant_last_name,
        g.id as guardian_id,
        g.name as guardian_name,
        g.phone as guardian_phone
      FROM appointments a
      JOIN patients p ON a.infant_id = p.id
      JOIN guardians g ON p.guardian_id = g.id
      WHERE a.scheduled_date BETWEEN NOW() + INTERVAL '20 hours' AND NOW() + INTERVAL '48 hours'
        AND a.status IN ('scheduled')
        AND a.is_active = true
    `;

    const result = await pool.query(query);
    const upcomingAppointments = result.rows;

    if (upcomingAppointments.length === 0) {
      logger.debug('No upcoming appointments found for reminders');
      return;
    }

    let sent24hCount = 0;
    let sent48hCount = 0;
    let failedCount = 0;

    for (const appointment of upcomingAppointments) {
      if (!appointment.guardian_phone) {
        failedCount++;
        continue;
      }

      const hoursUntil = Math.round(
        (new Date(appointment.scheduled_date) - new Date()) / (1000 * 60 * 60),
      );

      // Send 48-hour reminder if not already sent
      if (hoursUntil <= 48 && !appointment.reminder_sent_48h) {
        try {
          const smsResult = await smsService.sendAppointmentReminder({
            phoneNumber: appointment.guardian_phone,
            childName: `${appointment.infant_first_name} ${appointment.infant_last_name}`,
            scheduledDate: appointment.scheduled_date,
            hoursUntil: 48,
          });

          if (smsResult.success) {
            await pool.query(
              'UPDATE appointments SET reminder_sent_48h = TRUE WHERE id = $1',
              [appointment.appointment_id],
            );
            sent48hCount++;
          }
        } catch (error) {
          logger.error('Failed to send 48h reminder:', error.message);
          failedCount++;
        }
      }

      // Send 24-hour reminder if not already sent
      if (hoursUntil <= 24 && !appointment.reminder_sent_24h) {
        try {
          const smsResult = await smsService.sendAppointmentReminder({
            phoneNumber: appointment.guardian_phone,
            childName: `${appointment.infant_first_name} ${appointment.infant_last_name}`,
            scheduledDate: appointment.scheduled_date,
            hoursUntil: 24,
          });

          if (smsResult.success) {
            await pool.query(
              'UPDATE appointments SET reminder_sent_24h = TRUE WHERE id = $1',
              [appointment.appointment_id],
            );
            sent24hCount++;
          }
        } catch (error) {
          logger.error('Failed to send 24h reminder:', error.message);
          failedCount++;
        }
      }
    }

    logger.info(`Appointment reminders: 48h=${sent48hCount}, 24h=${sent24hCount}, failed=${failedCount}`);
  } catch (error) {
    logger.error('Error sending appointment reminders:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
    });
  }
}

/**
 * Process missed appointments and send notifications
 */
async function processMissedAppointmentsJob() {
  try {
    const result = await appointmentSchedulingService.processMissedAppointments();
    if (result && result.processed !== undefined) {
      logger.info(`Missed appointments processed: ${result.processed}, sent: ${result.sent}, failed: ${result.failed}`);
    }
  } catch (error) {
    logger.error('Error processing missed appointments:', error.message);
  }
}

/**
 * Initialize the scheduler
 * Sets up all scheduled jobs
 */
function initScheduler() {
  if (isInitialized) {
    logger.warn('Scheduler already initialized, skipping...');
    return;
  }

  logger.info('Initializing scheduler...');

  // Run cleanup tasks immediately on startup
  runCleanupTasks().catch((err) => {
    logger.error('Error running initial cleanup:', err.message);
  });

  // Schedule periodic cleanup tasks
  const cleanupJob = setInterval(() => {
    runCleanupTasks().catch((err) => {
      logger.error('Error in scheduled cleanup:', err.message);
    });
  }, CLEANUP_INTERVAL);

  jobs.push(cleanupJob);

  // Schedule session cleanup more frequently
  const sessionCleanupJob = setInterval(() => {
    cleanupExpiredSessions().catch((err) => {
      logger.error('Error in session cleanup:', err.message);
    });
  }, SESSION_CLEANUP_INTERVAL);

  jobs.push(sessionCleanupJob);

  // Schedule appointment reminder checks
  const reminderJob = setInterval(() => {
    sendAppointmentReminders().catch((err) => {
      logger.error('Error in appointment reminder job:', err.message);
    });
  }, REMINDER_CHECK_INTERVAL);

  jobs.push(reminderJob);

  // Run reminders immediately on startup (after a short delay)
  setTimeout(() => {
    sendAppointmentReminders().catch((err) => {
      logger.error('Error running initial appointment reminders:', err.message);
    });
  }, 30000); // 30 second delay to allow DB connection

  // Schedule missed appointment processing
  const missedAppointmentJob = setInterval(() => {
    processMissedAppointmentsJob().catch((err) => {
      logger.error('Error in missed appointment job:', err.message);
    });
  }, MISSED_APPOINTMENT_CHECK_INTERVAL);

  jobs.push(missedAppointmentJob);

  // Run missed appointment check after a delay
  setTimeout(() => {
    processMissedAppointmentsJob().catch((err) => {
      logger.error('Error running initial missed appointment check:', err.message);
    });
  }, 60000); // 1 minute delay

  isInitialized = true;
  logger.info('Scheduler initialized successfully');
}

/**
 * Stop all scheduled jobs
 */
function stopScheduler() {
  logger.info('Stopping scheduler...');
  jobs.forEach((job) => clearInterval(job));
  jobs = [];
  isInitialized = false;
  logger.info('Scheduler stopped');
}

/**
 * Get scheduler status
 */
function getStatus() {
  return {
    isInitialized,
    activeJobs: jobs.length,
  };
}

module.exports = initScheduler;
module.exports.stopScheduler = stopScheduler;
module.exports.getStatus = getStatus;
module.exports.runCleanupTasks = runCleanupTasks;
module.exports.sendAppointmentReminders = sendAppointmentReminders;
module.exports.processMissedAppointmentsJob = processMissedAppointmentsJob;
