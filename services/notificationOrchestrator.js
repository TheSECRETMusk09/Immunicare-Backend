const pool = require('../db');
const logger = require('../config/logger');
const crypto = require('crypto');
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

// Deduplication window in milliseconds (24 hours by default)
const parsedDedupeWindowMs = parseInt(process.env.NOTIFICATION_DEDUPE_WINDOW_MS || '86400000', 10);
const DEDUPE_WINDOW_MS =
  Number.isFinite(parsedDedupeWindowMs) && parsedDedupeWindowMs > 0
    ? parsedDedupeWindowMs
    : 86400000;
const DEDUPE_WINDOW_MINUTES = Math.max(1, Math.floor(DEDUPE_WINDOW_MS / 60000));

const toKeyPart = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
};

const toEpochMs = (value) => {
  const parsed = new Date(value || Date.now());
  const epochMs = parsed.getTime();
  return Number.isFinite(epochMs) ? epochMs : Date.now();
};

const getDedupeWindowBucket = (occurredAt) => Math.floor(toEpochMs(occurredAt) / DEDUPE_WINDOW_MS);

// Generate deterministic idempotency key from event properties
const generateIdempotencyKey = (eventType, recipient, payload, occurredAt) => {
  const recipientIdentifier = toKeyPart(
    recipient.targetId ||
      recipient.guardianId ||
      recipient.userId ||
      recipient.adminId ||
      recipient.email ||
      recipient.phone ||
      recipient.name,
  );

  const eventSpecificComponentsByType = {
    [EVENT_TYPES.FORGOT_PASSWORD_OTP]: [payload.otpCode, payload.expiresAt],
    [EVENT_TYPES.ACCOUNT_VERIFICATION]: [payload.otpCode, payload.expiresAt],
    [EVENT_TYPES.APPOINTMENT_CONFIRMATION]: [
      payload.childName,
      payload.vaccineName,
      payload.appointmentAt,
      payload.appointmentStatus,
    ],
    [EVENT_TYPES.APPOINTMENT_REMINDER]: [
      payload.childName,
      payload.vaccineName,
      payload.appointmentAt,
      payload.appointmentStatus,
    ],
    [EVENT_TYPES.MISSED_APPOINTMENT]: [
      payload.childName,
      payload.vaccineName,
      payload.appointmentAt,
      payload.appointmentStatus,
    ],
    [EVENT_TYPES.VACCINE_NON_AVAILABILITY]: [
      payload.childName,
      payload.vaccineName,
      payload.scheduledAt,
    ],
    [EVENT_TYPES.GUARDIAN_ACCOUNT_CREATED]: [payload.guardianName, payload.status],
    [EVENT_TYPES.CHILD_REGISTRATION_SUCCESS]: [payload.childName, payload.status],
    [EVENT_TYPES.ADMIN_ANNOUNCEMENT]: [
      payload.announcementTitle,
      payload.announcementBody,
      payload.status,
    ],
  };

  const eventSpecificComponents = eventSpecificComponentsByType[eventType] || [];
  const keyComponents = [
    toKeyPart(eventType),
    toKeyPart(recipient.targetType),
    recipientIdentifier,
    `window:${getDedupeWindowBucket(occurredAt)}`,
    ...eventSpecificComponents.map(toKeyPart),
  ].filter(Boolean);

  const keyString = keyComponents.length > 0 ? keyComponents.join(':') : 'notification:event:unknown';
  return crypto.createHash('sha256').update(keyString).digest('hex');
};

// Check if notification has already been processed with same idempotency key
const checkIdempotentAlreadyProcessed = async (idempotencyKey) => {
  const result = await pool.query(`
    SELECT
      id,
      status,
      created_at,
      CASE
        WHEN created_at >= NOW() - ($2::int * INTERVAL '1 minute') THEN TRUE
        ELSE FALSE
      END AS within_dedupe_window
    FROM notifications
    WHERE idempotency_key = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [idempotencyKey, DEDUPE_WINDOW_MINUTES]);

  if (result.rows.length > 0) {
    const withinDedupeWindow = Boolean(result.rows[0].within_dedupe_window);
    logger.info('Idempotent notification already processed', {
      idempotencyKey,
      notificationId: result.rows[0].id,
      status: result.rows[0].status,
      withinDedupeWindow,
    });

    if (!withinDedupeWindow) {
      return {
        processed: false,
        notificationId: result.rows[0].id,
        status: result.rows[0].status,
        withinDedupeWindow,
      };
    }

    return {
      processed: true,
      notificationId: result.rows[0].id,
      status: result.rows[0].status,
      withinDedupeWindow,
    };
  }

  return { processed: false };
};

// Check if notification log exists with same dedupe key (for per-channel dedupe)
const checkLogDeduplication = async (dedupeKey) => {
  const result = await pool.query(`
    SELECT
      id,
      status,
      created_at,
      CASE
        WHEN created_at >= NOW() - ($2::int * INTERVAL '1 minute') THEN TRUE
        ELSE FALSE
      END AS within_dedupe_window
    FROM notification_logs
    WHERE dedupe_key = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [dedupeKey, DEDUPE_WINDOW_MINUTES]);

  if (result.rows.length === 0) {
    return false;
  }

  logger.info('Notification deduplication hit', {
    dedupeKey,
    status: result.rows[0].status,
    withinDedupeWindow: Boolean(result.rows[0].within_dedupe_window),
  });

  return Boolean(result.rows[0].within_dedupe_window);
};

// Acquire advisory lock using idempotency key (SHA-256 hash to fit PostgreSQL hash size limit)
const acquireAdvisoryLock = async (idempotencyKey) => {
  const result = await pool.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [idempotencyKey]);
  const lockAcquired = Boolean(result.rows[0].locked);

  if (!lockAcquired) {
    logger.warn('Failed to acquire advisory lock for notification orchestration', {
      idempotencyKey,
    });
  }

  return {
    lockAcquired,
    lockKey: idempotencyKey,
  };
};

// Release advisory lock
const releaseAdvisoryLock = async (lockKey) => {
  try {
    await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
  } catch (unlockError) {
    logger.warn('Failed to release advisory lock', {
      lockKey,
      error: unlockError.message,
    });
  }
};

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
  idempotencyKey,
  dedupeKey,
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
          failed_at,
          idempotency_key,
          dedupe_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
          CASE WHEN $7 = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END,
          CASE WHEN $7 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END,
          $11, $12
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
        sanitizeRecordValue(idempotencyKey),
        sanitizeRecordValue(dedupeKey),
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
    event_type: eventType,
    target_type: recipient.targetType || 'guardian',
    target_id: recipient.targetId || recipient.guardianId || recipient.userId,
    recipient_name: recipient.name,
    recipient_email: recipient.email,
    recipient_phone: recipient.phone,
    channel: 'email',
    priority: 'normal',
    status: 'pending',
    trace_id: normalizedEvent.traceId,
    idempotency_key: normalizedEvent.idempotencyKey,
    channel_status: statusPayload,
    callback_status: {},
    subject: subjectMessage.subject,
    message: subjectMessage.message,
    created_by: normalizedEvent.actorAdminId || normalizedEvent.actorUserId || null,
    guardian_id: recipient.guardianId,
    recipient_guardian_id: recipient.guardianId || null,
    recipient_user_id: recipient.userId || null,
    recipient_admin_id: recipient.adminId || null,
    orchestration_version: 'v1',
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
    skipImmediateProcessing: true,
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

  // Generate idempotency key if not provided (deterministic from event properties)
  if (!normalizedEvent.idempotencyKey) {
    normalizedEvent.idempotencyKey = generateIdempotencyKey(
      normalizedEvent.eventType,
      normalizedEvent.recipient,
      normalizedEvent.payload,
      normalizedEvent.occurredAt,
    );
  }

  // Generate traceId if not provided
  if (!normalizedEvent.traceId) {
    normalizedEvent.traceId = `${normalizedEvent.eventType}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  // Acquire advisory lock to prevent race conditions
  const { lockAcquired, lockKey } = await acquireAdvisoryLock(normalizedEvent.idempotencyKey);
  if (!lockAcquired) {
    return {
      success: false,
      idempotent: true,
      idempotencyKey: normalizedEvent.idempotencyKey,
      traceId: normalizedEvent.traceId,
      reason: 'duplicate_in_progress',
      message: 'Notification orchestration already in progress for this idempotency key',
    };
  }

  let lockReleased = false;
  try {
    // Check for idempotent duplicate within dedupe window
    const idempotentCheck = await checkIdempotentAlreadyProcessed(normalizedEvent.idempotencyKey);
    if (idempotentCheck.processed) {
      return {
        success: true,
        idempotent: true,
        idempotencyKey: normalizedEvent.idempotencyKey,
        traceId: normalizedEvent.traceId,
        previousNotificationId: idempotentCheck.notificationId,
        previousStatus: idempotentCheck.status,
        withinDedupeWindow: idempotentCheck.withinDedupeWindow,
        message: idempotentCheck.withinDedupeWindow
          ? 'Notification already processed within dedupe window'
          : 'Notification already processed',
      };
    }

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
    // Check per-channel dedupe for SMS
      const smsDedupeKey = `sms:${normalizedEvent.idempotencyKey}`;
      const smsAlreadySent = await checkLogDeduplication(smsDedupeKey);

      if (!smsAlreadySent) {
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
            idempotencyKey: normalizedEvent.idempotencyKey,
            dedupeKey: smsDedupeKey,
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
            idempotencyKey: normalizedEvent.idempotencyKey,
            dedupeKey: smsDedupeKey,
          });
        }
      } else {
        channelStatus.sms = {
          status: 'skipped',
          provider: null,
          external_message_id: null,
          error: 'skipped due to deduplication',
        };
      }
    }

    if (allowedChannels.includes(CHANNELS.EMAIL)) {
    // Check per-channel dedupe for Email
      const emailDedupeKey = `email:${normalizedEvent.idempotencyKey}`;
      const emailAlreadySent = await checkLogDeduplication(emailDedupeKey);

      if (!emailAlreadySent) {
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
            idempotencyKey: normalizedEvent.idempotencyKey,
            dedupeKey: emailDedupeKey,
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
            idempotencyKey: normalizedEvent.idempotencyKey,
            dedupeKey: emailDedupeKey,
          });
        }
      } else {
        channelStatus.email = {
          status: 'skipped',
          provider: null,
          external_message_id: null,
          error: 'skipped due to deduplication',
        };
      }
    }

    let inAppNotification = null;
    if (allowedChannels.includes(CHANNELS.IN_APP)) {
    // Check per-channel dedupe for In-App notification
      const inAppDedupeKey = `inapp:${normalizedEvent.idempotencyKey}`;
      const inAppAlreadySent = await checkLogDeduplication(inAppDedupeKey);

      if (!inAppAlreadySent) {
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
          idempotencyKey: normalizedEvent.idempotencyKey,
          dedupeKey: inAppDedupeKey,
        });
      } else {
        channelStatus.in_app = {
          status: 'skipped',
          provider: null,
          external_message_id: null,
          error: 'skipped due to deduplication',
        };
      }
    }

    return {
      success: true,
      idempotent: false,
      eventType: normalizedEvent.eventType,
      traceId: normalizedEvent.traceId,
      idempotencyKey: normalizedEvent.idempotencyKey,
      allowedChannels,
      channelStatus,
      inAppNotificationId: inAppNotification?.id || null,
    };
  } finally {
    // Always release the advisory lock
    if (!lockReleased) {
      await releaseAdvisoryLock(lockKey);
      lockReleased = true;
    }
  }
};

module.exports = {
  orchestrateNotificationEvent,
};
