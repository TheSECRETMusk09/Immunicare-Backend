/**
 * SMS Configuration Module
 *
 * Centralized SMS configuration for Immunicare vaccination management system.
 * Supports multiple SMS providers: TextBee, Semaphore, Twilio, AWS SNS
 *
 * Environment Variables Required:
 * - SMS_GATEWAY: Gateway selection (textbee, semaphore, twilio, aws-sns, log)
 * - TEXTBEE_API_KEY: TextBee API key
 * - TEXTBEE_DEVICE_ID: TextBee device ID
 * - TEXTBEE_SENDER_NAME: Sender name for TextBee
 * - SEMAPHORE_API_KEY: Semaphore API key
 * - SEMAPHORE_SENDER_NAME: Sender name for Semaphore
 * - TWILIO_ACCOUNT_SID: Twilio account SID
 * - TWILIO_AUTH_TOKEN: Twilio auth token
 * - TWILIO_PHONE_NUMBER: Twilio phone number
 * - AWS_ACCESS_KEY_ID: AWS access key
 * - AWS_SECRET_ACCESS_KEY: AWS secret key
 * - AWS_REGION: AWS region
 * - AWS_SNS_SENDER_ID: SNS sender ID
 * - OTP_LENGTH: OTP code length (default: 6)
 * - OTP_EXPIRY_MINUTES: OTP expiry in minutes (default: 5)
 * - OTP_MAX_ATTEMPTS: Max verification attempts (default: 3)
 * - OTP_RESEND_COOLDOWN: Cooldown between OTP requests (default: 60 seconds)
 * - SMS_MAX_PER_HOUR: Max SMS per hour per number (default: 10)
 * - SMS_MAX_PER_DAY: Max SMS per day per number (default: 50)
 * - SMS_REMINDERS_ENABLED: Enable/disable SMS reminders (default: true)
 * - TEST_PHONE_NUMBER: Test phone number for development
 */

const logger = require('./logger');

/**
 * SMS Gateway Configuration
 */
const SMS_CONFIG = {
  // Primary Gateway Selection
  gateway: process.env.SMS_GATEWAY || 'log',

  // TextBee SMS Gateway (Philippines/Southeast Asia - Recommended)
  // Sign up: https://textbee.dev/
  textbee: {
    enabled: process.env.SMS_GATEWAY === 'textbee',
    apiKey: process.env.TEXTBEE_API_KEY || '',
    deviceId: process.env.TEXTBEE_DEVICE_ID || '',
    senderName: process.env.TEXTBEE_SENDER_NAME || 'IMMUNICARE',
    baseUrl: 'https://api.textbee.dev/api/v1',
    timeout: 30000,
    retries: 2,
  },

  // Semaphore SMS Gateway (Philippines)
  // Sign up: https://semaphore.co/
  semaphore: {
    enabled: process.env.SMS_GATEWAY === 'semaphore',
    apiKey: process.env.SEMAPHORE_API_KEY || '',
    senderName: process.env.SEMAPHORE_SENDER_NAME || 'Immunicare',
    baseUrl: 'https://api.semaphore.co/api/v4',
    timeout: 30000,
    retries: 2,
  },

  // Twilio SMS Gateway (International)
  // Sign up: https://twilio.com/
  twilio: {
    enabled: process.env.SMS_GATEWAY === 'twilio',
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    baseUrl: 'https://api.twilio.com/2010-04-01/Accounts',
    timeout: 30000,
    retries: 2,
  },

  // AWS SNS Configuration
  // Sign up: https://aws.amazon.com/sns/
  awsSns: {
    enabled: process.env.SMS_GATEWAY === 'aws-sns',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'ap-southeast-1',
    senderId: process.env.AWS_SNS_SENDER_ID || 'Immunicare',
    timeout: 30000,
    retries: 2,
  },

  // Development/Logging Mode
  log: {
    enabled: process.env.SMS_GATEWAY === 'log' || !process.env.SMS_GATEWAY,
    logToConsole: true,
    logToDatabase: true,
  },

  // OTP Configuration
  otp: {
    length: parseInt(process.env.OTP_LENGTH) || 6,
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES) || 5,
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS) || 3,
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN) || 60,
  },

  // Rate Limiting Configuration
  rateLimit: {
    maxPerHour: parseInt(process.env.SMS_MAX_PER_HOUR) || 10,
    maxPerDay: parseInt(process.env.SMS_MAX_PER_DAY) || 50,
    enabled: true,
  },

  // SMS Reminder Settings
  reminders: {
    enabled: process.env.SMS_REMINDERS_ENABLED !== 'false',
    defaultHoursBefore: 24,
    followUpHoursAfter: 48,
  },

  // Test Configuration
  test: {
    phoneNumber: process.env.TEST_PHONE_NUMBER || '',
    enabled: process.env.NODE_ENV === 'development',
  },
};

/**
 * SMS Message Types Enum
 */
const MESSAGE_TYPES = {
  OTP_VERIFICATION: 'otp_verification',
  OTP_PASSWORD_RESET: 'otp_password_reset',
  APPOINTMENT_REMINDER: 'appointment_reminder',
  APPOINTMENT_CONFIRMATION: 'appointment_confirmation',
  APPOINTMENT_CANCELLATION: 'appointment_cancellation',
  APPOINTMENT_RESCHEDULED: 'appointment_rescheduled',
  VACCINATION_REMINDER: 'vaccination_reminder',
  VACCINATION_DUE: 'vaccination_due',
  ACCOUNT_ALERT: 'account_alert',
  CUSTOM: 'custom',
};

/**
 * SMS Status Codes
 */
const SMS_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  EXPIRED: 'expired',
};

/**
 * Gateway Names Mapping
 */
const GATEWAY_NAMES = {
  textbee: 'TextBee (Philippines/Southeast Asia)',
  semaphore: 'Semaphore (Philippines)',
  twilio: 'Twilio (International)',
  'aws-sns': 'AWS SNS',
  log: 'Development Logger',
};

/**
 * Validate SMS Configuration
 * @returns {Object} Validation result with status and errors
 */
function validateConfig() {
  const errors = [];
  const warnings = [];
  const gateway = SMS_CONFIG.gateway;

  // Check gateway selection
  if (!['textbee', 'semaphore', 'twilio', 'aws-sns', 'log'].includes(gateway)) {
    errors.push(`Invalid SMS_GATEWAY: ${gateway}`);
  }

  // Validate gateway-specific configuration
  switch (gateway) {
  case 'textbee':
    if (!SMS_CONFIG.textbee.apiKey) {
      errors.push('TextBee API key not configured (TEXTBEE_API_KEY)');
    }
    if (!SMS_CONFIG.textbee.deviceId) {
      errors.push('TextBee device ID not configured (TEXTBEE_DEVICE_ID)');
    }
    break;

  case 'semaphore':
    if (!SMS_CONFIG.semaphore.apiKey) {
      errors.push('Semaphore API key not configured (SEMAPHORE_API_KEY)');
    }
    break;

  case 'twilio':
    if (!SMS_CONFIG.twilio.accountSid) {
      errors.push('Twilio Account SID not configured (TWILIO_ACCOUNT_SID)');
    }
    if (!SMS_CONFIG.twilio.authToken) {
      errors.push('Twilio Auth Token not configured (TWILIO_AUTH_TOKEN)');
    }
    if (!SMS_CONFIG.twilio.phoneNumber) {
      errors.push('Twilio phone number not configured (TWILIO_PHONE_NUMBER)');
    }
    break;

  case 'aws-sns':
    if (!SMS_CONFIG.awsSns.accessKeyId) {
      errors.push('AWS access key not configured (AWS_ACCESS_KEY_ID)');
    }
    if (!SMS_CONFIG.awsSns.secretAccessKey) {
      errors.push('AWS secret key not configured (AWS_SECRET_ACCESS_KEY)');
    }
    break;

  case 'log':
    warnings.push('SMS Gateway is set to LOG mode - messages will be logged but not sent');
    break;
  }

  // Warn about OTP configuration
  if (SMS_CONFIG.otp.length < 4 || SMS_CONFIG.otp.length > 8) {
    warnings.push(`OTP length ${SMS_CONFIG.otp.length} is unusual (recommended: 4-8)`);
  }

  if (SMS_CONFIG.otp.expiryMinutes < 1 || SMS_CONFIG.otp.expiryMinutes > 30) {
    warnings.push(`OTP expiry ${SMS_CONFIG.otp.expiryMinutes} minutes is unusual (recommended: 1-30)`);
  }

  // Check rate limits
  if (SMS_CONFIG.rateLimit.maxPerHour < 1) {
    warnings.push('SMS hourly rate limit should be at least 1');
  }

  if (SMS_CONFIG.rateLimit.maxPerDay < SMS_CONFIG.rateLimit.maxPerHour) {
    warnings.push('Daily rate limit should be >= hourly rate limit');
  }

  const isValid = errors.length === 0;

  if (!isValid) {
    logger.error('SMS Configuration Validation Failed', { errors, gateway });
  } else if (warnings.length > 0) {
    logger.warn('SMS Configuration Warnings', { warnings, gateway });
  } else {
    logger.info('SMS Configuration Validated', {
      gateway: GATEWAY_NAMES[gateway] || gateway,
      provider: gateway,
    });
  }

  return {
    valid: isValid,
    errors,
    warnings,
    configured: isValid,
    gateway: GATEWAY_NAMES[gateway] || gateway,
    provider: gateway,
  };
}

/**
 * Get SMS configuration status
 * @returns {Object} Configuration status
 */
function getConfigStatus() {
  const validation = validateConfig();
  const gateway = SMS_CONFIG.gateway;

  return {
    gateway,
    gatewayName: GATEWAY_NAMES[gateway] || gateway,
    configured: validation.valid,
    providerConfigured: validation.configured,
    errors: validation.errors,
    warnings: validation.warnings,
    otp: {
      length: SMS_CONFIG.otp.length,
      expiryMinutes: SMS_CONFIG.otp.expiryMinutes,
      maxAttempts: SMS_CONFIG.otp.maxAttempts,
      cooldownSeconds: SMS_CONFIG.otp.resendCooldownSeconds,
    },
    rateLimit: {
      maxPerHour: SMS_CONFIG.rateLimit.maxPerHour,
      maxPerDay: SMS_CONFIG.rateLimit.maxPerDay,
      enabled: SMS_CONFIG.rateLimit.enabled,
    },
    reminders: {
      enabled: SMS_CONFIG.reminders.enabled,
      defaultHoursBefore: SMS_CONFIG.reminders.defaultHoursBefore,
    },
    testMode: {
      enabled: SMS_CONFIG.test.enabled,
      phoneNumber: SMS_CONFIG.test.phoneNumber ? 'configured' : 'not configured',
    },
  };
}

/**
 * Check if SMS is properly configured for production
 * @returns {boolean}
 */
function isProductionReady() {
  const gateway = SMS_CONFIG.gateway;

  // Production ready if using a real gateway with proper credentials
  if (gateway === 'log') {
    return false;
  }

  return validateConfig().valid;
}

/**
 * Get configuration for specific gateway
 * @param {string} gatewayName - Gateway name
 * @returns {Object} Gateway configuration
 */
function getGatewayConfig(gatewayName) {
  const gatewayConfig = SMS_CONFIG[gatewayName];

  if (!gatewayConfig) {
    return null;
  }

  // Return config with sensitive data masked
  return {
    ...gatewayConfig,
    apiKey: gatewayConfig.apiKey ? '***' + gatewayConfig.apiKey.slice(-4) : '',
    authToken: gatewayConfig.authToken ? '***' + gatewayConfig.authToken.slice(-4) : '',
    secretAccessKey: gatewayConfig.secretAccessKey ? '***' + gatewayConfig.secretAccessKey.slice(-4) : '',
    accessKeyId: gatewayConfig.accessKeyId ? '***' + gatewayConfig.accessKeyId.slice(-4) : '',
  };
}

// Initialize and validate on module load
const validation = validateConfig();

// Log initial configuration status
if (validation.valid) {
  logger.info('SMS Service Initialized', {
    gateway: GATEWAY_NAMES[SMS_CONFIG.gateway] || SMS_CONFIG.gateway,
    otpLength: SMS_CONFIG.otp.length,
    otpExpiry: SMS_CONFIG.otp.expiryMinutes,
    rateLimitPerHour: SMS_CONFIG.rateLimit.maxPerHour,
    remindersEnabled: SMS_CONFIG.reminders.enabled,
  });
} else {
  logger.error('SMS Service Initialization Failed - Configuration Errors', {
    errors: validation.errors,
  });
}

module.exports = {
  // Configuration
  SMS_CONFIG,
  MESSAGE_TYPES,
  SMS_STATUS,
  GATEWAY_NAMES,

  // Functions
  validateConfig,
  getConfigStatus,
  isProductionReady,
  getGatewayConfig,
};
