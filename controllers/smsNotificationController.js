/**
 * SMS Notification Controller
 * Handles SMS notifications for appointments, vaccinations, and OTP
 *
 * Uses TextBee.dev for production SMS delivery in Philippines/Southeast Asia
 *
 * @module controllers/smsNotificationController
 * @version 2.0
 * @since 2026-03-01
 */

const smsService = require('../services/smsService');
const pool = require('../db');
const logger = require('../config/logger');

/**
 * Send OTP for phone verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendPhoneVerificationOTP = async (req, res) => {
  try {
    const { phoneNumber, userId, guardianId } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Validate phone number format
    const phoneValidation = smsService.validateAndFormatPhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      return res.status(400).json({
        success: false,
        error: phoneValidation.error,
      });
    }

    // Send OTP
    const result = await smsService.sendOTP(phoneNumber, 'phone_verification', {
      userId,
      guardianId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (result.success) {
      logger.info(`Phone verification OTP sent to ${phoneValidation.formattedNumber}`);
      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        otpId: result.otpId,
        expiresIn: result.expiresIn,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
        cooldownRemaining: result.cooldownRemaining,
      });
    }
  } catch (error) {
    logger.error('Error sending phone verification OTP:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send OTP',
    });
  }
};

/**
 * Send OTP for password reset
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendPasswordResetOTP = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Check if phone number exists in database
    const userQuery = `
      SELECT id, guardian_id FROM guardians
      WHERE contact_number = $1 OR alternate_contact = $1
      LIMIT 1
    `;
    const userResult = await pool.query(userQuery, [phoneNumber]);

    if (userResult.rows.length === 0) {
      // Don't reveal if phone number exists
      return res.status(200).json({
        success: true,
        message: 'If this phone number is registered, an OTP has been sent.',
      });
    }

    const user = userResult.rows[0];

    // Send OTP
    const result = await smsService.sendOTP(phoneNumber, 'password_reset', {
      userId: user.id,
      guardianId: user.guardian_id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (result.success) {
      logger.info(`Password reset OTP sent to ${phoneNumber}`);
      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        otpId: result.otpId,
        expiresIn: result.expiresIn,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
        cooldownRemaining: result.cooldownRemaining,
      });
    }
  } catch (error) {
    logger.error('Error sending password reset OTP:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send OTP',
    });
  }
};

/**
 * Verify OTP code
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, code, purpose } = req.body;

    if (!phoneNumber || !code) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and code are required',
      });
    }

    const result = await smsService.verifyOTP(phoneNumber, code, purpose || 'verification');

    if (result.success) {
      logger.info(`OTP verified successfully for ${phoneNumber}`);
      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully',
        userId: result.userId,
        guardianId: result.guardianId,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
        attemptsRemaining: result.attemptsRemaining,
      });
    }
  } catch (error) {
    logger.error('Error verifying OTP:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify OTP',
    });
  }
};

/**
 * Send appointment confirmation SMS
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendAppointmentConfirmation = async (req, res) => {
  try {
    const { appointmentId } = req.body;

    // Get appointment details
    const query = `
      SELECT
        a.id,
        a.scheduled_date,
        a.status,
        COALESCE(NULLIF(TRIM(g.name), ''), NULLIF(TRIM(CONCAT_WS(' ', g.first_name, g.last_name)), ''), 'Guardian') as guardian_name,
        COALESCE(NULLIF(TRIM(g.phone), ''), NULLIF(TRIM(g.alternate_phone), ''), NULLIF(TRIM(g.emergency_phone), '')) as guardian_phone,
        p.first_name as child_name,
        COALESCE(a.type, 'Vaccination Appointment') as vaccine_name
      FROM appointments a
      JOIN patients p ON a.infant_id = p.id
      JOIN guardians g ON COALESCE(a.guardian_id, p.guardian_id) = g.id
      WHERE a.id = $1
    `;

    const result = await pool.query(query, [appointmentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found',
      });
    }

    const appointment = result.rows[0];

    if (!appointment.guardian_phone) {
      return res.status(400).json({
        success: false,
        error: 'Guardian phone number not available',
      });
    }

    // Send SMS
    const smsResult = await smsService.sendAppointmentConfirmation({
      phoneNumber: appointment.guardian_phone,
      guardianName: appointment.guardian_name,
      childName: appointment.child_name,
      vaccineName: appointment.vaccine_name,
      scheduledDate: appointment.scheduled_date,
      location: 'Health Center', // Can be customized based on appointment location
    });

    if (smsResult.success) {
      logger.info(`Appointment confirmation SMS sent for appointment ${appointmentId}`);
      return res.status(200).json({
        success: true,
        message: 'Confirmation SMS sent successfully',
        messageId: smsResult.messageId,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: smsResult.error,
      });
    }
  } catch (error) {
    logger.error('Error sending appointment confirmation SMS:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send confirmation SMS',
    });
  }
};

/**
 * Send appointment reminder SMS (24 hours before)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendAppointmentReminder = async (req, res) => {
  try {
    const { appointmentId } = req.body;

    // Get appointment details
    const query = `
      SELECT
        a.id,
        a.scheduled_date,
        COALESCE(NULLIF(TRIM(g.name), ''), NULLIF(TRIM(CONCAT_WS(' ', g.first_name, g.last_name)), ''), 'Guardian') as guardian_name,
        COALESCE(NULLIF(TRIM(g.phone), ''), NULLIF(TRIM(g.alternate_phone), ''), NULLIF(TRIM(g.emergency_phone), '')) as guardian_phone,
        p.first_name as child_name,
        COALESCE(a.type, 'Vaccination Appointment') as vaccine_name
      FROM appointments a
      JOIN patients p ON a.infant_id = p.id
      JOIN guardians g ON COALESCE(a.guardian_id, p.guardian_id) = g.id
      WHERE a.id = $1
    `;

    const result = await pool.query(query, [appointmentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found',
      });
    }

    const appointment = result.rows[0];

    if (!appointment.guardian_phone) {
      return res.status(400).json({
        success: false,
        error: 'Guardian phone number not available',
      });
    }

    // Send SMS
    const smsResult = await smsService.sendAppointmentReminder({
      phoneNumber: appointment.guardian_phone,
      guardianName: appointment.guardian_name,
      childName: appointment.child_name,
      vaccineName: appointment.vaccine_name,
      scheduledDate: appointment.scheduled_date,
      location: 'Health Center',
    });

    if (smsResult.success) {
      logger.info(`Appointment reminder SMS sent for appointment ${appointmentId}`);
      return res.status(200).json({
        success: true,
        message: 'Reminder SMS sent successfully',
        messageId: smsResult.messageId,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: smsResult.error,
      });
    }
  } catch (error) {
    logger.error('Error sending appointment reminder SMS:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send reminder SMS',
    });
  }
};

/**
 * Send vaccination due reminder SMS
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendVaccinationDueReminder = async (req, res) => {
  try {
    const { guardianId, infantId, vaccineId } = req.body;

    // Get details
    const query = `
      SELECT
        COALESCE(NULLIF(TRIM(g.name), ''), NULLIF(TRIM(CONCAT_WS(' ', g.first_name, g.last_name)), ''), 'Guardian') as guardian_name,
        COALESCE(NULLIF(TRIM(g.phone), ''), NULLIF(TRIM(g.alternate_phone), ''), NULLIF(TRIM(g.emergency_phone), '')) as guardian_phone,
        p.first_name as child_name,
        v.name as vaccine_name,
        NULL::int as dose_number
      FROM guardians g
      JOIN patients p ON p.guardian_id = g.id
      CROSS JOIN vaccines v
      WHERE g.id = $1 AND p.id = $2 AND v.id = $3
    `;

    const result = await pool.query(query, [guardianId, infantId, vaccineId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Records not found',
      });
    }

    const data = result.rows[0];

    if (!data.guardian_phone) {
      return res.status(400).json({
        success: false,
        error: 'Guardian phone number not available',
      });
    }

    // Calculate due date (typically today + reminder days)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7); // Due in 7 days

    // Send SMS
    const smsResult = await smsService.sendVaccinationReminder({
      phoneNumber: data.guardian_phone,
      guardianName: data.guardian_name,
      childName: data.child_name,
      vaccineName: data.dose_number
        ? `${data.vaccine_name} (Dose ${data.dose_number})`
        : data.vaccine_name,
      dueDate: dueDate,
    });

    if (smsResult.success) {
      logger.info(`Vaccination due reminder SMS sent to guardian ${guardianId}`);
      return res.status(200).json({
        success: true,
        message: 'Vaccination reminder SMS sent successfully',
        messageId: smsResult.messageId,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: smsResult.error,
      });
    }
  } catch (error) {
    logger.error('Error sending vaccination due reminder SMS:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send vaccination reminder SMS',
    });
  }
};

/**
 * Bulk send appointment reminders for upcoming appointments
 * This can be called by a scheduled job
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const bulkSendAppointmentReminders = async (req, res) => {
  try {
    // Find appointments in next 24 hours that haven't had reminders sent
    const query = `
      SELECT
        a.id,
        a.scheduled_date,
        a.reminder_sent_24h as reminder_sent,
        COALESCE(NULLIF(TRIM(g.name), ''), NULLIF(TRIM(CONCAT_WS(' ', g.first_name, g.last_name)), ''), 'Guardian') as guardian_name,
        COALESCE(NULLIF(TRIM(g.phone), ''), NULLIF(TRIM(g.alternate_phone), ''), NULLIF(TRIM(g.emergency_phone), '')) as guardian_phone,
        p.first_name as child_name,
        COALESCE(a.type, 'Vaccination Appointment') as vaccine_name
      FROM appointments a
      JOIN patients p ON a.infant_id = p.id
      JOIN guardians g ON COALESCE(a.guardian_id, p.guardian_id) = g.id
      WHERE a.scheduled_date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
        AND LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled')
        AND COALESCE(a.reminder_sent_24h, false) = false
        AND COALESCE(NULLIF(TRIM(g.phone), ''), NULLIF(TRIM(g.alternate_phone), ''), NULLIF(TRIM(g.emergency_phone), '')) IS NOT NULL
    `;

    const result = await pool.query(query);
    const appointments = result.rows;

    const results = {
      total: appointments.length,
      sent: 0,
      failed: 0,
      errors: [],
    };

    for (const appointment of appointments) {
      try {
        const smsResult = await smsService.sendAppointmentReminder({
          phoneNumber: appointment.guardian_phone,
          guardianName: appointment.guardian_name,
          childName: appointment.child_name,
          vaccineName: appointment.vaccine_name,
          scheduledDate: appointment.scheduled_date,
          location: 'Health Center',
        });

        if (smsResult.success) {
          // Mark reminder as sent
          await pool.query(
            'UPDATE appointments SET reminder_sent_24h = true WHERE id = $1',
            [appointment.id],
          );
          results.sent++;
        } else {
          results.failed++;
          results.errors.push({
            appointmentId: appointment.id,
            error: smsResult.error,
          });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          appointmentId: appointment.id,
          error: error.message,
        });
      }
    }

    logger.info(`Bulk appointment reminders: ${results.sent} sent, ${results.failed} failed`);

    return res.status(200).json({
      success: true,
      message: `Processed ${results.total} appointments`,
      results,
    });
  } catch (error) {
    logger.error('Error in bulk appointment reminders:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process bulk reminders',
    });
  }
};

/**
 * Get SMS configuration status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getSMSConfigStatus = async (req, res) => {
  try {
    const status = smsService.getSMSConfigStatus();

    return res.status(200).json({
      success: true,
      status,
      environment: process.env.NODE_ENV,
      gateway: process.env.SMS_GATEWAY || 'log',
    });
  } catch (error) {
    logger.error('Error getting SMS config status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get SMS configuration',
    });
  }
};

module.exports = {
  sendPhoneVerificationOTP,
  sendPasswordResetOTP,
  verifyOTP,
  sendAppointmentConfirmation,
  sendAppointmentReminder,
  sendVaccinationDueReminder,
  bulkSendAppointmentReminders,
  getSMSConfigStatus,
};
