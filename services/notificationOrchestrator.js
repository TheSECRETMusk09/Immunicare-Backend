const pool = require('../db');
const logger = require('../config/logger');
const NotificationService = require('./notificationService');
const smsService = require('./smsService');
const emailService = require('./emailService');
const {
  CHANNELS,
  EVENT_TYPES,
  EVENT_CHANNEL_POLICY,
  normalizeEventPayload,
  createContractValidationError,
} = require('./notificationContracts');

const notificationService = new NotificationService();

const NOTIFICATION_LOG_STATUS = Object.freeze({
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
});

const toJsonString = (value) => {
  if (value === undefined || value === null) {
    return '{}';
  }
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch (_error) {
      return JSON.stringify({ value });
    }
  }

  try {
    return JSON.stringify(value);
  } catch (_error) {
    return '{}';
  }
};

const sanitizeRecordValue = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return value;
};

const resolveSubjectAndMessage = (eventType, payload = {}) => {
  switch (eventType) {
  case EVENT_TYPES.FORGOT_PASSWORD_OTP:
    return {
      subject: 'Immunicare Password Reset OTP',
      message: `Use OTP ${payload.otpCode} to reset your password. Expires at ${payload.expiresAt}.`,
      inAppTitle: 'Password Reset OTP',
      inAppType: 'security',
      inAppCategory: 'auth',
    };
  case EVENT_TYPES.ACCOUNT_VERIFICATION:
    return {
      subject: 'Immunicare Account Verification OTP',
      message: `Use OTP ${payload.otpCode} to verify your account. Expires at ${payload.expiresAt}.`,
      inAppTitle: 'Account Verification OTP',
      inAppType: 'security',
      inAppCategory: 'auth',
    };
  case EVENT_TYPES.APPOINTMENT_CONFIRMATION:
    return {
      subject: `Appointment Confirmed: ${payload.childName || 'Child'}`,
      message: `${payload.childName || 'Your child'} has a ${payload.vaccineName || 'scheduled'} appointment on ${payload.appointmentAt}.`,
      inAppTitle: 'Appointment Confirmed',
      inAppType: 'info',
      inAppCategory: 'appointments',
    };
  case EVENT_TYPES.APPOINTMENT_REMINDER:
    return {
      subject: `Appointment Reminder: ${payload.childName || 'Child'}`,
      message: `Reminder: ${payload.childName || 'Your child'} is scheduled for ${payload.vaccineName || 'vaccination'} on ${payload.appointmentAt}.`,
      inAppTitle: 'Appointment Reminder',
      inAppType: 'info',
      inAppCategory: 'appointments',
    };
  case EVENT_TYPES.MISSED_APPOINTMENT:
    return {
      subject: `Missed Appointment Alert: ${payload.childName || 'Child'}`,
      message: `${payload.childName || 'Your child'} missed ${payload.vaccineName || 'vaccination'} scheduled on ${payload.appointmentAt}.`,
      inAppTitle: 'Missed Appointment',
      inAppType: 'alert',
      inAppCategory: 'appointments',
    };
  case EVENT_TYPES.VACCINE_NON_AVAILABILITY:
    return {
      subject: `Vaccine Unavailable: ${payload.vaccineName || 'Vaccine'}`,
      message: `${payload.vaccineName || 'Selected vaccine'} is currently unavailable for ${payload.childName || 'your child'} (${payload.scheduledAt}).`,
      inAppTitle: 'Vaccine Unavailable',
      inAppType: 'alert',
      inAppCategory: 'inventory',
    };
  case EVENT_TYPES.GUARDIAN_ACCOUNT_CREATED:
    return {
      subject: 'Guardian Account Created',
      message: `Guardian account creation completed for ${payload.guardianName || 'guardian'}. Status: ${payload.status || 'success'}.`,
      inAppTitle: 'Account Created',
      inAppType: 'info',
      inAppCategory: 'account',
    };
  case EVENT_TYPES.CHILD_REGISTRATION_SUCCESS:
    return {
      subject: 'Child Registration Successful',
      message: `${payload.childName || 'Child'} registration completed. Status: ${payload.status || 'success'}.`,
      inAppTitle: 'Child Registered',
      inAppType: 'info',
      inAppCategory: 'account',
    };
  case EVENT_TYPES.ADMIN_ANNOUNCEMENT:
    return {
      subject: payload.announcementTitle || 'Admin Announcement',
      message: payload.announcementBody || 'You have a new admin announcement.',
      inAppTitle: payload.announcementTitle || 'Admin Announcement',
      inAppType: 'info',
      inAppCategory: 'announcements',
    };
  default:
    return {
      subject: 'Immunicare Notification',
      message: 'You have a new notification.',
      inAppTitle: 'Notification',
      inAppType: 'info',
      inAppCategory: 'general',
    };
  }
};

const toNotificationStatusFromChannel = (channelResult) => {
  if (!channelResult) {
    return 'failed';
  }
  if (channelResult.success) {
    return 'sent';
  }
  return 'failed';
};

const writeNotificationLog = async ({
  recipientType,
  recipientId,
  notificationType,
  channel,
  subject,
  content,
  status,
  externalMessageId,
  metadata,
  errorDetails,
}) => {
  try {
    await pool.query(
      `
        INSERT INTO notification_logs (
          recipient_type,
          recipient_id,
          notification_type,
          channel,
          subject,
          content,
          status,
          external_message_id,
          metadata,
          error_details,
          sent_at,
          failed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
          CASE WHEN $7 = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END,
          CASE WHEN $7 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END
        )
      `,
      [
        recipientType,
        recipientId,
        notificationType,
        channel,
        sanitizeRecordValue(subject),
        content,
        status,
        sanitizeRecordValue(externalMessageId),
        toJsonString(metadata || {}),
        sanitizeRecordValue(errorDetails),
      ],
    );
  } catch (error) {
    logger.warn('Failed to write notification_logs entry', {
      message: error.message,
      notificationType,
      channel,
    });
  }
};

const sendSmsForEvent = async ({ normalizedEvent, subjectMessage }) => {
  const { recipient, eventType, payload } = normalizedEvent;

  if (!recipient.phone) {
    return {
      success: false,
      error: 'Recipient phone is missing',
    };
  }

  const result = await smsService.sendSMS(
    recipient.phone,
    subjectMessage.message,
    eventType,
    {
      eventType,
      traceId: normalizedEvent.traceId,
      idempotencyKey: normalizedEvent.idempotencyKey,
      guardianId: recipient.guardianId,
      payload,
    },
  );

  return {
    success: true,
    provider: result.provider,
    externalMessageId: result.messageId,
    raw: result.raw || null,
  };
};

const sendEmailForEvent = async ({ normalizedEvent, subjectMessage }) => {
  const { recipient, eventType, payload } = normalizedEvent;

  if (!recipient.email) {
    return {
      success: false,
      error: 'Recipient email is missing',
    };
  }

  const emailResult = await emailService.sendEmail({
    to: recipient.email,
    subject: subjectMessage.subject,
    text: subjectMessage.message,
    html: `<p>${subjectMessage.message}</p>`,
  });

  return {
    success: Boolean(emailResult && emailResult.success),
    externalMessageId: emailResult?.messageId || null,
    provider: 'email',
    raw: {
      eventType,
      payload,
      response: emailResult,
    },
    error: emailResult?.success ? null : emailResult?.error || 'Email dispatch failed',
  };
};

const persistInAppNotification = async ({ normalizedEvent, subjectMessage, channelStatus }) => {
  const { recipient, eventType, payload, metadata } = normalizedEvent;

  const statusPayload = {
    channels: channelStatus,
    event_type: eventType,
  };

  const response = await notificationService.sendNotification({
    notification_type: eventType,
    target_type: recipient.targetType || 'guardian',
    target_id: recipient.targetId || recipient.guardianId || recipient.userId,
    recipient_name: recipient.name,
    recipient_email: recipient.email,
    recipient_phone: recipient.phone,
    channel: 'email',
    priority: 'normal',
    status: 'pending',
    subject: subjectMessage.subject,
    message: subjectMessage.message,
    created_by: normalizedEvent.actorAdminId || normalizedEvent.actorUserId || null,
    guardian_id: recipient.guardianId,
    target_role: recipient.targetType,
    title: subjectMessage.inAppTitle,
    type: subjectMessage.inAppType,
    category: subjectMessage.inAppCategory,
    is_read: false,
    metadata: {
      ...metadata,
      notification_contract: {
        event_type: eventType,
        timezone: payload.timezone,
        occurred_at: normalizedEvent.occurredAt,
      },
      delivery_status: statusPayload,
      payload,
    },
    template_data: {
      ...payload,
      timezone: payload.timezone,
    },
  });

  return response?.notification || null;
};

const pickRecipientTypeForLog = (recipient) => {
  if ((recipient.targetType || '').toLowerCase() === 'guardian') {
    return 'guardian';
  }
  if ((recipient.targetType || '').toLowerCase() === 'admin') {
    return 'admin';
  }
  return 'user';
};

const pickRecipientIdForLog = (recipient) => (
  recipient.targetId || recipient.guardianId || recipient.userId || recipient.adminId
);

const orchestrateNotificationEvent = async (rawEvent) => {
  const validationResult = normalizeEventPayload(rawEvent || {});
  if (!validationResult.valid) {
    throw createContractValidationError(validationResult);
  }

  const normalizedEvent = validationResult.normalized;
  const subjectMessage = resolveSubjectAndMessage(normalizedEvent.eventType, normalizedEvent.payload);
  const allowedChannels = validationResult.allowedChannels || EVENT_CHANNEL_POLICY[normalizedEvent.eventType] || [];

  const recipientTypeForLog = pickRecipientTypeForLog(normalizedEvent.recipient);
  const recipientIdForLog = pickRecipientIdForLog(normalizedEvent.recipient);

  if (!recipientIdForLog) {
    const recipientError = new Error('Notification recipient resolution failed: missing recipient identifier');
    recipientError.code = 'NOTIFICATION_RECIPIENT_RESOLUTION_FAILED';
    throw recipientError;
  }

  const channelStatus = {};

  if (allowedChannels.includes(CHANNELS.SMS)) {
    try {
      const smsResult = await sendSmsForEvent({ normalizedEvent, subjectMessage });
      channelStatus.sms = {
        status: toNotificationStatusFromChannel(smsResult),
        provider: smsResult.provider || null,
        external_message_id: smsResult.externalMessageId || null,
        error: smsResult.error || null,
      };

      await writeNotificationLog({
        recipientType: recipientTypeForLog,
        recipientId: recipientIdForLog,
        notificationType: normalizedEvent.eventType,
        channel: CHANNELS.SMS,
        subject: subjectMessage.subject,
        content: subjectMessage.message,
        status: smsResult.success
          ? NOTIFICATION_LOG_STATUS.SENT
          : NOTIFICATION_LOG_STATUS.FAILED,
        externalMessageId: smsResult.externalMessageId,
        metadata: {
          trace_id: normalizedEvent.traceId,
          idempotency_key: normalizedEvent.idempotencyKey,
          raw_response: smsResult.raw,
        },
        errorDetails: smsResult.error,
      });
    } catch (smsError) {
      channelStatus.sms = {
        status: 'failed',
        provider: 'sms',
        external_message_id: null,
        error: smsError.message,
      };

      await writeNotificationLog({
        recipientType: recipientTypeForLog,
        recipientId: recipientIdForLog,
        notificationType: normalizedEvent.eventType,
        channel: CHANNELS.SMS,
        subject: subjectMessage.subject,
        content: subjectMessage.message,
        status: NOTIFICATION_LOG_STATUS.FAILED,
        externalMessageId: null,
        metadata: {
          trace_id: normalizedEvent.traceId,
          idempotency_key: normalizedEvent.idempotencyKey,
        },
        errorDetails: smsError.message,
      });
    }
  }

  if (allowedChannels.includes(CHANNELS.EMAIL)) {
    try {
      const emailResult = await sendEmailForEvent({ normalizedEvent, subjectMessage });
      channelStatus.email = {
        status: toNotificationStatusFromChannel(emailResult),
        provider: emailResult.provider || 'email',
        external_message_id: emailResult.externalMessageId || null,
        error: emailResult.error || null,
      };

      await writeNotificationLog({
        recipientType: recipientTypeForLog,
        recipientId: recipientIdForLog,
        notificationType: normalizedEvent.eventType,
        channel: CHANNELS.EMAIL,
        subject: subjectMessage.subject,
        content: subjectMessage.message,
        status: emailResult.success
          ? NOTIFICATION_LOG_STATUS.SENT
          : NOTIFICATION_LOG_STATUS.FAILED,
        externalMessageId: emailResult.externalMessageId,
        metadata: {
          trace_id: normalizedEvent.traceId,
          idempotency_key: normalizedEvent.idempotencyKey,
          raw_response: emailResult.raw,
        },
        errorDetails: emailResult.error,
      });
    } catch (emailError) {
      channelStatus.email = {
        status: 'failed',
        provider: 'email',
        external_message_id: null,
        error: emailError.message,
      };

      await writeNotificationLog({
        recipientType: recipientTypeForLog,
        recipientId: recipientIdForLog,
        notificationType: normalizedEvent.eventType,
        channel: CHANNELS.EMAIL,
        subject: subjectMessage.subject,
        content: subjectMessage.message,
        status: NOTIFICATION_LOG_STATUS.FAILED,
        externalMessageId: null,
        metadata: {
          trace_id: normalizedEvent.traceId,
          idempotency_key: normalizedEvent.idempotencyKey,
        },
        errorDetails: emailError.message,
      });
    }
  }

  let inAppNotification = null;
  if (allowedChannels.includes(CHANNELS.IN_APP)) {
    inAppNotification = await persistInAppNotification({
      normalizedEvent,
      subjectMessage,
      channelStatus,
    });

    await writeNotificationLog({
      recipientType: recipientTypeForLog,
      recipientId: recipientIdForLog,
      notificationType: normalizedEvent.eventType,
      channel: CHANNELS.IN_APP,
      subject: subjectMessage.subject,
      content: subjectMessage.message,
      status: inAppNotification
        ? NOTIFICATION_LOG_STATUS.SENT
        : NOTIFICATION_LOG_STATUS.FAILED,
      externalMessageId: inAppNotification?.id || null,
      metadata: {
        trace_id: normalizedEvent.traceId,
        idempotency_key: normalizedEvent.idempotencyKey,
        notification_id: inAppNotification?.id || null,
        channel_status: channelStatus,
      },
      errorDetails: inAppNotification ? null : 'Failed to persist in-app notification',
    });
  }

  return {
    success: true,
    eventType: normalizedEvent.eventType,
    traceId: normalizedEvent.traceId,
    idempotencyKey: normalizedEvent.idempotencyKey,
    allowedChannels,
    channelStatus,
    inAppNotificationId: inAppNotification?.id || null,
  };
};

module.exports = {
  orchestrateNotificationEvent,
};
