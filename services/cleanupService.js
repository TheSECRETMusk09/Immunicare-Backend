/**
 * Cleanup tasks for old records.
 */

const pool = require('../db');
const logger = require('../config/logger');

/**
 * Clean old notifications from the database
 * @param {number} days - Number of days to keep notifications (default: 90)
 * @returns {Promise<number>} - Number of deleted notifications
 */
async function cleanOldNotifications(days = 90) {
  try {
    const query = `
      DELETE FROM notifications
      WHERE created_at < NOW() - INTERVAL '${days} days'
      AND is_read = true
      RETURNING id
    `;

    const result = await pool.query(query);
    const deletedCount = result.rowCount;

    logger.info(`Cleaned up ${deletedCount} old notifications (older than ${days} days)`);
    return deletedCount;
  } catch (error) {
    logger.error('Error cleaning old notifications:', error);
    throw error;
  }
}

/**
 * Clean old alerts from the database
 * @param {number} days - Number of days to keep resolved alerts (default: 30)
 * @returns {Promise<number>} - Number of deleted alerts
 */
async function cleanOldAlerts(days = 30) {
  try {
    const query = `
      DELETE FROM alerts
      WHERE resolved_at < NOW() - INTERVAL '${days} days'
      AND status = 'resolved'
      RETURNING id
    `;

    const result = await pool.query(query);
    const deletedCount = result.rowCount;

    logger.info(`Cleaned up ${deletedCount} old resolved alerts (older than ${days} days)`);
    return deletedCount;
  } catch (error) {
    logger.error('Error cleaning old alerts:', error);
    throw error;
  }
}

/**
 * Clean old refresh tokens from the database
 * @returns {Promise<number>} - Number of deleted tokens
 */
async function cleanExpiredTokens() {
  try {
    const query = `
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW()
      RETURNING id
    `;

    const result = await pool.query(query);
    const deletedCount = result.rowCount;

    logger.info(`Cleaned up ${deletedCount} expired refresh tokens`);
    return deletedCount;
  } catch (error) {
    logger.error('Error cleaning expired tokens:', error);
    throw error;
  }
}

/**
 * Run all cleanup tasks
 * @returns {Promise<Object>} - Cleanup results
 */
async function runAllCleanup() {
  const results = {
    notifications: 0,
    alerts: 0,
    tokens: 0,
    errors: [],
  };

  try {
    results.notifications = await cleanOldNotifications();
  } catch (error) {
    results.errors.push({ task: 'notifications', error: error.message });
  }

  try {
    results.alerts = await cleanOldAlerts();
  } catch (error) {
    results.errors.push({ task: 'alerts', error: error.message });
  }

  try {
    results.tokens = await cleanExpiredTokens();
  } catch (error) {
    results.errors.push({ task: 'tokens', error: error.message });
  }

  return results;
}

module.exports = {
  cleanOldNotifications,
  cleanOldAlerts,
  cleanExpiredTokens,
  runAllCleanup,
};
