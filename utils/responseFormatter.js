/**
 * Response Formatter Utilities
 * Provides standardized API response formatting
 */

/**
 * Standard success response
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {string} message - Success message
 * @param {number} statusCode - HTTP status code
 * @returns {Object} Express response
 */
function success(res, data = null, message = 'Success', statusCode = 200) {
  const response = {
    success: true,
    message
  };

  if (data !== null) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
}

/**
 * Standard error response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @param {string} code - Error code
 * @param {Object} details - Additional error details
 * @returns {Object} Express response
 */
function error(
  res,
  message = 'Internal Server Error',
  statusCode = 500,
  code = 'INTERNAL_ERROR',
  details = null
) {
  const response = {
    success: false,
    error: message,
    code
  };

  if (details) {
    response.details = details;
  }

  return res.status(statusCode).json(response);
}

/**
 * Bad request response (400)
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {Object} details - Validation errors
 * @returns {Object} Express response
 */
function badRequest(res, message = 'Bad Request', details = null) {
  return error(res, message, 400, 'BAD_REQUEST', details);
}

/**
 * Unauthorized response (401)
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @returns {Object} Express response
 */
function unauthorized(res, message = 'Unauthorized') {
  return error(res, message, 401, 'UNAUTHORIZED');
}

/**
 * Forbidden response (403)
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @returns {Object} Express response
 */
function forbidden(res, message = 'Forbidden') {
  return error(res, message, 403, 'FORBIDDEN');
}

/**
 * Not found response (404)
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @returns {Object} Express response
 */
function notFound(res, message = 'Not Found') {
  return error(res, message, 404, 'NOT_FOUND');
}

/**
 * Conflict response (409)
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @returns {Object} Express response
 */
function conflict(res, message = 'Conflict') {
  return error(res, message, 409, 'CONFLICT');
}

/**
 * Validation error response (422)
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {Array} errors - Validation errors
 * @returns {Object} Express response
 */
function validationError(res, message = 'Validation Failed', errors = []) {
  return error(res, message, 422, 'VALIDATION_ERROR', { errors });
}

/**
 * Created response (201)
 * @param {Object} res - Express response object
 * @param {*} data - Created resource data
 * @param {string} message - Success message
 * @returns {Object} Express response
 */
function created(res, data = null, message = 'Resource created successfully') {
  return success(res, data, message, 201);
}

/**
 * No content response (204)
 * @param {Object} res - Express response object
 * @returns {Object} Express response
 */
function noContent(res) {
  return res.status(204).send();
}

/**
 * Paginated response
 * @param {Object} res - Express response object
 * @param {Array} data - Array of items
 * @param {number} total - Total number of items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {string} message - Success message
 * @returns {Object} Express response
 */
function paginated(res, data, total, page, limit, message = 'Success') {
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage,
      hasPrevPage,
      nextPage: hasNextPage ? page + 1 : null,
      prevPage: hasPrevPage ? page - 1 : null
    }
  });
}

/**
 * List response (without full pagination)
 * @param {Object} res - Express response object
 * @param {Array} data - Array of items
 * @param {string} message - Success message
 * @returns {Object} Express response
 */
function list(res, data, message = 'Success') {
  return res.status(200).json({
    success: true,
    message,
    data,
    count: data.length
  });
}

/**
 * Login success response with tokens
 * @param {Object} res - Express response object
 * @param {Object} user - User data
 * @param {string} accessToken - JWT access token
 * @param {string} refreshToken - JWT refresh token
 * @param {string} message - Success message
 * @returns {Object} Express response
 */
function loginSuccess(res, user, accessToken, refreshToken, message = 'Login successful') {
  return res.status(200).json({
    success: true,
    message,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    },
    tokens: {
      accessToken,
      refreshToken
    }
  });
}

/**
 * Token refresh response
 * @param {Object} res - Express response object
 * @param {string} accessToken - New JWT access token
 * @param {string} refreshToken - New JWT refresh token
 * @returns {Object} Express response
 */
function tokenRefreshed(res, accessToken, refreshToken) {
  return res.status(200).json({
    success: true,
    message: 'Token refreshed successfully',
    tokens: {
      accessToken,
      refreshToken
    }
  });
}

/**
 * Rate limit exceeded response (429)
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} retryAfter - Seconds until rate limit resets
 * @returns {Object} Express response
 */
function rateLimited(res, message = 'Too many requests', retryAfter = 60) {
  res.setHeader('Retry-After', retryAfter);
  return error(res, message, 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
}

/**
 * Service unavailable response (503)
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @returns {Object} Express response
 */
function serviceUnavailable(res, message = 'Service temporarily unavailable') {
  return error(res, message, 503, 'SERVICE_UNAVAILABLE');
}

/**
 * Custom response with any status code
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {Object} body - Response body
 * @returns {Object} Express response
 */
function custom(res, statusCode, body) {
  return res.status(statusCode).json(body);
}

/**
 * Error response from Error object
 * @param {Object} res - Express response object
 * @param {Error} err - Error object
 * @param {boolean} includeStack - Include stack trace (development only)
 * @returns {Object} Express response
 */
function fromError(res, err, includeStack = false) {
  const statusCode = err.statusCode || err.status || 500;
  const response = {
    success: false,
    error: err.message || 'Internal Server Error',
    code: err.code || 'INTERNAL_ERROR'
  };

  if (includeStack && err.stack) {
    response.stack = err.stack;
  }

  if (err.details) {
    response.details = err.details;
  }

  return res.status(statusCode).json(response);
}

module.exports = {
  success,
  error,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  created,
  noContent,
  paginated,
  list,
  loginSuccess,
  tokenRefreshed,
  rateLimited,
  serviceUnavailable,
  custom,
  fromError
};
