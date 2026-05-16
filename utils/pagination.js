const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
};

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

const getPaginationClause = (limit, offset) => {
  return `LIMIT ${limit} OFFSET ${offset}`;
};

const getCountQuery = (baseQuery) => {
  const cleanQuery = baseQuery.replace(/ORDER BY.*?(?=FROM|$)/gi, '');

  return `SELECT COUNT(*) as total FROM (${cleanQuery}) as count_subquery`;
};

const paginatedQuery = async (pool, baseQuery, params, pagination) => {
  const { page, limit, offset } = parsePagination(pagination);

  const countQuery = getCountQuery(baseQuery);
  const countResult = await pool.query(countQuery, params);
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

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
