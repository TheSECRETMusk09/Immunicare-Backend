/**
 * Rate Limiting Middleware
 * Provides Redis-based rate limiting for authentication endpoints
 * Uses lazy loading to avoid IPv6 validation issues with express-rate-limit on Windows
 */

console.log('rateLimiter: Starting imports...');
const rateLimit = require('express-rate-limit');
console.log('rateLimiter: express-rate-limit loaded');

const crypto = require('crypto');

// Custom IPv6-safe key generator - handles both IPv4 and IPv6
const createIpKeyGenerator = () => {
  return (req) => {
    try {
      // Get IP address - handle both IPv4 and IPv6
      const ip =
        req.ip ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        req.get('X-Forwarded-For') ||
        '0.0.0.0';

      // Normalize IPv6 addresses
      let normalizedIp = ip;

      // Handle IPv6 localhost variants
      if (normalizedIp === '::1' || normalizedIp === '::ffff:127.0.0.1') {
        normalizedIp = '127.0.0.1';
      }

      // Remove IPv6 prefix if present
      normalizedIp = normalizedIp.replace(/^::ffff:/, '');

      // Remove port if present (IPv6 format with port: [::1]:5000)
      normalizedIp = normalizedIp.replace(/^\[|\]:\d+$/g, '');

      // If still contains colons and not a valid IPv4, it's likely an IPv6 address
      // Hash it to avoid any issues
      if (normalizedIp.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(normalizedIp)) {
        normalizedIp = crypto.createHash('md5').update(normalizedIp).digest('hex');
      }

      return normalizedIp;
    } catch {
      // Fallback to a fixed key if anything goes wrong
      return 'fallback-key';
    }
  };
};

// Create the key generator
const customIpKeyGenerator = createIpKeyGenerator();

const getNormalizedRequestPhone = (req) =>
  String(
    req.body?.phone || req.body?.phoneNumber || req.body?.phone_number || '',
  ).replace(/\D+/g, '');

const getNormalizedRequestEmail = (req) =>
  String(req.body?.email || '').trim().toLowerCase();

// Redis client configuration - lazy loaded
let redisClient = null;
let RedisStore = null;
let Redis = null;

// Lazy load Redis modules only when needed
const loadRedisModules = () => {
  if (RedisStore && Redis) {
    return true;
  }

  // Check if cache is disabled
  if (process.env.CACHE_DISABLED === 'true') {
    console.log('rateLimiter: CACHE_DISABLED=true, using memory store');
    return false;
  }

  try {
    RedisStore = require('rate-limit-redis').default;
    console.log('rateLimiter: rate-limit-redis loaded');
    Redis = require('ioredis');
    console.log('rateLimiter: ioredis loaded');
    return true;
  } catch {
    console.warn('rateLimiter: Failed to load Redis modules, using memory store:', error.message);
    return false;
  }
};

const initRedisClient = () => {
  // If cache is disabled, skip Redis initialization entirely
  if (process.env.CACHE_DISABLED === 'true') {
    console.log('Rate limiter: CACHE_DISABLED=true, using memory store');
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  // Lazy load Redis modules
  if (!loadRedisModules()) {
    return null;
  }

  try {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    redisClient.on('error', (err) => {
      console.warn('Redis rate limiter error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('Redis rate limiter connected');
    });

    return redisClient;
  } catch {
    console.warn('Redis not available, using memory store for rate limiting');
    return null;
  }
};

// Simple in-memory store for express-rate-limit
class SimpleMemoryStore {
  constructor(options) {
    this.windowMs = options.windowMs || 60000;
    this.hits = new Map();
  }

  async increment(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    if (!this.hits.has(key)) {
      this.hits.set(key, []);
    }

    const keyHits = this.hits.get(key);
    const validHits = keyHits.filter((time) => time > windowStart);
    validHits.push(now);
    this.hits.set(key, validHits);

    return {
      totalHits: validHits.length,
      resetTime: new Date(windowStart + this.windowMs),
    };
  }

  async decrement(_key) {
    // Optional
  }

  async resetKey(key) {
    this.hits.delete(key);
  }

  async get(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const keyHits = this.hits.get(key) || [];
    const validHits = keyHits.filter((time) => time > windowStart);

    if (validHits.length === 0) {
      return undefined;
    }

    return {
      totalHits: validHits.length,
      resetTime: new Date(windowStart + this.windowMs),
    };
  }

  resetAll() {
    this.hits.clear();
  }
}

// Cache for rate limiters to avoid recreating them
const rateLimiterCache = new Map();

// Login rate limiter - 200 attempts per 15 minutes (increased for testing)
const createLoginRateLimiter = () => {
  if (rateLimiterCache.has('login')) {
    return rateLimiterCache.get('login');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 15 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // 200 attempts for testing (increased from 100)
    message: {
      error: 'Too many login attempts. Please try again in 15 minutes.',
      code: 'RATE_LIMITED',
      retryAfter: 15 * 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ipKey = customIpKeyGenerator(req);
      const username = req.body?.username?.toLowerCase() || 'unknown';
      return `${ipKey}_${username}`;
    },
    handler: (req, res, next, options) => {
      try {
        const securityEventService = require('../services/securityEventService');
        securityEventService.logEvent({
          userId: null,
          eventType: 'API_RATE_LIMIT_EXCEEDED',
          severity: 'WARNING',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: {
            endpoint: '/api/auth/login',
            limit: options.totalHits,
            windowMs: options.windowMs,
          },
        });
      } catch {
        // Ignore if service not available
      }

      res.status(429).json(options.message);
    },
    skip: (req) => {
      if (req.path === '/api/health' || req.path === '/metrics') {
        return true;
      }
      return false;
    },
  });

  rateLimiterCache.set('login', limiter);
  return limiter;
};

// Forgot password rate limiter - 3 attempts per hour
const createForgotPasswordRateLimiter = () => {
  if (rateLimiterCache.has('forgot-password')) {
    return rateLimiterCache.get('forgot-password');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 attempts
    message: {
      error: 'Too many password reset requests. Please try again in 1 hour.',
      code: 'RATE_LIMITED',
      retryAfter: 60 * 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ipKey = customIpKeyGenerator(req);
      const email = req.body?.email?.toLowerCase() || 'unknown';
      return `${ipKey}_${email}`;
    },
    skip: (req) => {
      if (req.path === '/api/health' || req.path === '/metrics') {
        return true;
      }
      return false;
    },
  });

  rateLimiterCache.set('forgot-password', limiter);
  return limiter;
};

// Registration rate limiter - 10 attempts per hour
const createRegistrationRateLimiter = () => {
  if (rateLimiterCache.has('register')) {
    return rateLimiterCache.get('register');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 attempts
    message: {
      error: 'Too many registration attempts. Please try again in 1 hour.',
      code: 'RATE_LIMITED',
      retryAfter: 60 * 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ipKey = customIpKeyGenerator(req);
      const email = getNormalizedRequestEmail(req);
      const phone = getNormalizedRequestPhone(req);
      const identity = [email, phone].filter(Boolean).join('_') || 'unknown';
      return `${ipKey}_register_${identity}`;
    },
    skip: (req) => {
      if (req.path === '/api/health' || req.path === '/metrics') {
        return true;
      }
      return false;
    },
  });

  rateLimiterCache.set('register', limiter);
  return limiter;
};

// General API rate limiter - 100 requests per minute
const createGeneralRateLimiter = () => {
  if (rateLimiterCache.has('general')) {
    return rateLimiterCache.get('general');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests
    message: {
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
      retryAfter: 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: customIpKeyGenerator,
    skip: (req) => {
      if (req.path === '/api/health' || req.path === '/metrics' || req.path.startsWith('/static')) {
        return true;
      }
      if (req.user && (req.user.role === 'super_admin' || req.user.role === 'admin')) {
        return true;
      }
      return false;
    },
  });

  rateLimiterCache.set('general', limiter);
  return limiter;
};

// Strict rate limiter for admin endpoints - 200 requests per minute
const createAdminRateLimiter = () => {
  if (rateLimiterCache.has('admin')) {
    return rateLimiterCache.get('admin');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 1000, // 1 minute
    max: 200, // 200 requests
    message: {
      error: 'Too many admin requests. Please try again later.',
      code: 'RATE_LIMITED',
      retryAfter: 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ipKey = customIpKeyGenerator(req);
      const userId = req.user?.id || 'unknown';
      return `${ipKey}_${userId}`;
    },
    skip: (req) => {
      if (req.path === '/api/health' || req.path === '/metrics') {
        return true;
      }
      return false;
    },
  });

  rateLimiterCache.set('admin', limiter);
  return limiter;
};

// SMS rate limiter - 10 SMS per hour per phone number
const createSMSRateLimiter = () => {
  if (rateLimiterCache.has('sms')) {
    return rateLimiterCache.get('sms');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 SMS per hour
    message: {
      error: 'Too many SMS requests. Please try again in 1 hour.',
      code: 'SMS_RATE_LIMITED',
      retryAfter: 60 * 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ipKey = customIpKeyGenerator(req);
      const phone = getNormalizedRequestPhone(req) || 'unknown';
      return `${ipKey}_${phone}`;
    },
    skip: (req) => {
      if (req.path === '/api/health' || req.path === '/metrics') {
        return true;
      }
      // Skip for admin users
      if (req.user && (req.user.role === 'super_admin' || req.user.role === 'admin')) {
        return true;
      }
      return false;
    },
  });

  rateLimiterCache.set('sms', limiter);
  return limiter;
};

// SMS verification rate limiter - 5 verification attempts per hour per phone number
const createSMSVerificationRateLimiter = () => {
  if (rateLimiterCache.has('sms-verification')) {
    return rateLimiterCache.get('sms-verification');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 verification attempts per hour
    message: {
      error: 'Too many verification attempts. Please try again in 1 hour.',
      code: 'VERIFICATION_RATE_LIMITED',
      retryAfter: 60 * 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ipKey = customIpKeyGenerator(req);
      const phone = getNormalizedRequestPhone(req) || 'unknown';
      return `${ipKey}_verify_${phone}`;
    },
    skip: (req) => {
      if (req.path === '/api/health' || req.path === '/metrics') {
        return true;
      }
      return false;
    },
  });

  rateLimiterCache.set('sms-verification', limiter);
  return limiter;
};

// Create rate limiter based on configuration
const createRateLimiter = (type = 'general') => {
  switch (type) {
  case 'login':
    return createLoginRateLimiter();
  case 'forgot-password':
    return createForgotPasswordRateLimiter();
  case 'register':
    return createRegistrationRateLimiter();
  case 'admin':
    return createAdminRateLimiter();
  case 'sms':
    return createSMSRateLimiter();
  case 'sms-verification':
    return createSMSVerificationRateLimiter();
  default:
    return createGeneralRateLimiter();
  }
};

module.exports = {
  createLoginRateLimiter,
  createForgotPasswordRateLimiter,
  createRegistrationRateLimiter,
  createGeneralRateLimiter,
  createAdminRateLimiter,
  createRateLimiter,
  initRedisClient,
  SimpleMemoryStore,
  customIpKeyGenerator,
  // SMS Rate Limiters
  createSMSRateLimiter,
  createSMSVerificationRateLimiter,
};
