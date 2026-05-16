/**
 * Email Configuration Module
 *
 * Centralized email/SMTP configuration for Immunicare vaccination management system.
 * Supports SMTP, Resend API, and custom email providers.
 *
 * Environment Variables Required:
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP port (587 for TLS, 465 for SSL)
 * - SMTP_SECURE: Use SSL/TLS (true/false)
 * - SMTP_USER: SMTP username
 * - SMTP_PASSWORD: SMTP password
 * - EMAIL_FROM: Sender email address
 * - EMAIL_FROM_NAME: Sender display name
 * - RESEND_API_KEY: Resend API key (optional, for Resend provider)
 * - RESEND_EMAIL_FROM: Resend sender address
 * - EMAIL_MAX_PER_HOUR: Max emails per hour (default: 50)
 * - EMAIL_MAX_PER_DAY: Max emails per day (default: 500)
 */

const loadBackendEnv = require('./loadEnv');
loadBackendEnv();
const nodemailer = require('nodemailer');
const logger = require('./logger');
const axios = require('axios');

/**
 * Email Configuration
 */
const EMAIL_CONFIG = {
  // SMTP Configuration
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === true,
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  },

  // Email sender configuration
  from: {
    address: process.env.EMAIL_FROM || process.env.MAIL_FROM_EMAIL || '',
    name: process.env.EMAIL_FROM_NAME || process.env.MAIL_FROM_NAME || 'Immunicare',
  },

  // Resend API Configuration (optional)
  resend: {
    enabled: !!process.env.RESEND_API_KEY,
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.RESEND_EMAIL_FROM,
    enabledForTransactional: process.env.RESEND_TRANSACTIONAL !== 'false',
  },

  // MailerSend API Configuration
  mailersend: {
    enabled: !!process.env.MAILERSEND_API_KEY,
    apiKey: process.env.MAILERSEND_API_KEY,
  },

  // Global Email Switch
  emailDisabled: process.env.EMAIL_DISABLED === 'true',

  // Rate Limiting
  rateLimit: {
    maxPerHour: parseInt(process.env.EMAIL_MAX_PER_HOUR) || 50,
    maxPerDay: parseInt(process.env.EMAIL_MAX_PER_DAY) || 500,
    enabled: true,
  },

  // Email Types Configuration
  emailTypes: {
    otp: {
      enabled: true,
      expiryMinutes: 10,
    },
    passwordReset: {
      enabled: true,
      expiryMinutes: 60,
    },
    appointmentConfirmation: {
      enabled: true,
      includeCalendar: false,
    },
    weeklySchedule: {
      enabled: true,
      dayOfWeek: 'Monday',
      sendTime: '08:00',
    },
  },

  // Frontend URL for links in emails
  frontend: {
    url: process.env.FRONTEND_URL || '',
    passwordResetPath: '/reset-password',
    emailVerificationPath: '/verify-email',
    appointmentPath: '/appointments',
  },
};

const runtimeEnv = process.env.NODE_ENV || 'development';

/**
 * Email Message Types
 */
const EMAIL_TYPES = {
  OTP_EMAIL: 'otp_email',
  PASSWORD_RESET: 'password_reset',
  PASSWORD_RESET_CONFIRMATION: 'password_reset_confirmation',
  EMAIL_VERIFICATION: 'email_verification',
  APPOINTMENT_CONFIRMATION: 'appointment_confirmation',
  APPOINTMENT_REMINDER: 'appointment_reminder',
  APPOINTMENT_CANCELLATION: 'appointment_cancellation',
  WEEKLY_SCHEDULE: 'weekly_schedule',
  ADMIN_LOGIN_NOTIFICATION: 'admin_login_notification',
  FAILED_LOGIN_NOTIFICATION: 'failed_login_notification',
  ACCOUNT_CREATED: 'account_created',
  WELCOME_EMAIL: 'welcome_email',
};

/**
 * Create SMTP transporter
 * @returns {Object} Nodemailer transporter
 */
function createSMTPTransporter() {
  const { smtp } = EMAIL_CONFIG;

  const transporterConfig = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    tls: smtp.tls,
  };

  // Add authentication if credentials are provided
  if (smtp.user && smtp.password) {
    transporterConfig.auth = {
      user: smtp.user,
      pass: smtp.password,
    };
  }

  // For development, create a test account if using Mailtrap/Ethereal
  if (process.env.NODE_ENV === 'development' && (!smtp.user || !smtp.password)) {
    logger.warn('Email configuration incomplete - using ethereal test mode');
  }

  return nodemailer.createTransport(transporterConfig);
}

/**
 * Create Resend transporter
 * @returns {Object} Resend transporter
 */
async function createResendTransporter() {
  if (!EMAIL_CONFIG.resend.enabled || !EMAIL_CONFIG.resend.apiKey) {
    throw new Error('Resend API not configured');
  }

  // Dynamic import for Resend (ESM module)
  try {
    const { Resend } = require('resend');
    const resend = new Resend(EMAIL_CONFIG.resend.apiKey);

    return {
      sendMail: async (options) => {
        const result = await resend.emails.send({
          from: options.from || EMAIL_CONFIG.resend.from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text,
        });
        return { messageId: result.data?.id };
      },
    };
  } catch (error) {
    logger.error('Failed to create Resend transporter:', error);
    throw error;
  }
}

/**
 * Create MailerSend transporter
 * @returns {Object} MailerSend transporter
 */
async function createMailerSendTransporter() {
  if (!EMAIL_CONFIG.mailersend.enabled || !EMAIL_CONFIG.mailersend.apiKey) {
    throw new Error('MailerSend API not configured');
  }

  const apiKey = EMAIL_CONFIG.mailersend.apiKey;

  return {
    name: 'MailerSend',
    version: '1.0.0',
    sendMail: async (mailOptions) => {
      // Parse "Name <email>" format if necessary
      let fromEmail = EMAIL_CONFIG.from.address;
      let fromName = EMAIL_CONFIG.from.name;

      if (fromEmail.includes('<')) {
        const match = fromEmail.match(/(.*)<(.*)>/);
        if (match) {
          fromName = match[1].trim();
          fromEmail = match[2].trim();
        }
      }

      const data = {
        from: {
          email: fromEmail,
          name: fromName,
        },
        to: Array.isArray(mailOptions.to) ? mailOptions.to.map(email => ({ email })) : [{ email: mailOptions.to }],
        subject: mailOptions.subject,
        text: mailOptions.text,
        html: mailOptions.html,
      };

      try {
        const response = await axios.post('https://api.mailersend.com/v1/email', data, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        return { messageId: response.headers['x-message-id'] || 'sent-via-mailersend' };
      } catch (error) {
        logger.error('MailerSend Error:', error.response?.data || error.message);
        throw error;
      }
    },
    verify: async () => true,
  };
}

/**
 * Get email transporter based on configuration
 * @returns {Object} Configured transporter
 */
async function getTransporter() {
  // Prefer MailerSend if configured
  if (EMAIL_CONFIG.mailersend.enabled && EMAIL_CONFIG.mailersend.apiKey) {
    try {
      return await createMailerSendTransporter();
    } catch (error) {
      logger.warn('MailerSend transporter failed, falling back to Resend/SMTP:', error.message);
    }
  }

  // Prefer Resend if configured
  if (EMAIL_CONFIG.resend.enabled && EMAIL_CONFIG.resend.apiKey) {
    try {
      return await createResendTransporter();
    } catch (error) {
      logger.warn('Resend transporter failed, falling back to SMTP:', error.message);
    }
  }

  // Fall back to SMTP
  return createSMTPTransporter();
}

/**
 * Validate email configuration
 * @returns {Object} Validation result
 */
async function validateConfig(options = {}) {
  const { skipConnectionVerification = false } = options;
  const errors = [];
  const warnings = [];
  const info = [];

  // Check global disable flag
  if (EMAIL_CONFIG.emailDisabled) {
    warnings.push('EMAIL_DISABLED is set to true. Emails will not be sent (dry-run mode).');
  }

  // Check SMTP configuration
  if (runtimeEnv !== 'production' && !EMAIL_CONFIG.smtp.host) {
    warnings.push('SMTP host not configured (SMTP_HOST)');
  }

  if (!EMAIL_CONFIG.smtp.port) {
    warnings.push('SMTP port not configured, using default');
  }

  // Check credentials
  if (!EMAIL_CONFIG.smtp.user || !EMAIL_CONFIG.smtp.password) {
    warnings.push('SMTP credentials not configured - emails may not send');
  }

  // Check sender address
  if (!EMAIL_CONFIG.from.address) {
    errors.push('Sender email not configured (EMAIL_FROM)');
  }

  // Validate Resend configuration if enabled
  if (EMAIL_CONFIG.resend.enabled) {
    if (!EMAIL_CONFIG.resend.apiKey) {
      errors.push('Resend API key configured but missing (RESEND_API_KEY)');
    } else {
      info.push('Resend API is enabled and configured');
    }
  }

  // Validate MailerSend configuration if enabled
  if (EMAIL_CONFIG.mailersend.enabled) {
    if (!EMAIL_CONFIG.mailersend.apiKey) {
      warnings.push('MailerSend API key missing (MAILERSEND_API_KEY)');
    } else {
      info.push('MailerSend API is enabled and configured');
    }
  }

  // Check frontend URL
  if (!EMAIL_CONFIG.frontend.url) {
    warnings.push('Frontend URL not configured - email links may be broken');
  }

  const hasMailerSend = !!EMAIL_CONFIG.mailersend.apiKey;
  const hasResend = !!EMAIL_CONFIG.resend.apiKey;
  const hasSmtp = !!(
    EMAIL_CONFIG.smtp.host &&
    EMAIL_CONFIG.smtp.user &&
    EMAIL_CONFIG.smtp.password
  );

  if (!hasMailerSend && !hasResend && !hasSmtp) {
    if (runtimeEnv === 'production') {
      errors.push(
        'No email provider configured. Configure MAILERSEND_API_KEY, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASSWORD.',
      );
    } else {
      warnings.push(
        'No email provider configured. Configure MAILERSEND_API_KEY, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASSWORD.',
      );
    }
  }

  // Validate port number
  const port = EMAIL_CONFIG.smtp.port;
  if (port !== 25 && port !== 465 && port !== 587 && port !== 2525) {
    warnings.push(`SMTP port ${port} is unusual (standard ports: 25, 465, 587, 2525)`);
  }

  const isValid = errors.length === 0;

  // Try to verify connection if SMTP is configured
  if (isValid && hasSmtp && !skipConnectionVerification) {
    try {
      const transporter = createSMTPTransporter();
      await transporter.verify();
      info.push('SMTP connection verified successfully');
    } catch (error) {
      warnings.push(`SMTP connection verification failed: ${error.message}`);
    }
  }

  if (!isValid) {
    logger.error('Email Configuration Validation Failed', { errors });
  } else if (warnings.length > 0) {
    logger.warn('Email Configuration Warnings', { warnings });
  }

  return {
    valid: isValid,
    errors,
    warnings,
    info,
    configured: isValid,
  };
}

/**
 * Get email configuration status
 * @returns {Object} Configuration status
 */
async function getConfigStatus() {
  const validation = await validateConfig({ skipConnectionVerification: true });

  // Determine provider
  let provider = 'SMTP';
  if (EMAIL_CONFIG.mailersend.enabled && EMAIL_CONFIG.mailersend.apiKey) {
    provider = 'MailerSend';
  } else if (EMAIL_CONFIG.resend.enabled && EMAIL_CONFIG.resend.apiKey) {
    provider = 'Resend';
  }

  // Check if using default values
  const isDefaultSMTP = EMAIL_CONFIG.smtp.host === 'localhost' && EMAIL_CONFIG.smtp.port === 587;

  return {
    provider,
    configured: validation.valid,
    emailDisabled: EMAIL_CONFIG.emailDisabled,
    smtp: {
      host: isDefaultSMTP ? 'localhost (default)' : EMAIL_CONFIG.smtp.host,
      port: EMAIL_CONFIG.smtp.port,
      secure: EMAIL_CONFIG.smtp.secure,
      credentialsConfigured: !!(EMAIL_CONFIG.smtp.user && EMAIL_CONFIG.smtp.password),
    },
    mailersend: {
      enabled: EMAIL_CONFIG.mailersend.enabled,
    },
    resend: {
      enabled: EMAIL_CONFIG.resend.enabled,
      fromConfigured: !!EMAIL_CONFIG.resend.from,
    },
    from: {
      address: EMAIL_CONFIG.from.address,
      name: EMAIL_CONFIG.from.name,
    },
    frontend: {
      url: EMAIL_CONFIG.frontend.url,
    },
    rateLimit: {
      maxPerHour: EMAIL_CONFIG.rateLimit.maxPerHour,
      maxPerDay: EMAIL_CONFIG.rateLimit.maxPerDay,
    },
    emailTypes: {
      otp: EMAIL_CONFIG.emailTypes.otp.enabled,
      passwordReset: EMAIL_CONFIG.emailTypes.passwordReset.enabled,
      appointmentConfirmation: EMAIL_CONFIG.emailTypes.appointmentConfirmation.enabled,
      weeklySchedule: EMAIL_CONFIG.emailTypes.weeklySchedule.enabled,
    },
    validation: {
      errors: validation.errors,
      warnings: validation.warnings,
      info: validation.info,
    },
  };
}

/**
 * Check if email is properly configured for production
 * @returns {boolean}
 */
async function isProductionReady() {
  const validation = await validateConfig({ skipConnectionVerification: true });

  // Must have valid SMTP or Resend
  if (!validation.valid) {
    return false;
  }

  // Should have credentials
  if (!EMAIL_CONFIG.smtp.user || !EMAIL_CONFIG.smtp.password) {
    return false;
  }

  // Should have proper sender
  if (!EMAIL_CONFIG.from.address || EMAIL_CONFIG.from.address.includes('localhost')) {
    return false;
  }

  return true;
}

/**
 * Get masked configuration for logging
 * @returns {Object} Masked configuration
 */
function getMaskedConfig() {
  return {
    smtp: {
      host: EMAIL_CONFIG.smtp.host,
      port: EMAIL_CONFIG.smtp.port,
      secure: EMAIL_CONFIG.smtp.secure,
      user: EMAIL_CONFIG.smtp.user ? '***' : 'not set',
      password: EMAIL_CONFIG.smtp.password ? '***' : 'not set',
    },
    from: {
      address: EMAIL_CONFIG.from.address,
      name: EMAIL_CONFIG.from.name,
    },
    mailersend: {
      enabled: EMAIL_CONFIG.mailersend.enabled,
      apiKey: EMAIL_CONFIG.mailersend.apiKey ? '***' + EMAIL_CONFIG.mailersend.apiKey.slice(-4) : 'not set',
    },
    resend: {
      enabled: EMAIL_CONFIG.resend.enabled,
      apiKey: EMAIL_CONFIG.resend.apiKey ? '***' + EMAIL_CONFIG.resend.apiKey.slice(-4) : 'not set',
      from: EMAIL_CONFIG.resend.from,
    },
  };
}

// Email templates configuration
const EMAIL_TEMPLATES = {
  // OTP Email Template
  OTP: {
    subject: 'Your Verification Code - Immunicare',
    variables: ['firstName', 'verificationCode', 'expiryMinutes'],
  },

  // Password Reset Template
  PASSWORD_RESET: {
    subject: 'Password Reset Request - Immunicare',
    variables: ['username', 'resetLink', 'expiryMinutes', 'ipAddress'],
  },

  // Password Reset Confirmation
  PASSWORD_RESET_CONFIRMATION: {
    subject: 'Password Changed Successfully - Immunicare',
    variables: ['username', 'timestamp', 'ipAddress'],
  },

  // Email Verification
  EMAIL_VERIFICATION: {
    subject: 'Verify Your Email - Immunicare',
    variables: ['firstName', 'verificationLink', 'expiryHours'],
  },

  // Appointment Confirmation
  APPOINTMENT_CONFIRMATION: {
    subject: 'Appointment Confirmed - Immunicare',
    variables: ['guardianName', 'childName', 'vaccineName', 'appointmentDate', 'appointmentTime', 'location'],
  },

  // Weekly Schedule
  WEEKLY_SCHEDULE: {
    subject: 'Weekly Vaccination Schedule - Immunicare',
    variables: ['guardianName', 'scheduleDetails', 'weekStartDate'],
  },
};

/**
 * Generate email HTML with basic styling
 * @param {string} title - Email title
 * @param {string} content - Email content HTML
 * @returns {string} Full HTML document
 */
function generateEmailHTML(title, content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .email-wrapper {
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background: #0066cc;
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .content {
      padding: 30px 20px;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: #0066cc;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      margin: 20px 0;
      font-weight: 500;
    }
    .button-primary {
      background: #0066cc;
    }
    .button-danger {
      background: #dc3545;
    }
    .footer {
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #666;
      background: #f9f9f9;
    }
    .warning-box {
      background: #fff3cd;
      border: 1px solid #ffc107;
      padding: 12px;
      border-radius: 4px;
      margin: 15px 0;
    }
    .info-box {
      background: #e7f3ff;
      border: 1px solid #0066cc;
      padding: 12px;
      border-radius: 4px;
      margin: 15px 0;
    }
    .code-box {
      background: #f8f9fa;
      border: 2px dashed #dee2e6;
      padding: 15px;
      text-align: center;
      font-size: 24px;
      font-weight: bold;
      letter-spacing: 4px;
      margin: 20px 0;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="email-wrapper">
      <div class="header">
        <h1>${title}</h1>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>This is an automated message from Immunicare.</p>
        <p>© ${new Date().getFullYear()} Immunicare. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// Initialize configuration validation on module load
setImmediate(() => {
  validateConfig({ skipConnectionVerification: true })
    .then(validation => {
      if (validation.valid) {
        logger.info('Email Service Initialized', {
          provider: EMAIL_CONFIG.mailersend.enabled ? 'MailerSend' : (EMAIL_CONFIG.resend.enabled ? 'Resend' : 'SMTP'),
          from: EMAIL_CONFIG.from.address,
          host: EMAIL_CONFIG.smtp.host,
        });
      } else {
        logger.error('Email Service Initialization Issues', {
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }
    })
    .catch(error => {
      logger.error('Email Service Initialization Failed', { error: error.message });
    });
});

module.exports = {
  // Configuration
  EMAIL_CONFIG,
  EMAIL_TYPES,
  EMAIL_TEMPLATES,

  // Functions
  createSMTPTransporter,
  createResendTransporter,
  createMailerSendTransporter,
  getTransporter,
  validateConfig,
  getConfigStatus,
  isProductionReady,
  getMaskedConfig,
  generateEmailHTML,
};
