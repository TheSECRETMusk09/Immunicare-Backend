/**
 * Brute Force Protection Middleware
 * Protects against brute force attacks with progressive exponential delays
 * Replaces hard lockout with progressive delay strategy for better UX
 */

const crypto = require('crypto');

// In-memory storage for failed attempts (in production, use Redis)
const failedAttempts = new Map();
const lockedAccounts = new Map();

// Configuration - Progressive delay strategy
const MAX_ATTEMPTS = parseInt(process.env.BRUTE_FORCE_MAX_ATTEMPTS) || 5;
const LOCKOUT_DURATION = parseInt(process.env.BRUTE_FORCE_LOCKOUT_DURATION) || 30 * 60 * 1000; // 30 minutes (only for extreme cases)
const PROGRESSIVE_DELAY = true;
const DELAY_INCREMENT = 1000; // 1 second base delay
const MAX_DELAY = 30000; // 30 seconds max delay
const SOFT_LOCKOUT_THRESHOLD = 10; // After 10 attempts, apply longer delays
const HARD_LOCKOUT_THRESHOLD = 20; // After 20 attempts, apply hard lockout

/**
 * Generate a fingerprint for the client
 * @param {Object} req - Express request object
 * @returns {string} Client fingerprint
 */
const getClientFingerprint = (req) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'unknown';
  const fingerprint = crypto.createHash('md5').update(`${ip}:${userAgent}`).digest('hex');
  return fingerprint;
};

/**
 * Get or create failed attempts record
 * @param {string} identifier - Username, email, or IP
 * @returns {Object} Failed attempts record
 */
const getFailedAttempts = (identifier) => {
  if (!failedAttempts.has(identifier)) {
    failedAttempts.set(identifier, {
      count: 0,
      lastAttempt: null,
      history: [],
    });
  }
  return failedAttempts.get(identifier);
};

/**
 * Record a failed login attempt
 * @param {string} identifier - Username, email, or IP
 * @param {Object} req - Express request object
 */
const recordFailedAttempt = (identifier, req) => {
  const record = getFailedAttempts(identifier);
  const now = Date.now();

  record.count += 1;
  record.lastAttempt = now;
  record.history.push({
    timestamp: now,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Keep only last 20 attempts for analysis
  if (record.history.length > 20) {
    record.history = record.history.slice(-20);
  }

  // Calculate delay info
  const delayInfo = calculateDelay(record.count);

  // Only apply hard lockout for extreme cases (20+ attempts)
  if (record.count >= HARD_LOCKOUT_THRESHOLD) {
    lockAccount(identifier);

    // Try to log the lockout event, but don't fail if it errors
    try {
      const securityEventService = require('../services/securityEventService');
      securityEventService.logEvent({
        userId: null,
        eventType: 'BRUTE_FORCE_HARD_LOCKOUT',
        severity: 'WARNING',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: {
          identifier: identifier.substring(0, 3) + '***',
          attempts: record.count,
          reason: 'HARD_LOCKOUT_THRESHOLD_EXCEEDED',
          lockoutDuration: LOCKOUT_DURATION,
        },
      });
    } catch (seError) {
      console.warn('Could not log brute force lockout event:', seError.message);
    }
  } else if (record.count >= SOFT_LOCKOUT_THRESHOLD) {
    // Log soft lockout event
    try {
      const securityEventService = require('../services/securityEventService');
      securityEventService.logEvent({
        userId: null,
        eventType: 'BRUTE_FORCE_SOFT_LOCKOUT',
        severity: 'INFO',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: {
          identifier: identifier.substring(0, 3) + '***',
          attempts: record.count,
          delayMs: delayInfo.delay,
        },
      });
    } catch (seError) {
      console.warn('Could not log brute force event:', seError.message);
    }
  }
};

/**
 * Lock an account
 * @param {string} identifier - Username, email, or IP
 */
const lockAccount = (identifier) => {
  const lockoutEnd = Date.now() + LOCKOUT_DURATION;
  lockedAccounts.set(identifier, lockoutEnd);

  console.warn(`Account locked: ${identifier} until ${new Date(lockoutEnd).toISOString()}`);
};

/**
 * Check if account is locked
 * @param {string} identifier - Username, email, or IP
 * @returns {boolean} True if locked
 */
const isAccountLocked = (identifier) => {
  if (!lockedAccounts.has(identifier)) {
    return false;
  }

  const lockoutEnd = lockedAccounts.get(identifier);

  if (Date.now() > lockoutEnd) {
    // Lock expired, remove it
    lockedAccounts.delete(identifier);
    return false;
  }

  return true;
};

/**
 * Get remaining lockout time in seconds
 * @param {string} identifier - Username, email, or IP
 * @returns {number} Remaining time in seconds
 */
const getRemainingLockoutTime = (identifier) => {
  if (!lockedAccounts.has(identifier)) {
    return 0;
  }

  const lockoutEnd = lockedAccounts.get(identifier);
  const remaining = Math.ceil((lockoutEnd - Date.now()) / 1000);

  if (remaining <= 0) {
    lockedAccounts.delete(identifier);
    return 0;
  }

  return remaining;
};

/**
 * Clear failed attempts for an identifier
 * @param {string} identifier - Username, email, or IP
 */
const clearFailedAttempts = (identifier) => {
  failedAttempts.delete(identifier);
  lockedAccounts.delete(identifier);
};

/**
 * Get attempt count for an identifier
 * @param {string} identifier - Username, email, or IP
 * @returns {number} Number of failed attempts
 */
const getAttemptCount = (identifier) => {
  const record = failedAttempts.get(identifier);
  return record ? record.count : 0;
};

/**
 * Calculate delay for next attempt using progressive exponential backoff
 * @param {number} attemptCount - Number of failed attempts
 * @returns {Object} Delay information with delay time and type
 */
const calculateDelay = (attemptCount) => {
  if (!PROGRESSIVE_DELAY) {
    return { delay: 0, type: 'none' };
  }

  // Progressive delay strategy:
  // 1-3 attempts: No delay (give users a chance to correct typos)
  // 4-5 attempts: 2-4 seconds (slow down guessing)
  // 6-9 attempts: 8-16 seconds (significant slowdown)
  // 10+ attempts: 30 seconds (soft lockout behavior)

  if (attemptCount <= 3) {
    return { delay: 0, type: 'none', remainingAttempts: MAX_ATTEMPTS - attemptCount };
  }

  if (attemptCount <= 5) {
    // 2-4 seconds for 4-5 attempts
    const delay = DELAY_INCREMENT * Math.pow(2, attemptCount - 3); // 2s, 4s
    return {
      delay: Math.min(delay, MAX_DELAY),
      type: 'progressive',
      remainingAttempts: MAX_ATTEMPTS - attemptCount,
    };
  }

  if (attemptCount < SOFT_LOCKOUT_THRESHOLD) {
    // 8-16 seconds for 6-9 attempts
    const delay = DELAY_INCREMENT * Math.pow(2, attemptCount - 2); // 8s, 16s, 32s(capped)
    return { delay: Math.min(delay, MAX_DELAY), type: 'progressive', remainingAttempts: 0 };
  }

  if (attemptCount < HARD_LOCKOUT_THRESHOLD) {
    // Soft lockout: 30 seconds delay
    return { delay: MAX_DELAY, type: 'soft_lockout', remainingAttempts: 0 };
  }

  // Hard lockout only for extreme cases (20+ attempts)
  return { delay: LOCKOUT_DURATION, type: 'hard_lockout', remainingAttempts: 0 };
};

/**
 * Brute force protection middleware for login
 * Uses progressive delay strategy instead of hard lockout
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware
 */
const bruteForceProtection = (options = {}) => {
  const {
    keyType = 'username', // 'username', 'ip', 'fingerprint'
    maxAttempts = MAX_ATTEMPTS,
    lockoutDuration = LOCKOUT_DURATION,
    skipSuccessfulRequests = true,
    skipFailedRequests = false,
    onRateLimited = (req, res, next, options) => {
      const delayInfo = calculateDelay(options.attemptCount);

      // For hard lockout, return 429
      if (delayInfo.type === 'hard_lockout') {
        const remainingTime = getRemainingLockoutTime(options.identifier);
        return res.status(429).json({
          error: 'Account temporarily locked due to too many failed attempts',
          code: 'ACCOUNT_LOCKED',
          lockoutDuration: Math.ceil(lockoutDuration / 60000), // minutes
          retryAfter: remainingTime,
          attemptCount: options.attemptCount,
        });
      }

      // For progressive delay, return 429 with delay info but allow retry
      return res.status(429).json({
        error: 'Too many failed attempts. Please wait before trying again.',
        code: 'RATE_LIMITED',
        retryAfterMs: delayInfo.delay,
        attemptCount: options.attemptCount,
        delayType: delayInfo.type,
        message:
          delayInfo.delay > 0
            ? `Please wait ${Math.ceil(delayInfo.delay / 1000)} seconds before trying again.`
            : 'Please try again.',
      });
    },
  } = options;

  return (req, res, next) => {
    // Determine identifier
    let identifier;
    switch (keyType) {
    case 'ip':
      identifier = req.ip || req.connection.remoteAddress;
      break;
    case 'fingerprint':
      identifier = getClientFingerprint(req);
      break;
    case 'username':
    default:
      identifier = req.body?.username?.toLowerCase() || req.ip;
    }

    // Check if account is hard locked (only for extreme cases)
    if (isAccountLocked(identifier)) {
      const remainingTime = getRemainingLockoutTime(identifier);

      // Log the blocked attempt
      try {
        const securityEventService = require('../services/securityEventService');
        securityEventService.logEvent({
          userId: null,
          eventType: 'BRUTE_FORCE_BLOCKED',
          severity: 'WARNING',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: {
            identifier: identifier.substring(0, 3) + '***',
            remainingTime,
            type: 'hard_lockout',
          },
        });
      } catch (seError) {
        console.warn('Could not log brute force event:', seError.message);
      }

      return res.status(429).json({
        error: 'Account temporarily locked due to too many failed attempts',
        code: 'ACCOUNT_LOCKED',
        retryAfter: remainingTime,
      });
    }

    // Calculate delay info for progressive strategy
    const attemptCount = getAttemptCount(identifier);
    const delayInfo = calculateDelay(attemptCount);

    // Store delay info in request for response handling
    req.bruteForceDelay = delayInfo;
    req.bruteForceIdentifier = identifier;

    // Store original json function
    const originalJson = res.json.bind(res);

    // Override res.json to track successful requests and add delay info to failed responses
    res.json = (data) => {
      // Check if this was a successful login
      if (skipSuccessfulRequests && res.statusCode >= 200 && res.statusCode < 300) {
        if (data?.token || data?.accessToken) {
          // Successful authentication - clear failed attempts
          clearFailedAttempts(identifier);
        }
      }

      // Add delay info to failed login responses
      if (res.statusCode === 401 && data?.error?.includes('credentials')) {
        data.attemptCount = attemptCount;
        data.remainingAttempts =
          delayInfo.remainingAttempts !== undefined
            ? delayInfo.remainingAttempts
            : Math.max(0, maxAttempts - attemptCount);

        // Add warning if approaching limits
        if (attemptCount >= 3 && attemptCount < HARD_LOCKOUT_THRESHOLD) {
          data.warning = 'Multiple failed attempts detected. Please verify your credentials.';
        }
      }

      return originalJson(data);
    };

    next();
  };
};

/**
 * Manual brute force check - call after authentication
 * @param {Object} req - Express request object
 * @param {boolean} success - Whether authentication was successful
 */
const checkBruteForce = async (req, success) => {
  const identifier = req.bruteForceIdentifier;
  if (!identifier) {
    return;
  }

  if (success) {
    // Clear failed attempts on success
    clearFailedAttempts(identifier);
  } else {
    // Record failed attempt
    recordFailedAttempt(identifier, req);

    // Check if should lock
    if (isAccountLocked(identifier)) {
      // Try to log the lockout event, but don't fail if it errors
      try {
        const securityEventService = require('../services/securityEventService');
        await securityEventService.logEvent({
          userId: null,
          eventType: 'BRUTE_FORCE_DETECTED',
          severity: 'WARNING',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: {
            identifier: identifier.substring(0, 3) + '***',
            attempts: getAttemptCount(identifier),
          },
        });
      } catch (seError) {
        // Security event logging failed - don't break the flow
        console.warn('Could not log brute force lockout event:', seError.message);
      }
    }
  }
};

/**
 * Get brute force status for an identifier
 * @param {string} identifier - Username, email, or IP
 * @returns {Object} Status object
 */
const getBruteForceStatus = (identifier) => {
  const attemptCount = getAttemptCount(identifier);
  const delayInfo = calculateDelay(attemptCount);

  return {
    identifier,
    isLocked: isAccountLocked(identifier),
    attemptCount,
    maxAttempts: MAX_ATTEMPTS,
    remainingAttempts:
      delayInfo.remainingAttempts !== undefined
        ? delayInfo.remainingAttempts
        : Math.max(0, MAX_ATTEMPTS - attemptCount),
    remainingLockoutTime: getRemainingLockoutTime(identifier),
    delayInfo,
    lockoutThreshold: HARD_LOCKOUT_THRESHOLD,
    softLockoutThreshold: SOFT_LOCKOUT_THRESHOLD,
  };
};

/**
 * Clean up expired lockouts
 */
const cleanup = () => {
  const now = Date.now();
  let cleaned = 0;

  for (const [identifier, lockoutEnd] of lockedAccounts.entries()) {
    if (now > lockoutEnd) {
      lockedAccounts.delete(identifier);
      cleaned++;
    }
  }

  // Also clean old failed attempts
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  for (const [identifier, record] of failedAttempts.entries()) {
    if (now - record.lastAttempt > maxAge) {
      failedAttempts.delete(identifier);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired brute force records`);
  }
};

// Run cleanup every hour
if (process.env.NODE_ENV !== 'test') {
  setInterval(cleanup, 60 * 60 * 1000);
}

module.exports = {
  bruteForceProtection,
  checkBruteForce,
  recordFailedAttempt,
  clearFailedAttempts,
  isAccountLocked,
  getRemainingLockoutTime,
  getAttemptCount,
  getBruteForceStatus,
  getClientFingerprint,
  calculateDelay,
  cleanup,
  MAX_ATTEMPTS,
  LOCKOUT_DURATION,
  SOFT_LOCKOUT_THRESHOLD,
  HARD_LOCKOUT_THRESHOLD,
  MAX_DELAY,
};
