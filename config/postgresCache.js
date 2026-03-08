require('dotenv').config();
const { Pool } = require('pg');
const logger = require('./logger');

// PostgreSQL connection for cache
const cachePool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Cache client that mimics Redis API
const postgresCache = {
  // Initialize cache connection
  async connect() {
    try {
      const client = await cachePool.connect();
      logger.info('PostgreSQL cache connected successfully');
      client.release();
      return true;
    } catch (error) {
      logger.error('PostgreSQL cache connection error:', error);
      return false;
    }
  },

  // Get value from cache
  async get(key) {
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
      logger.error('Cache get error:', error);
      return null;
    }
  },

  // Set value in cache (without expiration)
  async set(key, value) {
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const query = 'SELECT set_cache_value($1, $2, NULL)';
      await cachePool.query(query, [key, stringValue]);
      return 'OK';
    } catch (error) {
      logger.error('Cache set error:', error);
      return null;
    }
  },

  // Set value in cache with expiration (in seconds)
  async setex(key, seconds, value) {
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const query = 'SELECT set_cache_value($1, $2, $3)';
      await cachePool.query(query, [key, stringValue, seconds]);
      return 'OK';
    } catch (error) {
      logger.error('Cache setex error:', error);
      return null;
    }
  },

  // Delete value from cache
  async del(key) {
    try {
      const query = 'SELECT delete_cache_value($1)';
      await cachePool.query(query, [key]);
      return 1;
    } catch (error) {
      logger.error('Cache del error:', error);
      return 0;
    }
  },

  // Get all keys matching pattern
  async keys(pattern = '%') {
    try {
      const query = 'SELECT * FROM get_cache_keys($1)';
      const result = await cachePool.query(query, [pattern]);
      return result.rows.map((row) => row.cache_key);
    } catch (error) {
      logger.error('Cache keys error:', error);
      return [];
    }
  },

  // Clear all cache
  async flushall() {
    try {
      const query = 'SELECT clear_all_cache()';
      await cachePool.query(query);
      return 'OK';
    } catch (error) {
      logger.error('Cache flushall error:', error);
      return null;
    }
  },

  // Clean up expired cache entries
  async cleanup() {
    try {
      const query = 'SELECT cleanup_expired_cache()';
      const result = await cachePool.query(query);
      const deletedCount = result.rows[0].cleanup_expired_cache;
      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} expired cache entries`);
      }
      return deletedCount;
    } catch (error) {
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
      logger.error('Cache getStats error:', error);
      return null;
    }
  }
};

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
  60 * 60 * 1000
);

module.exports = postgresCache;
