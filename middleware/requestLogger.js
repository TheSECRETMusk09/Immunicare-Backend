/**
 * Request Logging Middleware
 * Logs all incoming requests and responses for debugging and auditing
 */

const logger = require('../config/logger');

/**
 * Request logging middleware
 * Logs request details including method, path, headers, and timing
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Attach request ID to request for tracking
  req.requestId = requestId;

  // Log incoming request
  logger.info('Incoming request:', {
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    user: req.user?.id || 'anonymous',
  });

  // Capture response finish event
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      user: req.user?.id || 'anonymous',
    };

    if (res.statusCode >= 500) {
      logger.error('Request completed with server error:', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request completed with client error:', logData);
    } else {
      logger.info('Request completed successfully:', logData);
    }
  });

  // Capture response errors
  res.on('error', (error) => {
    logger.error('Response error:', {
      requestId,
      error: error.message,
      stack: error.stack,
    });
  });

  next();
};

/**
 * Security headers middleware
 * Adds security headers to all responses
 */
const securityHeaders = (req, res, next) => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Remove server identification
  res.removeHeader('X-Powered-By');

  next();
};

module.exports = {
  requestLogger,
  securityHeaders,
};
