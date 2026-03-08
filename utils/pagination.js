/**
 * Pagination Utilities
 * Provides standardized pagination for API endpoints
 */

/**
 * Default pagination settings
 */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse and validate pagination parameters from request
 * @param {Object} query - Request query object
 * @returns {{page: number, limit: number, offset: number}}
 */
function parsePagination(query = {}) {
  let page = parseInt(query.page) || DEFAULT_PAGE;
  let limit = parseInt(query.limit) || DEFAULT_LIMIT;

  // Validate page
  if (page < 1) {
    page = DEFAULT_PAGE;
  }

  // Validate and cap limit
  if (limit < 1) {
    limit = DEFAULT_LIMIT;
  } else if (limit > MAX_LIMIT) {
    limit = MAX_LIMIT;
  }

  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Build pagination metadata for response
 * @param {number} total - Total number of items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {Object} Pagination metadata
 */
function buildPaginationMeta(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage,
    hasPrevPage,
    nextPage: hasNextPage ? page + 1 : null,
    prevPage: hasPrevPage ? page - 1 : null,
    startIndex: (page - 1) * limit + 1,
    endIndex: Math.min(page * limit, total)
  };
}

/**
 * Apply pagination to a SQL query
 * @param {string} query - SQL query string
 * @param {number} offset - Offset value
 * @param {number} limit - Limit value
 * @returns {string} Query with pagination
 */
function applyPagination(query, offset, limit) {
  // Remove trailing semicolon if present
  const cleanQuery = query.trim().replace(/;$/, '');
  return `${cleanQuery} OFFSET ${offset} LIMIT ${limit}`;
}

/**
 * Build a paginated SQL query with count
 * @param {string} baseQuery - Base SQL query (without ORDER BY, LIMIT, OFFSET)
 * @param {Object} options - Pagination options
 * @returns {{dataQuery: string, countQuery: string}}
 */
function buildPaginatedQuery(baseQuery, options = {}) {
  const { orderBy = 'id', orderDirection = 'DESC' } = options;

  // Remove trailing semicolon if present
  const cleanQuery = baseQuery.trim().replace(/;$/, '');

  const dataQuery = `${cleanQuery} ORDER BY ${orderBy} ${orderDirection} OFFSET $1 LIMIT $2`;
  const countQuery = `SELECT COUNT(*) FROM (${cleanQuery}) AS count_query`;

  return { dataQuery, countQuery };
}

/**
 * Create a paginated response object
 * @param {Array} data - Array of items for current page
 * @param {number} total - Total number of items
 * @param {Object} pagination - Pagination parameters {page, limit}
 * @returns {Object} Standardized paginated response
 */
function createPaginatedResponse(data, total, pagination) {
  const { page, limit } = pagination;
  const meta = buildPaginationMeta(total, page, limit);

  return {
    success: true,
    data,
    pagination: meta
  };
}

/**
 * Middleware to add pagination to request
 * @param {Object} options - Configuration options
 * @returns {Function} Express middleware
 */
function paginationMiddleware(options = {}) {
  const { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = options;

  return (req, res, next) => {
    let page = parseInt(req.query.page) || DEFAULT_PAGE;
    let limit = parseInt(req.query.limit) || defaultLimit;

    if (page < 1) {
      page = DEFAULT_PAGE;
    }
    if (limit < 1) {
      limit = defaultLimit;
    }
    if (limit > maxLimit) {
      limit = maxLimit;
    }

    req.pagination = {
      page,
      limit,
      offset: (page - 1) * limit
    };

    next();
  };
}

/**
 * Helper to extract sort parameters from request
 * @param {Object} query - Request query object
 * @param {Array} allowedFields - Allowed sort fields
 * @param {string} defaultField - Default sort field
 * @returns {{sortBy: string, sortOrder: string}}
 */
function parseSorting(query = {}, allowedFields = [], defaultField = 'id') {
  const sortBy = query.sortBy || query.sort || defaultField;
  const sortOrder = (query.sortOrder || query.order || 'DESC').toUpperCase();

  // Validate sort field
  const validSortBy =
    allowedFields.length > 0 ? (allowedFields.includes(sortBy) ? sortBy : defaultField) : sortBy;

  // Validate sort order
  const validSortOrder = ['ASC', 'DESC'].includes(sortOrder) ? sortOrder : 'DESC';

  return {
    sortBy: validSortBy,
    sortOrder: validSortOrder
  };
}

/**
 * Build ORDER BY clause for SQL query
 * @param {string} sortBy - Column to sort by
 * @param {string} sortOrder - Sort direction (ASC/DESC)
 * @returns {string} ORDER BY clause
 */
function buildOrderBy(sortBy, sortOrder) {
  return `ORDER BY ${sortBy} ${sortOrder}`;
}

/**
 * Calculate pagination for cursor-based pagination (for large datasets)
 * @param {string|number} cursor - The cursor value (usually an ID or timestamp)
 * @param {number} limit - Number of items per page
 * @param {string} cursorField - Field to use as cursor
 * @returns {Object} Cursor pagination parameters
 */
function parseCursorPagination(query = {}, cursorField = 'id') {
  const { cursor, limit = DEFAULT_LIMIT, direction = 'next' } = query;
  const parsedLimit = Math.min(Math.max(parseInt(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  return {
    cursor,
    limit: parsedLimit,
    direction,
    cursorField,
    hasCursor: !!cursor
  };
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  buildPaginationMeta,
  applyPagination,
  buildPaginatedQuery,
  createPaginatedResponse,
  paginationMiddleware,
  parseSorting,
  buildOrderBy,
  parseCursorPagination
};
