/**
 * Appointment confirmation workflow (SMS + replies).
 */

const pool = require('../db');
const smsService = require('./smsService');
const logger = require('../config/logger');
const socketService = require('./socketService');

const isPoolUnavailableError = (error) =>
  (typeof pool.isPoolEndedError === 'function' && pool.isPoolEndedError(error)) ||
  String(error?.message || '')
    .toLowerCase()
    .includes('cannot use a pool after calling end on the pool');

const isDatabaseAvailable = (context) => {
  if (typeof pool.warnIfPoolUnavailable === 'function') {
    return !pool.warnIfPoolUnavailable(`appointmentConfirmation.${context}`);
  }

  if (pool.ended) {
    logger.warn('Skipping appointment notification database operation because pool is closed', {
      context,
    });
    return false;
  }

  return true;
};

class AppointmentConfirmationService {
  formatScheduledDateParts(scheduledDate) {
    const scheduledDateObj = new Date(scheduledDate);

    return {
      scheduledDateObj,
      dateStr: scheduledDateObj.toLocaleDateString('en-PH', {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      shortDateStr: scheduledDateObj.toLocaleDateString('en-PH', {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      timeStr: scheduledDateObj.toLocaleTimeString('en-PH', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  }

  /**
   * Send appointment confirmation SMS when appointment is created
   */
  async sendConfirmationSMS(appointmentId) {
    try {
      logger.info(`Sending confirmation SMS for appointment ${appointmentId}`);

      // Get appointment details with infant and guardian info
      const query = `
                SELECT
                    a.id as appointment_id,
                    a.scheduled_date,
                    a.type,
                    a.status,
                    a.infant_id,
                    p.first_name as infant_first_name,
                    p.last_name as infant_last_name,
                    COALESCE(p.control_number, 'N/A') as control_number,
                    g.id as guardian_id,
                    g.name as guardian_name,
                    g.phone as guardian_phone,
                    c.name as clinic_name,
                    c.address as clinic_address
                FROM appointments a
                JOIN patients p ON a.infant_id = p.id
                JOIN guardians g ON p.guardian_id = g.id
                JOIN clinics c ON a.clinic_id = c.id
                WHERE a.id = $1
            `;

      const result = await pool.query(query, [appointmentId]);

      if (result.rows.length === 0) {
        logger.warn(`Appointment ${appointmentId} not found`);
        return { success: false, message: 'Appointment not found' };
      }

      const appointment = result.rows[0];

      // Format the date and time
      const { dateStr, timeStr, shortDateStr } = this.formatScheduledDateParts(
        appointment.scheduled_date
      );

      // Format phone number
      const formattedPhone = smsService.formatPhoneNumber(appointment.guardian_phone);

      if (!formattedPhone) {
        logger.warn('Invalid guardian phone number');
        return { success: false, message: 'Invalid phone number' };
      }

      // Format appointment type for display
      const appointmentType = appointment.type || 'Vaccination Visit';
      const appointmentTypeDisplay =
        appointmentType.charAt(0).toUpperCase() + appointmentType.slice(1).toLowerCase();

      // Create confirmation message with requirements
      const message =
        `Immunicare: Hi ${appointment.guardian_name}, ` +
        `Your child's ${appointmentTypeDisplay} appointment is confirmed.\n\n` +
        `Child: ${appointment.infant_first_name} ${appointment.infant_last_name} (ID: ${appointment.control_number})\n` +
        `Date: ${dateStr}\n` +
        `Time: ${timeStr}\n` +
        `Type: ${appointmentTypeDisplay}\n\n` +
        'REQUIREMENTS:\n' +
        '- Vaccination Card\n' +
        '- Birth Certificate (original copy)\n' +
        '- Parent/Guardian ID\n\n' +
        'Please arrive 15 minutes early. Reply CONFIRM to confirm or CANCEL to cancel.';

      // Send SMS
      const smsResult = await smsService.sendSMS(
        formattedPhone,
        message,
        'appointment_confirmation',
        { appointmentId: appointmentId }
      );

      // Log the confirmation
      await pool.query(
        `
                INSERT INTO appointment_confirmations (
                    appointment_id, guardian_id, message, status, created_at
                ) VALUES ($1, $2, $3, 'sent', CURRENT_TIMESTAMP)
            `,
        [appointmentId, appointment.guardian_id, message]
      );

      // Update appointment with confirmation sent status
      await pool.query(
        `
                UPDATE appointments
                SET sms_confirmation_sent = true,
                    sms_confirmation_sent_at = CURRENT_TIMESTAMP,
                    confirmation_status = 'pending'
                WHERE id = $1
            `,
        [appointmentId]
      );

      logger.info(`Confirmation SMS sent to ${formattedPhone} for appointment ${appointmentId}`);

      // Create in-app notification for the guardian
      await this.createGuardianNotification({
        guardianId: appointment.guardian_id,
        guardianName: appointment.guardian_name,
        infantName: `${appointment.infant_first_name} ${appointment.infant_last_name}`,
        appointmentId: appointmentId,
        scheduledDate: appointment.scheduled_date,
        clinicName: appointment.clinic_name,
        appointmentType: appointmentTypeDisplay,
        notificationType: 'sms_confirmation_sent',
        category: 'confirmation',
        title: 'Appointment Confirmation SMS Sent',
        message: `Confirmation SMS has been sent to ${appointment.guardian_name} for ${appointment.infant_first_name} ${appointment.infant_last_name}'s ${appointmentTypeDisplay} appointment on ${shortDateStr} at ${timeStr} at ${appointment.clinic_name}.`,
      });

      return { success: true, message: 'Confirmation SMS sent', data: smsResult };
    } catch (error) {
      logger.error('Error sending confirmation SMS:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Send appointment reminder SMS
   */
  async sendReminderSMS(appointmentId, reminderType = '24h') {
    try {
      logger.info(`Sending reminder SMS for appointment ${appointmentId}`);

      const query = `
                SELECT
                    a.id as appointment_id,
                    a.scheduled_date,
                    a.type,
                    p.first_name as infant_first_name,
                    p.last_name as infant_last_name,
                    g.id as guardian_id,
                    g.name as guardian_name,
                    g.phone as guardian_phone,
                    c.name as clinic_name
                FROM appointments a
                JOIN patients p ON a.infant_id = p.id
                JOIN guardians g ON p.guardian_id = g.id
                JOIN clinics c ON a.clinic_id = c.id
                WHERE a.id = $1
            `;

      const result = await pool.query(query, [appointmentId]);

      if (result.rows.length === 0) {
        return { success: false, message: 'Appointment not found' };
      }

      const appointment = result.rows[0];
      const formattedPhone = smsService.formatPhoneNumber(appointment.guardian_phone);

      if (!formattedPhone) {
        return { success: false, message: 'Invalid phone number' };
      }

      const scheduledDate = new Date(appointment.scheduled_date);
      const dateStr = scheduledDate.toLocaleDateString('en-PH', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
      const timeStr = scheduledDate.toLocaleTimeString('en-PH', {
        hour: '2-digit',
        minute: '2-digit',
      });

      let message;
      if (reminderType === '24h') {
        message = `Reminder: ${appointment.infant_first_name}'s vaccination appointment is tomorrow (${dateStr}) at ${timeStr} at ${appointment.clinic_name}. Reply CONFIRM to confirm attendance.`;
      } else if (reminderType === '2h') {
        message = `Reminder: ${appointment.infant_first_name}'s appointment is in 2 hours at ${timeStr}. Please arrive 15 minutes early.`;
      } else {
        message = `Appointment reminder for ${appointment.infant_first_name} on ${dateStr} at ${timeStr} at ${appointment.clinic_name}.`;
      }

      const smsResult = await smsService.sendSMS(formattedPhone, message, 'appointment_reminder', {
        appointmentId: appointmentId,
        reminderType: reminderType,
      });

      await this.createGuardianNotification({
        guardianId: appointment.guardian_id,
        guardianName: appointment.guardian_name,
        infantName: `${appointment.infant_first_name} ${appointment.infant_last_name}`,
        appointmentId,
        scheduledDate: appointment.scheduled_date,
        clinicName: appointment.clinic_name,
        appointmentType: appointment.type || 'Vaccination',
        notificationType: 'appointment_reminder',
        category: 'reminder',
        title: reminderType === '24h' ? 'Appointment Reminder: Tomorrow' : 'Appointment Reminder',
        message,
        priority: 'high',
      });

      return { success: true, message: 'Reminder SMS sent', data: smsResult };
    } catch (error) {
      logger.error('Error sending reminder SMS:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Handle incoming SMS response (CONFIRM/CANCEL)
   */
  async handleIncomingSMS(phoneNumber, message) {
    try {
      logger.info(`Processing incoming SMS from ${phoneNumber}: ${message}`);

      // Normalize message
      const normalizedMessage = message.trim().toUpperCase();

      // Log incoming SMS
      const incomingQuery = `
                INSERT INTO incoming_sms (phone_number, message, keyword, created_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                RETURNING id
            `;

      const keyword = normalizedMessage.split(' ')[0];
      const incomingResult = await pool.query(incomingQuery, [phoneNumber, message, keyword]);
      const incomingId = incomingResult.rows[0].id;

      // Find related appointment
      let appointmentQuery;
      let appointmentParams;

      if (keyword === 'CONFIRM') {
        // Find most recent pending appointment for this phone number
        appointmentQuery = `
                    SELECT a.id, a.infant_id
                    FROM appointments a
                    JOIN guardians g ON a.guardian_id = g.id
                    WHERE g.phone = $1
                    AND a.confirmation_status = 'pending'
                    AND a.scheduled_date > CURRENT_TIMESTAMP
                    ORDER BY a.scheduled_date ASC
                    LIMIT 1
                `;
        appointmentParams = [phoneNumber];
      } else if (keyword === 'CANCEL') {
        appointmentQuery = `
                    SELECT a.id, a.infant_id
                    FROM appointments a
                    JOIN guardians g ON a.guardian_id = g.id
                    WHERE g.phone = $1
                    AND a.status = 'scheduled'
                    AND a.scheduled_date > CURRENT_TIMESTAMP
                    ORDER BY a.scheduled_date ASC
                    LIMIT 1
                `;
        appointmentParams = [phoneNumber];
      } else {
        // Unknown keyword - send help message
        await this.sendHelpMessage(phoneNumber);

        await pool.query(
          'UPDATE incoming_sms SET processed = true, processed_at = CURRENT_TIMESTAMP WHERE id = $1',
          [incomingId]
        );
        return { success: false, message: 'Unknown keyword' };
      }

      const appointmentResult = await pool.query(appointmentQuery, appointmentParams);

      if (appointmentResult.rows.length === 0) {
        await this.sendNoAppointmentMessage(phoneNumber);

        await pool.query(
          'UPDATE incoming_sms SET processed = true, processed_at = CURRENT_TIMESTAMP WHERE id = $1',
          [incomingId]
        );
        return { success: false, message: 'No pending appointment found' };
      }

      const appointment = appointmentResult.rows[0];

      // Process the response
      if (keyword === 'CONFIRM') {
        await this.confirmAppointment(appointment.id);
      } else if (keyword === 'CANCEL') {
        await this.cancelAppointment(appointment.id);
      }

      // Mark incoming SMS as processed
      await pool.query(
        `
                UPDATE incoming_sms
                SET processed = true,
                    processed_at = CURRENT_TIMESTAMP,
                    related_appointment_id = $2
                WHERE id = $1
            `,
        [incomingId, appointment.id]
      );

      return {
        success: true,
        message: `Appointment ${keyword === 'CONFIRM' ? 'confirmed' : 'cancelled'}`,
        appointmentId: appointment.id,
      };
    } catch (error) {
      logger.error('Error handling incoming SMS:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Confirm an appointment
   */
  async confirmAppointment(appointmentId) {
    await pool.query(
      `
            UPDATE appointments
            SET confirmation_status = 'confirmed',
                confirmed_at = CURRENT_TIMESTAMP,
                confirmation_method = 'sms',
                status = 'attended'
            WHERE id = $1
        `,
      [appointmentId]
    );

    logger.info(`Appointment ${appointmentId} confirmed via SMS`);

    // Send confirmation reply
    const query = `
            SELECT p.first_name, g.phone
            FROM appointments a
            JOIN patients p ON a.infant_id = p.id
            JOIN guardians g ON p.guardian_id = g.id
            WHERE a.id = $1
        `;

    const result = await pool.query(query, [appointmentId]);

    if (result.rows.length > 0) {
      const infant = result.rows[0];
      const formattedPhone = smsService.formatPhoneNumber(infant.phone);

      if (formattedPhone) {
        const message = `Immunicare: Thank you! ${infant.first_name}'s appointment has been confirmed. We look forward to seeing you!`;
        await smsService.sendSMS(formattedPhone, message, 'confirmation_reply');
      }
    }
  }

  /**
   * Cancel an appointment
   */
  async cancelAppointment(appointmentId) {
    await pool.query(
      `
            UPDATE appointments
            SET confirmation_status = 'cancelled',
                confirmed_at = CURRENT_TIMESTAMP,
                confirmation_method = 'sms',
                status = 'cancelled'
            WHERE id = $1
        `,
      [appointmentId]
    );

    logger.info(`Appointment ${appointmentId} cancelled via SMS`);

    // Send cancellation reply
    const query = `
            SELECT p.first_name, g.phone, a.scheduled_date
            FROM appointments a
            JOIN patients p ON a.infant_id = p.id
            JOIN guardians g ON p.guardian_id = g.id
            WHERE a.id = $1
        `;

    const result = await pool.query(query, [appointmentId]);

    if (result.rows.length > 0) {
      const data = result.rows[0];
      const formattedPhone = smsService.formatPhoneNumber(data.phone);

      if (formattedPhone) {
        const dateStr = new Date(data.scheduled_date).toLocaleDateString('en-PH');
        const message = `Immunicare: Your appointment for ${data.first_name} on ${dateStr} has been cancelled. Please reschedule through the portal or contact us.`;
        await smsService.sendSMS(formattedPhone, message, 'cancellation_reply');
      }
    }
  }

  /**
   * Send help message for unknown keywords
   */
  async sendHelpMessage(phoneNumber) {
    const message =
      'Immunicare: Unknown command. Reply CONFIRM to confirm appointment or CANCEL to cancel appointment. For assistance, call the health center.';

    const formattedPhone = smsService.formatPhoneNumber(phoneNumber);
    if (formattedPhone) {
      await smsService.sendSMS(formattedPhone, message, 'help_reply');
    }
  }

  /**
   * Send message when no pending appointment found
   */
  async sendNoAppointmentMessage(phoneNumber) {
    const message =
      "Immunicare: We couldn't find any pending appointments associated with your number. If you need assistance, please contact the health center.";

    const formattedPhone = smsService.formatPhoneNumber(phoneNumber);
    if (formattedPhone) {
      await smsService.sendSMS(formattedPhone, message, 'no_appointment_reply');
    }
  }

  /**
   * Create in-app notification for guardian after successful SMS delivery
   */
  async createGuardianNotification({
    guardianId,
    infantName,
    appointmentId,
    scheduledDate,
    clinicName,
    appointmentType,
    notificationType = 'appointment_confirmation',
    category = 'appointment',
    title = 'Upcoming Appointment Booked',
    message = null,
    priority = 'medium',
    channel = 'in_app',
    sound = false,
  }) {
    try {
      if (!isDatabaseAvailable('createGuardianNotification')) {
        return { success: false, error: 'Database pool unavailable', skipped: true };
      }

      const { shortDateStr, timeStr } = this.formatScheduledDateParts(scheduledDate);
      const resolvedMessage =
        message ||
        `Upcoming appointment booked for ${infantName}: ${appointmentType} on ${shortDateStr} at ${timeStr} at ${clinicName}.`;

      // Insert notification into database
      const notificationResult = await pool.query(
        `INSERT INTO notifications
          (user_id, title, message, type, category, is_read, notification_type, target_type, target_id, channel, priority, status, related_entity_type, related_entity_id, guardian_id, target_role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)
         RETURNING id`,
        [
          guardianId,
          title,
          resolvedMessage,
          'appointment',
          category,
          false,
          notificationType,
          'guardian',
          guardianId,
          channel,
          priority,
          'delivered',
          'appointment',
          appointmentId,
          guardianId,
          'guardian',
        ]
      );

      // Send real-time notification via socket
      const notification = {
        id: notificationResult.rows[0]?.id || `notif-${Date.now()}`,
        title,
        message: resolvedMessage,
        type: 'appointment',
        category,
        isRead: false,
        relatedEntityType: 'appointment',
        relatedEntityId: appointmentId,
        createdAt: new Date().toISOString(),
      };

      socketService.sendToUser(guardianId, 'notification', {
        notification,
        sound,
      });

      logger.info(
        `In-app notification created for guardian ${guardianId} for appointment ${appointmentId}`
      );
      return { success: true, notificationId: notificationResult.rows[0]?.id };
    } catch (error) {
      if (isPoolUnavailableError(error)) {
        logger.warn(
          'Guardian appointment notification skipped because database pool is unavailable',
          {
            guardianId,
            appointmentId,
            message: error.message,
          }
        );
        return { success: false, error: 'Database pool unavailable', skipped: true };
      }

      logger.error('Error creating guardian notification:', error);
      return { success: false, error: error.message };
    }
  }

  async notifyGuardianAppointmentBooked({
    guardianId,
    guardianName,
    infantName,
    appointmentId,
    scheduledDate,
    clinicName,
    appointmentType,
  }) {
    return this.createGuardianNotification({
      guardianId,
      guardianName,
      infantName,
      appointmentId,
      scheduledDate,
      clinicName,
      appointmentType,
      notificationType: 'appointment_confirmation',
      category: 'appointment',
      title: 'Upcoming Appointment Booked',
    });
  }

  /**
   * Process scheduled reminders
   */
  async processScheduledReminders() {
    try {
      logger.info('Processing scheduled appointment reminders...');

      // Get appointments needing 24h reminder
      const reminder24hQuery = `
                SELECT id FROM appointments
                WHERE status = 'scheduled'
                AND confirmation_status = 'confirmed'
                AND scheduled_date BETWEEN CURRENT_TIMESTAMP + INTERVAL '23 hours'
                AND CURRENT_TIMESTAMP + INTERVAL '25 hours'
                AND sms_confirmation_sent = true
            `;

      const reminder24hResult = await pool.query(reminder24hQuery);

      for (const row of reminder24hResult.rows) {
        await this.sendReminderSMS(row.id, '24h');
      }

      // Get appointments needing 2h reminder
      const reminder2hQuery = `
                SELECT id FROM appointments
                WHERE status = 'scheduled'
                AND confirmation_status = 'confirmed'
                AND scheduled_date BETWEEN CURRENT_TIMESTAMP + INTERVAL '1 hour'
                AND CURRENT_TIMESTAMP + INTERVAL '3 hours'
            `;

      const reminder2hResult = await pool.query(reminder2hQuery);

      for (const row of reminder2hResult.rows) {
        await this.sendReminderSMS(row.id, '2h');
      }

      logger.info(
        `Processed ${reminder24hResult.rows.length} 24h reminders and ${reminder2hResult.rows.length} 2h reminders`
      );
    } catch (error) {
      logger.error('Error processing scheduled reminders:', error);
    }
  }
}

// Export singleton instance
module.exports = new AppointmentConfirmationService();
