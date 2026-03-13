/**
 * Environment Variable Validator
 * Validates required environment variables at startup
 * Prevents server from starting with missing critical configuration
 */

const crypto = require('crypto');

const requiredEnvVars = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
];

const recommendedEnvVars = ['DB_PORT', 'PORT', 'FRONTEND_URL', 'NODE_ENV'];

const productionRequiredPresenceEnvVars = [
  'PORT',
  'FRONTEND_URL',
  'CLIENT_URL',
  'SESSION_SECRET',
  'SOCKET_CORS_ORIGIN',
  'ENABLE_METRICS',
  'DB_SSL',
];

const optionalSecurityVars = [
  'REDIS_URL',
  'SMS_PROVIDER',
  'TEXTBEE_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'SMTP_HOST',
  'SMTP_USER',
];

const hasNonEmptyEnv = (name) => {
  if (!(name in process.env)) {
    return false;
  }

  return String(process.env[name] || '').trim().length > 0;
};

const WEAK_SECRET_PATTERNS = [
  /^your[-_]?secret[-_]?key$/i,
  /^secret$/i,
  /^jwt[-_]?secret$/i,
  /^test[-_]/i,
  /^dev[-_]/i,
  /^changeme$/i,
  /^default$/i,
];

const hasSufficientSecretEntropy = (value) => {
  const normalized = String(value || '');
  if (normalized.length < 32) {
    return false;
  }

  const uniqueChars = new Set(normalized).size;
  if (uniqueChars < 12) {
    return false;
  }

  const digest = crypto.createHash('sha256').update(normalized).digest('hex');
  return Boolean(digest);
};

const isWeakSecret = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return true;
  }

  return WEAK_SECRET_PATTERNS.some((pattern) => pattern.test(normalized));
};

const isLikelyWeakDbPassword = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length < 16) {
    return true;
  }

  const commonWeak = ['postgres', 'password', 'admin', 'immunicare'];
  if (commonWeak.some((token) => normalized.toLowerCase().includes(token))) {
    return true;
  }

  return false;
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim().toLowerCase() === 'true';
};

const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOrigins = (...values) => {
  return values
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
};

const isValidHttpUrl = (value) => {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const validateProductionProviderConfig = (missing, warnings) => {
  const smsGateway = String(process.env.SMS_GATEWAY || process.env.SMS_PROVIDER || '').toLowerCase();
  if (!smsGateway) {
    warnings.push('SMS_GATEWAY is not configured. SMS features may fail in production.');
  } else if (smsGateway === 'textbee') {
    if (!process.env.TEXTBEE_API_KEY) {
      missing.push('TEXTBEE_API_KEY');
    }
    if (!process.env.TEXTBEE_DEVICE_ID) {
      missing.push('TEXTBEE_DEVICE_ID');
    }
  } else if (smsGateway === 'twilio') {
    ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'].forEach((name) => {
      if (!process.env[name]) {
        missing.push(name);
      }
    });
  } else if (smsGateway === 'semaphore') {
    if (!process.env.SEMAPHORE_API_KEY) {
      missing.push('SEMAPHORE_API_KEY');
    }
  } else if (smsGateway === 'log') {
    warnings.push('SMS_GATEWAY=log in production disables real SMS delivery.');
  }

  const hasMailerSend = Boolean(process.env.MAILERSEND_API_KEY);
  const hasResend = Boolean(process.env.RESEND_API_KEY);
  const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);

  if (!hasMailerSend && !hasResend && !hasSmtp) {
    warnings.push(
      'No email provider fully configured (MAILERSEND_API_KEY, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASSWORD).',
    );
  }

  if (!process.env.FRONTEND_URL || !isValidHttpUrl(process.env.FRONTEND_URL)) {
    missing.push('FRONTEND_URL');
  }

  if (!process.env.CLIENT_URL || !isValidHttpUrl(process.env.CLIENT_URL)) {
    missing.push('CLIENT_URL');
  }

  const corsOrigins = parseOrigins(
    process.env.CORS_ALLOWED_ORIGINS,
    process.env.CORS_ORIGIN,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
  );
  if (corsOrigins.length === 0) {
    missing.push('CORS_ALLOWED_ORIGINS');
  } else if (corsOrigins.some((origin) => !isValidHttpUrl(origin))) {
    missing.push('CORS_ALLOWED_ORIGINS');
  }

  const socketCorsOrigins = parseOrigins(process.env.SOCKET_CORS_ORIGIN);
  if (socketCorsOrigins.length === 0) {
    missing.push('SOCKET_CORS_ORIGIN');
  } else if (socketCorsOrigins.some((origin) => !isValidHttpUrl(origin))) {
    missing.push('SOCKET_CORS_ORIGIN');
  }

  const enableHttps = parseBoolean(process.env.ENABLE_HTTPS, false);
  if (enableHttps) {
    if (!process.env.SSL_KEY_PATH) {
      missing.push('SSL_KEY_PATH');
    }
    if (!process.env.SSL_CERT_PATH) {
      missing.push('SSL_CERT_PATH');
    }
  }
};

/**
 * Validates environment variables and returns validation result
 * @param {boolean} exitOnFailure - If true, exits process on missing required vars
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
function validateEnv(exitOnFailure = true) {
  const missing = [];
  const warnings = [];
  const info = [];
  const runtimeEnv = process.env.NODE_ENV || 'development';

  // Check required environment variables
  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check recommended environment variables
  for (const varName of recommendedEnvVars) {
    if (!process.env[varName]) {
      info.push(varName);
    }
  }

  // Validate JWT secret strength
  if (process.env.JWT_SECRET) {
    const jwtSecret = process.env.JWT_SECRET;
    if (!hasSufficientSecretEntropy(jwtSecret) || isWeakSecret(jwtSecret)) {
      if (runtimeEnv === 'production') {
        missing.push('JWT_SECRET');
      } else {
        warnings.push('JWT_SECRET is weak. Use a high-entropy secret (>=32 chars)');
      }
    }
  }

  // Validate JWT refresh secret strength
  if (process.env.JWT_REFRESH_SECRET) {
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!hasSufficientSecretEntropy(refreshSecret) || isWeakSecret(refreshSecret)) {
      if (runtimeEnv === 'production') {
        missing.push('JWT_REFRESH_SECRET');
      } else {
        warnings.push('JWT_REFRESH_SECRET is weak. Use a high-entropy secret (>=32 chars)');
      }
    }

    if (process.env.JWT_SECRET && refreshSecret === process.env.JWT_SECRET) {
      if (runtimeEnv === 'production') {
        missing.push('JWT_REFRESH_SECRET');
      } else {
        warnings.push('JWT_REFRESH_SECRET should be different from JWT_SECRET');
      }
    }
  }

  // Validate SESSION_SECRET strength in production
  if (process.env.SESSION_SECRET) {
    const sessionSecret = process.env.SESSION_SECRET;
    if (!hasSufficientSecretEntropy(sessionSecret) || isWeakSecret(sessionSecret)) {
      if (runtimeEnv === 'production') {
        missing.push('SESSION_SECRET');
      } else {
        warnings.push('SESSION_SECRET is weak. Use a high-entropy secret (>=32 chars)');
      }
    }
  }

  // Validate rate limit configuration
  const authRateLimitMax = parseInteger(process.env.AUTH_RATE_LIMIT_MAX, 0);
  if (authRateLimitMax > 0 && authRateLimitMax < 5 && runtimeEnv === 'production') {
    warnings.push('AUTH_RATE_LIMIT_MAX is very low (<5) for production. Consider increasing to prevent legitimate users from being rate-limited.');
  }
  if (authRateLimitMax > 1000) {
    warnings.push('AUTH_RATE_LIMIT_MAX is very high (>1000). This may not provide adequate protection against brute force attacks.');
  }

  const dbPassword = process.env.DB_PASSWORD;
  if (dbPassword && isLikelyWeakDbPassword(dbPassword)) {
    if (runtimeEnv === 'production') {
      missing.push('DB_PASSWORD');
    } else {
      warnings.push('DB_PASSWORD appears weak for production-grade deployments.');
    }
  }

  const dbPort = parseInteger(process.env.DB_PORT, 5432);
  if (dbPort <= 0 || dbPort > 65535) {
    missing.push('DB_PORT');
  }

  const poolMax = parseInteger(process.env.DB_POOL_MAX, 30);
  const poolMin = parseInteger(process.env.DB_POOL_MIN, 2);
  if (poolMin < 0 || poolMax <= 0 || poolMin > poolMax) {
    missing.push('DB_POOL_MIN/DB_POOL_MAX');
  }

  const connectionTimeout = parseInteger(process.env.DB_CONNECTION_TIMEOUT, 15000);
  if (connectionTimeout < 1000 || connectionTimeout > 60000) {
    warnings.push('DB_CONNECTION_TIMEOUT is outside recommended bounds (1000-60000 ms).');
  }

  if (runtimeEnv === 'production') {
    const dbSslEnabled = parseBoolean(process.env.DB_SSL, false);
    if (!dbSslEnabled) {
      warnings.push('DB_SSL is disabled in production. Enable TLS for database connections.');
    }
  }

  // Check for production-specific concerns
  if (runtimeEnv === 'production') {
    productionRequiredPresenceEnvVars.forEach((varName) => {
      if (!hasNonEmptyEnv(varName)) {
        missing.push(varName);
      }
    });

    if (process.env.CSRF_DISABLED === 'true') {
      warnings.push('CSRF_DISABLED=true - CSRF protection is disabled in production. This is not recommended.');
    }
    if (!process.env.REDIS_URL) {
      warnings.push('Redis not configured - rate limiting may not work across multiple instances');
    }

    validateProductionProviderConfig(missing, warnings);
  }

  const dedupedMissing = Array.from(new Set(missing));
  const dedupedWarnings = Array.from(new Set(warnings));

  // Log validation results
  if (dedupedMissing.length > 0) {
    console.error('=========================================');
    console.error('FATAL: Missing required environment variables:');
    dedupedMissing.forEach((v) => console.error(`  - ${v}`));
    console.error('=========================================');

    if (exitOnFailure) {
      console.error('Server cannot start without these variables.');
      console.error('Please check your .env file and try again.');
      process.exit(1);
    }
  }

  if (dedupedWarnings.length > 0) {
    console.warn('=========================================');
    console.warn('Environment validation warnings:');
    dedupedWarnings.forEach((w) => console.warn(`  ⚠ ${w}`));
    console.warn('=========================================');
  }

  if (info.length > 0) {
    console.info('Info: Using defaults for optional variables:', info.join(', '));
  }

  if (dedupedMissing.length === 0) {
    console.log('✓ Environment validation passed');
  }

  return {
    valid: dedupedMissing.length === 0,
    missing: dedupedMissing,
    warnings: dedupedWarnings,
    info,
  };
}

/**
 * Get environment variable with default value
 * @param {string} name - Environment variable name
 * @param {string} defaultValue - Default value if not set
 * @returns {string}
 */
function getEnv(name, defaultValue = '') {
  return process.env[name] || defaultValue;
}

/**
 * Get required environment variable (throws if missing)
 * @param {string} name - Environment variable name
 * @returns {string}
 */
function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Check if running in production
 * @returns {boolean}
 */
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development
 * @returns {boolean}
 */
function isDevelopment() {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

/**
 * Check if running in test mode
 * @returns {boolean}
 */
function isTest() {
  return process.env.NODE_ENV === 'test';
}

module.exports = {
  validateEnv,
  getEnv,
  getRequiredEnv,
  isProduction,
  isDevelopment,
  isTest,
  productionRequiredPresenceEnvVars,
  requiredEnvVars,
  recommendedEnvVars,
  optionalSecurityVars,
};
