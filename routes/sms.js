/**
 * SMS Routes for Immunicare Vaccination Management System
 *
 * Endpoints:
 * - POST /api/sms/send-verification - Send SMS verification code
 * - POST /api/sms/verify-code - Verify SMS code
 * - POST /api/sms/password-reset/request - Request password reset via SMS
 * - POST /api/sms/password-reset/verify - Verify password reset code
 * - POST /api/sms/password-reset/reset - Complete password reset
 * - GET /api/sms/phone/:guardianId - Get guardian phone numbers
 * - PUT /api/sms/phone/:guardianId - Update phone number
 * - POST /api/sms/phone/:guardianId/verify - Verify phone number change
 * - DELETE /api/sms/phone/:guardianId/:phoneId - Delete guardian phone number
 * - GET /api/sms/logs - Get SMS delivery logs
 * - GET /api/sms/config-status - Get SMS configuration status (admin only)
 * - POST /api/sms/test - Test SMS endpoint
 */

const express = require('express');
const router = express.Router();
require('jsonwebtoken');
const pool = require('../db');
const smsService = require('../services/smsService');
const rateLimiter = require('../middleware/rateLimiter');
const { authenticateToken } = require('../middleware/auth');
const { CANONICAL_ROLES, getCanonicalRole, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');

// Root route - return API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SMS API',
    endpoints: [
      '/send-verification',
      '/verify-code',
      '/password-reset/request',
      '/password-reset/verify',
      '/password-reset/reset',
      '/phone/:guardianId',
      '/logs',
      '/test',
    ],
  });
});

// Rate limiters
const smsRateLimiter = rateLimiter.createSMSRateLimiter();
const smsVerificationRateLimiter = rateLimiter.createSMSVerificationRateLimiter();

// Helper to verify guardian
async function verifyGuardian(req, res, next) {
  const { guardianId } = req.params;
  const userGuardianId = parseInt(req.user.guardian_id, 10);
  const canonicalRole = getCanonicalRole(req);

  // System admins can access any guardian
  if (canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN) {
    if (guardianId) {
      req.guardianId = parseInt(guardianId, 10);
    } else if (userGuardianId) {
      req.guardianId = userGuardianId;
    }

    if (!req.guardianId || Number.isNaN(req.guardianId)) {
      return res.status(400).json({ error: 'Invalid guardian ID', code: 'INVALID_GUARDIAN_ID' });
    }

    return next();
  }

  // Guardians can only access their own data
  const requestedGuardianId = guardianId ? parseInt(guardianId, 10) : null;
  if (!userGuardianId || Number.isNaN(userGuardianId)) {
    return res
      .status(403)
      .json({ error: 'Guardian account mapping is missing', code: 'FORBIDDEN' });
  }

  if (requestedGuardianId && requestedGuardianId !== userGuardianId) {
    return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
  }

  req.guardianId = userGuardianId;
  next();
}

/**
 * POST /api/sms/send-verification
 * Send SMS verification code for phone number verification
 */
router.post('/send-verification', smsVerificationRateLimiter, async (req, res) => {
  try {
    const { phoneNumber, purpose = 'phone_verification' } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        error: 'Phone number is required',
        code: 'MISSING_PHONE',
      });
    }

    // Validate phone number format
    const formattedPhone = smsService.formatPhoneNumber(phoneNumber);
    if (!formattedPhone) {
      return res.status(400).json({
        error: 'Invalid phone number format',
        code: 'INVALID_PHONE',
      });
    }

    // Generate verification code
    const code = smsService.generateVerificationCode(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store verification code
    await pool.query(
      `INSERT INTO sms_verification_codes (phone_number, code, purpose, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (phone_number, purpose)
       DO UPDATE SET code = $2, expires_at = $4, attempts = 0, created_at = CURRENT_TIMESTAMP`,
      [formattedPhone, code, purpose, expiresAt, req.ip, req.get('User-Agent')]
    );

    // Send SMS
    try {
      await smsService.sendVerificationSMS(formattedPhone, code);

      res.json({
        message: 'Verification code sent successfully',
        code: 'VERIFICATION_SENT',
        expiresIn: 600, // 10 minutes in seconds
      });
    } catch (smsError) {
      console.error('SMS sending failed:', smsError.message);
      // Still return success to avoid revealing internal errors
      res.json({
        message: 'Verification code sent successfully',
        code: 'VERIFICATION_SENT',
        expiresIn: 600,
      });
    }
  } catch (error) {
    console.error('Send verification error:', error);
    res.status(500).json({
      error: 'Failed to send verification code',
      code: 'SEND_ERROR',
    });
  }
});

/**
 * POST /api/sms/verify-code
 * Verify SMS code
 */
router.post('/verify-code', smsVerificationRateLimiter, async (req, res) => {
  try {
    const { phoneNumber, code, purpose = 'phone_verification' } = req.body;

    if (!phoneNumber || !code) {
      return res.status(400).json({
        error: 'Phone number and code are required',
        code: 'MISSING_FIELDS',
      });
    }

    const formattedPhone = smsService.formatPhoneNumber(phoneNumber);

    // Get stored code
    const result = await pool.query(
      `SELECT * FROM sms_verification_codes
       WHERE phone_number = $1 AND purpose = $2
       AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`,
      [formattedPhone, purpose]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Verification code expired or not found',
        code: 'CODE_EXPIRED',
      });
    }

    const verification = result.rows[0];

    // Check attempts
    if (verification.attempts >= verification.max_attempts) {
      return res.status(400).json({
        error: 'Too many failed attempts. Please request a new code',
        code: 'MAX_ATTEMPTS_EXCEEDED',
      });
    }

    // Verify code
    if (verification.code !== code) {
      await pool.query('UPDATE sms_verification_codes SET attempts = attempts + 1 WHERE id = $1', [
        verification.id,
      ]);

      const remainingAttempts = verification.max_attempts - verification.attempts - 1;
      return res.status(400).json({
        error: `Invalid verification code. ${remainingAttempts} attempts remaining`,
        code: 'INVALID_CODE',
      });
    }

    // Mark as verified
    await pool.query(
      'UPDATE sms_verification_codes SET verified_at = CURRENT_TIMESTAMP WHERE id = $1',
      [verification.id]
    );

    res.json({
      message: 'Phone number verified successfully',
      code: 'VERIFICATION_SUCCESS',
    });
  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({
      error: 'Verification failed',
      code: 'VERIFY_ERROR',
    });
  }
});

/**
 * POST /api/sms/password-reset/request
 * Request password reset via SMS
 */
router.post('/password-reset/request', smsRateLimiter, async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
      return res.status(400).json({
        error: 'Email or phone number is required',
        code: 'MISSING_CREDENTIALS',
      });
    }

    let guardianId = null;
    let userId = null;
    let targetPhone = null;

    if (phoneNumber) {
      // Find guardian by phone number
      targetPhone = smsService.formatPhoneNumber(phoneNumber);

      const phoneResult = await pool.query(
        'SELECT guardian_id FROM guardian_phone_numbers WHERE phone_number = $1 AND is_verified = true',
        [targetPhone]
      );

      if (phoneResult.rows.length === 0) {
        // Return success anyway to prevent phone number enumeration
        return res.json({
          message: 'If an account exists with this phone number, a verification code will be sent',
          code: 'RESET_REQUESTED',
        });
      }

      guardianId = phoneResult.rows[0].guardian_id;

      // Get user ID
      const userResult = await pool.query('SELECT id FROM users WHERE guardian_id = $1', [
        guardianId,
      ]);

      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
      }
    } else if (email) {
      // Find guardian by email
      const userResult = await pool.query(
        'SELECT id, guardian_id FROM users WHERE email = $1 AND is_active = true',
        [email.toLowerCase()]
      );

      if (userResult.rows.length === 0) {
        // Return success anyway to prevent email enumeration
        return res.json({
          message: 'If an account exists with this email, a reset link will be sent',
          code: 'RESET_REQUESTED',
        });
      }

      userId = userResult.rows[0].id;
      guardianId = userResult.rows[0].guardian_id;

      // Get verified phone number
      const phoneResult = await pool.query(
        'SELECT phone_number FROM guardian_phone_numbers WHERE guardian_id = $1 AND is_verified = true AND is_primary = true',
        [guardianId]
      );

      if (phoneResult.rows.length === 0) {
        // No verified phone, send email instead
        return res.json({
          message: 'If an account exists with this email, a reset link will be sent to your email',
          code: 'EMAIL_RESET_SENT',
        });
      }

      targetPhone = phoneResult.rows[0].phone_number;
    }

    if (!targetPhone) {
      return res.json({
        message: 'If an account exists, a reset code will be sent',
        code: 'RESET_REQUESTED',
      });
    }

    // Generate verification code
    const code = smsService.generateVerificationCode(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store verification code
    await pool.query(
      `INSERT INTO sms_verification_codes (phone_number, code, purpose, user_id, guardian_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, 'password_reset', $3, $4, $5, $6, $7)
       ON CONFLICT (phone_number, purpose)
       DO UPDATE SET
         code = EXCLUDED.code,
         user_id = EXCLUDED.user_id,
         guardian_id = EXCLUDED.guardian_id,
         expires_at = EXCLUDED.expires_at,
         ip_address = EXCLUDED.ip_address,
         user_agent = EXCLUDED.user_agent,
         attempts = 0,
         created_at = CURRENT_TIMESTAMP,
         verified_at = NULL`,
      [targetPhone, code, userId, guardianId, expiresAt, req.ip, req.get('User-Agent')]
    );

    // Send SMS
    try {
      await smsService.sendPasswordResetSMS(targetPhone, code);
    } catch (smsError) {
      console.error('SMS sending failed:', smsError.message);
    }

    // Mask phone number for response
    const maskedPhone =
      targetPhone.substring(0, 4) + '****' + targetPhone.substring(targetPhone.length - 4);

    res.json({
      message: `Verification code sent to ${maskedPhone}`,
      code: 'RESET_REQUESTED',
      maskedPhone,
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      error: 'Password reset request failed',
      code: 'RESET_ERROR',
    });
  }
});

/**
 * POST /api/sms/password-reset/verify
 * Verify password reset code
 */
router.post('/password-reset/verify', smsVerificationRateLimiter, async (req, res) => {
  try {
    const { phoneNumber, code } = req.body;

    if (!phoneNumber || !code) {
      return res.status(400).json({
        error: 'Phone number and code are required',
        code: 'MISSING_FIELDS',
      });
    }

    const formattedPhone = smsService.formatPhoneNumber(phoneNumber);

    // Get stored code
    const result = await pool.query(
      `SELECT * FROM sms_verification_codes
       WHERE phone_number = $1 AND purpose = 'password_reset'
       AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`,
      [formattedPhone]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Verification code expired or not found',
        code: 'CODE_EXPIRED',
      });
    }

    const verification = result.rows[0];

    // Check attempts
    if (verification.attempts >= verification.max_attempts) {
      return res.status(400).json({
        error: 'Too many failed attempts. Please request a new code',
        code: 'MAX_ATTEMPTS_EXCEEDED',
      });
    }

    // Verify code
    if (verification.code !== code) {
      await pool.query('UPDATE sms_verification_codes SET attempts = attempts + 1 WHERE id = $1', [
        verification.id,
      ]);

      const remainingAttempts = verification.max_attempts - verification.attempts - 1;
      return res.status(400).json({
        error: `Invalid verification code. ${remainingAttempts} attempts remaining`,
        code: 'INVALID_CODE',
      });
    }

    // Generate reset token
    const resetToken = smsService.generateResetToken();
    const resetExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Store reset token
    await pool.query(
      `INSERT INTO sms_verification_codes (phone_number, code, purpose, user_id, guardian_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, 'password_reset_token', $3, $4, $5, $6, $7)`,
      [
        formattedPhone,
        resetToken,
        verification.user_id,
        verification.guardian_id,
        resetExpiresAt,
        req.ip,
        req.get('User-Agent'),
      ]
    );

    res.json({
      message: 'Code verified successfully',
      code: 'CODE_VERIFIED',
      resetToken,
      expiresIn: 1800, // 30 minutes
    });
  } catch (error) {
    console.error('Password reset verify error:', error);
    res.status(500).json({
      error: 'Verification failed',
      code: 'VERIFY_ERROR',
    });
  }
});

/**
 * POST /api/sms/password-reset/reset
 * Complete password reset with token
 */
router.post('/password-reset/reset', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        error: 'Reset token and new password are required',
        code: 'MISSING_FIELDS',
      });
    }

    // Find reset token
    const result = await pool.query(
      `SELECT * FROM sms_verification_codes
       WHERE code = $1 AND purpose = 'password_reset_token'
       AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`,
      [resetToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid or expired reset token',
        code: 'INVALID_TOKEN',
      });
    }

    const verification = result.rows[0];

    if (!verification.user_id) {
      return res.status(400).json({
        error: 'Invalid reset token',
        code: 'INVALID_TOKEN',
      });
    }

    // Validate password
    if (newPassword.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters',
        code: 'WEAK_PASSWORD',
      });
    }

    // Hash new password
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1, force_password_change = false, password_changed_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, verification.user_id]
    );

    // Update guardian password status if applicable
    if (verification.guardian_id) {
      await pool.query(
        'UPDATE guardians SET is_password_set = true, must_change_password = false WHERE id = $1',
        [verification.guardian_id]
      );
    }

    // Delete used token
    await pool.query('DELETE FROM sms_verification_codes WHERE id = $1', [verification.id]);

    res.json({
      message: 'Password reset successful',
      code: 'PASSWORD_RESET_SUCCESS',
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      error: 'Password reset failed',
      code: 'RESET_ERROR',
    });
  }
});

/**
 * GET /api/sms/phone/:guardianId
 * Get guardian phone numbers
 */
router.get('/phone/:guardianId', authenticateToken, verifyGuardian, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, phone_number, is_primary, is_verified, verified_at, sms_preferences, created_at, updated_at
       FROM guardian_phone_numbers
       WHERE guardian_id = $1
       ORDER BY is_primary DESC, created_at DESC`,
      [req.guardianId]
    );

    // Mask phone numbers for response
    const maskedPhones = result.rows.map((phone) => ({
      ...phone,
      phone_number:
        phone.phone_number.substring(0, 4) +
        '****' +
        phone.phone_number.substring(phone.phone_number.length - 4),
    }));

    res.json(maskedPhones);
  } catch (error) {
    console.error('Get phone error:', error);
    res.status(500).json({
      error: 'Failed to get phone numbers',
      code: 'GET_ERROR',
    });
  }
});

/**
 * PUT /api/sms/phone/:guardianId
 * Update phone number (requires verification)
 */
router.put('/phone/:guardianId', authenticateToken, verifyGuardian, async (req, res) => {
  try {
    const { phoneNumber, isPrimary = true, smsPreferences } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        error: 'Phone number is required',
        code: 'MISSING_PHONE',
      });
    }

    const formattedPhone = smsService.formatPhoneNumber(phoneNumber);

    // Check if phone is already verified for this guardian
    const existingResult = await pool.query(
      `SELECT id, is_verified FROM guardian_phone_numbers
       WHERE guardian_id = $1 AND phone_number = $2`,
      [req.guardianId, formattedPhone]
    );

    if (existingResult.rows.length > 0) {
      // Update existing record
      await pool.query(
        `UPDATE guardian_phone_numbers
         SET is_primary = $1, sms_preferences = COALESCE($2, sms_preferences), updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [
          isPrimary,
          smsPreferences ? JSON.stringify(smsPreferences) : null,
          existingResult.rows[0].id,
        ]
      );

      return res.json({
        message: existingResult.rows[0].is_verified
          ? 'Phone number updated successfully'
          : 'Phone number updated. Verification required.',
        code: existingResult.rows[0].is_verified ? 'UPDATED' : 'VERIFICATION_REQUIRED',
      });
    }

    // Insert new phone number (unverified)
    await pool.query(
      `INSERT INTO guardian_phone_numbers (guardian_id, phone_number, is_primary, sms_preferences)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guardian_id, phone_number) DO NOTHING`,
      [
        req.guardianId,
        formattedPhone,
        isPrimary,
        smsPreferences ? JSON.stringify(smsPreferences) : null,
      ]
    );

    // Send verification code
    try {
      const code = smsService.generateVerificationCode(6);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await pool.query(
        `INSERT INTO sms_verification_codes (phone_number, code, purpose, guardian_id, expires_at)
         VALUES ($1, $2, 'phone_update', $3, $4)
         ON CONFLICT (phone_number, purpose)
         DO UPDATE SET code = $2, expires_at = $4, attempts = 0`,
        [formattedPhone, code, req.guardianId, expiresAt]
      );

      await smsService.sendVerificationSMS(formattedPhone, code);
    } catch (smsError) {
      console.error('SMS sending failed:', smsError.message);
    }

    res.json({
      message: 'Phone number added. Verification code sent.',
      code: 'VERIFICATION_SENT',
      maskedPhone:
        formattedPhone.substring(0, 4) +
        '****' +
        formattedPhone.substring(formattedPhone.length - 4),
    });
  } catch (error) {
    console.error('Update phone error:', error);
    res.status(500).json({
      error: 'Failed to update phone number',
      code: 'UPDATE_ERROR',
    });
  }
});

/**
 * POST /api/sms/phone/:guardianId/verify
 * Verify phone number change
 */
router.post('/phone/:guardianId/verify', authenticateToken, verifyGuardian, async (req, res) => {
  try {
    const { phoneNumber, code } = req.body;

    if (!phoneNumber || !code) {
      return res.status(400).json({
        error: 'Phone number and code are required',
        code: 'MISSING_FIELDS',
      });
    }

    const formattedPhone = smsService.formatPhoneNumber(phoneNumber);

    // Verify code
    const result = await pool.query(
      `SELECT * FROM sms_verification_codes
       WHERE phone_number = $1 AND purpose = 'phone_update'
       AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`,
      [formattedPhone]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Verification code expired or not found',
        code: 'CODE_EXPIRED',
      });
    }

    const verification = result.rows[0];

    if (verification.code !== code) {
      await pool.query('UPDATE sms_verification_codes SET attempts = attempts + 1 WHERE id = $1', [
        verification.id,
      ]);

      return res.status(400).json({
        error: 'Invalid verification code',
        code: 'INVALID_CODE',
      });
    }

    // Update phone number as verified
    await pool.query(
      `UPDATE guardian_phone_numbers
       SET is_verified = true, verified_at = CURRENT_TIMESTAMP, verification_code_id = $1
       WHERE guardian_id = $2 AND phone_number = $3`,
      [verification.id, req.guardianId, formattedPhone]
    );

    // Mark verification as used
    await pool.query(
      'UPDATE sms_verification_codes SET verified_at = CURRENT_TIMESTAMP WHERE id = $1',
      [verification.id]
    );

    res.json({
      message: 'Phone number verified successfully',
      code: 'VERIFIED',
    });
  } catch (error) {
    console.error('Verify phone error:', error);
    res.status(500).json({
      error: 'Phone verification failed',
      code: 'VERIFY_ERROR',
    });
  }
});

/**
 * DELETE /api/sms/phone/:guardianId/:phoneId
 * Delete a guardian phone number
 */
router.delete(
  '/phone/:guardianId/:phoneId',
  authenticateToken,
  verifyGuardian,
  async (req, res) => {
    try {
      const phoneId = Number.parseInt(req.params.phoneId, 10);

      if (!Number.isFinite(phoneId) || phoneId <= 0) {
        return res.status(400).json({
          error: 'Invalid phone ID',
          code: 'INVALID_PHONE_ID',
        });
      }

      const existingResult = await pool.query(
        `SELECT id, is_primary
       FROM guardian_phone_numbers
       WHERE id = $1 AND guardian_id = $2`,
        [phoneId, req.guardianId]
      );

      if (existingResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Phone number not found',
          code: 'PHONE_NOT_FOUND',
        });
      }

      if (existingResult.rows[0].is_primary) {
        return res.status(400).json({
          error: 'Primary phone number cannot be deleted',
          code: 'PRIMARY_PHONE_DELETE_FORBIDDEN',
        });
      }

      await pool.query('DELETE FROM guardian_phone_numbers WHERE id = $1 AND guardian_id = $2', [
        phoneId,
        req.guardianId,
      ]);

      return res.json({
        message: 'Phone number removed',
        code: 'DELETED',
      });
    } catch (error) {
      console.error('Delete phone error:', error);
      return res.status(500).json({
        error: 'Failed to delete phone number',
        code: 'DELETE_ERROR',
      });
    }
  }
);

/**
 * GET /api/sms/logs
 * Get SMS delivery logs (admin only)
 */
router.get(
  '/logs',
  authenticateToken,
  requirePermission('system:audit'),
  asyncHandler(async (req, res) => {
    const { phoneNumber, type, status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM sms_logs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (phoneNumber) {
      query += ` AND phone_number LIKE $${paramIndex}`;
      params.push(`%${phoneNumber}%`);
      paramIndex++;
    }

    if (type) {
      query += ` AND message_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC LIMIT $' + paramIndex + ' OFFSET $' + (paramIndex + 1);
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM sms_logs WHERE 1=1';
    const countParams = [];
    let countIndex = 1;

    if (phoneNumber) {
      countQuery += ` AND phone_number LIKE $${countIndex}`;
      countParams.push(`%${phoneNumber}%`);
      countIndex++;
    }

    if (type) {
      countQuery += ` AND message_type = $${countIndex}`;
      countParams.push(type);
      countIndex++;
    }

    if (status) {
      countQuery += ` AND status = $${countIndex}`;
      countParams.push(status);
      countIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      logs: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  })
);

/**
 * GET /api/sms/config-status
 * Get SMS configuration status (admin only)
 */
router.get(
  '/config-status',
  authenticateToken,
  requirePermission('system:sms_config'),
  asyncHandler(async (req, res) => {
    const provider = process.env.SMS_GATEWAY || 'log';
    const hasApiKey = !!(
      process.env.TEXTBEE_API_KEY ||
      process.env.TWILIO_ACCOUNT_SID ||
      process.env.SEMAPHORE_API_KEY
    );
    res.json({
      provider,
      isConfigured: hasApiKey,
      enabledFeatures: {
        verification: true,
        passwordReset: true,
        reminders: process.env.SMS_REMINDERS_ENABLED === 'true',
      },
      senderName:
        process.env.TEXTBEE_SENDER_NAME || process.env.SEMAPHORE_SENDER_NAME || 'IMMUNICARE',
    });
  })
);

/**
 * POST /api/sms/test
 * Test SMS endpoint
 */
router.post(
  '/test',
  authenticateToken,
  requirePermission('system:sms_config'),
  async (req, res) => {
    try {
      const { phoneNumber, message } = req.body;

      // Check if SMS provider is configured
      const provider = process.env.SMS_PROVIDER || 'log';

      if (provider === 'log') {
        // Log mode - just log and return success
        console.log(`[SMS-TEST] Phone: ${phoneNumber}, Message: ${message}`);

        return res.json({
          success: true,
          provider: 'log',
          message: 'SMS logged (development mode)',
          testMode: true,
        });
      }

      // Send actual SMS
      const result = await smsService.sendSMS(
        phoneNumber || process.env.TEST_PHONE_NUMBER,
        message || 'This is a test message from Immunicare SMS Service'
      );

      res.json({
        success: true,
        provider,
        messageId: result.messageId,
        timestamp: result.timestamp,
      });
    } catch (error) {
      console.error('SMS test error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

module.exports = router;
