/**
 * Scheduler Module
 * Initializes and manages scheduled background jobs for the Immunicare system
 */

const logger = require('../config/logger');
const pool = require('../db');
const appointmentSchedulingService = require('../services/appointmentSchedulingService');

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

  // DISABLED: Missed appointment processing causes infinite SMS loops
  // The job was sending duplicate SMS notifications for missed appointments
  // const missedAppointmentJob = setInterval(() => {
  //   processMissedAppointmentsJob().catch((err) => {
  //     logger.error('Error in missed appointment job:', err.message);
  //   });
  // }, MISSED_APPOINTMENT_CHECK_INTERVAL);
  // jobs.push(missedAppointmentJob);

  // DISABLED: Initial missed appointment check also disabled
  // setTimeout(() => {
  //   processMissedAppointmentsJob().catch((err) => {
  //     logger.error('Error running initial missed appointment check:', err.message);
  //   });
  // }, 60000); // 1 minute delay

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
module.exports.processMissedAppointmentsJob = processMissedAppointmentsJob;
