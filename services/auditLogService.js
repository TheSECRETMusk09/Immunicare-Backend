const pool = require('../db');
const { CANONICAL_ROLES, getCanonicalRole } = require('../middleware/rbac');

const DATE_RANGE_TO_DAYS = Object.freeze({
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
});

const safeParseJson = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const serializeAuditField = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ fallback: String(value) });
  }
};

const toIsoDateTime = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

const resolveDateRangeFilters = ({ startDate, endDate, dateRange } = {}) => {
  const normalizedStartDate = toIsoDateTime(startDate);
  const normalizedEndDate = toIsoDateTime(endDate);

  if (normalizedStartDate || normalizedEndDate) {
    return {
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
    };
  }

  const days = DATE_RANGE_TO_DAYS[String(dateRange || '').trim().toLowerCase()];
  if (!days) {
    return {
      startDate: null,
      endDate: null,
    };
  }

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
};

const buildActorMetadata = (req) => {
  const canonicalRole = getCanonicalRole(req);
  const actorId = Number.isInteger(Number(req?.user?.id)) ? Number(req.user.id) : null;
  const guardianId = Number.isInteger(Number(req?.user?.guardian_id))
    ? Number(req.user.guardian_id)
    : null;

  return {
    adminId: canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN ? actorId : null,
    username:
      req?.user?.username ||
      req?.user?.email ||
      (canonicalRole === CANONICAL_ROLES.GUARDIAN
        ? `guardian:${guardianId || 'unknown'}`
        : `user:${actorId || 'unknown'}`),
    role: canonicalRole || req?.user?.role || null,
    guardianId,
  };
};

const normalizeAuditRow = (row = {}) => ({
  ...row,
  action_type: row.event_type,
  timestamp: row.timestamp,
  created_at: row.timestamp,
  old_values: safeParseJson(row.old_values) || row.old_values,
  new_values: safeParseJson(row.new_values) || row.new_values,
  metadata: safeParseJson(row.metadata) || row.metadata,
  details: safeParseJson(row.details) || row.details || null,
});

const writeAuditLog = async ({
  client = null,
  req,
  eventType,
  entityType = null,
  entityId = null,
  oldValues = null,
  newValues = null,
  metadata = null,
  details = null,
  severity = 'INFO',
  success = true,
  errorMessage = null,
} = {}) => {
  if (!eventType) {
    return false;
  }

  const dbClient = client || pool;
  const actor = buildActorMetadata(req);

  try {
    await dbClient.query(
      `INSERT INTO audit_logs (
         admin_id,
         username,
         role,
         event_type,
         entity_type,
         entity_id,
         old_values,
         new_values,
         metadata,
         details,
         severity,
         ip_address,
         user_agent,
         success,
         error_message,
         timestamp
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)`,
      [
        actor.adminId,
        actor.username,
        actor.role,
        eventType,
        entityType,
        entityId,
        serializeAuditField(oldValues),
        serializeAuditField(newValues),
        serializeAuditField(metadata),
        details || metadata || null,
        severity,
        req?.ip || null,
        req?.get?.('User-Agent') || null,
        success,
        errorMessage,
      ],
    );

    return true;
  } catch (error) {
    console.error('Failed to write audit log:', error.message);
    return false;
  }
};

const listAuditLogs = async ({
  username = null,
  user = null,
  eventType = null,
  actionType = null,
  severity = null,
  entityType = null,
  entityId = null,
  startDate = null,
  endDate = null,
  dateRange = null,
  limit = 100,
  offset = 0,
} = {}) => {
  const normalizedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 5000);
  const normalizedOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const normalizedUsername = String(username || user || '').trim();
  const normalizedEventType = String(eventType || actionType || '').trim();
  const normalizedSeverity = String(severity || '').trim().toUpperCase();
  const normalizedEntityType = String(entityType || '').trim();
  const normalizedEntityId = entityId !== undefined && entityId !== null && entityId !== ''
    ? parseInt(entityId, 10)
    : null;
  const resolvedDateRange = resolveDateRangeFilters({ startDate, endDate, dateRange });

  const params = [];
  let paramIndex = 1;
  let query = `
    SELECT
      id,
      admin_id,
      username,
      role,
      event_type,
      entity_type,
      entity_id,
      old_values,
      new_values,
      metadata,
      details,
      severity,
      ip_address,
      user_agent,
      success,
      error_message,
      timestamp
    FROM audit_logs
    WHERE 1=1
  `;

  if (normalizedUsername) {
    query += ` AND username ILIKE $${paramIndex}`;
    params.push(`%${normalizedUsername}%`);
    paramIndex += 1;
  }

  if (normalizedEventType) {
    query += ` AND event_type ILIKE $${paramIndex}`;
    params.push(`%${normalizedEventType}%`);
    paramIndex += 1;
  }

  if (normalizedSeverity) {
    query += ` AND UPPER(COALESCE(severity, '')) = $${paramIndex}`;
    params.push(normalizedSeverity);
    paramIndex += 1;
  }

  if (normalizedEntityType) {
    query += ` AND entity_type = $${paramIndex}`;
    params.push(normalizedEntityType);
    paramIndex += 1;
  }

  if (!Number.isNaN(normalizedEntityId) && normalizedEntityId !== null) {
    query += ` AND entity_id = $${paramIndex}`;
    params.push(normalizedEntityId);
    paramIndex += 1;
  }

  if (resolvedDateRange.startDate) {
    query += ` AND timestamp >= $${paramIndex}`;
    params.push(resolvedDateRange.startDate);
    paramIndex += 1;
  }

  if (resolvedDateRange.endDate) {
    query += ` AND timestamp <= $${paramIndex}`;
    params.push(resolvedDateRange.endDate);
    paramIndex += 1;
  }

  query += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(normalizedLimit, normalizedOffset);

  const result = await pool.query(query, params);
  return result.rows.map(normalizeAuditRow);
};

const csvEscape = (value) => {
  if (value === null || value === undefined) {
    return '';
  }

  const normalized = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${String(normalized).replace(/"/g, '""')}"`;
};

const exportAuditLogsCsv = async (filters = {}) => {
  const rows = await listAuditLogs({
    ...filters,
    limit: Math.min(Math.max(parseInt(filters.limit, 10) || 1000, 1), 5000),
    offset: 0,
  });

  const headers = [
    'id',
    'timestamp',
    'username',
    'role',
    'event_type',
    'entity_type',
    'entity_id',
    'severity',
    'success',
    'ip_address',
    'error_message',
    'metadata',
    'details',
  ];

  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(
      [
        row.id,
        row.timestamp,
        row.username,
        row.role,
        row.event_type,
        row.entity_type,
        row.entity_id,
        row.severity,
        row.success,
        row.ip_address,
        row.error_message,
        row.metadata,
        row.details,
      ]
        .map(csvEscape)
        .join(','),
    );
  });

  return lines.join('\n');
};

module.exports = {
  writeAuditLog,
  listAuditLogs,
  exportAuditLogsCsv,
  normalizeAuditRow,
};
