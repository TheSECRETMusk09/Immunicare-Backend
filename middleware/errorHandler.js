/**
 * Centralized Error Handling Middleware
 * Provides consistent error responses across the application
 */

const logger = require('../config/logger');

/**
 * Custom error classes for different error types
 */
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

/**
 * Error response formatter
 */
const formatErrorResponse = (err, req, includeDetails = false) => {
  const response = {
    success: false,
    error: err.message || 'An unexpected error occurred',
    code: err.code || 'INTERNAL_ERROR',
  };

  // Add validation details if available
  if (err.details && Array.isArray(err.details)) {
    response.details = err.details;
  }

  // Add request ID for tracking
  if (req.requestId) {
    response.requestId = req.requestId;
  }

  // Add stack trace and additional details in development
  if (includeDetails) {
    response.stack = err.stack;
    if (err.errors) {
      response.errors = err.errors;
    }
  }

  return response;
};

/**
 * Main error handling middleware with proper severity levels
 * Distinguishes between operational errors (4xx) and programming errors (5xx)
 */
const errorHandler = (err, req, res, next) => {
  // Determine severity level based on error type
  const statusCode = err.statusCode || err.status || 500;
  const isOperational = err.isOperational || (statusCode >= 400 && statusCode < 500);

  // Log with appropriate severity level
  const logData = {
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
    // Programming errors - critical level
    logger.error('CRITICAL: Server error occurred:', {
      ...logData,
      stack: err.stack,
    });
  } else if (statusCode >= 400) {
    // Operational errors - warning level
    logger.warn('Operational error occurred:', logData);
  } else {
    // Other errors - info level
    logger.info('Error occurred:', logData);
  }

  // Determine if we should include detailed error info
  const includeDetails = process.env.NODE_ENV === 'development';

  // Handle specific error types
  if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    return res
      .status(401)
      .json(
        formatErrorResponse(
          new AuthenticationError('Invalid or expired token'),
          req,
          includeDetails,
        ),
      );
  }

  if (err.name === 'TokenExpiredError') {
    return res
      .status(401)
      .json(formatErrorResponse(new AuthenticationError('Token has expired'), req, includeDetails));
  }

  if (err.name === 'SyntaxError' && err.status === 400 && 'body' in err) {
    return res
      .status(400)
      .json(
        formatErrorResponse(
          new ValidationError('Invalid JSON in request body'),
          req,
          includeDetails,
        ),
      );
  }

  // Database errors
  if (err.code === '23505') {
    // Unique constraint violation
    return res
      .status(409)
      .json(
        formatErrorResponse(
          new ConflictError('A record with this information already exists'),
          req,
          includeDetails,
        ),
      );
  }

  if (err.code === '23503') {
    // Foreign key constraint violation
    return res
      .status(400)
      .json(
        formatErrorResponse(
          new ValidationError('Referenced record does not exist'),
          req,
          includeDetails,
        ),
      );
  }

  if (err.code === '23502') {
    // Not null constraint violation
    return res
      .status(400)
      .json(
        formatErrorResponse(new ValidationError('Required field is missing'), req, includeDetails),
      );
  }

  // Operational errors (expected errors)
  if (err.isOperational) {
    return res.status(statusCode).json(formatErrorResponse(err, req, includeDetails));
  }

  // Programming or unknown errors - don't leak details in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
    });
  }

  // Development: return full error details
  return res.status(statusCode).json(formatErrorResponse(err, req, true));
};

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    path: req.path,
    method: req.method,
  });
};

/**
 * Async handler wrapper to catch async errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

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
