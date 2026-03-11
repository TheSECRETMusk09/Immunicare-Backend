const SG_TIMEZONE = 'Asia/Singapore';

const EVENT_TYPES = Object.freeze({
  VACCINE_NON_AVAILABILITY: 'vaccine_non_availability',
  APPOINTMENT_CONFIRMATION: 'appointment_confirmation',
  APPOINTMENT_REMINDER: 'appointment_reminder',
  MISSED_APPOINTMENT: 'missed_appointment',
  FORGOT_PASSWORD_OTP: 'forgot_password_otp',
  ACCOUNT_VERIFICATION: 'account_verification',
  GUARDIAN_ACCOUNT_CREATED: 'guardian_account_created',
  CHILD_REGISTRATION_SUCCESS: 'child_registration_success',
  ADMIN_ANNOUNCEMENT: 'admin_announcement',
});

const CHANNELS = Object.freeze({
  SMS: 'sms',
  EMAIL: 'email',
  IN_APP: 'in_app',
});

const EVENT_CHANNEL_POLICY = Object.freeze({
  [EVENT_TYPES.FORGOT_PASSWORD_OTP]: [CHANNELS.EMAIL, CHANNELS.IN_APP],
  [EVENT_TYPES.ACCOUNT_VERIFICATION]: [CHANNELS.EMAIL, CHANNELS.IN_APP],
  [EVENT_TYPES.APPOINTMENT_CONFIRMATION]: [CHANNELS.SMS, CHANNELS.EMAIL, CHANNELS.IN_APP],
  [EVENT_TYPES.APPOINTMENT_REMINDER]: [CHANNELS.SMS, CHANNELS.EMAIL, CHANNELS.IN_APP],
  [EVENT_TYPES.MISSED_APPOINTMENT]: [CHANNELS.SMS, CHANNELS.EMAIL, CHANNELS.IN_APP],
  [EVENT_TYPES.VACCINE_NON_AVAILABILITY]: [CHANNELS.SMS, CHANNELS.EMAIL, CHANNELS.IN_APP],
  [EVENT_TYPES.GUARDIAN_ACCOUNT_CREATED]: [CHANNELS.SMS, CHANNELS.EMAIL, CHANNELS.IN_APP],
  [EVENT_TYPES.CHILD_REGISTRATION_SUCCESS]: [CHANNELS.SMS, CHANNELS.EMAIL, CHANNELS.IN_APP],
  [EVENT_TYPES.ADMIN_ANNOUNCEMENT]: [CHANNELS.EMAIL, CHANNELS.IN_APP],
});

const EVENT_REQUIRED_FIELDS = Object.freeze({
  [EVENT_TYPES.VACCINE_NON_AVAILABILITY]: [
    'recipient.guardianId',
    'recipient.targetType',
    'payload.childName',
    'payload.vaccineName',
    'payload.scheduledAt',
  ],
  [EVENT_TYPES.APPOINTMENT_CONFIRMATION]: [
    'recipient.guardianId',
    'recipient.targetType',
    'payload.childName',
    'payload.vaccineName',
    'payload.appointmentAt',
    'payload.appointmentStatus',
  ],
  [EVENT_TYPES.APPOINTMENT_REMINDER]: [
    'recipient.guardianId',
    'recipient.targetType',
    'payload.childName',
    'payload.vaccineName',
    'payload.appointmentAt',
    'payload.appointmentStatus',
  ],
  [EVENT_TYPES.MISSED_APPOINTMENT]: [
    'recipient.guardianId',
    'recipient.targetType',
    'payload.childName',
    'payload.vaccineName',
    'payload.appointmentAt',
    'payload.appointmentStatus',
  ],
  [EVENT_TYPES.FORGOT_PASSWORD_OTP]: [
    'recipient.guardianId',
    'recipient.targetType',
    'payload.otpCode',
    'payload.expiresAt',
  ],
  [EVENT_TYPES.ACCOUNT_VERIFICATION]: [
    'recipient.guardianId',
    'recipient.targetType',
    'payload.otpCode',
    'payload.expiresAt',
  ],
  [EVENT_TYPES.GUARDIAN_ACCOUNT_CREATED]: [
    'recipient.guardianId',
    'recipient.targetType',
    'payload.guardianName',
    'payload.status',
  ],
  [EVENT_TYPES.CHILD_REGISTRATION_SUCCESS]: [
    'recipient.guardianId',
    'recipient.targetType',
    'payload.childName',
    'payload.status',
  ],
  [EVENT_TYPES.ADMIN_ANNOUNCEMENT]: [
    'recipient.targetType',
    'payload.announcementTitle',
    'payload.announcementBody',
    'payload.status',
  ],
});

const deepGet = (source, path) => {
  const segments = String(path || '').split('.').filter(Boolean);
  let current = source;

  for (const segment of segments) {
    if (current === null || current === undefined || !(segment in Object(current))) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
};

const toStringOrNull = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

const toIntegerOrNull = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const normalizeIsoInSingapore = (value, fieldName, errors) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsedDate = new Date(String(value).trim());
  if (Number.isNaN(parsedDate.getTime())) {
    errors.push(`Invalid date-time for ${fieldName}`);
    return null;
  }

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: SG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter
    .formatToParts(parsedDate)
    .reduce((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});

  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = parts.hour;
  const minute = parts.minute;
  const second = parts.second;

  if (!year || !month || !day || !hour || !minute || !second) {
    errors.push(`Invalid date-time for ${fieldName}`);
    return null;
  }

  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
};

const assertRequiredFields = (eventType, eventPayload, errors) => {
  const requiredFields = EVENT_REQUIRED_FIELDS[eventType] || [];

  requiredFields.forEach((fieldPath) => {
    const value = deepGet(eventPayload, fieldPath);
    if (value === undefined || value === null || value === '') {
      errors.push(`Missing required field: ${fieldPath}`);
    }
  });
};

const normalizeRecipient = (recipient = {}) => ({
  targetType: toStringOrNull(recipient.targetType) || 'guardian',
  targetId: toIntegerOrNull(recipient.targetId),
  guardianId: toIntegerOrNull(recipient.guardianId),
  userId: toIntegerOrNull(recipient.userId),
  adminId: toIntegerOrNull(recipient.adminId),
  name: toStringOrNull(recipient.name),
  email: toStringOrNull(recipient.email),
  phone: toStringOrNull(recipient.phone),
});

const normalizeEventPayload = (rawEvent = {}) => {
  const errors = [];
  const eventType = toStringOrNull(rawEvent.eventType);

  if (!eventType || !Object.values(EVENT_TYPES).includes(eventType)) {
    errors.push('Unsupported or missing eventType');
  }

  const recipient = normalizeRecipient(rawEvent.recipient || {});
  const payloadInput = rawEvent.payload && typeof rawEvent.payload === 'object' ? rawEvent.payload : {};

  const normalizedPayload = {
    guardianName: toStringOrNull(payloadInput.guardianName),
    childName: toStringOrNull(payloadInput.childName),
    vaccineName: toStringOrNull(payloadInput.vaccineName),
    appointmentDetails: toStringOrNull(payloadInput.appointmentDetails),
    appointmentStatus: toStringOrNull(payloadInput.appointmentStatus),
    announcementTitle: toStringOrNull(payloadInput.announcementTitle),
    announcementBody: toStringOrNull(payloadInput.announcementBody),
    otpCode: toStringOrNull(payloadInput.otpCode),
    status: toStringOrNull(payloadInput.status),
    timezone: SG_TIMEZONE,
    appointmentAt: normalizeIsoInSingapore(payloadInput.appointmentAt, 'payload.appointmentAt', errors),
    scheduledAt: normalizeIsoInSingapore(payloadInput.scheduledAt, 'payload.scheduledAt', errors),
    expiresAt: normalizeIsoInSingapore(payloadInput.expiresAt, 'payload.expiresAt', errors),
  };

  const normalized = {
    eventType,
    traceId: toStringOrNull(rawEvent.traceId),
    idempotencyKey: toStringOrNull(rawEvent.idempotencyKey),
    actorUserId: toIntegerOrNull(rawEvent.actorUserId),
    actorAdminId: toIntegerOrNull(rawEvent.actorAdminId),
    source: toStringOrNull(rawEvent.source) || 'backend',
    occurredAt: normalizeIsoInSingapore(rawEvent.occurredAt || new Date().toISOString(), 'occurredAt', errors),
    recipient,
    payload: normalizedPayload,
    metadata: rawEvent.metadata && typeof rawEvent.metadata === 'object' ? rawEvent.metadata : {},
  };

  if (!normalized.occurredAt) {
    errors.push('Missing or invalid occurredAt');
  }

  if (normalized.eventType) {
    assertRequiredFields(normalized.eventType, normalized, errors);
  }

  const allowedChannels = EVENT_CHANNEL_POLICY[normalized.eventType] || [];

  return {
    valid: errors.length === 0,
    errors,
    allowedChannels,
    normalized,
  };
};

const createContractValidationError = (validationResult) => {
  const error = new Error(validationResult.errors.join('; '));
  error.code = 'NOTIFICATION_CONTRACT_VALIDATION_FAILED';
  error.details = validationResult.errors;
  error.validation = validationResult;
  return error;
};

module.exports = {
  SG_TIMEZONE,
  EVENT_TYPES,
  CHANNELS,
  EVENT_CHANNEL_POLICY,
  EVENT_REQUIRED_FIELDS,
  normalizeEventPayload,
  createContractValidationError,
};
