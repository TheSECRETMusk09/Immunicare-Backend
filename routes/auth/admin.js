const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../db');
const refreshTokenService = require('../../services/refreshTokenService');
const validation = require('../../utils/validation');
const passwordHistoryService = require('../../services/passwordHistoryService');
const passwordResetService = require('../../services/passwordResetService');
const emailService = require('../../services/emailService');
const securityEventService = require('../../services/securityEventService');
const sessionService = require('../../services/sessionService');
const adminActivityService = require('../../services/adminActivityService');
const resendEmailService = require('../../services/resendEmailService');
const rateLimiter = require('../../middleware/rateLimiter');
const { bruteForceProtection, checkBruteForce } = require('../../middleware/bruteForceProtection');
const { normalizeRole, CANONICAL_ROLES, getRolePermissions } = require('../../middleware/rbac');

const router = express.Router();

const BARANGAY_SCOPE = Object.freeze({
  barangay_code: 'SAN_NICOLAS_PASIG',
  barangay_name: 'Barangay San Nicolas, Pasig City',
});

const resolveCanonicalRole = (roleName) => {
  const normalized = normalizeRole(roleName);
  if (normalized) {
    return normalized;
  }
  return null;
};

router.options('*', (req, res) => {
  res.status(204).send();
});

const loginRateLimiter = rateLimiter.createLoginRateLimiter();

const validateLoginInput = (req, res, next) => {
  const { username, email, password } = req.body;

  if (!password) {
    return res.status(400).json({
      error: 'Password is required',
      code: 'MISSING_CREDENTIALS',
    });
  }

  if (!username && !email) {
    return res.status(400).json({
      error: 'Username or email is required',
      code: 'MISSING_CREDENTIALS',
    });
  }

  if (typeof password !== 'string') {
    return res.status(400).json({
      error: 'Invalid input format',
      code: 'INVALID_FORMAT',
    });
  }

  if (username && typeof username !== 'string') {
    return res.status(400).json({
      error: 'Invalid input format',
      code: 'INVALID_FORMAT',
    });
  }

  if (email && typeof email !== 'string') {
    return res.status(400).json({
      error: 'Invalid input format',
      code: 'INVALID_FORMAT',
    });
  }

  if (username) {
    req.body.username = username.replace(/[<>"'%\\]/g, '');
    if (req.body.username.length > 255) {
      return res.status(400).json({
        error: 'Input too long',
        code: 'INPUT_TOO_LONG',
      });
    }
  }

  if (email) {
    req.body.email = email.replace(/[<>"'%\\]/g, '');
    if (req.body.email.length > 255) {
      return res.status(400).json({
        error: 'Input too long',
        code: 'INPUT_TOO_LONG',
      });
    }
  }

  req.body.password = password.replace(/[<>"'%\\]/g, '');
  if (req.body.password.length > 1000) {
    return res.status(400).json({
      error: 'Input too long',
      code: 'INPUT_TOO_LONG',
    });
  }

  const suspiciousPatterns = [
    /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION|--|;)\b/i,
    /\b(?:OR\s+1=1|'OR'1'='1)\b/i,
  ];

  if (
    (username && suspiciousPatterns.some((pattern) => pattern.test(username))) ||
    (email && suspiciousPatterns.some((pattern) => pattern.test(email))) ||
    suspiciousPatterns.some((pattern) => pattern.test(password))
  ) {
    return res.status(400).json({
      error: 'Invalid input format',
      code: 'INVALID_FORMAT',
    });
  }

  next();
};

router.post(
  '/login',
  loginRateLimiter,
  validateLoginInput,
  bruteForceProtection(),
  async (req, res) => {
    try {
      const { username, password, email } = req.body;

      const result = await pool.query(
        `SELECT u.id, u.username, u.password_hash, u.role_id, u.clinic_id, u.last_login, u.guardian_id, u.email, u.is_active,
               u.force_password_change, r.name as role_name, r.display_name, c.name as clinic_name
        FROM users u
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN clinics c ON u.clinic_id = c.id
        WHERE (u.username = $1 OR u.email = $1) AND r.name IN ('admin', 'super_admin', 'administrator')`,
        [username || email],
      );

      if (result.rows.length === 0) {
        try {
          await securityEventService.logLoginFailed(
            username,
            req.ip,
            req.get('User-Agent'),
            'USER_NOT_FOUND',
          );
          await checkBruteForce(req, false);
        } catch (logError) {
          console.warn('Could not log failed login:', logError.message);
        }

        return res.status(401).json({
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS',
        });
      }

      const user = result.rows[0];
      const canonicalRole = resolveCanonicalRole(user.role_name);

      if (!canonicalRole || (canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN && canonicalRole !== CANONICAL_ROLES.ADMIN)) {
        return res.status(403).json({
          error: 'Access denied. Only administrators can log in here.',
          code: 'ACCESS_DENIED',
        });
      }

      if (!user.is_active) {
        try {
          await securityEventService.logLoginFailed(
            username,
            req.ip,
            req.get('User-Agent'),
            'ACCOUNT_INACTIVE',
          );
          await checkBruteForce(req, false);
        } catch (logError) {
          console.warn('Could not log inactive account login:', logError.message);
        }

        return res.status(401).json({
          error: 'Account is inactive. Please contact support.',
          code: 'ACCOUNT_INACTIVE',
        });
      }

      const isValidPassword = await bcrypt.compare(password, user.password_hash);

      if (!isValidPassword) {
        try {
          await securityEventService.logLoginFailed(
            username,
            req.ip,
            req.get('User-Agent'),
            'INVALID_PASSWORD',
          );
          await checkBruteForce(req, false);
        } catch (logError) {
          console.warn('Could not log invalid password:', logError.message);
        }

        return res.status(401).json({
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS',
        });
      }

      await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

      const tokenPayload = {
        id: user.id,
        username: user.username,
        role: canonicalRole,
        role_type: canonicalRole,
        runtime_role: canonicalRole,
        legacy_role: user.role_name,
        clinic_id: user.clinic_id || null,
        ...BARANGAY_SCOPE,
        permissions: getRolePermissions(canonicalRole),
      };

      const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m',
        issuer: 'immunicare-system',
        audience: 'immunicare-users',
      });

      const refreshToken = refreshTokenService.generateRefreshToken({
        id: user.id,
        username: user.username,
        role: canonicalRole,
        role_type: canonicalRole,
        legacy_role: user.role_name,
        clinic_id: user.clinic_id || null,
        ...BARANGAY_SCOPE,
      });

      await refreshTokenService.storeRefreshToken(
        user.id,
        refreshToken,
        req.get('User-Agent')?.substring(0, 255) || 'Unknown',
        req.ip?.substring(0, 255) || 'Unknown',
      );

      await sessionService.createSession(user.id, accessToken, req.ip, req.get('User-Agent'), {
        browser: req.get('User-Agent'),
      });

      await checkBruteForce(req, true);

      try {
        await securityEventService.logLoginSuccess(user.id, req.ip, req.get('User-Agent'), {
          role: canonicalRole,
          legacy_role: user.role_name,
          clinic: user.clinic_name,
        });
      } catch (logError) {
        console.warn('Could not log login success event:', logError.message);
      }

      try {
        await adminActivityService.logLogin(
          {
            ...user,
            role_name: canonicalRole,
            role: canonicalRole,
            runtime_role: canonicalRole,
            legacy_role: user.role_name,
          },
          req.ip,
          req.get('User-Agent'),
        );
      } catch (error) {
        console.warn('Could not log admin activity:', error.message);
      }

      const userResponse = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: canonicalRole,
        role_type: canonicalRole,
        runtime_role: canonicalRole,
        legacy_role: user.role_name,
        clinic: user.clinic_name,
        clinic_id: user.clinic_id,
        ...BARANGAY_SCOPE,
        last_login: user.last_login,
        force_password_change: user.force_password_change || false,
        forcePasswordChange: user.force_password_change || false,
        permissions: getRolePermissions(canonicalRole),
        dashboardRoute: '/dashboard',
        layout: 'AdminLayout',
      };

      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: 15 * 60 * 1000,
        path: '/',
      };

      res.cookie('token', accessToken, cookieOptions);

      res.cookie('refreshToken', refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({
        message: 'Admin login successful',
        user: userResponse,
        token: accessToken,
        accessToken: accessToken,
        refreshToken: refreshToken,
        expiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m',
        layout: 'AdminLayout',
        dashboardRoute: '/dashboard',
        permissions: getRolePermissions(canonicalRole),
      });
    } catch (error) {
      console.error('Admin login error:', error);
      res.status(500).json({
        error: 'Login failed',
        code: 'LOGIN_ERROR',
      });
    }
  },
);

module.exports = router;
