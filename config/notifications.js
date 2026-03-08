/**
 * Notification Configuration Module
 *
 * Unified notification configuration for SMS and Email services.
 * Provides centralized configuration management, validation, and status checking.
 *
 * This module integrates:
 * - SMS Configuration (backend/config/sms.js)
 * - Email Configuration (backend/config/email.js)
 * - Notification preferences
 * - Error handling and logging
 */

const logger = require('./logger');

// Import SMS and Email configurations
const smsConfig = require('./sms');
const emailConfig = require('./email');

/**
 * Notification Configuration
 */
const NOTIFICATION_CONFIG = {
  // Default notification channels
  channels: {
    sms: {
      enabled: true,
      preferred: true,
      fallbackToEmail: true,
    },
    email: {
      enabled: true,
      preferred: false,
      fallbackToSMS: false,
    },
  },

  // Notification preferences
  preferences: {
    // Authentication notifications
    auth: {
      otp: {
        sms: true,
        email: true,
      },
      passwordReset: {
        sms: true,
        email: true,
      },
      loginNotification: {
        email: true,
        sms: false,
      },
    },

    // Appointment notifications
    appointments: {
      confirmation: {
        sms: true,
        email: true,
      },
      reminder: {
        sms: true,
        email: true,
      },
      cancellation: {
        sms: true,
        email: true,
      },
      reschedule: {
        sms: true,
        email: true,
      },
    },

    // Vaccination notifications
    vaccinations: {
      reminder: {
        sms: true,
        email: true,
      },
      dueSoon: {
        sms: true,
        email: false,
      },
      overdue: {
        sms: true,
        email: true,
      },
    },

    // Administrative notifications
    admin: {
      loginAlerts: {
        email: true,
      },
      securityAlerts: {
        email: true,
        sms: true,
      },
    },
  },

  // Retry configuration
  retry: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  },

  // Queue configuration (for future implementation)
  queue: {
    enabled: false,
    maxSize: 1000,
    processingInterval: 5000,
  },
};

/**
 * Notification Status
 */
const NOTIFICATION_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  RETRYING: 'retrying',
  CANCELLED: 'cancelled',
};

/**
 * Get comprehensive notification configuration status
 * @returns {Object} Complete status report
 */
async function getNotificationStatus() {
  const smsStatus = smsConfig.getConfigStatus();
  const emailStatus = await emailConfig.getConfigStatus();

  return {
    timestamp: new Date().toISOString(),
    overall: {
      sms: smsStatus.configured,
      email: emailStatus.configured,
      ready: smsStatus.configured || emailStatus.configured,
    },
    sms: {
      configured: smsStatus.configured,
      gateway: smsStatus.gatewayName,
      provider: smsStatus.provider,
      errors: smsStatus.errors,
      warnings: smsStatus.warnings,
      otp: smsStatus.otp,
      rateLimit: smsStatus.rateLimit,
      reminders: smsStatus.reminders,
    },
    email: {
      configured: emailStatus.configured,
      provider: emailStatus.provider,
      smtp: emailStatus.smtp,
      resend: emailStatus.resend,
      errors: emailStatus.validation?.errors || [],
      warnings: emailStatus.validation?.warnings || [],
    },
    preferences: NOTIFICATION_CONFIG.preferences,
  };
}

/**
 * Check if notification system is production ready
 * @returns {Object} Production readiness status
 */
async function isProductionReady() {
  const smsReady = smsConfig.isProductionReady();
  const emailReady = await emailConfig.isProductionReady();

  // Production ready if at least one channel is properly configured
  const ready = smsReady || emailReady;

  return {
    ready,
    sms: {
      ready: smsReady,
      configured: smsReady,
    },
    email: {
      ready: emailReady,
      configured: emailReady,
    },
    recommendation: !ready
      ? 'Configure at least one notification channel (SMS or Email) for production'
      : smsReady && emailReady
        ? 'Both SMS and Email are production ready'
        : smsReady
          ? 'SMS is production ready. Consider adding Email for better coverage.'
          : 'Email is production ready. Consider adding SMS for urgent notifications.',
  };
}

/**
 * Get notification channel configuration
 * @param {string} channel - 'sms' or 'email'
 * @returns {Object} Channel configuration
 */
function getChannelConfig(channel) {
  if (channel === 'sms') {
    return {
      ...smsConfig.SMS_CONFIG,
      status: smsConfig.getConfigStatus(),
    };
  }

  if (channel === 'email') {
    return {
      ...emailConfig.EMAIL_CONFIG,
      status: emailConfig.getConfigStatus
        ? emailConfig.getConfigStatus()
        : null,
    };
  }

  return null;
}

/**
 * Validate complete notification configuration
 * @returns {Object} Validation results
 */
async function validateConfiguration() {
  const results = {
    valid: true,
    sms: await smsConfig.validateConfig(),
    email: await emailConfig.validateConfig(),
    channels: {
      sms: false,
      email: false,
    },
  };

  results.channels.sms = results.sms.valid;
  results.channels.email = results.email.valid;

  results.valid = results.channels.sms || results.channels.email;

  return results;
}

/**
 * Log notification configuration summary
 */
async function logConfigurationSummary() {
  const status = await getNotificationStatus();

  logger.info('========================================');
  logger.info('NOTIFICATION SYSTEM CONFIGURATION SUMMARY');
  logger.info('========================================');

  // SMS Status
  logger.info(`SMS Gateway: ${status.sms.gateway}`);
  logger.info(`SMS Configured: ${status.sms.configured ? 'YES' : 'NO'}`);
  if (status.sms.errors?.length > 0) {
    logger.warn(`SMS Errors: ${status.sms.errors.join(', ')}`);
  }
  if (status.sms.warnings?.length > 0) {
    logger.warn(`SMS Warnings: ${status.sms.warnings.join(', ')}`);
  }

  // Email Status
  logger.info(`Email Provider: ${status.email.provider}`);
  logger.info(`Email Configured: ${status.email.configured ? 'YES' : 'NO'}`);
  if (status.email.smtp?.host) {
    logger.info(`SMTP Host: ${status.email.smtp.host}:${status.email.smtp.port}`);
  }
  if (status.email.validation?.errors?.length > 0) {
    logger.warn(`Email Errors: ${status.email.validation.errors.join(', ')}`);
  }

  // Overall Status
  logger.info(`Overall Ready: ${status.overall.ready ? 'YES' : 'NO'}`);
  logger.info('========================================');

  return status;
}

/**
 * Get appropriate notification channel based on availability
 * @param {Object} options - Channel preferences
 * @returns {string} Preferred channel ('sms', 'email', or null)
 */
function getPreferredChannel(options = {}) {
  const { preferSMS = true, requireSMS = false, requireEmail = false } = options;

  // Check availability
  const smsAvailable = smsConfig.isProductionReady();
  const emailAvailable = emailConfig.isProductionReady();

  // If only one is available, use it
  if (smsAvailable && !emailAvailable) {
    return 'sms';
  }
  if (emailAvailable && !smsAvailable) {
    return 'email';
  }

  // If both are available, use preference
  if (smsAvailable && emailAvailable) {
    if (requireSMS) {
      return 'sms';
    }
    if (requireEmail) {
      return 'email';
    }
    return preferSMS ? 'sms' : 'email';
  }

  // If neither is available
  if (requireSMS || requireEmail) {
    logger.warn(`Required channel not available (requireSMS: ${requireSMS}, requireEmail: ${requireEmail})`);
  }

  return null;
}

/**
 * Check if specific notification type is enabled
 * @param {string} category - Category (auth, appointments, vaccinations, admin)
 * @param {string} type - Notification type
 * @param {string} channel - Channel (sms or email)
 * @returns {boolean} Whether notification is enabled
 */
function isNotificationEnabled(category, type, channel) {
  try {
    return NOTIFICATION_CONFIG.preferences[category]?.[type]?.[channel] || false;
  } catch (error) {
    logger.warn(`Invalid notification type: ${category}.${type}.${channel}`);
    return false;
  }
}

/**
 * Create notification error with context
 * @param {string} message - Error message
 * @param {Object} context - Additional context
 * @returns {Error} Error with context
 */
function createNotificationError(message, context = {}) {
  const error = new Error(message);
  error.notificationContext = {
    ...context,
    timestamp: new Date().toISOString(),
    service: 'notification',
  };
  return error;
}

// Initialize and log configuration on module load
(async () => {
  try {
    const status = await logConfigurationSummary();

    if (!status.overall.ready) {
      logger.warn('Notification System: Not fully configured for production');
    } else {
      logger.info('Notification System: Initialized successfully');
    }
  } catch (error) {
    logger.error('Failed to initialize notification configuration:', error);
  }
})();

module.exports = {
  // Configuration
  NOTIFICATION_CONFIG,
  NOTIFICATION_STATUS,

  // Functions
  getNotificationStatus,
  isProductionReady,
  getChannelConfig,
  validateConfiguration,
  logConfigurationSummary,
  getPreferredChannel,
  isNotificationEnabled,
  createNotificationError,

  // Re-export SMS and Email configurations
  sms: smsConfig,
  email: emailConfig,
};
