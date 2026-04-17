const { Pool } = require('pg');
const loadBackendEnv = require('./config/loadEnv');
loadBackendEnv();
const { getPrimaryDbPassword, getPrimaryDbUser } = require('./config/dbCredentials');
const logger = require('./config/logger');
const { isReadOnlyRuntime } = require('./utils/runtimeStorage');

const runtimeEnv = process.env.NODE_ENV || 'development';
const isProductionLikeEnv = runtimeEnv === 'production' || runtimeEnv === 'hostinger';
const isServerlessRuntime = isReadOnlyRuntime();
const connectionString = String(process.env.DATABASE_URL || '').trim();

const parseConnectionString = (value) => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const parsedConnectionString = parseConnectionString(connectionString);
const parsedConnectionPassword = parsedConnectionString
  ? decodeURIComponent(parsedConnectionString.password || '')
  : '';
const parsedConnectionUser = parsedConnectionString
  ? decodeURIComponent(parsedConnectionString.username || '')
  : '';
const parsedConnectionHost = parsedConnectionString?.hostname || '';
const parsedConnectionPort = parsedConnectionString?.port || '';
const parsedConnectionDatabase = parsedConnectionString?.pathname
  ? decodeURIComponent(parsedConnectionString.pathname.replace(/^\//, ''))
  : '';

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
const requiredDbEnvVars = connectionString
  ? []
  : ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingDbEnvVars = requiredDbEnvVars.filter(envVar => !process.env[envVar]);

if (missingDbEnvVars.length > 0 && isProductionLikeEnv) {
  logger.error('CRITICAL: Missing required database configuration environment variables', {
    missing: missingDbEnvVars,
  });
  throw new Error('Production database configuration is incomplete');
}

if (connectionString && !parsedConnectionString) {
  throw new Error('DATABASE_URL is invalid and could not be parsed');
}

const dbPassword = getPrimaryDbPassword() || parsedConnectionPassword;
if (isProductionLikeEnv && !dbPassword && !connectionString) {
  throw new Error('Production DB_PASSWORD is required and cannot be empty');
}

if (!isProductionLikeEnv && process.env.DB_PASSWORD !== undefined && dbPassword.length === 0) {
  logger.warn(
    'DB_PASSWORD is set to an empty string. If PostgreSQL uses password/SCRAM authentication, set a non-empty DB_PASSWORD to avoid connection failures.',
  );
}

// Determine SSL configuration based on environment
const dbSslEnabled = parseBoolean(process.env.DB_SSL, false);
const sslConfig = dbSslEnabled
  ? {
    rejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, isProductionLikeEnv),
    ca: process.env.DB_SSL_CA ? Buffer.from(process.env.DB_SSL_CA, 'base64').toString() : undefined,
    cert: process.env.DB_SSL_CERT ? Buffer.from(process.env.DB_SSL_CERT, 'base64').toString() : undefined,
    key: process.env.DB_SSL_KEY ? Buffer.from(process.env.DB_SSL_KEY, 'base64').toString() : undefined,
  }
  : false;

if (isProductionLikeEnv && !dbSslEnabled) {
  logger.warn('DB_SSL is disabled in production. Enable TLS for database connections where supported.');
}

const host = process.env.DB_HOST || parsedConnectionHost || (isProductionLikeEnv ? '' : 'localhost');
const port = parseInteger(process.env.DB_PORT || parsedConnectionPort, 5432);
const database =
  process.env.DB_NAME || parsedConnectionDatabase || (isProductionLikeEnv ? '' : 'immunicare_dev');
const user = getPrimaryDbUser() || parsedConnectionUser || (isProductionLikeEnv ? '' : 'postgres');

const maxPoolSize = parseInteger(process.env.DB_POOL_MAX, isServerlessRuntime ? 3 : isProductionLikeEnv ? 30 : 20);
const minPoolSize = parseInteger(process.env.DB_POOL_MIN, isServerlessRuntime ? 0 : isProductionLikeEnv ? 2 : 0);
const idleTimeoutMillis = parseInteger(process.env.DB_IDLE_TIMEOUT, isServerlessRuntime ? 10000 : 60000);
const connectionTimeoutMillis = parseInteger(process.env.DB_CONNECTION_TIMEOUT, isServerlessRuntime ? 20000 : 15000);
const queryTimeoutMillis = parseInteger(process.env.DB_QUERY_TIMEOUT, 60000);
const statementTimeoutMillis = parseInteger(process.env.DB_STATEMENT_TIMEOUT, 60000);
const acquireTimeoutMillis = parseInteger(process.env.DB_ACQUIRE_TIMEOUT, 30000);

if (isServerlessRuntime && ['127.0.0.1', 'localhost', '::1'].includes(String(host || '').trim().toLowerCase())) {
  logger.warn(
    'Detected a loopback database host in a serverless runtime. Use a publicly reachable database host or DATABASE_URL for Vercel/Functions deployments.',
    { host },
  );
}

if (isProductionLikeEnv) {
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
  ...(connectionString ? { connectionString } : {}),
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
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  allowExitOnIdle: isServerlessRuntime,
};

const pool = new Pool(poolConfig);
const originalPoolEnd = pool.end.bind(pool);
let poolEndStarted = false;
let poolEndFinished = false;
let poolEndPromise = null;

const isPoolEnding = () => Boolean(poolEndStarted || pool.ended);
const isPoolUsable = () => !poolEndStarted && !pool.ended;
const isPoolEndedError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === 'POOL_ENDED' ||
    message.includes('cannot use a pool after calling end on the pool') ||
    message.includes('pool has already been closed') ||
    message.includes('database pool is closing')
  );
};

const warnIfPoolUnavailable = (context = 'database operation', details = {}) => {
  if (isPoolUsable()) {
    return false;
  }

  logger.warn('Skipping database operation because PostgreSQL pool is closing or closed', {
    context,
    poolEndStarted,
    poolEndFinished,
    poolEnded: Boolean(pool.ended),
    ...details,
  });
  return true;
};

pool.end = async (...args) => {
  if (poolEndFinished || pool.ended) {
    logger.debug('PostgreSQL pool end requested after pool was already closed');
    return undefined;
  }

  if (poolEndPromise) {
    logger.debug('PostgreSQL pool end already in progress');
    return poolEndPromise;
  }

  poolEndStarted = true;
  poolEndPromise = originalPoolEnd(...args)
    .then((result) => {
      poolEndFinished = true;
      return result;
    })
    .catch((error) => {
      if (!pool.ended) {
        poolEndStarted = false;
        poolEndPromise = null;
      }
      throw error;
    });

  return poolEndPromise;
};

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
      if (warnIfPoolUnavailable('queryWithRetry')) {
        const poolError = new Error('Database pool is closing or closed');
        poolError.code = 'POOL_ENDED';
        throw poolError;
      }
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
  if (warnIfPoolUnavailable('queryWithTimeout')) {
    const poolError = new Error('Database pool is closing or closed');
    poolError.code = 'POOL_ENDED';
    throw poolError;
  }

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
    if (warnIfPoolUnavailable('transaction')) {
      const poolError = new Error('Database pool is closing or closed');
      poolError.code = 'POOL_ENDED';
      throw poolError;
    }

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
  if (poolEndFinished || pool.ended) {
    logger.info('Database pool already closed');
    return;
  }

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
module.exports.isPoolEnding = isPoolEnding;
module.exports.isPoolUsable = isPoolUsable;
module.exports.isPoolEndedError = isPoolEndedError;
module.exports.warnIfPoolUnavailable = warnIfPoolUnavailable;
module.exports.poolConfig = poolConfig;
