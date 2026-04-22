const winston = require('winston');
const path = require('path');

const REDACTION_PATTERNS = [
  /(\"?(?:token|password|secret|api[_-]?key|auth[_-]?token|refresh[_-]?token)\"?\s*[:=]\s*\"?)([^\",\s}]+)/gi,
  /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
];

const SANITIZE_LIMITS = {
  maxDepth: 8,
  maxArrayLength: 100,
  maxObjectKeys: 200,
  maxStringLength: 10000,
};

const redactString = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const redacted = REDACTION_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, '$1[REDACTED]'),
    value,
  );

  if (redacted.length <= SANITIZE_LIMITS.maxStringLength) {
    return redacted;
  }

  return `${redacted.slice(0, SANITIZE_LIMITS.maxStringLength)}...[TRUNCATED]`;
};

const createSanitizeContext = (context) => ({
  seen: context?.seen || new WeakSet(),
  depth: Number.isFinite(context?.depth) ? context.depth : 0,
});

const createNextSanitizeContext = (context) => ({
  seen: context.seen,
  depth: context.depth + 1,
});

const sanitizeMetadata = (value, contextInput) => {
  const context = createSanitizeContext(contextInput);

  if (value === null || value === undefined) {
    return value;
  }

  if (context.depth > SANITIZE_LIMITS.maxDepth) {
    return '[MaxDepthReached]';
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (typeof value === 'symbol') {
    return String(value);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer length=${value.length}]`;
  }

  if (value instanceof Error) {
    const nextContext = createNextSanitizeContext(context);
    return {
      name: value.name || 'Error',
      message: redactString(value.message || ''),
      stack: redactString(value.stack || ''),
      ...(value.code ? { code: value.code } : {}),
      ...(Number.isFinite(value.status) ? { status: value.status } : {}),
      ...(Number.isFinite(value.response?.status)
        ? { responseStatus: value.response.status }
        : {}),
      ...(value.response?.data !== undefined
        ? { responseData: sanitizeMetadata(value.response.data, nextContext) }
        : {}),
      ...(value.config
        ? {
          requestConfig: sanitizeMetadata(
            {
              url: value.config.url,
              method: value.config.method,
              timeout: value.config.timeout,
              baseURL: value.config.baseURL,
            },
            nextContext,
          ),
        }
        : {}),
    };
  }

  if (typeof value === 'object') {
    if (context.seen.has(value)) {
      return '[Circular]';
    }

    context.seen.add(value);
  }

  const nextContext = createNextSanitizeContext(context);

  if (Array.isArray(value)) {
    const limitedItems = value.slice(0, SANITIZE_LIMITS.maxArrayLength);
    const sanitizedItems = limitedItems.map((item) => sanitizeMetadata(item, nextContext));

    if (value.length > SANITIZE_LIMITS.maxArrayLength) {
      sanitizedItems.push(
        `[Truncated ${value.length - SANITIZE_LIMITS.maxArrayLength} additional items]`,
      );
    }

    return sanitizedItems;
  }

  if (typeof value === 'object') {
    const sanitized = {};
    const entries = Object.entries(value).slice(0, SANITIZE_LIMITS.maxObjectKeys);

    for (const [key, raw] of entries) {
      if (/(password|secret|token|api[_-]?key|auth[_-]?token|refresh[_-]?token)/i.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeMetadata(raw, nextContext);
      }
    }

    if (Object.keys(value).length > SANITIZE_LIMITS.maxObjectKeys) {
      sanitized.__truncated_keys__ =
        Object.keys(value).length - SANITIZE_LIMITS.maxObjectKeys;
    }

    return sanitized;
  }

  try {
    return redactString(String(value));
  } catch {
    return '[UnserializableValue]';
  }
};

const redactFormat = winston.format((info) => {
  const cloned = { ...info };
  cloned.message = redactString(cloned.message);

  for (const [key, value] of Object.entries(cloned)) {
    if (key === 'level' || key === 'message' || key === 'timestamp') {
      continue;
    }

    try {
      cloned[key] = sanitizeMetadata(value);
    } catch (sanitizeError) {
      cloned[key] = {
        message: '[SanitizationFailed]',
        reason: sanitizeError.message,
      };
    }
  }

  return cloned;
});

// Custom format for console output
const consoleFormat = winston.format.combine(
  redactFormat(),
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  }),
);

// Custom format for file output (JSON)
const fileFormat = winston.format.combine(
  redactFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// Determine log level based on environment
const logLevel =
  process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '..', 'logs');
const isReadOnlyRuntime = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.FUNCTION_TARGET ||
  process.env.K_SERVICE,
);

let fileLoggingEnabled = !isReadOnlyRuntime;

if (fileLoggingEnabled) {
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (error) {
    fileLoggingEnabled = false;
  }
}

const logger = winston.createLogger({
  level: logLevel,
  format: fileFormat,
  defaultMeta: {
    service: 'immunicare-api',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
      handleExceptions: true,
      handleRejections: true,
    }),
    // Error log file - for errors only
    ...(fileLoggingEnabled
      ? [
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
          handleExceptions: true,
          handleRejections: true,
        }),
        // Combined log file - all levels
        new winston.transports.File({
          filename: path.join(logsDir, 'combined.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        // Debug log file - for development
        ...(process.env.NODE_ENV !== 'production'
          ? [
            new winston.transports.File({
              filename: path.join(logsDir, 'debug.log'),
              level: 'debug',
              maxsize: 5242880, // 5MB
              maxFiles: 3,
            }),
          ]
          : []),
      ]
      : []),
  ],
  exceptionHandlers: fileLoggingEnabled
    ? [
      new winston.transports.File({
        filename: path.join(logsDir, 'exceptions.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
    ]
    : [],
  rejectionHandlers: fileLoggingEnabled
    ? [
      new winston.transports.File({
        filename: path.join(logsDir, 'rejections.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
    ]
    : [],
  exitOnError: false, // Do not exit on handled exceptions
});

// Create a child logger with request context
logger.createRequestLogger = (requestId, userId = null) => {
  return logger.child({
    requestId,
    userId,
  });
};

// Helper method to log with context
logger.logWithContext = (level, message, context = {}) => {
  logger.log(level, message, context);
};

// Performance logging helper
logger.logPerformance = (operation, durationMs, metadata = {}) => {
  logger.info(`Performance: ${operation} completed in ${durationMs}ms`, {
    operation,
    durationMs,
    ...metadata,
  });
};

// Security event logging helper
logger.logSecurity = (event, details = {}) => {
  logger.warn(`Security Event: ${event}`, {
    securityEvent: true,
    event,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

// Audit logging helper
logger.logAudit = (action, userId, details = {}) => {
  logger.info(`Audit: ${action}`, {
    audit: true,
    action,
    userId,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

// API request logging helper
logger.logRequest = (req, statusCode, durationMs) => {
  const logData = {
    method: req.method,
    path: req.path,
    statusCode,
    durationMs,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
    userId: req.user?.id || 'anonymous',
  };

  if (statusCode >= 400) {
    logger.warn('API Request Failed', logData);
  } else {
    logger.info('API Request', logData);
  }
};

logger.__testUtils = {
  redactString,
  sanitizeMetadata,
};

module.exports = logger;
