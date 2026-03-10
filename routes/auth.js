console.log('Starting auth.js imports...');
const express = require('express');
console.log('express loaded');
const bcrypt = require('bcryptjs');
console.log('bcryptjs loaded');
const jwt = require('jsonwebtoken');
console.log('jsonwebtoken loaded');
const pool = require('../db');
console.log('db loaded');
const refreshTokenService = require('../services/refreshTokenService');
console.log('refreshTokenService loaded');

// New services
console.log('Loading validation...');
const validation = require('../utils/validation');
console.log('validation loaded');
console.log('Loading passwordHistoryService...');
const passwordHistoryService = require('../services/passwordHistoryService');
console.log('passwordHistoryService loaded');
console.log('Loading passwordResetService...');
const passwordResetService = require('../services/passwordResetService');
console.log('passwordResetService loaded');
console.log('Loading emailService...');
const emailService = require('../services/emailService');
console.log('emailService loaded');
console.log('Loading securityEventService...');
const securityEventService = require('../services/securityEventService');
console.log('securityEventService loaded');
console.log('Loading sessionService...');
const sessionService = require('../services/sessionService');
console.log('sessionService loaded');
console.log('Loading adminActivityService...');
const adminActivityService = require('../services/adminActivityService');
console.log('adminActivityService loaded');
console.log('Loading resendEmailService...');
const resendEmailService = require('../services/resendEmailService');
console.log('resendEmailService loaded');
console.log('Loading smsService...');
const smsService = require('../services/smsService');
console.log('smsService loaded');
console.log('Loading rateLimiter...');
const rateLimiter = require('../middleware/rateLimiter');
console.log('rateLimiter loaded');
console.log('Loading bruteForceProtection...');
const bruteForceProtectionModule = require('../middleware/bruteForceProtection');
const bruteForceProtection = bruteForceProtectionModule.bruteForceProtection;
const { checkBruteForce } = bruteForceProtectionModule;
const { normalizeRole, CANONICAL_ROLES, getRolePermissions } = require('../middleware/rbac');
console.log('bruteForceProtection loaded');

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

  // Safe fallback for historical guardian rows
  if (String(roleName || '').toLowerCase() === 'guardian') {
    return CANONICAL_ROLES.GUARDIAN;
  }

  return null;
};

// Handle OPTIONS requests for all auth routes
router.options('*', (req, res) => {
  res.status(204).send();
});

// Rate limiters
const loginRateLimiter = rateLimiter.createLoginRateLimiter();
const forgotPasswordRateLimiter = rateLimiter.createForgotPasswordRateLimiter();
const registrationRateLimiter = rateLimiter.createRegistrationRateLimiter();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication endpoints
 */

// ==================== VALIDATION MIDDLEWARE ====================

// Enhanced input validation middleware
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

  // Sanitize input
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

  // Check for suspicious patterns
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

// ==================== GUARDIAN REGISTRATION ====================

/**
 * @swagger
 * /api/auth/register/guardian:
 *   post:
 *     summary: Register a new guardian
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - confirmPassword
 *               - firstName
 *               - lastName
 *               - phone
 *               - relationship
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               confirmPassword:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               infantName:
 *                 type: string
 *               infantDob:
 *                 type: string
 *               relationship:
 *                 type: string
 *     responses:
 *       201:
 *         description: Registration successful, verification email sent
 *       400:
 *         description: Validation error
 */
router.post('/register/guardian', registrationRateLimiter, async (req, res) => {
  try {
    const registrationPayload = req.body || {};

    // Validate input
    const validationResult = validation.validateGuardianRegistration(registrationPayload);
    if (!validationResult.isValid) {
      const normalizedFieldErrors = Object.entries(validationResult.fields || {}).reduce(
        (acc, [field, messages]) => {
          if (Array.isArray(messages) && messages.length > 0) {
            acc[field] = messages[0];
          }
          return acc;
        },
        {},
      );

      return res.status(400).json({
        success: false,
        message: 'Please correct the highlighted registration fields.',
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors: validationResult.errors,
        fields: normalizedFieldErrors,
      });
    }

    const {
      email,
      firstName,
      lastName,
      phone,
      relationship,
      address,
      infantName,
      infantDob,
    } = validationResult.data;

    const normalizedRegistrationData = {
      ...registrationPayload,
      email,
      firstName,
      lastName,
      phone,
      relationship,
      address: address || null,
      infantName: infantName || null,
      infantDob: infantDob || null,
    };

    // Check if email already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [
      email,
    ]);

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Email already registered',
        code: 'EMAIL_EXISTS',
      });
    }

    const existingGuardian = await pool.query('SELECT id FROM guardians WHERE email = $1 LIMIT 1', [
      email,
    ]);

    if (existingGuardian.rows.length > 0) {
      return res.status(409).json({
        error: 'Email already registered',
        code: 'EMAIL_EXISTS',
      });
    }

    // Generate OTP using centralized service to avoid mismatches between
    // persisted pending registration OTP and delivered SMS OTP.
    const otp = smsService.generateVerificationCode();
    const expiresAt = new Date(
      Date.now() + smsService.SMS_CONFIG.otp.expiryMinutes * 60 * 1000,
    );

    // Store pending registration
    await pool.query(
      `INSERT INTO pending_registrations (registration_data, otp, phone_number, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [JSON.stringify(normalizedRegistrationData), otp, phone, expiresAt],
    );

    // Send OTP via SMS using the same generated code used for verification.
    // If SMS fails, clean up pending registration so the frontend can retry
    // without creating unusable stale OTP records.
    try {
      await smsService.sendVerificationSMS(phone, otp);
    } catch (smsError) {
      console.error('Failed to send OTP SMS:', smsError);
      await pool.query('DELETE FROM pending_registrations WHERE phone_number = $1', [phone]);
      return res.status(503).json({
        success: false,
        error: 'Unable to send verification code at this time. Please try again.',
        code: 'OTP_SEND_FAILED',
      });
    }

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully. Please verify to complete registration.',
      code: 'OTP_SENT',
      data: {
        phone,
        expiresInSeconds: smsService.SMS_CONFIG.otp.expiryMinutes * 60,
      },
    });
  } catch (error) {
    console.error('Guardian registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      code: 'REGISTRATION_ERROR',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/auth/register/guardian/verify:
 *   post:
 *     summary: Verify guardian registration OTP and create account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - otp
 *             properties:
 *               phone:
 *                 type: string
 *               otp:
 *                 type: string
 *     responses:
 *       201:
 *         description: Registration complete, welcome notifications sent
 *       400:
 *         description: Invalid OTP or expired
 */
router.post('/register/guardian/verify', registrationRateLimiter, async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone, otp } = req.body;

    // 1. Verify OTP from pending registrations
    const pendingResult = await client.query(
      `SELECT * FROM pending_registrations
       WHERE phone_number = $1 AND otp = $2 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phone, otp],
    );

    if (pendingResult.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid or expired OTP',
        code: 'INVALID_OTP',
      });
    }

    const registrationData = pendingResult.rows[0].registration_data;
    const { email, password, firstName, lastName, address, relationship } = registrationData;

    await client.query('BEGIN');

    // 2. Create Guardian
    const guardianResult = await client.query(
      `INSERT INTO guardians (name, phone, email, address, relationship, is_active, is_password_set)
       VALUES ($1, $2, $3, $4, $5, true, true)
       RETURNING id`,
      [`${firstName} ${lastName}`, phone, email, address, relationship],
    );
    const guardianId = guardianResult.rows[0].id;

    // 3. Create User
    const hashedPassword = await bcrypt.hash(password, 10);
    // Get guardian role ID
    const roleResult = await client.query('SELECT id FROM roles WHERE name = \'guardian\'');
    const roleId = roleResult.rows[0]?.id;

    // Get or create default clinic for guardians
    let clinicId = null;
    const clinicRes = await client.query('SELECT id FROM clinics WHERE name = \'Guardian Portal\' LIMIT 1');
    if (clinicRes.rows.length > 0) {
      clinicId = clinicRes.rows[0].id;
    } else {
      const newClinic = await client.query('INSERT INTO clinics (name, region, address, contact) VALUES (\'Guardian Portal\', \'Virtual\', \'Online\', \'N/A\') RETURNING id');
      clinicId = newClinic.rows[0].id;
    }

    await client.query(
      `INSERT INTO users (username, email, password_hash, role_id, guardian_id, clinic_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [email, email, hashedPassword, roleId, guardianId, clinicId],
    );

    // 4. Cleanup pending registration
    await client.query('DELETE FROM pending_registrations WHERE phone_number = $1', [phone]);

    await client.query('COMMIT');

    // 5. Send Welcome Notifications (Non-blocking)
    emailService.sendWelcomeEmail(email, firstName).catch(e => console.error('Welcome email failed:', e.message));
    smsService.sendWelcomeSMS(phone, firstName).catch(e => console.error('Welcome SMS failed:', e.message));

    res.status(201).json({
      message: 'Registration successful. Welcome to Immunicare!',
      code: 'REGISTRATION_COMPLETE',
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Registration verification error:', error);
    res.status(500).json({ error: 'Registration failed', code: 'SERVER_ERROR' });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verify email with token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Verification token is required',
        code: 'MISSING_TOKEN',
      });
    }

    const result = await passwordResetService.verifyEmail(token);

    if (!result.success) {
      return res.status(400).json({
        error: result.error,
        code: result.code,
      });
    }

    res.json({
      message: 'Email verified successfully. You can now login.',
      code: 'VERIFICATION_SUCCESS',
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      error: 'Email verification failed',
      code: 'VERIFICATION_ERROR',
    });
  }
});

// ==================== LOGIN ====================

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.post(
  '/login',
  loginRateLimiter,
  validateLoginInput,
  bruteForceProtection(),
  async (req, res) => {
    try {
      const { username, password, email } = req.body;

      // Query user by username or email
      const result = await pool.query(
        `SELECT u.id, u.username, u.password_hash, u.role_id, u.clinic_id, u.last_login, u.guardian_id, u.email, u.is_active,
               u.force_password_change, r.name as role_name, r.display_name, c.name as clinic_name
        FROM users u
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN clinics c ON u.clinic_id = c.id
        WHERE u.username = $1 OR u.email = $1`,
        [username || email],
      );

      if (result.rows.length === 0) {
        // Log failed attempt (optional - may fail if table doesn't exist)
        try {
          await securityEventService.logLoginFailed(
            username,
            req.ip,
            req.get('User-Agent'),
            'USER_NOT_FOUND',
          );
          await checkBruteForce(req, false);
        } catch (logError) {
          // Continue even if logging fails
          console.warn('Could not log failed login:', logError.message);
        }

        return res.status(401).json({
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS',
        });
      }

      const user = result.rows[0];
      const canonicalRole = resolveCanonicalRole(user.role_name);

      if (!canonicalRole) {
        return res.status(403).json({
          error: 'Unsupported account role. Please contact SYSTEM_ADMIN.',
          code: 'UNSUPPORTED_ROLE',
        });
      }

      // For guardian users, sync force_password_change with must_change_password from guardians table
      if (canonicalRole === CANONICAL_ROLES.GUARDIAN && user.guardian_id) {
        const guardianResult = await pool.query(
          'SELECT must_change_password, is_password_set FROM guardians WHERE id = $1',
          [user.guardian_id],
        );

        if (guardianResult.rows.length > 0) {
          const { must_change_password, is_password_set } = guardianResult.rows[0];

          // If is_password_set is true and force_password_change is true in users,
          // but must_change_password is false in guardians, sync the users table
          if (is_password_set && user.force_password_change && !must_change_password) {
            await pool.query('UPDATE users SET force_password_change = false WHERE id = $1', [
              user.id,
            ]);
            user.force_password_change = false;
          } else if (!is_password_set && !user.force_password_change) {
            // This is a new guardian who hasn't set password yet
            await pool.query('UPDATE guardians SET must_change_password = true WHERE id = $1', [
              user.guardian_id,
            ]);
          }
        }
      }

      // Check if user is active
      if (!user.is_active) {
        // Log failed attempt
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
          error: 'Account is inactive. Please verify your email.',
          code: 'ACCOUNT_INACTIVE',
        });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);

      if (!isValidPassword) {
        // Log failed attempt
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

      // Canonical two-role runtime model
      const roleType = canonicalRole;

      // Update last login
      await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

      // Generate tokens
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

      if (canonicalRole === CANONICAL_ROLES.GUARDIAN && user.guardian_id) {
        tokenPayload.guardian_id = user.guardian_id;
      }

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
        guardian_id: user.guardian_id || null,
        ...BARANGAY_SCOPE,
      });

      // Store refresh token
      await refreshTokenService.storeRefreshToken(
        user.id,
        refreshToken,
        req.get('User-Agent')?.substring(0, 255) || 'Unknown',
        req.ip?.substring(0, 255) || 'Unknown',
      );

      // Create session
      await sessionService.createSession(user.id, accessToken, req.ip, req.get('User-Agent'), {
        browser: req.get('User-Agent'),
      });

      // Clear failed attempts on success
      await checkBruteForce(req, true);

      // Log successful login
      try {
        await securityEventService.logLoginSuccess(user.id, req.ip, req.get('User-Agent'), {
          role: canonicalRole,
          legacy_role: user.role_name,
          clinic: user.clinic_name,
        });
      } catch (logError) {
        // Silently ignore logging errors - login still successful
        console.warn('Could not log login success event:', logError.message);
      }

      // Log admin login if applicable
      if (canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN) {
        try {
          await adminActivityService.logLogin(
            {
              ...user,
              role_name: CANONICAL_ROLES.SYSTEM_ADMIN,
              role: CANONICAL_ROLES.SYSTEM_ADMIN,
              runtime_role: CANONICAL_ROLES.SYSTEM_ADMIN,
              legacy_role: user.role_name,
            },
            req.ip,
            req.get('User-Agent'),
          );
        } catch (error) {
          // Suppress admin activity logging errors in development mode
          console.warn('Could not log admin activity:', error.message);
        }
      }

      // Build response
      const userResponse = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: canonicalRole,
        role_type: roleType,
        runtime_role: canonicalRole,
        legacy_role: user.role_name,
        clinic: user.clinic_name,
        clinic_id: user.clinic_id,
        ...BARANGAY_SCOPE,
        last_login: user.last_login,
        force_password_change: user.force_password_change || false,
        forcePasswordChange: user.force_password_change || false,
        permissions: getRolePermissions(canonicalRole),
        dashboardRoute: canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN ? '/dashboard' : '/guardian/dashboard',
        layout: canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN ? 'AdminLayout' : 'GuardianLayout',
      };

      if (canonicalRole === CANONICAL_ROLES.GUARDIAN && user.guardian_id) {
        userResponse.guardian_id = user.guardian_id;
      }

      // Set cookies
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
        message: 'Login successful',
        user: userResponse,
        token: accessToken,
        accessToken: accessToken,
        refreshToken: refreshToken,
        expiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m',
        layout: canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN ? 'AdminLayout' : 'GuardianLayout',
        dashboardRoute: canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN ? '/dashboard' : '/guardian/dashboard',
        permissions: getRolePermissions(canonicalRole),
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        error: 'Login failed',
        code: 'LOGIN_ERROR',
      });
    }
  },
);

// ==================== FORGOT PASSWORD ====================

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset link sent if email exists
 */
router.post('/forgot-password', forgotPasswordRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
        code: 'MISSING_EMAIL',
      });
    }

    const result = await passwordResetService.requestPasswordReset(
      email,
      req.ip,
      req.get('User-Agent'),
    );

    res.json({
      message: result.message,
      code: 'RESET_LINK_SENT',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      error: 'Password reset request failed',
      code: 'RESET_ERROR',
    });
  }
});

// ==================== DUAL-OPTION FORGOT PASSWORD (SMS or Email) ====================

/**
 * POST /api/auth/forgot-password/otp
 * Request password reset with OTP via SMS or Email
 */
router.post('/forgot-password/otp', forgotPasswordRateLimiter, async (req, res) => {
  try {
    const { email, method = 'email' } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
        code: 'MISSING_EMAIL',
      });
    }

    if (!['email', 'sms'].includes(method)) {
      return res.status(400).json({
        error: 'Invalid method. Must be "email" or "sms"',
        code: 'INVALID_METHOD',
      });
    }

    // Find user by email
    const userResult = await pool.query(
      'SELECT id, username, email, contact, guardian_id FROM users WHERE email = $1 AND is_active = true',
      [email],
    );

    if (userResult.rows.length === 0) {
      // Don't reveal that email doesn't exist
      return res.json({
        message: 'If the email exists, an OTP will be sent',
        code: 'OTP_SENT',
      });
    }

    const user = userResult.rows[0];

    // Generate OTP using centralized service
    const otp = smsService.generateVerificationCode();
    const expiresAt = new Date(
      Date.now() + smsService.SMS_CONFIG.otp.expiryMinutes * 60 * 1000,
    );

    // Store OTP
    await pool.query(
      `INSERT INTO password_reset_otps (user_id, otp, method, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, otp, method, expiresAt, req.ip, req.get('User-Agent')],
    );

    if (method === 'email') {
      // Send OTP via email using Resend
      try {
        await resendEmailService.sendOTPEmail(user.email, otp, 'password_reset');
      } catch (emailError) {
        console.error('Failed to send OTP email:', emailError.message);
        // Try fallback to nodemailer
        try {
          await emailService.sendEmailVerificationEmail(user.email, otp, user.username);
        } catch (fallbackError) {
          console.error('Fallback email also failed:', fallbackError.message);
        }
      }
    } else if (method === 'sms') {
      // Send OTP via SMS
      let userPhone = user.contact;

      // Try to get phone from guardian record
      if (!userPhone && user.guardian_id) {
        const guardianResult = await pool.query('SELECT phone FROM guardians WHERE id = $1', [
          user.guardian_id,
        ]);
        if (guardianResult.rows.length > 0 && guardianResult.rows[0].phone) {
          userPhone = guardianResult.rows[0].phone;
        }
      }

      if (!userPhone) {
        return res.status(400).json({
          error: 'No phone number on file. Please contact support.',
          code: 'NO_PHONE',
        });
      }

      const formattedPhone = smsService.formatPhoneNumber(userPhone);
      if (formattedPhone) {
        await smsService.sendPasswordResetSMS(formattedPhone, otp);
      }
    }

    res.json({
      message: 'OTP sent successfully',
      code: 'OTP_SENT',
      method: method,
    });
  } catch (error) {
    console.error('Forgot password OTP error:', error);
    res.status(500).json({
      error: 'Failed to send OTP',
      code: 'OTP_ERROR',
    });
  }
});

/**
 * POST /api/auth/forgot-password/verify-otp
 * Verify OTP for password reset
 */
router.post('/forgot-password/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        error: 'Email and OTP are required',
        code: 'MISSING_FIELDS',
      });
    }

    // Find user
    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND is_active = true',
      [email],
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid OTP',
        code: 'INVALID_OTP',
      });
    }

    const userId = userResult.rows[0].id;

    // Find valid OTP
    const otpResult = await pool.query(
      `SELECT id, otp, expires_at, used_at
       FROM password_reset_otps
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid or expired OTP',
        code: 'INVALID_OTP',
      });
    }

    const storedOtp = otpResult.rows[0];

    if (storedOtp.otp !== otp) {
      // Increment attempts
      await pool.query('UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = $1', [
        storedOtp.id,
      ]);
      return res.status(400).json({
        error: 'Invalid OTP',
        code: 'INVALID_OTP',
      });
    }

    // Mark OTP as used
    await pool.query('UPDATE password_reset_otps SET used_at = NOW() WHERE id = $1', [
      storedOtp.id,
    ]);

    // Generate reset token
    const resetToken = jwt.sign({ userId, type: 'password_reset' }, process.env.JWT_SECRET, {
      expiresIn: '30m',
    });

    res.json({
      message: 'OTP verified successfully',
      code: 'OTP_VERIFIED',
      resetToken: resetToken,
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      error: 'Failed to verify OTP',
      code: 'VERIFY_ERROR',
    });
  }
});

/**
 * POST /api/auth/forgot-password/reset-with-token
 * Reset password with verified token
 */
router.post('/forgot-password/reset-with-token', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        error: 'Reset token and new password are required',
        code: 'MISSING_FIELDS',
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({
        error: 'Invalid or expired reset token',
        code: 'INVALID_TOKEN',
      });
    }

    if (decoded.type !== 'password_reset') {
      return res.status(400).json({
        error: 'Invalid token type',
        code: 'INVALID_TOKEN',
      });
    }

    // Get user
    const userResult = await pool.query(
      'SELECT id, username, password_hash, email FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const user = userResult.rows[0];

    // Validate new password strength
    const passwordValidation = validation.validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        error: 'New password does not meet requirements',
        code: 'WEAK_PASSWORD',
        errors: passwordValidation.errors,
      });
    }

    // Check password history
    const historyValidation = await passwordHistoryService.validatePasswordAgainstHistory(
      user.id,
      newPassword,
    );
    if (!historyValidation.isValid) {
      return res.status(400).json({
        error: historyValidation.error,
        code: 'PASSWORD_IN_HISTORY',
      });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           updated_at = NOW(),
           force_password_change = false,
           password_changed_at = NOW()
       WHERE id = $2`,
      [newPasswordHash, user.id],
    );

    // Add to password history
    await passwordHistoryService.addToPasswordHistory(user.id, user.password_hash);
    await passwordHistoryService.addToPasswordHistory(user.id, newPasswordHash);

    // Revoke all sessions and refresh tokens
    await refreshTokenService.revokeAllUserTokens(user.id);
    await sessionService.endAllSessions(user.id, 'password_reset');

    // Log security event
    await securityEventService.logEvent({
      userId: user.id,
      eventType: 'PASSWORD_RESET',
      severity: 'INFO',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      details: { method: 'otp' },
    });

    // Send confirmation email
    try {
      await resendEmailService.sendPasswordResetConfirmationEmail(
        user.email,
        user.username,
        req.ip,
        new Date().toLocaleString(),
      );
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError.message);
    }

    res.json({
      message: 'Password reset successful',
      code: 'PASSWORD_RESET_SUCCESS',
    });
  } catch (error) {
    console.error('Reset password with token error:', error);
    res.status(500).json({
      error: 'Password reset failed',
      code: 'RESET_ERROR',
    });
  }
});

// ==================== RESET PASSWORD ====================

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password with token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired token
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        error: 'Token and new password are required',
        code: 'MISSING_FIELDS',
      });
    }

    const result = await passwordResetService.resetPassword(
      token,
      newPassword,
      req.ip,
      req.get('User-Agent'),
    );

    if (!result.success) {
      return res.status(400).json({
        error: result.error,
        code: result.code,
        details: result.details,
      });
    }

    res.json({
      message: 'Password reset successful',
      code: 'PASSWORD_RESET_SUCCESS',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      error: 'Password reset failed',
      code: 'RESET_ERROR',
    });
  }
});

// ==================== CHANGE PASSWORD ====================

/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     summary: Change password (authenticated)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid current password
 */
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

    if (!token || !currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and new password are required',
        code: 'MISSING_FIELDS',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user
    const userResult = await pool.query(
      'SELECT id, username, password_hash, email FROM users WHERE id = $1 AND is_active = true',
      [decoded.id],
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const user = userResult.rows[0];

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      await securityEventService.logEvent({
        userId: user.id,
        eventType: 'PASSWORD_FAILED_CHANGE',
        severity: 'WARNING',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: { reason: 'Invalid current password' },
      });

      return res.status(401).json({
        error: 'Current password is incorrect',
        code: 'INVALID_PASSWORD',
      });
    }

    // Validate new password strength
    const passwordValidation = validation.validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        error: 'New password does not meet requirements',
        code: 'WEAK_PASSWORD',
        errors: passwordValidation.errors,
      });
    }

    // Check password history
    const historyValidation = await passwordHistoryService.validatePasswordAgainstHistory(
      user.id,
      newPassword,
    );
    if (!historyValidation.isValid) {
      return res.status(400).json({
        error: historyValidation.error,
        code: 'PASSWORD_IN_HISTORY',
      });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password and reset force_password_change flag in users table
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           updated_at = NOW(),
           force_password_change = false,
           password_changed_at = NOW()
       WHERE id = $2`,
      [newPasswordHash, user.id],
    );

    // Also update must_change_password in guardians table for guardian users
    // Get the guardian_id for this user
    const guardianResult = await pool.query('SELECT guardian_id FROM users WHERE id = $1', [
      user.id,
    ]);

    if (guardianResult.rows.length > 0 && guardianResult.rows[0].guardian_id) {
      // Update the guardians table to mark password as set
      await pool.query(
        `UPDATE guardians
         SET is_password_set = true,
             must_change_password = false,
             updated_at = NOW()
         WHERE id = $1`,
        [guardianResult.rows[0].guardian_id],
      );
    }

    // Add to password history
    await passwordHistoryService.addToPasswordHistory(user.id, user.password_hash);
    await passwordHistoryService.addToPasswordHistory(user.id, newPasswordHash);

    // Revoke all refresh tokens
    await refreshTokenService.revokeAllUserTokens(user.id);
    await sessionService.endAllSessions(user.id, 'password_changed');

    // Log the event
    await securityEventService.logEvent({
      userId: user.id,
      eventType: 'PASSWORD_CHANGED',
      severity: 'INFO',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Send confirmation email
    try {
      await emailService.sendPasswordResetConfirmationEmail(
        user.email,
        user.username,
        req.ip,
        new Date().toLocaleString(),
      );
    } catch {
      // Suppress email errors in development mode (SMTP not configured)
    }

    res.json({
      message: 'Password changed successfully. Please login again.',
      code: 'PASSWORD_CHANGED',
    });
  } catch (error) {
    console.error('Change password error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
    }
    res.status(500).json({
      error: 'Password change failed',
      code: 'CHANGE_ERROR',
    });
  }
});

// ==================== LOGOUT ====================

router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    // Revoke refresh token
    if (refreshToken) {
      try {
        await refreshTokenService.revokeRefreshToken(refreshToken);
      } catch (error) {
        console.error('Error revoking refresh token:', error);
      }
    }

    // Clear cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
    };

    res.clearCookie('token', cookieOptions);

    res.clearCookie('refreshToken', cookieOptions);

    res.json({
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'Logout failed',
      code: 'LOGOUT_ERROR',
    });
  }
});

// ==================== TOKEN REFRESH ====================

router.post('/refresh', async (req, res) => {
  try {
    // Try to get refresh token from cookies first, then from body, then from Authorization header
    let refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      refreshToken = req.body?.refreshToken;
    }

    if (!refreshToken) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        refreshToken = authHeader.substring(7);
      }
    }

    if (!refreshToken) {
      return res.status(401).json({
        error: 'No refresh token provided',
        code: 'NO_REFRESH_TOKEN',
      });
    }

    const refreshResult = await refreshTokenService.refreshAccessToken(
      refreshToken,
      req.get('User-Agent')?.substring(0, 255) || 'Unknown',
      req.ip?.substring(0, 255) || 'Unknown',
    );

    // Get user details
    const userResult = await pool.query(
      `SELECT u.id, u.username, u.role_id, u.clinic_id, u.guardian_id, u.email,
              u.force_password_change, r.name as role_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.id = $1 AND u.is_active = true`,
      [refreshResult.user.id],
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const user = userResult.rows[0];
    const canonicalRole = resolveCanonicalRole(user.role_name);
    const roleType = canonicalRole;

    const userResponse = {
      id: user.id,
      username: user.username,
      email: user.email || user.username || null,
      role: canonicalRole,
      role_type: roleType,
      runtime_role: canonicalRole,
      legacy_role: user.role_name,
      clinic: user.clinic_name,
      clinic_id: user.clinic_id,
      ...BARANGAY_SCOPE,
      force_password_change: user.force_password_change || false,
      forcePasswordChange: user.force_password_change || false,
    };

    if (canonicalRole === CANONICAL_ROLES.GUARDIAN && user.guardian_id) {
      userResponse.guardian_id = user.guardian_id;
    }

    // Set new cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/',
    };

    res.cookie('token', refreshResult.accessToken, cookieOptions);

    res.cookie('refreshToken', refreshResult.refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      message: 'Token refreshed',
      token: refreshResult.accessToken,
      accessToken: refreshResult.accessToken,
      refreshToken: refreshResult.refreshToken,
      user: userResponse,
      expiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m',
    });
  } catch (error) {
    console.error('Refresh error:', error);
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
    };
    res.clearCookie('refreshToken', cookieOptions);

    if (error.name === 'TokenExpiredError' || error.message.includes('expired')) {
      return res.status(401).json({
        error: 'Refresh token expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    res.status(401).json({
      error: 'Invalid or revoked refresh token',
      code: 'INVALID_TOKEN',
    });
  }
});

// ==================== SESSION VERIFICATION ====================

router.get('/verify', async (req, res) => {
  // Prevent caching for session verification endpoint
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        error: 'No token provided',
        code: 'NO_TOKEN',
        authenticated: false,
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      if (jwtError.name === 'JsonWebTokenError' || jwtError.name === 'SyntaxError') {
        return res.status(401).json({
          error: 'Invalid token',
          code: 'INVALID_TOKEN',
          authenticated: false,
        });
      }
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expired',
          code: 'TOKEN_EXPIRED',
          authenticated: false,
        });
      }
      throw jwtError;
    }

    const result = await pool.query(
      `SELECT u.id, u.username, u.role_id, u.clinic_id, u.guardian_id, u.last_login, u.email,
              u.force_password_change, r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.id = $1 AND u.is_active = true`,
      [decoded.id],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'User not found or inactive',
        code: 'USER_NOT_FOUND',
        authenticated: false,
      });
    }

    const user = result.rows[0];
    const canonicalRole = resolveCanonicalRole(user.role_name);
    const roleType = canonicalRole;

    const userResponse = {
      id: user.id,
      username: user.username,
      email: user.email || user.username || null,
      role: canonicalRole,
      role_type: roleType,
      runtime_role: canonicalRole,
      legacy_role: user.role_name,
      clinic: user.clinic_name,
      clinic_id: user.clinic_id,
      ...BARANGAY_SCOPE,
      last_login: user.last_login,
      force_password_change: user.force_password_change || false,
      forcePasswordChange: user.force_password_change || false,
    };

    if (canonicalRole === CANONICAL_ROLES.GUARDIAN && user.guardian_id) {
      userResponse.guardian_id = user.guardian_id;
    }

    // Update session activity
    await sessionService.updateSessionActivity(token);

    res.json({
      authenticated: true,
      user: userResponse,
      expiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m',
    });
  } catch (error) {
    console.error('Session verification error:', error);
    res.status(401).json({
      error: 'Session verification failed',
      code: 'VERIFICATION_ERROR',
      authenticated: false,
    });
  }
});

// ==================== SESSION MANAGEMENT ====================

router.get('/sessions', async (req, res) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      if (jwtError.name === 'JsonWebTokenError' || jwtError.name === 'SyntaxError') {
        return res.status(401).json({
          error: 'Invalid token',
          code: 'INVALID_TOKEN',
        });
      }
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expired',
          code: 'TOKEN_EXPIRED',
        });
      }
      throw jwtError;
    }

    const sessions = await sessionService.getUserSessions(decoded.id);

    res.json({
      sessions,
      currentSessionId: decoded.id,
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    // Check if it's a table missing error
    if (error.code === '42P01') {
      return res.status(500).json({
        error: 'Session table not found. Please run database migrations.',
        code: 'TABLE_MISSING',
      });
    }
    res.status(500).json({
      error: 'Failed to get sessions',
      code: 'SESSIONS_ERROR',
    });
  }
});

router.delete('/sessions/:id', async (req, res) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const sessionId = parseInt(req.params.id);

    // Get session to revoke
    const sessionResult = await pool.query(
      'SELECT session_token FROM user_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, decoded.id],
    );

    if (sessionResult.rows.length > 0) {
      await sessionService.endSession(sessionResult.rows[0].session_token, 'user_revoked');
    }

    res.json({
      message: 'Session revoked successfully',
      code: 'SESSION_REVOKED',
    });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({
      error: 'Failed to revoke session',
      code: 'REVOKE_ERROR',
    });
  }
});

router.delete('/sessions', async (req, res) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const count = await sessionService.endAllSessions(decoded.id, 'logout_all');

    // Also revoke refresh tokens
    await refreshTokenService.revokeAllUserTokens(decoded.id);

    res.json({
      message: 'All sessions revoked successfully',
      code: 'ALL_SESSIONS_REVOKED',
      sessionsEnded: count,
    });
  } catch (error) {
    console.error('Revoke all sessions error:', error);
    res.status(500).json({
      error: 'Failed to revoke sessions',
      code: 'REVOKE_ERROR',
    });
  }
});

// ==================== TEST ENDPOINT ====================

router.get('/test', (req, res) => {
  res.json({
    message: 'Auth route is working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

module.exports = router;
