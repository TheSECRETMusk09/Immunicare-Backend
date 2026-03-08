/**
 * Environment Variable Validator
 * Validates required environment variables at startup
 * Prevents server from starting with missing critical configuration
 */

const requiredEnvVars = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET'
];

const recommendedEnvVars = ['DB_PORT', 'PORT', 'FRONTEND_URL', 'NODE_ENV'];

const optionalSecurityVars = [
  'REDIS_URL',
  'SMS_PROVIDER',
  'TEXTBEE_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'SMTP_HOST',
  'SMTP_USER'
];

/**
 * Validates environment variables and returns validation result
 * @param {boolean} exitOnFailure - If true, exits process on missing required vars
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
function validateEnv(exitOnFailure = true) {
  const missing = [];
  const warnings = [];
  const info = [];

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
    if (process.env.JWT_SECRET.length < 32) {
      warnings.push('JWT_SECRET should be at least 32 characters for security');
    }
    if (
      process.env.JWT_SECRET === 'your-secret-key' ||
      process.env.JWT_SECRET === 'secret' ||
      process.env.JWT_SECRET === 'jwt-secret'
    ) {
      warnings.push(
        'JWT_SECRET appears to be a default/weak value - please use a strong secret in production'
      );
    }
  }

  // Validate JWT refresh secret strength
  if (process.env.JWT_REFRESH_SECRET) {
    if (process.env.JWT_REFRESH_SECRET.length < 32) {
      warnings.push('JWT_REFRESH_SECRET should be at least 32 characters for security');
    }
  }

  // Check for production-specific concerns
  if (process.env.NODE_ENV === 'production') {
    if (process.env.CSRF_DISABLED === 'true') {
      warnings.push('CSRF protection is disabled in production - this is a security risk');
    }
    if (!process.env.REDIS_URL) {
      warnings.push('Redis not configured - rate limiting may not work across multiple instances');
    }
  }

  // Log validation results
  if (missing.length > 0) {
    console.error('=========================================');
    console.error('FATAL: Missing required environment variables:');
    missing.forEach((v) => console.error(`  - ${v}`));
    console.error('=========================================');

    if (exitOnFailure) {
      console.error('Server cannot start without these variables.');
      console.error('Please check your .env file and try again.');
      process.exit(1);
    }
  }

  if (warnings.length > 0) {
    console.warn('=========================================');
    console.warn('Environment validation warnings:');
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
    console.warn('=========================================');
  }

  if (info.length > 0) {
    console.info('Info: Using defaults for optional variables:', info.join(', '));
  }

  if (missing.length === 0) {
    console.log('✓ Environment validation passed');
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
    info
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
  requiredEnvVars,
  recommendedEnvVars,
  optionalSecurityVars
};
