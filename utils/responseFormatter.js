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

function badRequest(res, message = 'Bad Request', details = null) {
  return error(res, message, 400, 'BAD_REQUEST', details);
}

function unauthorized(res, message = 'Unauthorized') {
  return error(res, message, 401, 'UNAUTHORIZED');
}

function forbidden(res, message = 'Forbidden') {
  return error(res, message, 403, 'FORBIDDEN');
}

function notFound(res, message = 'Not Found') {
  return error(res, message, 404, 'NOT_FOUND');
}

function conflict(res, message = 'Conflict') {
  return error(res, message, 409, 'CONFLICT');
}

function validationError(res, message = 'Validation Failed', errors = []) {
  return error(res, message, 422, 'VALIDATION_ERROR', { errors });
}

function created(res, data = null, message = 'Resource created successfully') {
  return success(res, data, message, 201);
}

function noContent(res) {
  return res.status(204).send();
}

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

function list(res, data, message = 'Success') {
  return res.status(200).json({
    success: true,
    message,
    data,
    count: data.length
  });
}

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

function rateLimited(res, message = 'Too many requests', retryAfter = 60) {
  res.setHeader('Retry-After', retryAfter);
  return error(res, message, 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
}

function serviceUnavailable(res, message = 'Service temporarily unavailable') {
  return error(res, message, 503, 'SERVICE_UNAVAILABLE');
}

function custom(res, statusCode, body) {
  return res.status(statusCode).json(body);
}

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
