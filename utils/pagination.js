/**
 * Pagination Utility
 * Provides pagination helper functions for database queries
 *
 * @module utils/pagination
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse pagination parameters from query string
 * @param {Object} query - Express query object
 * @returns {Object} - Parsed pagination parameters with page, limit, and offset
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
};

/**
 * Build pagination metadata
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @param {number} total - Total number of items
 * @returns {Object} - Pagination metadata
 */
const buildPaginationMeta = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

/**
 * Get pagination query clause
 * @param {number} limit - Number of items per page
 * @param {number} offset - Number of items to skip
 * @returns {string} - SQL LIMIT/OFFSET clause
 */
const getPaginationClause = (limit, offset) => {
  return `LIMIT ${limit} OFFSET ${offset}`;
};

/**
 * Get total count for a query (without pagination)
 * Use this before adding LIMIT to get total count
 * @param {string} baseQuery - Base SQL query (should not have LIMIT/OFFSET)
 * @returns {string} - Query for getting total count
 */
const getCountQuery = (baseQuery) => {
  // Wrap the query in a count subquery
  // Remove any existing ORDER BY clause as it's not needed for count
  const cleanQuery = baseQuery.replace(/ORDER BY.*?(?=FROM|$)/gi, '');

  return `SELECT COUNT(*) as total FROM (${cleanQuery}) as count_subquery`;
};

/**
 * Async paginated query helper
 * @param {Object} pool - Database pool
 * @param {string} baseQuery - Base SQL query
 * @param {Array} params - Query parameters
 * @param {Object} pagination - Pagination parameters { page, limit }
 * @returns {Object} - Paginated result with data and metadata
 */
const paginatedQuery = async (pool, baseQuery, params, pagination) => {
  const { page, limit, offset } = parsePagination(pagination);

  // Get total count
  const countQuery = getCountQuery(baseQuery);
  const countResult = await pool.query(countQuery, params);
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

  // Add pagination and execute main query
  const paginatedQuery = `${baseQuery} ${getPaginationClause(limit, offset)}`;
  const result = await pool.query(paginatedQuery, params);

  return {
    data: result.rows,
    pagination: buildPaginationMeta(page, limit, total),
  };
};

module.exports = {
  parsePagination,
  buildPaginationMeta,
  getPaginationClause,
  getCountQuery,
  paginatedQuery,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
