const logger = require('../config/logger');

const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  req.requestId = requestId;

  logger.info('Incoming request:', {
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    user: req.user?.id || 'anonymous',
  });

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

  res.on('error', (error) => {
    logger.error('Response error:', {
      requestId,
      error: error.message,
      stack: error.stack,
    });
  });

  next();
};

const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  next();
};

module.exports = {
  requestLogger,
  securityHeaders,
};
