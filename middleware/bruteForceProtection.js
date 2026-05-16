const crypto = require('crypto');

const failedAttempts = new Map();
const lockedAccounts = new Map();

const parsedMaxAttempts = Number.parseInt(process.env.BRUTE_FORCE_MAX_ATTEMPTS || '', 10);
const parsedLockoutDuration = Number.parseInt(process.env.BRUTE_FORCE_LOCKOUT_DURATION || '', 10);

const isDev = process.env.NODE_ENV !== 'production';

const MAX_ATTEMPTS =
  Number.isFinite(parsedMaxAttempts) && parsedMaxAttempts > 0 ? parsedMaxAttempts : isDev ? 100 : 3;
const LOCKOUT_DURATION =
  Number.isFinite(parsedLockoutDuration) && parsedLockoutDuration > 0
    ? parsedLockoutDuration
    : isDev
      ? 10 * 1000
      : 15 * 60 * 1000; // dev:10s prod:15m

const MAX_DELAY = 30000;
const SOFT_LOCKOUT_THRESHOLD = MAX_ATTEMPTS;
const HARD_LOCKOUT_THRESHOLD = MAX_ATTEMPTS;

const getClientFingerprint = (req) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'unknown';
  const fingerprint = crypto.createHash('md5').update(`${ip}:${userAgent}`).digest('hex');
  return fingerprint;
};

const getMissLog = (identifier) => {
  if (!failedAttempts.has(identifier)) {
    failedAttempts.set(identifier, {
      count: 0,
      lastAttempt: null,
      history: [],
    });
  }
  return failedAttempts.get(identifier);
};

const recordFailedAttempt = (identifier, req) => {
  const record = getMissLog(identifier);
  const now = Date.now();

  record.count += 1;
  record.lastAttempt = now;
  record.history.push({
    timestamp: now,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  if (record.history.length > 20) {
    record.history = record.history.slice(-20);
  }

  calculateDelay(record.count);

  if (record.count >= HARD_LOCKOUT_THRESHOLD) {
    pinBlock(identifier);

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
  }
};

const pinBlock = (identifier) => {
  const lockoutEnd = Date.now() + LOCKOUT_DURATION;
  lockedAccounts.set(identifier, lockoutEnd);

  console.warn(`Account locked: ${identifier} until ${new Date(lockoutEnd).toISOString()}`);
};

const isAccountLocked = (identifier) => {
  if (!lockedAccounts.has(identifier)) {
    return false;
  }

  const lockoutEnd = lockedAccounts.get(identifier);

  if (Date.now() > lockoutEnd) {
    lockedAccounts.delete(identifier);
    return false;
  }

  return true;
};

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

const clearFailedAttempts = (identifier) => {
  failedAttempts.delete(identifier);
  lockedAccounts.delete(identifier);
};

const getAttemptCount = (identifier) => {
  const record = failedAttempts.get(identifier);
  return record ? record.count : 0;
};

const calculateDelay = (attemptCount) => {
  if (attemptCount < MAX_ATTEMPTS) {
    return {
      delay: 0,
      type: 'none',
      remainingAttempts: Math.max(0, MAX_ATTEMPTS - attemptCount),
    };
  }

  return {
    delay: LOCKOUT_DURATION,
    type: 'hard_lockout',
    remainingAttempts: 0,
  };
};

const bruteForceProtection = (options = {}) => {
  const {
    keyType = 'username',
    maxAttempts = MAX_ATTEMPTS,
    lockoutDuration = LOCKOUT_DURATION,
    skipSuccessfulRequests = true,
  } = options;

  return (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }

    const isGuardianLogin =
      req.body?.role === 'guardian' ||
      req.body?.userType === 'guardian' ||
      (typeof req.body?.username === 'string' &&
        /^\+?\d{10,15}$/.test(req.body.username.replace(/[-_()\s]/g, '')));

    if (isGuardianLogin) {
      return next();
    }

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

    if (isAccountLocked(identifier)) {
      const remainingTime = getRemainingLockoutTime(identifier);

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

    const attemptCount = getAttemptCount(identifier);
    const delayInfo = calculateDelay(attemptCount);

    req.bruteForceDelay = delayInfo;
    req.bruteForceIdentifier = identifier;

    const originalJson = res.json.bind(res);

    res.json = (data) => {
      if (skipSuccessfulRequests && res.statusCode >= 200 && res.statusCode < 300) {
        if (data?.token || data?.accessToken) {
          clearFailedAttempts(identifier);
        }
      }

      if (res.statusCode === 401 && data?.error?.includes('credentials')) {
        const liveAttemptCount = getAttemptCount(identifier);
        const remainingAttempts = Math.max(0, maxAttempts - liveAttemptCount);

        if (isAccountLocked(identifier)) {
          const remainingTime = getRemainingLockoutTime(identifier);
          res.statusCode = 429;
          return originalJson({
            error: 'Account temporarily locked due to too many failed attempts',
            code: 'ACCOUNT_LOCKED',
            lockoutDuration: Math.ceil(lockoutDuration / 60000),
            retryAfter: remainingTime,
            attemptCount: liveAttemptCount,
            remainingAttempts: 0,
          });
        }

        data.attemptCount = liveAttemptCount;
        data.remainingAttempts = remainingAttempts;

        if (remainingAttempts <= 1) {
          data.warning = 'You have one attempt remaining before a temporary lockout.';
        }
      }

      return originalJson(data);
    };

    next();
  };
};

const checkBruteForce = async (req, success) => {
  const identifier = req.bruteForceIdentifier;
  if (!identifier) {
    return;
  }

  if (success) {
    clearFailedAttempts(identifier);
  } else {
    recordFailedAttempt(identifier, req);

    if (isAccountLocked(identifier)) {
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
        console.warn('Could not log brute force lockout event:', seError.message);
      }
    }
  }
};

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

const cleanup = () => {
  const now = Date.now();
  let cleaned = 0;

  for (const [identifier, lockoutEnd] of lockedAccounts.entries()) {
    if (now > lockoutEnd) {
      lockedAccounts.delete(identifier);
      cleaned++;
    }
  }

  const maxAge = 24 * 60 * 60 * 1000;
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
