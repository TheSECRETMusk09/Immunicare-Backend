/**
 * Session Management Service
 * Handles session timeout, invalidation, and management
 */

const pool = require('../db');

// Configuration
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT) || 15 * 60 * 1000; // 15 minutes inactivity
const ABSOLUTE_TIMEOUT = parseInt(process.env.ABSOLUTE_SESSION_TIMEOUT) || 8 * 60 * 60 * 1000; // 8 hours max
const MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_CONCURRENT_SESSIONS) || 5;
const ABSOLUTE_TIMEOUT_SECONDS = Math.floor(ABSOLUTE_TIMEOUT / 1000);

/**
 * Create a new session
 * @param {number} userId - User ID
 * @param {string} sessionToken - Session token (optional, will generate if not provided)
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - Browser user agent
 * @param {Object} deviceInfo - Device information
 * @returns {Promise<Object>} Session data
 */
const createSession = async (
  userId,
  sessionToken = null,
  ipAddress,
  userAgent,
  deviceInfo = {},
) => {
  try {
    // Check concurrent sessions
    const activeSessions = await getActiveSessionCount(userId);
    if (activeSessions >= MAX_CONCURRENT_SESSIONS) {
      // Revoke oldest session
      await revokeOldestSession(userId);
    }

    // Generate unique session token if not provided
    if (!sessionToken) {
      sessionToken = generateUniqueSessionToken(userId);
    }

    const result = await pool.query(
      `INSERT INTO user_sessions
       (user_id, session_token, ip_address, user_agent, device_info, login_time, last_activity, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW() + ($6 * INTERVAL '1 second'))
       ON CONFLICT (session_token) DO UPDATE
       SET login_time = NOW(),
           last_activity = NOW(),
           expires_at = NOW() + ($6 * INTERVAL '1 second'),
           is_active = true,
           logout_time = NULL
       RETURNING *`,
      [userId, sessionToken, ipAddress, userAgent, JSON.stringify(deviceInfo), ABSOLUTE_TIMEOUT_SECONDS],
    );

    return result.rows[0];
  } catch (error) {
    console.error('Error creating session:', error);
    throw error;
  }
};

/**
 * Generate a unique session token
 * @param {number} userId - User ID
 * @returns {string} Unique session token
 */
const generateUniqueSessionToken = (userId) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const userIdHash = Buffer.from(userId.toString()).toString('base64').replace(/=/g, '');
  return `${userIdHash}.${timestamp}.${random}`;
};

/**
 * Validate a session
 * @param {string} sessionToken - Session token
 * @returns {Promise<Object|null>} Session data or null
 */
const validateSession = async (sessionToken) => {
  try {
    const result = await pool.query(
      `SELECT us.*, u.username, u.role_id, u.clinic_id, u.guardian_id, u.email,
              r.name as role_name, r.display_name as role_display_name
       FROM user_sessions us
       JOIN users u ON us.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE us.session_token = $1
       AND us.is_active = true
       AND us.logout_time IS NULL`,
      [sessionToken],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const session = result.rows[0];

    // Check if session has expired due to inactivity
    const lastActivity = new Date(session.last_activity);
    if (Date.now() - lastActivity.getTime() > SESSION_TIMEOUT) {
      await endSession(sessionToken, 'timeout');
      return null;
    }

    // Check if session has exceeded absolute timeout
    const loginTime = new Date(session.login_time);
    if (Date.now() - loginTime.getTime() > ABSOLUTE_TIMEOUT) {
      await endSession(sessionToken, 'expired');
      return null;
    }

    return session;
  } catch (error) {
    console.error('Error validating session:', error);
    throw error;
  }
};

/**
 * Update session activity timestamp
 * @param {string} sessionToken - Session token
 * @returns {Promise<boolean>}
 */
const updateSessionActivity = async (sessionToken) => {
  try {
    await pool.query(
      `UPDATE user_sessions
       SET last_activity = NOW()
       WHERE session_token = $1 AND is_active = true AND logout_time IS NULL`,
      [sessionToken],
    );
    return true;
  } catch (error) {
    console.error('Error updating session activity:', error);
    return false;
  }
};

/**
 * End a session
 * @param {string} sessionToken - Session token
 * @param {string} reason - End reason
 * @returns {Promise<boolean>}
 */
const endSession = async (sessionToken, reason = 'logout') => {
  try {
    await pool.query(
      `UPDATE user_sessions
       SET is_active = false,
           logout_time = NOW(),
           session_duration = EXTRACT(EPOCH FROM (NOW() - login_time))::INTEGER
       WHERE session_token = $1`,
      [sessionToken],
    );

    // Log the event (optional - may fail if table doesn't exist)
    try {
      const securityEventService = require('./securityEventService');
      const sessionResult = await pool.query(
        'SELECT user_id FROM user_sessions WHERE session_token = $1',
        [sessionToken],
      );

      if (sessionResult.rows.length > 0) {
        await securityEventService.logEvent({
          userId: sessionResult.rows[0].user_id,
          eventType: 'SESSION_TERMINATED',
          severity: 'INFO',
          details: { reason, sessionToken: sessionToken.substring(0, 8) + '...' },
        });
      }
    } catch (logError) {
      // Silently ignore logging errors - session still ended
      console.warn('Could not log session termination event:', logError.message);
    }

    return true;
  } catch (error) {
    console.error('Error ending session:', error);
    return false;
  }
};

/**
 * End all sessions for a user
 * @param {number} userId - User ID
 * @param {string} reason - End reason
 * @returns {Promise<number>} Number of sessions ended
 */
const endAllSessions = async (userId, reason = 'force_logout') => {
  try {
    const result = await pool.query(
      `UPDATE user_sessions
       SET is_active = false,
           logout_time = NOW(),
           session_duration = EXTRACT(EPOCH FROM (NOW() - login_time))::INTEGER
       WHERE user_id = $1 AND is_active = true AND logout_time IS NULL
       RETURNING session_token`,
      [userId],
    );

    // Log the event (optional - may fail if table doesn't exist)
    try {
      const securityEventService = require('./securityEventService');
      await securityEventService.logEvent({
        userId,
        eventType: 'SESSION_TERMINATED',
        severity: 'INFO',
        details: { reason, sessionsEnded: result.rows.length },
      });
    } catch (logError) {
      // Silently ignore logging errors - sessions still ended
      console.warn('Could not log session termination event:', logError.message);
    }

    return result.rows.length;
  } catch (error) {
    console.error('Error ending all sessions:', error);
    return 0;
  }
};

/**
 * Get active session count for a user
 * @param {number} userId - User ID
 * @returns {Promise<number>}
 */
const getActiveSessionCount = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM user_sessions
       WHERE user_id = $1 AND is_active = true AND logout_time IS NULL`,
      [userId],
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error getting active session count:', error);
    return 0;
  }
};

/**
 * Revoke oldest session for a user
 * @param {number} userId - User ID
 * @returns {Promise<boolean>}
 */
const revokeOldestSession = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT session_token FROM user_sessions
       WHERE user_id = $1 AND is_active = true AND logout_time IS NULL
       ORDER BY login_time ASC
       LIMIT 1`,
      [userId],
    );

    if (result.rows.length > 0) {
      await endSession(result.rows[0].session_token, 'max_sessions_exceeded');
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error revoking oldest session:', error);
    return false;
  }
};

/**
 * Get active sessions for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>}
 */
const getUserSessions = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT id, session_token, ip_address, user_agent, device_info,
              login_time, last_activity, login_method
       FROM user_sessions
       WHERE user_id = $1 AND is_active = true AND logout_time IS NULL
       ORDER BY last_activity DESC`,
      [userId],
    );

    return result.rows.map((session) => ({
      ...session,
      sessionToken: session.session_token.substring(0, 8) + '...', // Mask token
    }));
  } catch (error) {
    console.error('Error getting user sessions:', error);
    return [];
  }
};

/**
 * Get session history for a user
 * @param {number} userId - User ID
 * @param {number} limit - Maximum number of sessions
 * @returns {Promise<Array>}
 */
const getSessionHistory = async (userId, limit = 20) => {
  try {
    const result = await pool.query(
      `SELECT id, session_token, ip_address, user_agent,
              login_time, logout_time, session_duration, login_method
       FROM user_sessions
       WHERE user_id = $1 AND logout_time IS NOT NULL
       ORDER BY login_time DESC
       LIMIT $2`,
      [userId, limit],
    );

    return result.rows.map((session) => ({
      ...session,
      sessionToken: session.session_token?.substring(0, 8) + '...',
    }));
  } catch (error) {
    console.error('Error getting session history:', error);
    return [];
  }
};

/**
 * Clean up expired sessions
 */
const cleanupExpiredSessions = async () => {
  try {
    const result = await pool.query(
      `UPDATE user_sessions
       SET is_active = false,
           session_duration = EXTRACT(EPOCH FROM (NOW() - login_time))::INTEGER
       WHERE is_active = true
       AND (logout_time IS NULL AND NOW() - login_time > INTERVAL '${ABSOLUTE_TIMEOUT / 1000} seconds')
       OR (last_activity < NOW() - INTERVAL '${SESSION_TIMEOUT / 1000} seconds' AND logout_time IS NULL)`,
    );

    if (result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} expired sessions`);
    }

    return result.rowCount;
  } catch (error) {
    console.error('Error cleaning up expired sessions:', error);
    return 0;
  }
};

/**
 * Check if session is valid and not expired
 * @param {Object} session - Session data
 * @returns {Object} Validation result
 */
const isSessionValid = (session) => {
  if (!session || !session.is_active || session.logout_time) {
    return { valid: false, reason: 'Session is not active' };
  }

  const lastActivity = new Date(session.last_activity);
  const loginTime = new Date(session.login_time);
  const now = Date.now();

  // Check inactivity timeout
  if (now - lastActivity.getTime() > SESSION_TIMEOUT) {
    return { valid: false, reason: 'Session expired due to inactivity' };
  }

  // Check absolute timeout
  if (now - loginTime.getTime() > ABSOLUTE_TIMEOUT) {
    return { valid: false, reason: 'Session exceeded maximum duration' };
  }

  return { valid: true };
};

/**
 * Create required indexes
 */
const createIndexes = async () => {
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active, logout_time);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON user_sessions(last_activity);
    `);

    console.log('Session indexes created/verified');
    return true;
  } catch (error) {
    console.error('Error creating session indexes:', error);
    throw error;
  }
};

module.exports = {
  createSession,
  validateSession,
  updateSessionActivity,
  endSession,
  endAllSessions,
  getActiveSessionCount,
  revokeOldestSession,
  getUserSessions,
  getSessionHistory,
  cleanupExpiredSessions,
  isSessionValid,
  createIndexes,
  SESSION_TIMEOUT,
  ABSOLUTE_TIMEOUT,
  MAX_CONCURRENT_SESSIONS,
};
