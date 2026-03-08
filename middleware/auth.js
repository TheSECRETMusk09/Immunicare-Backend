const jwt = require('jsonwebtoken');
const {
  normalizeRole,
  CANONICAL_ROLES,
  requireRole: requireCanonicalRole,
} = require('./rbac');
const refreshTokenService = require('../services/refreshTokenService');
const logger = require('../config/logger');

const getCanonicalUser = (user) => {
  const runtimeRole = normalizeRole(user?.runtime_role || user?.role_type || user?.role);

  if (!runtimeRole) {
    return null;
  }

  return {
    ...user,
    role: runtimeRole,
    role_type: runtimeRole,
    runtime_role: runtimeRole,
    legacy_role: user?.legacy_role || user?.role || null,
  };
};

const authenticateToken = (req, res, next) => {
  try {
    // Check for JWT secret configuration - use fallback for development
    let jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      // Try to load from .env file in backend directory
      try {
        require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
        jwtSecret = process.env.JWT_SECRET;
      } catch (e) {
        // Ignore dotenv errors
      }
    }

    if (!jwtSecret) {
      console.warn('JWT_SECRET not configured - auth requests may fail');
    }

    // Check for token in cookies first, then fallback to Authorization header
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        code: 'MISSING_TOKEN',
      });
    }

    // Verify token with proper error handling
    jwt.verify(token, jwtSecret || 'fallback-secret-do-not-use-in-production', (err, user) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          // Return specific error code for token expiration
          // Frontend can use this to trigger token refresh
          return res.status(401).json({
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
            message: 'Access token has expired. Please refresh your token.',
          });
        }
        if (err.name === 'JsonWebTokenError') {
          return res.status(403).json({
            error: 'Invalid token format',
            code: 'INVALID_TOKEN',
          });
        }
        return res.status(403).json({
          error: 'Token verification failed',
          code: 'TOKEN_ERROR',
        });
      }

      // Validate user payload
      if (!user || !user.id || !user.role) {
        return res.status(403).json({
          error: 'Invalid token payload',
          code: 'INVALID_PAYLOAD',
        });
      }

      const canonicalUser = getCanonicalUser(user);
      if (!canonicalUser) {
        return res.status(403).json({
          error: 'Unsupported role in token payload',
          code: 'UNSUPPORTED_ROLE',
        });
      }

      // Add security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader(
        'Content-Security-Policy',
        'default-src \'self\'; script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\'; connect-src \'self\'; frame-src \'none\'; object-src \'none\'; base-uri \'self\'; form-action \'self\'',
      );
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');

      req.user = canonicalUser;
      next();
    });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      code: 'AUTH_ERROR',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * Optional authentication middleware
 * Attaches user to request if token is valid, but doesn't require it
 */
const optionalAuth = (req, res, next) => {
  try {
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
      // No token provided, continue without user
      return next();
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) {
        // Token invalid, continue without user
        return next();
      }

      const canonicalUser = getCanonicalUser(user);
      if (canonicalUser && canonicalUser.id) {
        req.user = canonicalUser;
      }
      next();
    });
  } catch (error) {
    // Error occurred, continue without user
    next();
  }
};

const requireRole = (roles) => {
  return requireCanonicalRole(roles);
};

const requireAdmin = (req, res, next) => {
  return requireRole([CANONICAL_ROLES.SYSTEM_ADMIN])(req, res, next);
};

const requireSuperAdmin = (req, res, next) => {
  return requireRole([CANONICAL_ROLES.SYSTEM_ADMIN])(req, res, next);
};

const requireClinicAccess = (req, res, next) => {
  try {
    if (!req.user || !req.user.clinic_id) {
      return res.status(403).json({
        error: 'Clinic access required',
        code: 'NO_CLINIC_ACCESS',
      });
    }

    req.user.clinic_id = parseInt(req.user.clinic_id);
    next();
  } catch (error) {
    console.error('Clinic access check error:', error);
    res.status(500).json({
      error: 'Clinic access check failed',
      code: 'CLINIC_ACCESS_ERROR',
    });
  }
};

/**
 * Middleware to handle JWT refresh token rotation
 * Verifies refresh token from HTTP-only cookies and issues new access token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const handleTokenRefresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        error: 'Refresh token required',
        code: 'MISSING_REFRESH_TOKEN',
      });
    }

    const userAgent = req.headers['user-agent'] || 'unknown';
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';

    // Refresh access token using refresh token service
    const tokenData = await refreshTokenService.refreshAccessToken(
      refreshToken,
      userAgent,
      ipAddress,
    );

    // Set new refresh token in HTTP-only cookie
    res.cookie('refreshToken', tokenData.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Return new access token in Authorization header
    res.setHeader('Authorization', `Bearer ${tokenData.accessToken}`);

    // Attach user to request
    req.user = getCanonicalUser(tokenData.user);

    logger.info('Token refreshed successfully', { userId: tokenData.user.id });

    next();
  } catch (error) {
    logger.error('Token refresh failed:', error.message);

    // Clear invalid refresh token cookie
    res.clearCookie('refreshToken');

    return res.status(401).json({
      error: 'Invalid or expired refresh token',
      code: 'REFRESH_TOKEN_INVALID',
    });
  }
};

/**
 * Middleware to prevent guardian users from accessing admin routes
 * Returns 403 Forbidden with descriptive error message
 */
const preventGuardianAccess = (req, res, next) => {
  const canonicalRole = req.user?.role || req.user?.role_type;

  if (canonicalRole === CANONICAL_ROLES.GUARDIAN) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'GUARDIAN_ACCESS_DENIED',
        message: 'Guardian users are not authorized to access admin resources.',
        details: 'This endpoint is restricted to system administrators only.',
      },
    });
  }

  next();
};

/**
 * Request ID tracking middleware for distributed tracing
 */
const requestIdMiddleware = (req, res, next) => {
  const requestId = req.headers['x-request-id'] ||
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
};

module.exports = {
  authenticateToken,
  optionalAuth,
  handleTokenRefresh,
  preventGuardianAccess,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  requireClinicAccess,
  requestIdMiddleware,
};
