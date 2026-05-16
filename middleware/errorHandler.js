const logger = require('../config/logger');
const AUTH_ERROR_NAMES = new Set(['UnauthorizedError', 'JsonWebTokenError']);

class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, 500, 'DATABASE_ERROR');
  }
}

const fmtErrResp = (err, req, includeDetails = false) => {
  const response = {
    success: false,
    error: err.message || 'An unexpected error occurred',
    code: err.code || 'INTERNAL_ERROR',
  };

  if (Array.isArray(err.details)) response.details = err.details;
  if (req.requestId) response.requestId = req.requestId;

  if (includeDetails) {
    response.stack = err.stack;
    if (err.errors) response.errors = err.errors;
  }

  return response;
};

const errorHandler = (err, req, res, next) => {
  void next;

  const statusCode = err.statusCode || err.status || 500;
  const isOperational = err.isOperational || (statusCode >= 400 && statusCode < 500);
  const isDev = process.env.NODE_ENV === 'development';

  const ctx = {
    message: err.message,
    code: err.code || 'UNKNOWN_ERROR',
    statusCode,
    isOperational,
    path: req.path,
    method: req.method,
    user: req.user?.id,
    ip: req.ip,
    requestId: req.requestId,
  };

  if (statusCode >= 500) {
    logger.error('Server error:', { ...ctx, stack: err.stack });
  } else if (statusCode >= 400) {
    logger.warn('Client error:', ctx);
  }

  if (AUTH_ERROR_NAMES.has(err.name)) {
    return res.status(401).json(
      fmtErrResp(new AuthenticationError('Invalid or expired token'), req, isDev),
    );
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json(
      fmtErrResp(new AuthenticationError('Token has expired'), req, isDev),
    );
  }

  if (err.name === 'SyntaxError' && err.status === 400 && 'body' in err) {
    return res.status(400).json(
      fmtErrResp(new ValidationError('Invalid JSON in request body'), req, isDev),
    );
  }

  if (err.code === '23505') {
    return res.status(409).json(
      fmtErrResp(new ConflictError('A record with this information already exists'), req, isDev),
    );
  }
  if (err.code === '23503') {
    return res.status(400).json(
      fmtErrResp(new ValidationError('Referenced record does not exist'), req, isDev),
    );
  }
  if (err.code === '23502') {
    return res.status(400).json(
      fmtErrResp(new ValidationError('Required field is missing'), req, isDev),
    );
  }

  if (err.isOperational) {
    return res.status(statusCode).json(fmtErrResp(err, req, isDev));
  }

  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
    });
  }

  return res.status(statusCode).json(fmtErrResp(err, req, true));
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    path: req.path,
    method: req.method,
  });
};

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,
};
