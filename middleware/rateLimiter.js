console.log('rateLimiter: Starting imports...');
const rateLimit = require('express-rate-limit');
console.log('rateLimiter: express-rate-limit loaded');

const crypto = require('crypto');

const createIpKeyGenerator = () => {
  return (req) => {
    try {
      const ip =
        req.ip ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        req.get('X-Forwarded-For') ||
        '0.0.0.0';

      let normalizedIp = ip;

      if (normalizedIp === '::1' || normalizedIp === '::ffff:127.0.0.1') {
        normalizedIp = '127.0.0.1';
      }

      normalizedIp = normalizedIp.replace(/^::ffff:/, '');

      normalizedIp = normalizedIp.replace(/^\[|\]:\d+$/g, '');

      if (normalizedIp.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(normalizedIp)) {
        normalizedIp = crypto.createHash('md5').update(normalizedIp).digest('hex');
      }

      return normalizedIp;
    } catch {
      return 'fallback-key';
    }
  };
};

const customIpKeyGenerator = createIpKeyGenerator();

const getNormalizedRequestPhone = (req) =>
  String(req.body?.phone || req.body?.phoneNumber || req.body?.phone_number || '').replace(
    /\D+/g,
    ''
  );

const getNormalizedRequestEmail = (req) =>
  String(req.body?.email || '')
    .trim()
    .toLowerCase();

let redisClient = null;
let RedisStore = null;
let Redis = null;

const loadRedisModules = () => {
  if (RedisStore && Redis) {
    return true;
  }

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
  if (process.env.CACHE_DISABLED === 'true') {
    console.log('Rate limiter: CACHE_DISABLED=true, using memory store');
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

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

  async decrement() {}

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

const limCache = new Map();

const createLoginRateLimiter = () => {
  if (limCache.has('login')) {
    return limCache.get('login');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 15 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 15 * 60 * 1000,
    max: 200,
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
      }

      res.status(429).json(options.message);
    },
    skip: (req) => {
      if (process.env.NODE_ENV !== 'production') {
        return true;
      }
      if (req.path === '/api/health' || req.path === '/metrics') {
        return true;
      }
      return false;
    },
  });

  limCache.set('login', limiter);
  return limiter;
};

const createForgotPasswordRateLimiter = () => {
  if (limCache.has('forgot-password')) {
    return limCache.get('forgot-password');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 60 * 1000,
    max: 3,
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

  limCache.set('forgot-password', limiter);
  return limiter;
};

const createRegistrationRateLimiter = () => {
  if (limCache.has('register')) {
    return limCache.get('register');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 60 * 1000,
    max: 10,
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

  limCache.set('register', limiter);
  return limiter;
};

const createGeneralRateLimiter = () => {
  if (limCache.has('general')) {
    return limCache.get('general');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 1000,
    max: 100,
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

  limCache.set('general', limiter);
  return limiter;
};

const createAdminRateLimiter = () => {
  if (limCache.has('admin')) {
    return limCache.get('admin');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 1000,
    max: 200,
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

  limCache.set('admin', limiter);
  return limiter;
};

const createSMSRateLimiter = () => {
  if (limCache.has('sms')) {
    return limCache.get('sms');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 60 * 1000,
    max: 10,
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
      if (req.user && (req.user.role === 'super_admin' || req.user.role === 'admin')) {
        return true;
      }
      return false;
    },
  });

  limCache.set('sms', limiter);
  return limiter;
};

const createSMSVerificationRateLimiter = () => {
  if (limCache.has('sms-verification')) {
    return limCache.get('sms-verification');
  }

  const memoryStore = new SimpleMemoryStore({ windowMs: 60 * 60 * 1000 });

  const limiter = rateLimit({
    store: memoryStore,
    windowMs: 60 * 60 * 1000,
    max: 5,
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

      const isGuardianLogin =
        req.body?.role === 'guardian' ||
        req.body?.userType === 'guardian' ||
        (typeof req.body?.username === 'string' &&
          /^\+?\d{10,15}$/.test(req.body.username.replace(/[-_()\s]/g, '')));

      if (isGuardianLogin) {
        return true;
      }

      return false;
    },
  });

  limCache.set('sms-verification', limiter);
  return limiter;
};

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
  createSMSRateLimiter,
  createSMSVerificationRateLimiter,
};
