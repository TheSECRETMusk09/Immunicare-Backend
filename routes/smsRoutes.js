/**
 * SMS API Routes for Immunicare
 *
 * RESTful endpoints for SMS functionality including:
 * - OTP verification
 * - Phone number verification
 * - Appointment reminders
 * - SMS preferences management
 */

/**
 * @deprecated Legacy SMS router retained only for historical reference.
 * Active production SMS routes are defined in backend/routes/sms.js and
 * mounted via /api/sms in backend/routes/api.js.
 */

const express = require('express');
const router = express.Router();
const smsService = require('../services/smsService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const pool = require('../db');

const requireGuardian = requireRole(['GUARDIAN']);

/**
 * @route POST /api/sms/send-otp
 * @description Send OTP verification code to phone number
 * @access Public (with rate limiting)
 */
router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber, purpose = 'verification' } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Validate purpose
    const validPurposes = ['verification', 'password_reset', 'phone_verification'];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid purpose',
      });
    }

    const result = await smsService.sendOTP(phoneNumber, purpose, {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    if (result.success) {
      res.json({
        success: true,
        message: 'OTP sent successfully',
        expiresIn: result.expiresIn,
        otpId: result.otpId,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        cooldownRemaining: result.cooldownRemaining,
      });
    }
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send OTP',
    });
  }
});

/**
 * @route POST /api/sms/verify-otp
 * @description Verify OTP code
 * @access Public
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, code, purpose = 'verification' } = req.body;

    if (!phoneNumber || !code) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and code are required',
      });
    }

    const result = await smsService.verifyOTP(phoneNumber, code, purpose);

    if (result.success) {
      res.json({
        success: true,
        message: 'OTP verified successfully',
        userId: result.userId,
        guardianId: result.guardianId,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        attemptsRemaining: result.attemptsRemaining,
      });
    }
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify OTP',
    });
  }
});

/**
 * @route POST /api/sms/send-appointment-reminder
 * @description Send appointment reminder (internal use)
 * @access Private (Admin/System)
 */
router.post('/send-appointment-reminder', authenticateToken, async (req, res) => {
  try {
    const { appointment } = req.body;

    if (!appointment || !appointment.phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Appointment details with phone number are required',
      });
    }

    const result = await smsService.sendAppointmentReminder(appointment);

    res.json({
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    });
  } catch (error) {
    console.error('Send appointment reminder error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send appointment reminder',
    });
  }
});

/**
 * @route GET /api/sms/config-status
 * @description Get SMS gateway configuration status
 * @access Private (Admin)
 */
router.get('/config-status', authenticateToken, async (req, res) => {
  try {
    const status = smsService.getSMSConfigStatus();

    res.json({
      success: true,
      config: status,
    });
  } catch (error) {
    console.error('Get SMS config status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get SMS config status',
    });
  }
});

/**
 * @route GET /api/sms/preferences
 * @description Get SMS preferences for authenticated guardian
 * @access Private (Guardian)
 */
router.get('/preferences', authenticateToken, requireGuardian, async (req, res) => {
  try {
    const guardianId = req.user.guardianId;

    // Get phone numbers and preferences
    const query = `
      SELECT
        gpn.id,
        gpn.phone_number,
        gpn.is_primary,
        gpn.is_verified,
        gpn.sms_preferences
      FROM guardian_phone_numbers gpn
      WHERE gpn.guardian_id = $1
    `;

    const result = await pool.query(query, [guardianId]);

    res.json({
      success: true,
      phoneNumbers: result.rows,
    });
  } catch (error) {
    console.error('Get SMS preferences error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get SMS preferences',
    });
  }
});

/**
 * @route PUT /api/sms/preferences
 * @description Update SMS preferences for authenticated guardian
 * @access Private (Guardian)
 */
router.put('/preferences', authenticateToken, requireGuardian, async (req, res) => {
  try {
    const guardianId = req.user.guardianId;
    const { phoneNumberId, smsPreferences } = req.body;

    if (!phoneNumberId) {
      return res.status(400).json({
        success: false,
        error: 'Phone number ID is required',
      });
    }

    const query = `
      UPDATE guardian_phone_numbers
      SET sms_preferences = $1, updated_at = NOW()
      WHERE id = $2 AND guardian_id = $3
      RETURNING *
    `;

    const result = await pool.query(query, [
      JSON.stringify(smsPreferences),
      phoneNumberId,
      guardianId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Phone number not found',
      });
    }

    res.json({
      success: true,
      message: 'SMS preferences updated',
      preferences: result.rows[0],
    });
  } catch (error) {
    console.error('Update SMS preferences error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update SMS preferences',
    });
  }
});

/**
 * @route POST /api/sms/verify-phone
 * @description Start phone number verification process
 * @access Private (Guardian)
 */
router.post('/verify-phone', authenticateToken, requireGuardian, async (req, res) => {
  try {
    const guardianId = req.user.guardianId;
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Send OTP for phone verification
    const result = await smsService.sendOTP(phoneNumber, 'phone_verification', {
      guardianId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    if (result.success) {
      res.json({
        success: true,
        message: 'Verification code sent',
        expiresIn: result.expiresIn,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        cooldownRemaining: result.cooldownRemaining,
      });
    }
  } catch (error) {
    console.error('Verify phone error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate phone verification',
    });
  }
});

/**
 * @route POST /api/sms/confirm-phone
 * @description Confirm phone number with OTP
 * @access Private (Guardian)
 */
router.post('/confirm-phone', authenticateToken, requireGuardian, async (req, res) => {
  try {
    const guardianId = req.user.guardianId;
    const { phoneNumber, code, setPrimary = false } = req.body;

    if (!phoneNumber || !code) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and verification code are required',
      });
    }

    // Verify OTP
    const verifyResult = await smsService.verifyOTP(phoneNumber, code, 'phone_verification');

    if (!verifyResult.success) {
      return res.status(400).json({
        success: false,
        error: verifyResult.error,
        attemptsRemaining: verifyResult.attemptsRemaining,
      });
    }

    // If setting as primary, unset other primary numbers
    if (setPrimary) {
      await pool.query(
        'UPDATE guardian_phone_numbers SET is_primary = false WHERE guardian_id = $1',
        [guardianId],
      );
    }

    // Upsert phone number
    const upsertQuery = `
      INSERT INTO guardian_phone_numbers (guardian_id, phone_number, is_primary, is_verified, verified_at)
      VALUES ($1, $2, $3, true, NOW())
      ON CONFLICT (guardian_id, phone_number)
      DO UPDATE SET is_verified = true, verified_at = NOW(), is_primary = COALESCE($3, guardian_phone_numbers.is_primary)
      RETURNING *
    `;

    const result = await pool.query(upsertQuery, [
      guardianId,
      smsService.formatPhoneNumber(phoneNumber),
      setPrimary,
    ]);

    res.json({
      success: true,
      message: 'Phone number verified successfully',
      phoneNumber: result.rows[0],
    });
  } catch (error) {
    console.error('Confirm phone error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm phone verification',
    });
  }
});

/**
 * @route POST /api/sms/password-reset
 * @description Request password reset via SMS
 * @access Public
 */
router.post('/password-reset', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Check if phone number exists in guardian records
    const formattedNumber = smsService.formatPhoneNumber(phoneNumber);
    const guardianQuery = `
      SELECT g.id, g.first_name
      FROM guardians g
      JOIN guardian_phone_numbers gpn ON g.id = gpn.guardian_id
      WHERE gpn.phone_number = $1 AND gpn.is_verified = true
    `;

    const guardianResult = await pool.query(guardianQuery, [formattedNumber]);

    if (guardianResult.rows.length === 0) {
      // Don't reveal if phone number exists or not
      return res.json({
        success: true,
        message: 'If the phone number is registered, you will receive a verification code',
      });
    }

    const guardian = guardianResult.rows[0];

    // Send OTP for password reset
    const result = await smsService.sendOTP(phoneNumber, 'password_reset', {
      guardianId: guardian.id,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Always return success to prevent phone number enumeration
    res.json({
      success: true,
      message: 'If the phone number is registered, you will receive a verification code',
      expiresIn: result.success ? result.expiresIn : undefined,
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process password reset request',
    });
  }
});

/**
 * @route GET /api/sms/logs
 * @description Get SMS logs for authenticated guardian
 * @access Private (Guardian)
 */
router.get('/logs', authenticateToken, requireGuardian, async (req, res) => {
  try {
    const guardianId = req.user.guardianId;
    const { limit = 20, offset = 0 } = req.query;

    // Get guardian's phone numbers
    const phoneQuery = 'SELECT phone_number FROM guardian_phone_numbers WHERE guardian_id = $1';
    const phoneResult = await pool.query(phoneQuery, [guardianId]);

    if (phoneResult.rows.length === 0) {
      return res.json({
        success: true,
        logs: [],
        total: 0,
      });
    }

    const phoneNumbers = phoneResult.rows.map((r) => r.phone_number);

    // Get SMS logs for those phone numbers
    const logsQuery = `
      SELECT
        id, phone_number, message_type, status, provider,
        created_at, sent_at
      FROM sms_logs
      WHERE phone_number = ANY($1)
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM sms_logs
      WHERE phone_number = ANY($1)
    `;

    const [logsResult, countResult] = await Promise.all([
      pool.query(logsQuery, [phoneNumbers, parseInt(limit), parseInt(offset)]),
      pool.query(countQuery, [phoneNumbers]),
    ]);

    res.json({
      success: true,
      logs: logsResult.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Get SMS logs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get SMS logs',
    });
  }
});

module.exports = router;
