// PostgreSQL-based Cache Configuration
// This module now uses PostgreSQL instead of Redis for caching

const logger = require('./logger');

let cacheClient;

try {
  // Check if PostgreSQL cache is explicitly disabled
  if (process.env.CACHE_DISABLED === 'true') {
    console.warn('Cache explicitly disabled, using mock client');
    cacheClient = {
      on: () => {},
      get: async () => null,
      set: async () => {},
      setex: async () => {},
      del: async () => {},
      keys: async () => [],
      quit: async () => {}
    };
  } else {
    // Use PostgreSQL-based cache
    cacheClient = require('./postgresCache');
    console.log('Using PostgreSQL-based cache');
  }
} catch (err) {
  console.warn('PostgreSQL cache not available, using mock client');
  logger.error('Cache initialization error:', err);
  // Create a mock cache client for development
  cacheClient = {
    on: () => {},
    get: async () => null,
    set: async () => {},
    setex: async () => {},
    del: async () => {},
    keys: async () => [],
    quit: async () => {}
  };
}

module.exports = cacheClient;
