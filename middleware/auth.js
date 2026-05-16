const jwt = require('jsonwebtoken');
const loadBackendEnv = require('../config/loadEnv');
loadBackendEnv();
const {
  normalizeRole,
  CANONICAL_ROLES,
  requireRole: requireCanonicalRole,
} = require('./rbac');
const refreshTokenService = require('../services/refreshTokenService');
const sessionService = require('../services/sessionService');
const logger = require('../config/logger');
const {
  getBaseAuthCookieOptions,
  getRefreshTokenCookieOptions,
} = require('../utils/authCookies');

const getCanonicalUser = (user) => {
  const normalizedRole = normalizeRole(user?.runtime_role || user?.role_type || user?.role);
  if (!normalizedRole) return null;

  return {
    ...user,
    role: normalizedRole,
    role_type: normalizedRole,
    runtime_role: normalizedRole,
    legacy_role: user?.legacy_role || user?.role || null,
  };
};

const resolveJwtSecret = () => process.env.JWT_SECRET || null;

const getBearerTokenFromHeader = (authorizationHeader) => {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') return null;
  if (!authorizationHeader.startsWith('Bearer ')) return null;
  return authorizationHeader.slice(7).trim() || null;
};

const getAccessTokenFromRequest = (req) =>
  getBearerTokenFromHeader(req.headers?.authorization) || req.cookies?.token || null;

const getRefreshTokenFromRequest = (req) =>
  req.cookies?.refreshToken ||
  req.body?.refreshToken ||
  getBearerTokenFromHeader(req.headers?.authorization) ||
  null;

const authenticateToken = (req, res, next) => {
  try {
    const jwtSecret = resolveJwtSecret();
    if (!jwtSecret) {
      logger.error('JWT_SECRET is not configured. Refusing to authenticate requests.');
      return res.status(500).json({
        error: 'Server authentication is not configured',
        code: 'SERVER_CONFIG_ERROR',
      });
    }

    const accessToken = getAccessTokenFromRequest(req);
    if (!accessToken) {
      return res.status(401).json({ error: 'Access token required', code: 'MISSING_TOKEN' });
    }

    jwt.verify(accessToken, jwtSecret, (err, user) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
            message: 'Access token has expired. Please refresh your token.',
          });
        }
        if (err.name === 'JsonWebTokenError') {
          return res.status(401).json({ error: 'Invalid token format', code: 'INVALID_TOKEN' });
        }
        return res.status(401).json({ error: 'Token verification failed', code: 'TOKEN_ERROR' });
      }

      if (!user || !user.id || !user.role) {
        return res.status(401).json({ error: 'Invalid token payload', code: 'INVALID_PAYLOAD' });
      }

      const canonicalUser = getCanonicalUser(user);
      if (!canonicalUser) {
        return res.status(401).json({ error: 'Unsupported role in token payload', code: 'UNSUPPORTED_ROLE' });
      }

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
      );
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');

      req.user = canonicalUser;

      // fire-and-forget - don't block the request for session bookkeeping
      sessionService.updateSessionActivity(accessToken).catch((sessionError) => {
        logger.warn('Session activity update failed', {
          message: sessionError?.message || sessionError,
          userId: canonicalUser.id,
        });
      });

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

// Attach user if token is present and valid; otherwise continue unauthenticated
const optionalAuth = (req, res, next) => {
  try {
    const jwtSecret = resolveJwtSecret();
    if (!jwtSecret) return next();

    const accessToken = getAccessTokenFromRequest(req);
    if (!accessToken) return next();

    jwt.verify(accessToken, jwtSecret, (err, user) => {
      if (err) return next();

      const canonicalUser = getCanonicalUser(user);
      if (canonicalUser && canonicalUser.id) req.user = canonicalUser;
      next();
    });
  } catch {
    next();
  }
};

const requireRole = (roles) => requireCanonicalRole(roles);

const requireAdmin = (req, res, next) =>
  requireRole([CANONICAL_ROLES.SYSTEM_ADMIN])(req, res, next);

const requireSuperAdmin = (req, res, next) =>
  requireRole([CANONICAL_ROLES.SYSTEM_ADMIN])(req, res, next);

const requireClinicAccess = (req, res, next) => {
  try {
    if (!req.user || !req.user.clinic_id) {
      return res.status(403).json({ error: 'Clinic access required', code: 'NO_CLINIC_ACCESS' });
    }
    req.user.clinic_id = parseInt(req.user.clinic_id);
    next();
  } catch (error) {
    console.error('Clinic access check error:', error);
    res.status(500).json({ error: 'Clinic access check failed', code: 'CLINIC_ACCESS_ERROR' });
  }
};

// Rotates the refresh token and issues a new access token
const handleTokenRefresh = async (req, res, next) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required', code: 'MISSING_REFRESH_TOKEN' });
    }

    const userAgent = req.headers['user-agent'] || 'unknown';
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';

    const tokenData = await refreshTokenService.refreshAccessToken(refreshToken, userAgent, ipAddress);

    res.cookie('refreshToken', tokenData.refreshToken, getRefreshTokenCookieOptions());
    res.setHeader('Authorization', `Bearer ${tokenData.accessToken}`);
    req.user = getCanonicalUser(tokenData.user);

    logger.info('Token refreshed successfully', { userId: tokenData.user.id });
    next();
  } catch (error) {
    logger.error('Token refresh failed:', error.message);
    res.clearCookie('refreshToken', getBaseAuthCookieOptions());
    return res.status(401).json({
      error: 'Invalid or expired refresh token',
      code: 'REFRESH_TOKEN_INVALID',
    });
  }
};

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

const requestIdMiddleware = (req, res, next) => {
  const requestId =
    req.headers['x-request-id'] ||
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
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest,
  getBearerTokenFromHeader,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  requireClinicAccess,
  requestIdMiddleware,
};
