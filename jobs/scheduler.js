/**
 * Scheduler Module
 * Initializes and manages scheduled background jobs for the Immunicare system
 */

const logger = require('../config/logger');

// Job intervals (in milliseconds)
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

let jobs = [];
let isInitialized = false;

// Cache for table existence checks
const tableExistsCache = new Map();
const TABLE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Check if a table exists in the database
 * @param {string} tableName - Name of the table to check
 * @returns {Promise<boolean>} - True if table exists
 */
async function checkTableExists(tableName) {
  const cached = tableExistsCache.get(tableName);
  if (cached && cached.timestamp > Date.now() - TABLE_CACHE_TTL) {
    return cached.exists;
  }

  try {
    const pool = require('../db');
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
  try {
    // Check if table exists first
    const exists = await checkTableExists('user_sessions');

    if (!exists) {
      logger.warn('Table \'user_sessions\' does not exist, skipping session cleanup. Run migrations to create it.');
      return;
    }

    const pool = require('../db');

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
    // Only log as error if it's not a "table doesn't exist" error
    if (error.code === '42P01') { // undefined_table
      logger.warn('Table \'user_sessions\' not accessible, skipping cleanup. Check permissions and configuration.');
    } else {
      logger.error('Error cleaning up expired sessions:', {
        message: error.message,
        code: error.code,
      });
    }
  }
}

/**
 * Cleanup old notification logs
 */
async function cleanupOldNotifications() {
  try {
    // Check if table exists first
    const exists = await checkTableExists('notification_logs');

    if (!exists) {
      logger.warn('Table \'notification_logs\' does not exist, skipping notification cleanup. Run migrations to create it.');
      return;
    }

    const pool = require('../db');
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
    // Only log as error if it's not a "table doesn't exist" error
    if (error.code === '42P01') { // undefined_table
      logger.warn('Table \'notification_logs\' not accessible, skipping cleanup. Check permissions and configuration.');
    } else {
      logger.error('Error cleaning up old notifications:', {
        message: error.message,
        code: error.code,
      });
    }
  }
}

/**
 * Cleanup expired password reset tokens
 */
async function cleanupExpiredTokens() {
  try {
    // Check if table exists first
    let exists;
    try {
      exists = await checkTableExists('password_reset_otps');
    } catch (_checkError) {
      logger.debug('Could not check password_reset_otps table existence, skipping cleanup');
      return;
    }

    if (!exists) {
      logger.debug('password_reset_otps table does not exist, skipping cleanup');
      return;
    }

    const pool = require('../db');
    const result = await pool.query(
      `DELETE FROM password_reset_otps
       WHERE expires_at < NOW()
       RETURNING id`,
    );
    if (result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} expired password reset tokens`);
    }
  } catch (error) {
    // Only log as error if it's not a "table doesn't exist" error
    if (error.code === '42P01') { // undefined_table
      logger.debug('password_reset_otps table not accessible, skipping cleanup');
    } else {
      logger.error('Error cleaning up expired tokens:', {
        message: error.message,
        code: error.code,
      });
    }
  }
}

/**
 * Run all cleanup tasks
 */
async function runCleanupTasks() {
  logger.info('Running scheduled cleanup tasks...');
  await Promise.allSettled([
    cleanupExpiredSessions(),
    cleanupOldNotifications(),
    cleanupExpiredTokens(),
  ]);
  logger.info('Scheduled cleanup tasks completed');
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
