/**
 * Guardian Authentication Middleware
 * Provides authentication specifically for guardian users
 */

const jwt = require('jsonwebtoken');
const pool = require('../db');
const logger = require('../config/logger');
const loadBackendEnv = require('../config/loadEnv');
loadBackendEnv();

const DEFAULT_JWT_CLOCK_TOLERANCE_SECONDS = 5;
const configuredClockToleranceSeconds = Number.parseInt(
  process.env.JWT_CLOCK_TOLERANCE_SECONDS || '',
  10,
);
const JWT_CLOCK_TOLERANCE_SECONDS = Number.isFinite(configuredClockToleranceSeconds)
  && configuredClockToleranceSeconds >= 0
  ? configuredClockToleranceSeconds
  : DEFAULT_JWT_CLOCK_TOLERANCE_SECONDS;

const resolveJwtSecret = () => {
  return process.env.JWT_SECRET || null;
};

/**
 * Authenticate guardian user
 * Verifies JWT token and ensures user is a guardian
 */
const authenticateGuardian = async (req, res, next) => {
  try {
    // Get JWT secret
    const jwtSecret = resolveJwtSecret();

    if (!jwtSecret) {
      logger.error('JWT_SECRET is not configured. Guardian authentication is unavailable.');
      return res.status(500).json({
        success: false,
        message: 'Server authentication is not configured',
        code: 'SERVER_CONFIG_ERROR',
      });
    }

    // Check for token in cookies first, then Authorization header
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'MISSING_TOKEN',
      });
    }

    // Verify token
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(
        token,
        jwtSecret,
        { clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS },
        (err, decoded) => {
          if (err) {
            reject(err);
          } else {
            resolve(decoded);
          }
        },
      );
    });

    // Check if user is a guardian (support both canonical and legacy role values)
    const canonicalRole = decoded.role?.toUpperCase();
    const isGuardianRole = canonicalRole === 'GUARDIAN' || decoded.role === 'guardian';
    if (!isGuardianRole) {
      return res.status(403).json({
        success: false,
        message: 'Guardian access required',
        code: 'NOT_GUARDIAN',
      });
    }

    // Get the guardian ID from the token (support both canonical and legacy formats)
    const guardianId = decoded.guardian_id || decoded.id;
    if (!guardianId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token: missing guardian ID',
        code: 'INVALID_TOKEN',
      });
    }

    // Fetch guardian from database to ensure they exist and are active
    const guardianResult = await pool.query(
      `SELECT id, name, email, phone, is_active
       FROM guardians
       WHERE id = $1 AND is_active = TRUE`,
      [guardianId],
    );

    if (guardianResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Guardian not found or inactive',
        code: 'GUARDIAN_NOT_FOUND',
      });
    }

    // Attach guardian to request
    req.guardian = guardianResult.rows[0];
    req.user = {
      id: guardianId,
      role: decoded.role,
      guardianId: guardianId,
    };

    // Add security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.info('Guardian access token expired', {
        code: 'TOKEN_EXPIRED',
        method: req.method,
        path: req.originalUrl || req.url,
        expiredAt: error.expiredAt,
      });

      return res.status(401).json({
        success: false,
        message: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    if (error.name === 'JsonWebTokenError') {
      logger.warn('Guardian JWT validation failed', {
        code: 'INVALID_TOKEN',
        method: req.method,
        path: req.originalUrl || req.url,
        reason: error.message,
      });

      return res.status(403).json({
        success: false,
        message: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
    }

    logger.error('Guardian authentication error:', error);

    return res.status(500).json({
      success: false,
      message: 'Authentication failed',
      code: 'AUTH_ERROR',
    });
  }
};

/**
 * Optional guardian authentication
 * Attaches guardian to request if valid token provided, but doesn't require it
 */
const optionalGuardianAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
      return next();
    }

    const jwtSecret = resolveJwtSecret();
    if (!jwtSecret) {
      return next();
    }

    const decoded = jwt.verify(token, jwtSecret, {
      clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
    });

    // Support both canonical and legacy role values
    const canonicalRole = decoded.role?.toUpperCase();
    const isGuardianRole = canonicalRole === 'GUARDIAN' || decoded.role === 'guardian';
    if (isGuardianRole) {
      // Get the guardian ID from the token (support both canonical and legacy formats)
      const guardianId = decoded.guardian_id || decoded.id;
      if (guardianId) {
        const guardianResult = await pool.query(
          'SELECT id, name, email, phone FROM guardians WHERE id = $1 AND is_active = TRUE',
          [guardianId],
        );

        if (guardianResult.rows.length > 0) {
          req.guardian = guardianResult.rows[0];
          req.user = {
            id: guardianId,
            role: decoded.role,
            guardianId: guardianId,
          };
        }
      }
    }

    next();
  } catch {
    // Continue without guardian context
    next();
  }
};

/**
 * Verify guardian owns the resource (by guardian_id field)
 */
const requireGuardianOwnership = (resourceTable, resourceIdParam = 'id') => {
  return async (req, res, next) => {
    try {
      if (!req.guardian) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const resourceId = req.params[resourceIdParam];
      const result = await pool.query(`SELECT guardian_id FROM ${resourceTable} WHERE id = $1`, [
        resourceId,
      ]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found',
        });
      }

      if (result.rows[0].guardian_id !== req.guardian.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      next();
    } catch (error) {
      logger.error('Guardian ownership check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Authorization check failed',
      });
    }
  };
};

module.exports = {
  authenticateGuardian,
  optionalGuardianAuth,
  requireGuardianOwnership,
};
