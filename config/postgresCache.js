const { Pool } = require('pg');
const logger = require('./logger');
const loadBackendEnv = require('./loadEnv');
loadBackendEnv();
const { getPrimaryDbPassword, getPrimaryDbUser } = require('./dbCredentials');
const { isReadOnlyRuntime } = require('../utils/runtimeStorage');

const FATAL_DB_CONFIG_ERROR_CODES = new Set([
  '28P01',
  '28000',
  '3D000',
  '3F000',
  '42501',
]);

const isFatalDbConfigError = (code) => FATAL_DB_CONFIG_ERROR_CODES.has(code);

const runtimeEnv = process.env.NODE_ENV || 'development';
const isServerlessRuntime = isReadOnlyRuntime();
const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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

const dbSslEnabled = parseBoolean(process.env.DB_SSL, false);
const sslConfig = dbSslEnabled
  ? {
      rejectUnauthorized: parseBoolean(
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        runtimeEnv === 'production' || runtimeEnv === 'hostinger',
      ),
      ca: process.env.DB_SSL_CA ? Buffer.from(process.env.DB_SSL_CA, 'base64').toString() : undefined,
      cert: process.env.DB_SSL_CERT ? Buffer.from(process.env.DB_SSL_CERT, 'base64').toString() : undefined,
      key: process.env.DB_SSL_KEY ? Buffer.from(process.env.DB_SSL_KEY, 'base64').toString() : undefined,
    }
  : false;

const host = process.env.DB_HOST || parsedConnectionHost || (runtimeEnv === 'production' ? '' : 'localhost');
const port = parseInteger(process.env.DB_PORT, 5432);
const database = process.env.DB_NAME || parsedConnectionDatabase || (runtimeEnv === 'production' ? '' : 'immunicare_dev');
const user = getPrimaryDbUser() || parsedConnectionUser || (runtimeEnv === 'production' ? '' : 'postgres');
const password = getPrimaryDbPassword() || parsedConnectionPassword;

if (runtimeEnv === 'production') {
  const missing = [];
  if (!connectionString && !host) {
    missing.push('DB_HOST');
  }
  if (!connectionString && !database) {
    missing.push('DB_NAME');
  }
  if (!connectionString && !user) {
    missing.push('DB_USER');
  }
  if (!connectionString && !password) {
    missing.push('DB_PASSWORD');
  }

  if (missing.length > 0) {
    throw new Error(`PostgreSQL cache requires production DB credentials: ${missing.join(', ')}`);
  }
}

// PostgreSQL connection for cache
const cachePool = new Pool({
  ...(connectionString ? { connectionString } : {}),
  host,
  port: parseInteger(process.env.DB_PORT || parsedConnectionPort, port),
  database,
  user,
  password,
  ssl: sslConfig,
  max: parseInteger(process.env.DB_POOL_MAX, isServerlessRuntime ? 2 : 20),
  idleTimeoutMillis: parseInteger(process.env.DB_IDLE_TIMEOUT, isServerlessRuntime ? 10000 : 30000),
  connectionTimeoutMillis: parseInteger(process.env.DB_CONNECTION_TIMEOUT, isServerlessRuntime ? 20000 : 10000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  allowExitOnIdle: isServerlessRuntime,
});

let cacheDisabled = false;

// Cache client that mimics Redis API
const postgresCache = {
  // Initialize cache connection
  async connect() {
    if (cacheDisabled) {
      return false;
    }

    try {
      const client = await cachePool.connect();
      logger.info('PostgreSQL cache connected successfully');
      client.release();
      return true;
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return false;
      }

      logger.error('PostgreSQL cache connection error:', error);
      return false;
    }
  },

  // Get value from cache
  async get(key) {
    if (cacheDisabled) {
      return null;
    }

    try {
      const query = 'SELECT get_cache_value($1) as value';
      const result = await cachePool.query(query, [key]);

      if (result.rows[0] && result.rows[0].value) {
        // Try to parse as JSON, return as string if fails
        try {
          return JSON.parse(result.rows[0].value);
        } catch {
          return result.rows[0].value;
        }
      }
      return null;
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache get disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return null;
      }

      logger.error('Cache get error:', error);
      return null;
    }
  },

  // Set value in cache (without expiration)
  async set(key, value) {
    if (cacheDisabled) {
      return null;
    }

    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const query = 'SELECT set_cache_value($1, $2, NULL)';
      await cachePool.query(query, [key, stringValue]);
      return 'OK';
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache set disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return null;
      }

      logger.error('Cache set error:', error);
      return null;
    }
  },

  // Set value in cache with expiration (in seconds)
  async setex(key, seconds, value) {
    if (cacheDisabled) {
      return null;
    }

    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const query = 'SELECT set_cache_value($1, $2, $3)';
      await cachePool.query(query, [key, stringValue, seconds]);
      return 'OK';
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache setex disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return null;
      }

      logger.error('Cache setex error:', error);
      return null;
    }
  },

  // Delete value from cache
  async del(key) {
    if (cacheDisabled) {
      return 0;
    }

    try {
      const query = 'SELECT delete_cache_value($1)';
      await cachePool.query(query, [key]);
      return 1;
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache del disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return 0;
      }

      logger.error('Cache del error:', error);
      return 0;
    }
  },

  // Get all keys matching pattern
  async keys(pattern = '%') {
    if (cacheDisabled) {
      return [];
    }

    try {
      const query = 'SELECT * FROM get_cache_keys($1)';
      const result = await cachePool.query(query, [pattern]);
      return result.rows.map((row) => row.cache_key);
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache keys disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return [];
      }

      logger.error('Cache keys error:', error);
      return [];
    }
  },

  // Clear all cache
  async flushall() {
    if (cacheDisabled) {
      return null;
    }

    try {
      const query = 'SELECT clear_all_cache()';
      await cachePool.query(query);
      return 'OK';
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache flushall disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return null;
      }

      logger.error('Cache flushall error:', error);
      return null;
    }
  },

  // Clean up expired cache entries
  async cleanup() {
    if (cacheDisabled) {
      return 0;
    }

    try {
      const query = 'SELECT cleanup_expired_cache()';
      const result = await cachePool.query(query);
      const deletedCount = result.rows[0].cleanup_expired_cache;
      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} expired cache entries`);
      }
      return deletedCount;
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache cleanup disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return 0;
      }

      logger.error('Cache cleanup error:', error);
      return 0;
    }
  },

  // Check if key exists
  async exists(key) {
    try {
      const value = await this.get(key);
      return value !== null ? 1 : 0;
    } catch (error) {
      logger.error('Cache exists error:', error);
      return 0;
    }
  },

  // Set multiple values
  async mset(keyValuePairs) {
    if (cacheDisabled) {
      return null;
    }

    try {
      const client = await cachePool.connect();
      try {
        await client.query('BEGIN');

        for (const [key, value] of Object.entries(keyValuePairs)) {
          const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
          await client.query('SELECT set_cache_value($1, $2, NULL)', [key, stringValue]);
        }

        await client.query('COMMIT');
        return 'OK';
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache mset disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return null;
      }

      logger.error('Cache mset error:', error);
      return null;
    }
  },

  // Get multiple values
  async mget(keys) {
    try {
      const values = [];
      for (const key of keys) {
        const value = await this.get(key);
        values.push(value);
      }
      return values;
    } catch (error) {
      logger.error('Cache mget error:', error);
      return keys.map(() => null);
    }
  },

  // Increment value
  async incr(key) {
    try {
      const currentValue = await this.get(key);
      const newValue = (parseInt(currentValue) || 0) + 1;
      await this.set(key, newValue.toString());
      return newValue;
    } catch (error) {
      logger.error('Cache incr error:', error);
      return null;
    }
  },

  // Decrement value
  async decr(key) {
    try {
      const currentValue = await this.get(key);
      const newValue = (parseInt(currentValue) || 0) - 1;
      await this.set(key, newValue.toString());
      return newValue;
    } catch (error) {
      logger.error('Cache decr error:', error);
      return null;
    }
  },

  // Get TTL (time to live) in seconds
  async ttl(key) {
    if (cacheDisabled) {
      return -2;
    }

    try {
      const query = `
        SELECT EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP)) as ttl
        FROM cache
        WHERE cache_key = $1
      `;
      const result = await cachePool.query(query, [key]);

      if (result.rows[0] && result.rows[0].ttl !== null) {
        return Math.max(0, Math.floor(result.rows[0].ttl));
      }
      return -1; // Key exists but no expiration
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache ttl disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return -2;
      }

      logger.error('Cache ttl error:', error);
      return -2; // Key does not exist
    }
  },

  // Event handler (for compatibility with Redis API)
  on(event, callback) {
    // PostgreSQL doesn't have the same event system as Redis
    // This is a no-op for compatibility
    if (event === 'connect') {
      // Call callback immediately since we're already connected
      setTimeout(() => callback(), 0);
    }
  },

  // Quit connection
  async quit() {
    if (cacheDisabled) {
      return 'OK';
    }

    try {
      await cachePool.end();
      logger.info('PostgreSQL cache connection closed');
      return 'OK';
    } catch (error) {
      logger.error('Cache quit error:', error);
      return null;
    }
  },

  // Get cache statistics
  async getStats() {
    if (cacheDisabled) {
      return {
        total_entries: 0,
        active_entries: 0,
        expired_entries: 0,
        disabled: true,
      };
    }

    try {
      const query = `
        SELECT
          COUNT(*) as total_entries,
          COUNT(CASE WHEN expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP THEN 1 END) as active_entries,
          COUNT(CASE WHEN expires_at < CURRENT_TIMESTAMP THEN 1 END) as expired_entries
        FROM cache
      `;
      const result = await cachePool.query(query);
      return result.rows[0];
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        cacheDisabled = true;
        logger.warn('PostgreSQL cache stats disabled due to DB authentication/configuration failure', {
          code: error.code,
          message: error.message,
        });
        return {
          total_entries: 0,
          active_entries: 0,
          expired_entries: 0,
          disabled: true,
        };
      }

      logger.error('Cache getStats error:', error);
      return null;
    }
  },
};

if (!isServerlessRuntime) {
  // Initialize cache connection
  postgresCache.connect().then((connected) => {
    if (connected) {
      logger.info('PostgreSQL cache initialized successfully');
    } else {
      logger.warn('PostgreSQL cache initialization failed, using fallback');
    }
  });

  // Schedule periodic cleanup of expired cache entries (every hour)
  setInterval(
    () => {
      postgresCache.cleanup();
    },
    60 * 60 * 1000,
  );
}

module.exports = postgresCache;
