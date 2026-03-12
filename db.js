const { Pool } = require('pg');
const loadBackendEnv = require('./config/loadEnv');
loadBackendEnv();
const { getPrimaryDbPassword, getPrimaryDbUser } = require('./config/dbCredentials');
const logger = require('./config/logger');

const runtimeEnv = process.env.NODE_ENV || 'development';

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

const RETRYABLE_CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  '08006', // Connection failure
  '08003', // Connection does not exist
  '57P01', // Admin shutdown
  '57P02', // Crash shutdown
  '57P03', // Cannot connect now
]);

const FATAL_DB_CONFIG_ERROR_CODES = new Set([
  '28P01', // invalid_password
  '28000', // invalid_authorization_specification
  '3D000', // invalid_catalog_name (database does not exist)
  '3F000', // invalid_schema_name
  '42501', // insufficient_privilege
]);

const isRetryableConnectionError = (code) => RETRYABLE_CONNECTION_ERROR_CODES.has(code);
const isScramPasswordTypeError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('sasl') && message.includes('client password must be a string');
};

const isFatalDbConfigError = (errorOrCode) => {
  if (!errorOrCode) {
    return false;
  }

  if (typeof errorOrCode === 'string') {
    return FATAL_DB_CONFIG_ERROR_CODES.has(errorOrCode);
  }

  return FATAL_DB_CONFIG_ERROR_CODES.has(errorOrCode.code) || isScramPasswordTypeError(errorOrCode);
};

// Validate required production database configuration
const requiredDbEnvVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingDbEnvVars = requiredDbEnvVars.filter(envVar => !process.env[envVar]);

if (missingDbEnvVars.length > 0 && runtimeEnv === 'production') {
  logger.error('CRITICAL: Missing required database configuration environment variables', {
    missing: missingDbEnvVars,
  });
  throw new Error('Production database configuration is incomplete');
}

const dbPassword = getPrimaryDbPassword();
if (runtimeEnv === 'production' && !dbPassword) {
  throw new Error('Production DB_PASSWORD is required and cannot be empty');
}

if (runtimeEnv !== 'production' && process.env.DB_PASSWORD !== undefined && dbPassword.length === 0) {
  logger.warn(
    'DB_PASSWORD is set to an empty string. If PostgreSQL uses password/SCRAM authentication, set a non-empty DB_PASSWORD to avoid connection failures.',
  );
}

// Determine SSL configuration based on environment
const dbSslEnabled = parseBoolean(process.env.DB_SSL, false);
const sslConfig = dbSslEnabled
  ? {
    rejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, runtimeEnv === 'production'),
    ca: process.env.DB_SSL_CA ? Buffer.from(process.env.DB_SSL_CA, 'base64').toString() : undefined,
    cert: process.env.DB_SSL_CERT ? Buffer.from(process.env.DB_SSL_CERT, 'base64').toString() : undefined,
    key: process.env.DB_SSL_KEY ? Buffer.from(process.env.DB_SSL_KEY, 'base64').toString() : undefined,
  }
  : false;

if (runtimeEnv === 'production' && !dbSslEnabled) {
  logger.warn('DB_SSL is disabled in production. Enable TLS for database connections where supported.');
}

const host = process.env.DB_HOST || (runtimeEnv === 'production' ? '' : 'localhost');
const port = parseInteger(process.env.DB_PORT, 5432);
const database = process.env.DB_NAME || (runtimeEnv === 'production' ? '' : 'immunicare_dev');
const user = getPrimaryDbUser() || (runtimeEnv === 'production' ? '' : 'postgres');

const maxPoolSize = parseInteger(process.env.DB_POOL_MAX, runtimeEnv === 'production' ? 30 : 20);
const minPoolSize = parseInteger(process.env.DB_POOL_MIN, runtimeEnv === 'production' ? 2 : 0);
const idleTimeoutMillis = parseInteger(process.env.DB_IDLE_TIMEOUT, 60000);
const connectionTimeoutMillis = parseInteger(process.env.DB_CONNECTION_TIMEOUT, 15000);
const queryTimeoutMillis = parseInteger(process.env.DB_QUERY_TIMEOUT, 30000);
const statementTimeoutMillis = parseInteger(process.env.DB_STATEMENT_TIMEOUT, 30000);
const acquireTimeoutMillis = parseInteger(process.env.DB_ACQUIRE_TIMEOUT, 30000);

if (runtimeEnv === 'production') {
  const invalidPoolBounds = minPoolSize < 0 || maxPoolSize <= 0 || minPoolSize > maxPoolSize;
  if (invalidPoolBounds) {
    throw new Error('Invalid DB pool configuration: ensure DB_POOL_MIN >= 0 and DB_POOL_MAX >= DB_POOL_MIN');
  }

  if (connectionTimeoutMillis < 1000 || connectionTimeoutMillis > 60000) {
    throw new Error('Invalid DB_CONNECTION_TIMEOUT for production (expected between 1000 and 60000 ms)');
  }
}

// Pool configuration with production-ready settings
const poolConfig = {
  host,
  port,
  database,
  user,
  password: dbPassword,
  ssl: sslConfig,
  // Connection pool settings optimized for production
  max: maxPoolSize,
  min: minPoolSize,
  idleTimeoutMillis,
  connectionTimeoutMillis,
  query_timeout: queryTimeoutMillis,
  statement_timeout: statementTimeoutMillis,
  acquireTimeoutMillis,
  reapIntervalMillis: 1000, // Check for idle connections every 1s
  evictionRunIntervalMillis: 30000, // Run eviction every 30s
  numTestsPerEvictionRun: 3, // Test up to 3 connections per eviction
  application_name: 'immunicare-api',
};

const pool = new Pool(poolConfig);

// Pool event listeners with structured logging
pool.on('connect', (client) => {
  logger.info('PostgreSQL client connected', {
    client: client.processID,
    timestamp: new Date().toISOString(),
  });
});

pool.on('acquire', (client) => {
  logger.debug('PostgreSQL client acquired from pool', {
    client: client.processID,
  });
});

pool.on('release', (client) => {
  if (!client || !client.processID) {
    return; // Client may be null or already disconnected
  }
  logger.debug('PostgreSQL client released back to pool', {
    client: client.processID,
  });
});

pool.on('remove', (client) => {
  logger.info('PostgreSQL client removed from pool', {
    client: client.processID,
  });
});

pool.on('error', (err, client) => {
  logger.error('PostgreSQL pool error', {
    client: client?.processID,
    message: err.message,
    code: err.code,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Execute a query with automatic retry on connection errors
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Query result
 */
const queryWithRetry = async (text, params, options = {}) => {
  const { maxRetries = 2, retryDelay = 1000 } = options;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await pool.query(text, params);
      return result;
    } catch (err) {
      lastError = err;
      const errorCode = err?.code;

      if (isFatalDbConfigError(err)) {
        logger.error('Database query failed due to authentication/configuration error', {
          code: errorCode || 'DB_AUTH_CONFIG',
          message: err.message,
        });
        throw err;
      }

      // Only retry on transient connection-related errors
      if (!isRetryableConnectionError(errorCode) || attempt === maxRetries) {
        throw err;
      }

      logger.warn(
        `Database query failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`,
        {
          error: err.message,
          code: err.code,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
    }
  }

  throw lastError;
};

/**
 * Helper function to execute queries with timeout
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Query result
 */
const queryWithTimeout = async (text, params, timeoutMs = 10000) => {
  const client = await pool.connect();
  try {
    // Set statement timeout for this query
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
};

/**
 * Execute a transaction with automatic retry on deadlock
 * @param {Function} callback - Async function receiving client
 * @param {Object} options - Transaction options
 * @returns {Promise<any>} Transaction result
 */
const transaction = async (callback, options = {}) => {
  const {
    maxRetries = 3,
    retryDelay = 100,
    onRetry = null,
  } = options;

  let lastError;
  let client;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      client.release();
      return result;
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          logger.error('Rollback failed:', rollbackErr.message);
        }
      }

      lastError = err;

      // Check if deadlock or lock timeout
      const isRetryableError = (
        err.code === 'deadlock detected' ||
        err.code === '55P03' || // lock_not_available
        err.code === '55P04' || // lock_timeout
        err.code === '40001'   // serialization_failure
      );

      if (isRetryableError && attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        logger.warn(
          `Transaction retry (attempt ${attempt}/${maxRetries}) after ${delay}ms due to: ${err.message}`,
        );

        if (onRetry) {
          onRetry(err, attempt, maxRetries);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Non-retryable error or max retries reached
        throw err;
      }
    } finally {
      if (client && client.release) {
        try {
          client.release();
        } catch (releaseErr) {
          logger.error('Client release error:', releaseErr.message);
        }
      }
    }
  }

  throw lastError;
};

/**
 * Get pool statistics
 * @returns {Object} Pool statistics
 */
const getPoolStats = () => ({
  totalCount: pool.totalCount,
  idleCount: pool.idleCount,
  waitingCount: pool.waitingCount,
  maxCount: poolConfig.max,
});

/**
 * Health check for database connection
 * @returns {Promise<{healthy: boolean, latency: number, error: string|null}>}
 */
const healthCheck = async () => {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      healthy: true,
      latency: Date.now() - start,
      error: null,
      code: null,
    };
  } catch (err) {
    const derivedCode = err.code || (isScramPasswordTypeError(err) ? 'DB_PASSWORD_INVALID' : null);
    logger.error('Database health check failed', {
      error: err.message,
      code: derivedCode,
    });
    return {
      healthy: false,
      latency: Date.now() - start,
      error: err.message,
      code: derivedCode,
    };
  }
};

/**
 * Gracefully close all connections
 * @returns {Promise<void>}
 */
const close = async () => {
  logger.info('Closing database pool...');
  await pool.end();
  logger.info('Database pool closed');
};

module.exports = pool;
module.exports.queryWithTimeout = queryWithTimeout;
module.exports.queryWithRetry = queryWithRetry;
module.exports.transaction = transaction;
module.exports.getPoolStats = getPoolStats;
module.exports.healthCheck = healthCheck;
module.exports.close = close;
module.exports.poolConfig = poolConfig;
