/**
 * Guardian Authentication Middleware
 * Provides authentication specifically for guardian users
 */

const jwt = require('jsonwebtoken');
const pool = require('../db');
const logger = require('../config/logger');

/**
 * Authenticate guardian user
 * Verifies JWT token and ensures user is a guardian
 */
const authenticateGuardian = async (req, res, next) => {
  try {
    // Get JWT secret
    let jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      try {
        require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
        jwtSecret = process.env.JWT_SECRET;
      } catch {
        // Ignore dotenv errors
      }
    }

    if (!jwtSecret) {
      logger.warn('JWT_SECRET not configured');
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
      jwt.verify(token, jwtSecret || 'fallback-secret-do-not-use-in-production', (err, decoded) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded);
        }
      });
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
    logger.error('Guardian authentication error:', error);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({
        success: false,
        message: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
    }

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

    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret';
    const decoded = jwt.verify(token, jwtSecret);

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
