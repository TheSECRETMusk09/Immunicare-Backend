const axios = require('axios');
const crypto = require('crypto');
const pool = require('../db');
const logger = require('../config/logger');

const SMS_PROVIDER = String(
  process.env.SMS_GATEWAY || process.env.SMS_PROVIDER || 'textbee'
).toLowerCase();

const TEXTBEE_API_KEY = process.env.TEXTBEE_API_KEY || '';
const TEXTBEE_DEVICE_ID = process.env.TEXTBEE_DEVICE_ID || '';
const TEXTBEE_BASE_URL = 'https://api.textbee.dev/api/v1/gateway/devices';

let logSchemaCache = null;
let logSchemaPromise = null;
let verifySchemaPromise = null;

async function ensureVerifySchema() {
  if (verifySchemaPromise) {
    return verifySchemaPromise;
  }

  verifySchemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sms_verification_codes (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(32) NOT NULL,
        code VARCHAR(32) NOT NULL,
        purpose VARCHAR(64) NOT NULL DEFAULT 'verification',
        user_id INTEGER NULL,
        guardian_id INTEGER NULL,
        expires_at TIMESTAMP NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        ip_address TEXT NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        verified_at TIMESTAMP NULL,
        UNIQUE (phone_number, purpose)
      )
    `);

    await pool.query(
      `ALTER TABLE sms_verification_codes ADD COLUMN IF NOT EXISTS purpose VARCHAR(64) NOT NULL DEFAULT 'verification'`
    );
    await pool.query(
      `ALTER TABLE sms_verification_codes ADD COLUMN IF NOT EXISTS user_id INTEGER NULL`
    );
    await pool.query(
      `ALTER TABLE sms_verification_codes ADD COLUMN IF NOT EXISTS guardian_id INTEGER NULL`
    );
    await pool.query(
      `ALTER TABLE sms_verification_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL`
    );
    await pool.query(
      `ALTER TABLE sms_verification_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`
    );
    await pool.query(
      `ALTER TABLE sms_verification_codes ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3`
    );
    await pool.query(
      `ALTER TABLE sms_verification_codes ADD COLUMN IF NOT EXISTS ip_address TEXT NULL`
    );
    await pool.query(
      `ALTER TABLE sms_verification_codes ADD COLUMN IF NOT EXISTS user_agent TEXT NULL`
    );
    await pool.query(
      `ALTER TABLE sms_verification_codes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP NULL`
    );

    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_sms_verification_codes_phone ON sms_verification_codes (phone_number)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_sms_verification_codes_expires ON sms_verification_codes (expires_at)`
    );
  })().catch((error) => {
    verifySchemaPromise = null;
    throw error;
  });

  return verifySchemaPromise;
}

const SMS_CONFIG = {
  provider: SMS_PROVIDER,
  senderName: process.env.TEXTBEE_SENDER_NAME || 'Immunicare',
  otp: {
    length: parseInt(process.env.OTP_LENGTH || '6', 10),
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '3', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN || '60', 10),
  },
  rateLimit: {
    maxPerHour: parseInt(process.env.SMS_MAX_PER_HOUR || '20', 10),
    maxPerDay: parseInt(process.env.SMS_MAX_PER_DAY || '100', 10),
  },
};

const PURPOSE_MAP = {
  verification: 'phone_verification',
  phone_verification: 'phone_verification',
  account_verification: 'phone_verification',
  password_reset: 'password_reset',
  login: 'login',
};

const OTP_MESSAGES = {
  phone_verification:
    'Immunicare: Your phone verification code is {code}. It expires in {minutes} minutes. Do not share this code.',
  password_reset:
    'Immunicare: Your password reset code is {code}. It expires in {minutes} minutes. Do not share this code.',
  login:
    'Immunicare: Your login verification code is {code}. It expires in {minutes} minutes. Do not share this code.',
};

const APPT_MESSAGES = {
  nextAppointment:
    "Immunicare Reminder: {baby_name}'s vaccination appointment is scheduled on {scheduledDate} at {location}. Please arrive 15 minutes early.",
  nextAppointment24h:
    "Immunicare: Hi {guardian_name}, this is a reminder that {baby_name}'s vaccination appointment is TOMORROW ({scheduledDate}) at {time}. Location: {location}. Please arrive 15 minutes early.",
  nextAppointment48h:
    "Immunicare: Hi {guardian_name}, this is a reminder that {baby_name}'s vaccination appointment is in 2 days ({scheduledDate}) at {time}. Location: {location}. Please arrive 15 minutes early.",
  missedAppointment:
    "Immunicare Alert: {baby_name}'s vaccination appointment on {scheduledDate} was missed. Please contact the health center at your earliest convenience to reschedule. Location: {location}.",
  scheduleDateChanged:
    "Immunicare Alert: {baby_name}'s vaccination appointment has been rescheduled to {newDate} at {time}. Location: {location}. Please take note of the new schedule.",
};

function normalizePurpose(purpose) {
  return (
    PURPOSE_MAP[String(purpose || '').toLowerCase()] ||
    String(purpose || 'verification').toLowerCase()
  );
}

function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

function formatPhoneNumber(phoneNumber) {
  const digits = digitsOnly(phoneNumber);
  if (!digits) {
    return null;
  }

  if (digits.length === 11 && digits.startsWith('09')) {
    return `+63${digits.slice(1)}`;
  }

  if (digits.length === 12 && digits.startsWith('639')) {
    return `+${digits}`;
  }

  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

function validateAndFormatPhoneNumber(phoneNumber) {
  const formattedNumber = formatPhoneNumber(phoneNumber);
  if (!formattedNumber) {
    return {
      valid: false,
      error: 'Invalid phone number format',
    };
  }

  return {
    valid: true,
    formattedNumber,
  };
}

function generateVerificationCode(length = SMS_CONFIG.otp.length) {
  const size = Math.max(4, parseInt(length || SMS_CONFIG.otp.length, 10));
  const min = 10 ** (size - 1);
  const max = 10 ** size - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getLogMessage(message, messageType, status, error) {
  const normalizedMessage = String(message ?? '').trim();
  if (normalizedMessage) {
    return normalizedMessage;
  }

  const normalizedType = String(messageType || 'general').trim() || 'general';
  if (error) {
    return `SMS ${normalizedType} ${status === 'failed' ? 'failed' : 'event'}: ${error}`;
  }

  return `SMS ${normalizedType} ${status || 'logged'}`;
}

async function getLogsSchema() {
  if (logSchemaCache) {
    return logSchemaCache;
  }

  if (!logSchemaPromise) {
    logSchemaPromise = pool
      .query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'sms_logs'`
      )
      .then((result) => {
        if (result.rows.length === 0) {
          return null;
        }

        const schema = {
          columns: new Set(result.rows.map((row) => row.column_name)),
        };

        logSchemaCache = schema;
        return schema;
      })
      .catch((error) => {
        logSchemaCache = null;
        throw error;
      })
      .finally(() => {
        logSchemaPromise = null;
      });
  }

  return logSchemaPromise;
}

function maskPhone(phoneNumber) {
  const formatted = formatPhoneNumber(phoneNumber);
  if (!formatted) {
    return String(phoneNumber || '');
  }
  return `${formatted.slice(0, 6)}****${formatted.slice(-3)}`;
}

function buildOtpMessage(purpose, code) {
  const normalizedPurpose = normalizePurpose(purpose);
  const template =
    OTP_MESSAGES[normalizedPurpose] ||
    'Your Immunicare verification code is {code}. It expires in {minutes} minutes.';
  return template
    .replace('{code}', String(code))
    .replace('{minutes}', String(SMS_CONFIG.otp.expiryMinutes));
}

async function sendTextBee(phoneNumber, message) {
  if (!TEXTBEE_API_KEY) {
    throw new Error('TEXTBEE_API_KEY is not configured');
  }

  if (!TEXTBEE_DEVICE_ID) {
    throw new Error('TEXTBEE_DEVICE_ID is not configured');
  }

  const headers = {
    'x-api-key': TEXTBEE_API_KEY,
    'Content-Type': 'application/json',
  };

  const normalizeResponse = (responseData) => ({
    provider: 'textbee',
    raw: responseData,
    messageId:
      responseData?.id ||
      responseData?.messageId ||
      responseData?.data?.id ||
      responseData?.data?.messageId ||
      null,
  });

  const primaryUrl = `${TEXTBEE_BASE_URL}/${TEXTBEE_DEVICE_ID}/sendSMS`;
  const primaryPayload = {
    recipients: [phoneNumber],
    message,
  };

  try {
    const response = await axios.post(primaryUrl, primaryPayload, {
      headers,
      timeout: 15000,
    });

    return normalizeResponse(response.data);
  } catch (primaryError) {
    const statusCode = primaryError?.response?.status;
    const shouldFallback = statusCode === 400 || statusCode === 404 || statusCode === 422;

    if (!shouldFallback) {
      throw primaryError;
    }

    const fallbackUrl = `${TEXTBEE_BASE_URL.replace(/\/gateway\/devices$/, '')}/messages/send`;
    const fallbackPayload = {
      deviceId: TEXTBEE_DEVICE_ID,
      recipient: phoneNumber,
      message,
      sender: SMS_CONFIG.senderName,
    };

    try {
      const fallbackResponse = await axios.post(fallbackUrl, fallbackPayload, {
        headers,
        timeout: 15000,
      });

      logger.warn('TextBee primary endpoint rejected request; fallback endpoint used', {
        primaryStatus: statusCode,
      });

      return normalizeResponse(fallbackResponse.data);
    } catch (fallbackError) {
      fallbackError.primaryEndpoint = {
        status: statusCode,
        data: primaryError?.response?.data,
      };
      throw fallbackError;
    }
  }
}

async function logSms({
  phoneNumber,
  message,
  messageType,
  status,
  provider,
  messageId,
  metadata,
  error,
}) {
  try {
    const schema = await getLogsSchema();
    if (!schema) {
      return;
    }

    const normalizedMessage = getLogMessage(message, messageType, status, error);
    const columns = ['phone_number'];
    const values = [phoneNumber];
    const appendColumn = (columnName, value) => {
      if (schema.columns.has(columnName)) {
        columns.push(columnName);
        values.push(value);
      }
    };

    appendColumn('message_content', normalizedMessage);
    appendColumn('message', normalizedMessage);
    appendColumn('message_type', messageType || 'general');
    appendColumn('status', status);
    appendColumn('provider', provider || SMS_PROVIDER);
    appendColumn('external_message_id', messageId || null);
    appendColumn('message_id', messageId || null);
    appendColumn('metadata', metadata ? JSON.stringify(metadata) : null);
    appendColumn('error_details', error || null);
    appendColumn('error_message', error || null);
    appendColumn('sent_at', status === 'sent' ? new Date() : null);
    appendColumn('failed_at', status === 'failed' ? new Date() : null);

    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    await pool.query(
      `INSERT INTO sms_logs (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
  } catch (logError) {
    if (logError?.code === '42703' || logError?.code === '42P01') {
      logSchemaCache = null;
    }

    logger.warn('Failed to write sms_logs entry', {
      message: logError.message,
    });
  }
}

async function checkCooldown(phoneNumber, purpose) {
  try {
    await ensureVerifySchema();
    const result = await pool.query(
      `SELECT created_at
       FROM sms_verification_codes
       WHERE phone_number = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [phoneNumber, purpose]
    );

    if (result.rows.length === 0) {
      return { allowed: true, remainingSeconds: 0 };
    }

    const lastSentAt = new Date(result.rows[0].created_at).getTime();
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - lastSentAt) / 1000);
    const remainingSeconds = SMS_CONFIG.otp.resendCooldownSeconds - elapsedSeconds;

    if (remainingSeconds > 0) {
      return { allowed: false, remainingSeconds };
    }

    return { allowed: true, remainingSeconds: 0 };
  } catch {
    return { allowed: true, remainingSeconds: 0 };
  }
}

async function getRateCounts(phoneNumber) {
  try {
    const hourlyResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM sms_logs
       WHERE phone_number = $1
         AND created_at >= NOW() - INTERVAL '1 hour'`,
      [phoneNumber]
    );

    const dailyResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM sms_logs
       WHERE phone_number = $1
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [phoneNumber]
    );

    return {
      perHour: hourlyResult.rows[0]?.count || 0,
      perDay: dailyResult.rows[0]?.count || 0,
    };
  } catch {
    return { perHour: 0, perDay: 0 };
  }
}

async function upsertOtp({
  phoneNumber,
  code,
  purpose,
  userId,
  guardianId,
  ipAddress,
  userAgent,
}) {
  const expiresAt = new Date(Date.now() + SMS_CONFIG.otp.expiryMinutes * 60 * 1000);

  await ensureVerifySchema();
  await pool.query(
    `INSERT INTO sms_verification_codes
      (phone_number, code, purpose, user_id, guardian_id, expires_at, attempts, max_attempts, ip_address, user_agent)
     VALUES
      ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9)
     ON CONFLICT (phone_number, purpose)
     DO UPDATE SET
       code = EXCLUDED.code,
       user_id = EXCLUDED.user_id,
       guardian_id = EXCLUDED.guardian_id,
       expires_at = EXCLUDED.expires_at,
       attempts = 0,
       max_attempts = EXCLUDED.max_attempts,
       ip_address = EXCLUDED.ip_address,
       user_agent = EXCLUDED.user_agent,
       created_at = CURRENT_TIMESTAMP,
       verified_at = NULL
     RETURNING id`,
    [
      phoneNumber,
      code,
      purpose,
      userId || null,
      guardianId || null,
      expiresAt,
      SMS_CONFIG.otp.maxAttempts,
      ipAddress || null,
      userAgent || null,
    ]
  );

  return {
    expiresAt,
    expiresIn: SMS_CONFIG.otp.expiryMinutes * 60,
  };
}

async function sendSMS(phoneNumber, message, messageType = 'general', metadata = {}) {
  if (pool.ended) {
    const poolEndedError = 'Database pool is closed';
    logger.error('SMS send aborted because database pool is closed', {
      messageType,
      metadata,
    });
    throw new Error(poolEndedError);
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    const error = 'Invalid phone number format';
    await logSms({
      phoneNumber: String(phoneNumber || ''),
      message,
      messageType,
      status: 'failed',
      provider: SMS_PROVIDER,
      metadata,
      error,
    });
    throw new Error(error);
  }

  const { perHour, perDay } = await getRateCounts(formattedPhone);
  if (perHour >= SMS_CONFIG.rateLimit.maxPerHour) {
    const error = 'SMS hourly limit reached';
    await logSms({
      phoneNumber: formattedPhone,
      message,
      messageType,
      status: 'failed',
      provider: SMS_PROVIDER,
      metadata,
      error,
    });
    throw new Error(error);
  }

  if (perDay >= SMS_CONFIG.rateLimit.maxPerDay) {
    const error = 'SMS daily limit reached';
    await logSms({
      phoneNumber: formattedPhone,
      message,
      messageType,
      status: 'failed',
      provider: SMS_PROVIDER,
      metadata,
      error,
    });
    throw new Error(error);
  }

  try {
    let providerResult;

    if (SMS_PROVIDER === 'textbee' && TEXTBEE_API_KEY) {
      providerResult = await sendTextBee(formattedPhone, message);
    } else {
      providerResult = {
        provider: 'log',
        messageId: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        raw: null,
      };
      logger.info(`[SMS-LOG] ${formattedPhone}: ${message}`);
    }

    await logSms({
      phoneNumber: formattedPhone,
      message,
      messageType,
      status: 'sent',
      provider: providerResult.provider,
      messageId: providerResult.messageId,
      metadata,
    });

    return {
      success: true,
      provider: providerResult.provider,
      messageId: providerResult.messageId,
      timestamp: new Date().toISOString(),
      to: formattedPhone,
      raw: providerResult.raw,
    };
  } catch (error) {
    const providerStatus = Number.isFinite(error?.response?.status) ? error.response.status : null;
    const providerStatusText = error?.response?.statusText || null;
    const providerErrorPayload = error?.response?.data;
    let providerErrorDetail = null;

    if (typeof providerErrorPayload === 'string') {
      providerErrorDetail = providerErrorPayload;
    } else if (providerErrorPayload && typeof providerErrorPayload === 'object') {
      providerErrorDetail =
        providerErrorPayload.error ||
        providerErrorPayload.message ||
        providerErrorPayload.details ||
        JSON.stringify(providerErrorPayload);
    }

    await logSms({
      phoneNumber: formattedPhone,
      message,
      messageType,
      status: 'failed',
      provider: SMS_PROVIDER,
      metadata,
      error: providerStatus ? `${error.message} (status ${providerStatus})` : error.message,
    });

    logger.error('SMS send failed', {
      to: formattedPhone,
      messageType,
      error: error.message,
      provider: SMS_PROVIDER,
      ...(providerStatus ? { providerStatus } : {}),
      ...(providerStatusText ? { providerStatusText } : {}),
      ...(providerErrorDetail ? { providerErrorDetail } : {}),
    });
    throw error;
  }
}

async function sendOTP(phoneNumber, purpose = 'verification', metadata = {}) {
  const normalizedPurpose = normalizePurpose(purpose);
  const validation = validateAndFormatPhoneNumber(phoneNumber);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  const formattedPhone = validation.formattedNumber;
  const cooldown = await checkCooldown(formattedPhone, normalizedPurpose);
  if (!cooldown.allowed) {
    return {
      success: false,
      error: 'Please wait before requesting another OTP',
      cooldownRemaining: cooldown.remainingSeconds,
    };
  }

  const code = generateVerificationCode(SMS_CONFIG.otp.length);
  const otpMeta = await upsertOtp({
    phoneNumber: formattedPhone,
    code,
    purpose: normalizedPurpose,
    userId: metadata.userId,
    guardianId: metadata.guardianId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  const message = buildOtpMessage(normalizedPurpose, code);

  try {
    const sendResult = await sendSMS(formattedPhone, message, `otp_${normalizedPurpose}`, {
      ...metadata,
      purpose: normalizedPurpose,
    });

    return {
      success: true,
      otpId: sendResult.messageId,
      expiresIn: otpMeta.expiresIn,
      maskedPhone: maskPhone(formattedPhone),
      purpose: normalizedPurpose,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

async function verifyOTP(phoneNumber, code, purpose = 'verification') {
  const normalizedPurpose = normalizePurpose(purpose);
  const validation = validateAndFormatPhoneNumber(phoneNumber);

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      attemptsRemaining: 0,
    };
  }

  const formattedPhone = validation.formattedNumber;

  await ensureVerifySchema();
  const result = await pool.query(
    `SELECT id, code, attempts, max_attempts, user_id, guardian_id, expires_at
     FROM sms_verification_codes
     WHERE phone_number = $1
       AND purpose = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [formattedPhone, normalizedPurpose]
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      error: 'Verification code not found',
      attemptsRemaining: 0,
    };
  }

  const otp = result.rows[0];

  if (otp.expires_at && new Date(otp.expires_at).getTime() < Date.now()) {
    return {
      success: false,
      error: 'Verification code expired',
      attemptsRemaining: 0,
    };
  }

  if (otp.attempts >= otp.max_attempts) {
    return {
      success: false,
      error: 'Maximum attempts exceeded',
      attemptsRemaining: 0,
    };
  }

  if (String(otp.code) !== String(code)) {
    await pool.query('UPDATE sms_verification_codes SET attempts = attempts + 1 WHERE id = $1', [
      otp.id,
    ]);

    const attemptsRemaining = Math.max(0, otp.max_attempts - (otp.attempts + 1));
    return {
      success: false,
      error: 'Invalid verification code',
      attemptsRemaining,
    };
  }

  await pool.query(
    'UPDATE sms_verification_codes SET verified_at = CURRENT_TIMESTAMP WHERE id = $1',
    [otp.id]
  );

  return {
    success: true,
    userId: otp.user_id,
    guardianId: otp.guardian_id,
  };
}

function formatReminderDateLabel(dateInput) {
  const parsedDate = dateInput ? new Date(dateInput) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return String(dateInput || 'your scheduled date');
  }

  return parsedDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function createAppointmentReminderMessage(vaccineType, scheduledDate, options = {}) {
  const {
    hoursUntil = 48,
    childName = 'Your child',
    guardianName = '',
    location = 'Barangay San Nicolas Health Center',
  } = options;
  String(vaccineType || 'vaccination').trim();
  const dateObj = scheduledDate ? new Date(scheduledDate) : null;
  const dateLabel = dateObj
    ? dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'your scheduled date';
  const timeLabel = dateObj
    ? dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '';

  if (hoursUntil <= 24) {
    return APPT_MESSAGES.nextAppointment24h
      .replace('{guardian_name}', guardianName || 'Guardian')
      .replace('{baby_name}', childName)
      .replace('{scheduledDate}', dateLabel)
      .replace('{time}', timeLabel)
      .replace('{location}', location);
  }

  return APPT_MESSAGES.nextAppointment48h
    .replace('{guardian_name}', guardianName || 'Guardian')
    .replace('{baby_name}', childName)
    .replace('{scheduledDate}', dateLabel)
    .replace('{time}', timeLabel)
    .replace('{location}', location);
}

function createMissedAppointmentMessage(vaccineType, scheduledDate, options = {}) {
  const { childName = 'Your child', location = 'Barangay San Nicolas Health Center' } = options;
  const normalizedVaccineType = String(vaccineType || 'vaccination').trim();
  const dateLabel = formatReminderDateLabel(scheduledDate);

  return APPT_MESSAGES.missedAppointment
    .replace('{baby_name}', childName)
    .replace('{vaccineType}', normalizedVaccineType)
    .replace('{scheduledDate}', dateLabel)
    .replace('{location}', location);
}

function createScheduleDateChangedMessage(scheduledDate, options = {}) {
  const {
    childName = 'Your child',
    location = 'Barangay San Nicolas Health Center',
    time = '',
  } = options;
  const dateObj = scheduledDate ? new Date(scheduledDate) : null;
  const dateLabel = dateObj
    ? dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'your scheduled date';
  const timeLabel =
    time ||
    (dateObj ? dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '');

  return APPT_MESSAGES.scheduleDateChanged
    .replace('{baby_name}', childName)
    .replace('{newDate}', dateLabel)
    .replace('{time}', timeLabel)
    .replace('{location}', location);
}

async function sendAppointmentReminder(appointment) {
  try {
    const phoneNumber = appointment?.phoneNumber || appointment?.guardian_phone;
    const childName =
      appointment?.childName ||
      appointment?.babyName ||
      appointment?.infantName ||
      appointment?.infant_first_name ||
      'your child';

    const guardianName = appointment?.guardianName || appointment?.guardian_name || 'Guardian';

    const vaccineType =
      appointment?.vaccineName ||
      appointment?.vaccine_name ||
      appointment?.type ||
      appointment?.appointment_type ||
      appointment?.vaccine ||
      'vaccination';

    const hoursUntil = appointment?.hoursUntil || appointment?.hours_until || 48;
    const location =
      appointment?.location || appointment?.clinicName || 'Barangay San Nicolas Health Center';

    const scheduledDateSource =
      appointment?.scheduledDate || appointment?.scheduled_date || appointment?.date;

    const message = createAppointmentReminderMessage(vaccineType, scheduledDateSource, {
      hoursUntil,
      childName,
      guardianName,
      location,
    });

    const sendResult = await sendSMS(phoneNumber, message, 'appointment_reminder', {
      appointmentId: appointment?.appointmentId || appointment?.appointment_id,
      infantName: childName,
      vaccineType,
      scheduledDate: scheduledDateSource,
      hoursUntil,
    });

    return {
      success: true,
      messageId: sendResult.messageId,
      provider: sendResult.provider,
    };
  } catch (error) {
    logger.error('Failed to send appointment reminder:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

async function sendMissedAppointmentNotification(appointment) {
  const phoneNumber = appointment?.phoneNumber || appointment?.guardian_phone;

  if (!phoneNumber) {
    logger.error('sendMissedAppointmentNotification called with no phone number', {
      appointmentId: appointment?.appointmentId || appointment?.appointment_id,
    });
    return {
      success: false,
      error: 'No phone number provided',
    };
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    logger.error('sendMissedAppointmentNotification called with invalid phone number', {
      appointmentId: appointment?.appointmentId || appointment?.appointment_id,
      phoneNumber,
    });
    return {
      success: false,
      error: 'Invalid phone number format',
    };
  }

  const childName =
    appointment?.childName ||
    appointment?.babyName ||
    appointment?.infantName ||
    appointment?.infant_first_name ||
    'your child';

  const vaccineType =
    appointment?.vaccineName ||
    appointment?.vaccine_name ||
    appointment?.type ||
    appointment?.appointment_type ||
    appointment?.vaccine ||
    'vaccination';

  const scheduledDateSource =
    appointment?.scheduledDate || appointment?.scheduled_date || appointment?.date;

  const location =
    appointment?.location || appointment?.clinicName || 'Barangay San Nicolas Health Center';

  const message = createMissedAppointmentMessage(vaccineType, scheduledDateSource, {
    childName,
    location,
  });

  try {
    const sendResult = await sendSMS(phoneNumber, message, 'missed_appointment', {
      appointmentId: appointment?.appointmentId || appointment?.appointment_id,
      infantName: childName,
      vaccineType,
      scheduledDate: scheduledDateSource,
      guardianName: appointment?.guardianName || appointment?.guardian_name || null,
      location,
    });

    return {
      success: true,
      messageId: sendResult.messageId,
      provider: sendResult.provider,
    };
  } catch (error) {
    logger.error('Failed to send missed appointment SMS', {
      appointmentId: appointment?.appointmentId || appointment?.appointment_id,
      phoneNumber,
      error: error.message,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

async function sendAppointmentConfirmation(payload) {
  const phoneNumber = payload?.phoneNumber || payload?.guardianPhone;
  const guardianName = payload?.guardianName || 'Guardian';
  const childName = payload?.childName || payload?.babyName || 'your child';
  const vaccineName = payload?.vaccineName || 'vaccination';
  const scheduledDateSource = payload?.scheduledDate || payload?.appointmentDate || payload?.date;
  const dateObj = scheduledDateSource ? new Date(scheduledDateSource) : new Date();
  const dateLabel = dateObj.toLocaleDateString('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeLabel = dateObj.toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const location = payload?.location || payload?.clinicName || 'Barangay San Nicolas Health Center';

  const message =
    `Immunicare: Hi ${guardianName}, ${childName}'s ${vaccineName} appointment has been confirmed for ${dateLabel} at ${timeLabel}. ` +
    `Location: ${location}. Please arrive 15 minutes early. Thank you!`;

  const sendResult = await sendSMS(phoneNumber, message, 'appointment_confirmation', {
    childName,
    vaccineName,
    scheduledDate: dateLabel,
  });

  return {
    success: true,
    messageId: sendResult.messageId,
    provider: sendResult.provider,
  };
}

async function sendVaccinationReminder(payload) {
  const phoneNumber = payload?.phoneNumber || payload?.guardianPhone;
  const childName = payload?.childName || payload?.babyName || 'your child';
  const vaccineName = payload?.vaccineName || 'scheduled vaccine';
  const dueDateSource = payload?.dueDate || payload?.date;
  const dueLabel = dueDateSource
    ? new Date(dueDateSource).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'soon';

  const message = `Immunicare Reminder: ${childName} is due for ${vaccineName} on ${dueLabel}. Please coordinate with your health center at Barangay San Nicolas Health Center to schedule an appointment.`;
  const sendResult = await sendSMS(phoneNumber, message, 'vaccination_reminder', {
    childName,
    vaccineName,
    dueDate: dueLabel,
  });

  return {
    success: true,
    messageId: sendResult.messageId,
    provider: sendResult.provider,
  };
}

async function sendVerificationSMS(phoneNumber, code) {
  return sendSMS(phoneNumber, buildOtpMessage('phone_verification', code), 'verification', {
    purpose: 'phone_verification',
  });
}

async function sendPasswordResetSMS(phoneNumber, code) {
  return sendSMS(phoneNumber, buildOtpMessage('password_reset', code), 'password_reset', {
    purpose: 'password_reset',
  });
}

async function sendWelcomeSMS(phoneNumber, name) {
  const message = `Welcome to Immunicare, ${name}! Your account has been successfully verified. You can now log in to manage your child's vaccination schedule at the Barangay San Nicolas Health Center.`;
  return sendSMS(phoneNumber, message, 'welcome_notification', { purpose: 'welcome' });
}

async function sendScheduleDateChangedNotification(appointment) {
  const phoneNumber = appointment?.phoneNumber || appointment?.guardian_phone;

  if (!phoneNumber) {
    logger.error('sendScheduleDateChangedNotification called with no phone number', {
      appointmentId: appointment?.appointmentId || appointment?.appointment_id,
    });
    return {
      success: false,
      error: 'No phone number provided',
    };
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    logger.error('sendScheduleDateChangedNotification called with invalid phone number', {
      appointmentId: appointment?.appointmentId || appointment?.appointment_id,
      phoneNumber,
    });
    return {
      success: false,
      error: 'Invalid phone number format',
    };
  }

  const childName =
    appointment?.childName ||
    appointment?.babyName ||
    appointment?.infantName ||
    appointment?.infant_first_name ||
    'your child';

  const scheduledDateSource =
    appointment?.scheduledDate || appointment?.scheduled_date || appointment?.newScheduledDate;

  const location =
    appointment?.location || appointment?.clinicName || 'Barangay San Nicolas Health Center';

  const time = appointment?.time || appointment?.appointmentTime || '';

  const message = createScheduleDateChangedMessage(scheduledDateSource, {
    childName,
    location,
    time,
  });

  try {
    const sendResult = await sendSMS(phoneNumber, message, 'schedule_date_changed', {
      appointmentId: appointment?.appointmentId || appointment?.appointment_id,
      infantName: childName,
      scheduledDate: scheduledDateSource,
      previousDate: appointment?.previousDate || appointment?.previous_scheduled_date || null,
      guardianName: appointment?.guardianName || appointment?.guardian_name || null,
      location,
    });

    return {
      success: true,
      messageId: sendResult.messageId,
      provider: sendResult.provider,
    };
  } catch (error) {
    logger.error('Failed to send schedule date changed SMS', {
      appointmentId: appointment?.appointmentId || appointment?.appointment_id,
      phoneNumber,
      error: error.message,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

async function hasNotificationBeenSent(appointmentId, scheduledDate, notificationType) {
  try {
    const schema = await getLogsSchema();
    if (!schema) {
      return false;
    }

    const dateStr =
      scheduledDate instanceof Date
        ? scheduledDate.toISOString().split('T')[0]
        : String(scheduledDate).split('T')[0];

    const result = await pool.query(
      `SELECT id FROM sms_logs
       WHERE message_type = $1
         AND metadata->>'appointmentId' = $2
         AND DATE(sent_at) = $3
       LIMIT 1`,
      [notificationType, String(appointmentId), dateStr]
    );

    return result.rows.length > 0;
  } catch (error) {
    logger.warn('Failed to check notification dedupe', {
      appointmentId,
      scheduledDate,
      notificationType,
      error: error.message,
    });
    return false;
  }
}

function getSMSConfigStatus() {
  return {
    provider: SMS_PROVIDER,
    configured: SMS_PROVIDER === 'log' || (SMS_PROVIDER === 'textbee' && Boolean(TEXTBEE_API_KEY)),
    textbee: {
      apiKeyConfigured: Boolean(TEXTBEE_API_KEY),
      deviceIdConfigured: Boolean(TEXTBEE_DEVICE_ID),
      senderName: SMS_CONFIG.senderName,
    },
    otp: SMS_CONFIG.otp,
    rateLimit: SMS_CONFIG.rateLimit,
  };
}

const smsService = {
  SMS_CONFIG,

  sendSMS,
  sendOTP,
  verifyOTP,

  sendSms: sendSMS,
  sendOtp: (phoneNumber) => {
    return sendOTP(phoneNumber, 'verification');
  },

  validateAndFormatPhoneNumber,
  formatPhoneNumber,
  maskPhone,
  buildOtpMessage,
  formatReminderDateLabel,
  generateVerificationCode,
  generateResetToken,
  createAppointmentReminderMessage,
  createMissedAppointmentMessage,
  createScheduleDateChangedMessage,
  sendVerificationSMS,
  sendPasswordResetSMS,
  sendAppointmentReminder,
  sendMissedAppointmentNotification,
  sendMissedAppointmentSms: sendMissedAppointmentNotification,
  sendAppointmentReminderSms: sendAppointmentReminder,
  sendAppointmentConfirmation,
  sendScheduleDateChangedNotification,
  hasNotificationBeenSent,
  sendVaccinationReminder,
  sendWelcomeSMS,
  getSMSConfigStatus,
};

module.exports = smsService;
