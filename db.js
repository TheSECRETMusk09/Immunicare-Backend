const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const logger = require('./config/logger');

// Validate required production database configuration
const requiredDbEnvVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingDbEnvVars = requiredDbEnvVars.filter(envVar => !process.env[envVar]);

if (missingDbEnvVars.length > 0 && process.env.NODE_ENV === 'production') {
  logger.error('CRITICAL: Missing required database configuration environment variables', {
    missing: missingDbEnvVars,
  });
  throw new Error('Production database configuration is incomplete');
}

// Determine SSL configuration based on environment
const sslConfig =
  process.env.DB_SSL === 'true'
    ? {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      ca: process.env.DB_SSL_CA
        ? Buffer.from(process.env.DB_SSL_CA, 'base64').toString()
        : undefined,
      cert: process.env.DB_SSL_CERT
        ? Buffer.from(process.env.DB_SSL_CERT, 'base64').toString()
        : undefined,
      key: process.env.DB_SSL_KEY
        ? Buffer.from(process.env.DB_SSL_KEY, 'base64').toString()
        : undefined,
    }
    : false;

// Pool configuration with production-ready settings
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'immunicare_prod',
  user: process.env.DB_USER || 'immunicare_prod',
  password: String(process.env.DB_PASSWORD || ''),
  ssl: sslConfig,
  // Connection pool settings optimized for production
  max: parseInt(process.env.DB_POOL_MAX) || 30, // Reduced to 30 for production stability
  min: parseInt(process.env.DB_POOL_MIN) || 2, // Lower minimum for idle connections
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 60000, // Close idle after 60s
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 15000, // Increased to 15s
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 30000, // Query timeout
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || 30000, // Statement timeout
  acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 30000, // Wait up to 30s for available connection
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
      // Only retry on connection-related errors
      const isConnectionError = [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        '08006', // Connection failure
        '08003', // Connection does not exist
        '57P01', // Admin shutdown
        '57P02', // Crash shutdown
        '57P03', // Cannot connect now
      ].includes(err.code);

      if (!isConnectionError || attempt === maxRetries) {
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
    };
  } catch (err) {
    logger.error('Database health check failed', {
      error: err.message,
      code: err.code,
    });
    return {
      healthy: false,
      latency: Date.now() - start,
      error: err.message,
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
