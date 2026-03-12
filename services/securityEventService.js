/**
 * Security Event Service
 * Logs and manages security events for audit trail
 */

const mainPool = require('../db');
const { Pool } = require('pg');
const dns = require('dns').promises;
const logger = require('../config/logger');
const { getSecurityDbUser, getSecurityDbPassword } = require('../config/dbCredentials');

const RETRYABLE_CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  '08006',
  '08003',
  '57P01',
  '57P02',
  '57P03',
]);

const FATAL_DB_CONFIG_ERROR_CODES = new Set([
  '28P01',
  '28000',
  '3D000',
  '3F000',
  '42501',
]);

const isRetryableConnectionError = (code) => RETRYABLE_CONNECTION_ERROR_CODES.has(code);
const isFatalDbConfigError = (code) => FATAL_DB_CONFIG_ERROR_CODES.has(code);
const isScramPasswordTypeError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('sasl') && message.includes('client password must be a string');
};

// Event types
const EVENT_TYPES = {
  // Authentication events
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',

  // Password events
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_FAILED_CHANGE: 'PASSWORD_FAILED_CHANGE',

  // Email events
  EMAIL_VERIFICATION_REQUESTED: 'EMAIL_VERIFICATION_REQUESTED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  EMAIL_CHANGE_REQUESTED: 'EMAIL_CHANGE_REQUESTED',
  EMAIL_CHANGE_COMPLETED: 'EMAIL_CHANGE_COMPLETED',

  // Admin events
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  ADMIN_ACTION: 'ADMIN_ACTION',
  ADMIN_PERMISSION_CHANGE: 'ADMIN_PERMISSION_CHANGE',

  // Security events
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  BRUTE_FORCE_DETECTED: 'BRUTE_FORCE_DETECTED',
  IP_BLOCKED: 'IP_BLOCKED',
  UNUSUAL_LOCATION_LOGIN: 'UNUSUAL_LOCATION_LOGIN',

  // Session events
  SESSION_CREATED: 'SESSION_CREATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_TERMINATED: 'SESSION_TERMINATED',

  // Data access events
  SENSITIVE_DATA_ACCESSED: 'SENSITIVE_DATA_ACCESSED',
  DATA_EXPORT: 'DATA_EXPORT',
  BULK_DELETE: 'BULK_DELETE',

  // System events
  SYSTEM_CONFIG_CHANGED: 'SYSTEM_CONFIG_CHANGED',
  API_RATE_LIMIT_EXCEEDED: 'API_RATE_LIMIT_EXCEEDED',
  UNAUTHORIZED_ACCESS_ATTEMPT: 'UNAUTHORIZED_ACCESS_ATTEMPT',
};

// Severity levels
const SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
};

// Track if table exists
let tableVerified = false;
let activePool = mainPool; // Default to main pool
const isSecurityDbEnabled = process.env.SECURITY_DB_ENABLED !== 'false';

const canAttemptSchemaInitialization = () => {
  if (!isSecurityDbEnabled) {
    return false;
  }

  if (!activePool) {
    return false;
  }

  if (activePool !== mainPool && !process.env.SECURITY_DB_HOST) {
    return false;
  }

  return true;
};

const shouldDisableSecurityDbForError = (error) => isFatalDbConfigError(error?.code) || isScramPasswordTypeError(error);

const disableSecurityDbWrites = (reason, error) => {
  logger.error(
    'Security schema initialization failed due to DB authentication/configuration error. Disabling security DB writes for this process.',
    {
      reason,
      code: error?.code || null,
      message: error?.message || null,
    },
  );
  activePool = null;
  tableVerified = false;
};

/**
 * Initialize security events table
 */
const initialize = async () => {
  if (!isSecurityDbEnabled) {
    logger.warn('Security DB disabled via SECURITY_DB_ENABLED=false. Events will be buffered locally.');
    return;
  }

  try {
    await configureDatabaseConnection();
    await initializeSchemaWithRetry();
  } catch (error) {
    logger.error('CRITICAL: Security DB Initialization failed', { error: error.message });
    // Fallback to local buffer mode implicitly by leaving tableVerified = false
  }
};

/**
 * Configure database connection with fallback
 */
const configureDatabaseConnection = async () => {
  // Check if specific Security DB host is configured
  if (process.env.SECURITY_DB_HOST) {
    const secConfig = {
      host: process.env.SECURITY_DB_HOST,
      port: parseInt(process.env.SECURITY_DB_PORT) || 5432,
      database: process.env.SECURITY_DB_NAME || 'security_events',
      user: getSecurityDbUser(),
      password: getSecurityDbPassword(),
      connectionTimeoutMillis: 5000, // Fail fast in dev
    };

    logger.info(`Attempting connection to Security DB: ${secConfig.host}:${secConfig.port}`);

    try {
      // Diagnostic: Resolve DNS
      const resolved = await dns.lookup(secConfig.host).catch(() => null);
      logger.info(`DNS Resolution for ${secConfig.host}: ${resolved ? resolved.address : 'FAILED'}`);

      const tempPool = new Pool(secConfig);
      await tempPool.query('SELECT 1'); // Health check
      activePool = tempPool;
      logger.info('Connected to dedicated Security DB cluster');
    } catch (error) {
      logger.warn(`Failed to connect to Security DB (${secConfig.host}). Falling back to Main DB.`, { error: error.message });
      activePool = mainPool; // Fallback
    }
  } else {
    activePool = mainPool;
  }
};

/**
 * Initialize schema with retry policy and lock detection
 */
const initializeSchemaWithRetry = async (attempt = 1, maxRetries = 3) => {
  if (!canAttemptSchemaInitialization()) {
    logger.warn('Security schema initialization skipped due to disabled or unavailable DB configuration.');
    return;
  }

  try {
    await createTable();
    tableVerified = true;
    logger.info('Security events table initialized successfully');
  } catch (error) {
    const errorCode = error?.code;

    if (shouldDisableSecurityDbForError(error)) {
      disableSecurityDbWrites('db_auth_or_config', error);
      return;
    }

    if (!isRetryableConnectionError(errorCode)) {
      logger.error('Security schema initialization failed with non-retryable error.', {
        code: errorCode,
        message: error.message,
      });
      tableVerified = false;
      return;
    }

    logger.warn(`Schema initialization attempt ${attempt}/${maxRetries} failed: ${error.message}`);

    // Lock Detection
    if (attempt === 1) {
      try {
        const lockCheck = await activePool.query(`
          SELECT pid, usename, application_name, state, query_start
          FROM pg_stat_activity
          WHERE pid IN (
            SELECT pid FROM pg_locks l
            JOIN pg_class c ON l.relation = c.oid
            WHERE c.relname = 'security_events'
          );
        `);
        if (lockCheck.rows.length > 0) {
          logger.warn('Active locks detected on security_events table:', lockCheck.rows);
        }
      } catch (_lockError) {
        // Ignore lock check errors
      }
    }

    if (attempt < maxRetries && isRetryableConnectionError(errorCode)) {
      const backoff = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      logger.info(`Retrying in ${backoff}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      return initializeSchemaWithRetry(attempt + 1, maxRetries);
    } else {
      logger.warn('Security schema initialization exhausted retries. Continuing without security DB table initialization for this process.', {
        attempts: maxRetries,
        code: errorCode,
      });
      tableVerified = false;
      return;
    }
  }
};

// Auto-initialize on module load (non-blocking, but logged)
initialize().catch(err => console.error('Security Service Init Error:', err));

/**
 * Check if the security_events table exists
 */
const tableExists = async () => {
  if (!activePool) {
    return false;
  }

  try {
    const result = await activePool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'security_events'
      )
    `);
    return result.rows[0]?.exists || false;
  } catch (error) {
    console.warn('Error checking if security_events table exists:', error.message);
    return false;
  }
};

/**
 * Log a security event
 * @param {Object} event - Event details
 */
const logEvent = async (event) => {
  if (!activePool || !isSecurityDbEnabled) {
    return false;
  }

  try {
    // Ensure table exists before logging
    if (!tableVerified) {
      const exists = await tableExists();
      if (!exists) {
        await createTable();
        tableVerified = true;
      }
    }

    if (!tableVerified && !isSecurityDbEnabled) {
      return false;
    } // Buffer mode

    const {
      userId,
      eventType,
      severity = SEVERITY.INFO,
      ipAddress,
      userAgent,
      resourceType,
      resourceId,
      details = {},
    } = event;

    await activePool.query(
      `INSERT INTO security_events
       (user_id, event_type, severity, ip_address, user_agent, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId || null,
        eventType,
        severity,
        ipAddress || null,
        userAgent || null,
        resourceType || null,
        resourceId || null,
        JSON.stringify(details),
      ],
    );

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[SECURITY] ${severity} - ${eventType}:`, {
        userId,
        ipAddress,
        details,
      });
    }

    // For critical events, log to error logger
    if (severity === SEVERITY.CRITICAL) {
      const logger = require('../config/logger');
      logger.error(`SECURITY EVENT: ${eventType}`, {
        userId,
        ipAddress,
        userAgent,
        details,
      });
    }

    return true;
  } catch (error) {
    if (shouldDisableSecurityDbForError(error)) {
      disableSecurityDbWrites('log_event_auth_config_failure', error);
    }

    // Don't throw - logging failure shouldn't break app
    console.warn('Error logging security event:', error.message);
    return false;
  }
};

/**
 * Log successful login
 * @param {number} userId - User ID
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - Browser user agent
 * @param {Object} details - Additional details
 */
const logLoginSuccess = async (userId, ipAddress, userAgent, details = {}) => {
  return logEvent({
    userId,
    eventType: EVENT_TYPES.LOGIN_SUCCESS,
    severity: SEVERITY.INFO,
    ipAddress,
    userAgent,
    details: {
      ...details,
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * Log failed login attempt
 * @param {string} identifier - Username or email used
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - Browser user agent
 * @param {string} reason - Failure reason
 */
const logLoginFailed = async (identifier, ipAddress, userAgent, reason) => {
  return logEvent({
    userId: null, // May not have user ID on failed attempt
    eventType: EVENT_TYPES.LOGIN_FAILED,
    severity: SEVERITY.WARNING,
    ipAddress,
    userAgent,
    details: {
      identifier: identifier.substring(0, 3) + '***', // Mask identifier
      reason,
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * Log account lockout
 * @param {number} userId - User ID
 * @param {string} ipAddress - IP address
 * @param {string} reason - Lockout reason
 */
const logAccountLocked = async (userId, ipAddress, reason) => {
  return logEvent({
    userId,
    eventType: EVENT_TYPES.LOGIN_LOCKED,
    severity: SEVERITY.WARNING,
    ipAddress,
    details: {
      reason,
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * Log password reset request
 * @param {number} userId - User ID
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - Browser user agent
 */
const logPasswordResetRequested = async (userId, ipAddress, userAgent) => {
  return logEvent({
    userId,
    eventType: EVENT_TYPES.PASSWORD_RESET_REQUESTED,
    severity: SEVERITY.INFO,
    ipAddress,
    userAgent,
  });
};

/**
 * Log password reset completion
 * @param {number} userId - User ID
 * @param {string} ipAddress - IP address
 */
const logPasswordResetCompleted = async (userId, ipAddress) => {
  return logEvent({
    userId,
    eventType: EVENT_TYPES.PASSWORD_RESET_COMPLETED,
    severity: SEVERITY.INFO,
    ipAddress,
    details: {
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * Log admin login
 * @param {number} userId - Admin user ID
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - Browser user agent
 */
const logAdminLogin = async (userId, ipAddress, userAgent) => {
  return logEvent({
    userId,
    eventType: EVENT_TYPES.ADMIN_LOGIN,
    severity: SEVERITY.INFO,
    ipAddress,
    userAgent,
    details: {
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * Log suspicious activity
 * @param {number} userId - User ID (if authenticated)
 * @param {string} ipAddress - IP address
 * @param {string} activityType - Type of suspicious activity
 * @param {Object} details - Additional details
 */
const logSuspiciousActivity = async (userId, ipAddress, activityType, details = {}) => {
  return logEvent({
    userId,
    eventType: EVENT_TYPES.SUSPICIOUS_ACTIVITY,
    severity: SEVERITY.ERROR,
    ipAddress,
    details: {
      activityType,
      ...details,
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * Log brute force detection
 * @param {string} ipAddress - IP address
 * @param {number} attempts - Number of attempts
 * @param {string} target - Target identifier
 */
const logBruteForceDetected = async (ipAddress, attempts, target) => {
  return logEvent({
    userId: null,
    eventType: EVENT_TYPES.BRUTE_FORCE_DETECTED,
    severity: SEVERITY.WARNING,
    ipAddress,
    details: {
      attempts,
      target: target.substring(0, 3) + '***',
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * Log API rate limit exceeded
 * @param {string} ipAddress - IP address
 * @param {string} endpoint - API endpoint
 * @param {number} requestCount - Number of requests
 */
const logRateLimitExceeded = async (ipAddress, endpoint, requestCount) => {
  return logEvent({
    userId: null,
    eventType: EVENT_TYPES.API_RATE_LIMIT_EXCEEDED,
    severity: SEVERITY.WARNING,
    ipAddress,
    details: {
      endpoint,
      requestCount,
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * Get security events for a user
 * @param {number} userId - User ID
 * @param {number} limit - Maximum number of events
 * @returns {Promise<Array>} Array of security events
 */
const getUserEvents = async (userId, limit = 100) => {
  if (!activePool) {
    return [];
  }

  try {
    // Ensure table exists
    if (!tableVerified) {
      const exists = await tableExists();
      if (!exists) {
        await createTable();
        tableVerified = true;
      }
    }

    const result = await activePool.query(
      `SELECT * FROM security_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return result.rows;
  } catch (error) {
    console.warn('Error getting user security events:', error.message);
    return [];
  }
};

/**
 * Get security events by IP address
 * @param {string} ipAddress - IP address
 * @param {number} limit - Maximum number of events
 * @returns {Promise<Array>} Array of security events
 */
const getEventsByIP = async (ipAddress, limit = 100) => {
  if (!activePool) {
    return [];
  }

  try {
    // Ensure table exists
    if (!tableVerified) {
      const exists = await tableExists();
      if (!exists) {
        await createTable();
        tableVerified = true;
      }
    }

    const result = await activePool.query(
      `SELECT * FROM security_events
       WHERE ip_address = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [ipAddress, limit],
    );
    return result.rows;
  } catch (error) {
    console.warn('Error getting security events by IP:', error.message);
    return [];
  }
};

/**
 * Get recent security events
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Array of security events
 */
const getRecentEvents = async (options = {}) => {
  const { limit = 100, offset = 0, severity, eventType, startDate, endDate } = options;

  if (!activePool) {
    return [];
  }

  try {
    // Ensure table exists
    if (!tableVerified) {
      const exists = await tableExists();
      if (!exists) {
        await createTable();
        tableVerified = true;
      }
    }

    let query = `
      SELECT * FROM security_events
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(severity);
    }

    if (eventType) {
      query += ` AND event_type = $${paramIndex++}`;
      params.push(eventType);
    }

    if (startDate) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await activePool.query(query, params);
    return result.rows;
  } catch (error) {
    console.warn('Error getting recent security events:', error.message);
    return [];
  }
};

/**
 * Get security event count by type
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Object>} Event counts by type
 */
const getEventCounts = async (startDate, endDate) => {
  if (!activePool) {
    return [];
  }

  try {
    // Ensure table exists
    if (!tableVerified) {
      const exists = await tableExists();
      if (!exists) {
        await createTable();
        tableVerified = true;
      }
    }

    const result = await activePool.query(
      `SELECT event_type, severity, COUNT(*) as count
       FROM security_events
       WHERE created_at BETWEEN $1 AND $2
       GROUP BY event_type, severity
       ORDER BY count DESC`,
      [startDate, endDate],
    );
    return result.rows;
  } catch (error) {
    console.warn('Error getting security event counts:', error.message);
    return [];
  }
};

/**
 * Create security events table
 */
const createTable = async () => {
  if (!activePool) {
    logger.warn('Skipping security_events table creation because no active DB pool is available.');
    return false;
  }

  try {
    await activePool.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        event_type VARCHAR(100) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        resource_type VARCHAR(100),
        resource_id INTEGER,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_security_events_ip_address ON security_events(ip_address);
      CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
      CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
    `);

    logger.info('Security events table created/verified');
    return true;
  } catch (error) {
    if (shouldDisableSecurityDbForError(error)) {
      logger.warn('Security events table creation failed due to DB authentication/configuration issue.', {
        code: error?.code || 'DB_AUTH_CONFIG',
        message: error?.message,
      });
    } else {
      logger.error('Error creating security events table:', error);
    }
    throw error;
  }
};

/**
 * Clean up old security events
 * @param {number} daysToKeep - Number of days to retain events
 */
const cleanupOldEvents = async (daysToKeep = 90) => {
  if (!activePool) {
    return 0;
  }

  try {
    const result = await activePool.query(
      `DELETE FROM security_events
       WHERE created_at < NOW() - INTERVAL '${daysToKeep} days'`,
    );
    console.log(`Cleaned up ${result.rowCount} old security events`);
    return result.rowCount;
  } catch (error) {
    console.error('Error cleaning up old security events:', error);
    throw error;
  }
};

module.exports = {
  EVENT_TYPES,
  SEVERITY,
  logEvent,
  logLoginSuccess,
  logLoginFailed,
  logAccountLocked,
  logPasswordResetRequested,
  logPasswordResetCompleted,
  logAdminLogin,
  logSuspiciousActivity,
  logBruteForceDetected,
  logRateLimitExceeded,
  getUserEvents,
  getEventsByIP,
  getRecentEvents,
  getEventCounts,
  createTable,
  cleanupOldEvents,
};
