/**
 * Password History Service
 * Tracks password history to prevent password reuse
 */

const pool = require('../db');
const bcrypt = require('bcryptjs');

const PASSWORD_HISTORY_SIZE = parseInt(process.env.PASSWORD_HISTORY_SIZE) || 10;
const PASSWORD_HISTORY_DAYS = 365; // Keep history for 1 year

/**
 * Add password to history
 * @param {number} userId - User ID
 * @param {string} passwordHash - Password hash to store
 */
const addToPasswordHistory = async (userId, passwordHash) => {
  try {
    // Delete expired history entries first
    await pool.query(
      `DELETE FROM password_history 
       WHERE user_id = $1 
       AND expires_at < NOW()`,
      [userId]
    );

    // Insert new password hash
    await pool.query(
      `INSERT INTO password_history (user_id, password_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${PASSWORD_HISTORY_DAYS} days')`,
      [userId, passwordHash]
    );

    // Delete old entries beyond the limit
    await pool.query(
      `DELETE FROM password_history 
       WHERE user_id = $1 
       AND id NOT IN (
         SELECT id FROM password_history 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2
       )`,
      [userId, PASSWORD_HISTORY_SIZE]
    );

    return true;
  } catch (error) {
    console.error('Error adding to password history:', error);
    throw error;
  }
};

/**
 * Get password history for a user
 * @param {number} userId - User ID
 * @returns {Promise<string[]>} Array of password hashes
 */
const getPasswordHistory = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT password_hash FROM password_history 
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, PASSWORD_HISTORY_SIZE]
    );

    return result.rows.map((row) => row.password_hash);
  } catch (error) {
    console.error('Error getting password history:', error);
    throw error;
  }
};

/**
 * Check if new password matches any in history
 * @param {number} userId - User ID
 * @param {string} newPassword - New password plain text
 * @returns {Promise<boolean>} True if password is in history
 */
const isPasswordInHistory = async (userId, newPassword) => {
  try {
    const history = await getPasswordHistory(userId);

    if (!history || history.length === 0) {
      return false;
    }

    for (const hash of history) {
      const match = await bcrypt.compare(newPassword, hash);
      if (match) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking password history:', error);
    // If there's an error, allow the password change (fail secure but not block)
    return false;
  }
};

/**
 * Validate password against history
 * @param {number} userId - User ID
 * @param {string} newPassword - New password plain text
 * @returns {Promise<Object>} Validation result
 */
const validatePasswordAgainstHistory = async (userId, newPassword) => {
  try {
    const isInHistory = await isPasswordInHistory(userId, newPassword);

    if (isInHistory) {
      return {
        isValid: false,
        error: 'You cannot use a password you have used in the last year'
      };
    }

    return { isValid: true };
  } catch (error) {
    console.error('Error validating password against history:', error);
    return { isValid: true };
  }
};

/**
 * Clear password history for a user (admin function)
 * @param {number} userId - User ID
 */
const clearPasswordHistory = async (userId) => {
  try {
    await pool.query('DELETE FROM password_history WHERE user_id = $1', [userId]);
    return true;
  } catch (error) {
    console.error('Error clearing password history:', error);
    throw error;
  }
};

/**
 * Get password history count for a user
 * @param {number} userId - User ID
 * @returns {Promise<number>} Count of history entries
 */
const getHistoryCount = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM password_history 
       WHERE user_id = $1 AND expires_at > NOW()`,
      [userId]
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error getting history count:', error);
    throw error;
  }
};

/**
 * Create password history table if it doesn't exist
 */
const createPasswordHistoryTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '1 year'
      );

      CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_password_history_expires_at ON password_history(expires_at);
    `);

    console.log('Password history table created/verified');
    return true;
  } catch (error) {
    console.error('Error creating password history table:', error);
    throw error;
  }
};

/**
 * Clean up expired password history entries
 */
const cleanupExpiredHistory = async () => {
  try {
    const result = await pool.query('DELETE FROM password_history WHERE expires_at < NOW()');
    console.log(`Cleaned up ${result.rowCount} expired password history entries`);
    return result.rowCount;
  } catch (error) {
    console.error('Error cleaning up expired password history:', error);
    throw error;
  }
};

module.exports = {
  addToPasswordHistory,
  getPasswordHistory,
  isPasswordInHistory,
  validatePasswordAgainstHistory,
  clearPasswordHistory,
  getHistoryCount,
  createPasswordHistoryTable,
  cleanupExpiredHistory,
  PASSWORD_HISTORY_SIZE
};
