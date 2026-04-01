/**
 * SMS Notification Routes
 * Handles all SMS-related endpoints for appointments, OTP, and vaccination reminders
 *
 * @module routes/smsNotifications
 * @version 2.0
 * @since 2026-03-01
 */

const express = require('express');
const router = express.Router();
const smsNotificationController = require('../controllers/smsNotificationController');
const { authenticateToken, requireRole } = require('../middleware/auth');

/**
 * @route POST /api/sms/otp/phone-verification
 * @description Send OTP for phone number verification
 * @access Public (with rate limiting)
 */
router.post(
  '/otp/phone-verification',
  smsNotificationController.sendPhoneVerificationOTP,
);

/**
 * @route POST /api/sms/otp/password-reset
 * @description Send OTP for password reset
 * @access Public (with rate limiting)
 */
router.post(
  '/otp/password-reset',
  smsNotificationController.sendPasswordResetOTP,
);

/**
 * @route POST /api/sms/otp/verify
 * @description Verify OTP code
 * @access Public
 */
router.post(
  '/otp/verify',
  smsNotificationController.verifyOTP,
);

/**
 * @route POST /api/sms/appointments/confirmation
 * @description Send appointment confirmation SMS
 * @access Private (Admin, Nurse, Staff)
 */
router.post(
  '/appointments/confirmation',
  authenticateToken,
  requireRole(['admin', 'nurse', 'staff']),
  smsNotificationController.sendAppointmentConfirmation,
);

/**
 * @route POST /api/sms/appointments/reminder
 * @description Send appointment reminder SMS
 * @access Private (Admin, Nurse, Staff)
 */
router.post(
  '/appointments/reminder',
  authenticateToken,
  requireRole(['admin', 'nurse', 'staff']),
  smsNotificationController.sendAppointmentReminder,
);

/**
 * @route POST /api/sms/appointments/bulk-reminders
 * @description Send bulk appointment reminders for upcoming appointments
 * @access Private (Admin only)
 */
router.post(
  '/appointments/bulk-reminders',
  authenticateToken,
  requireRole(['admin']),
  smsNotificationController.bulkSendAppointmentReminders,
);

/**
 * @route POST /api/sms/vaccinations/due-reminder
 * @description Send vaccination due reminder SMS
 * @access Private (Admin, Nurse, Staff)
 */
router.post(
  '/vaccinations/due-reminder',
  authenticateToken,
  requireRole(['admin', 'nurse', 'staff']),
  smsNotificationController.sendVaccinationDueReminder,
);

/**
 * @route GET /api/sms/config-status
 * @description Get SMS configuration status
 * @access Private (Admin only)
 */
router.get(
  '/config-status',
  authenticateToken,
  requireRole(['admin']),
  smsNotificationController.getSMSConfigStatus,
);

module.exports = router;
