const express = require('express');
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const socketService = require('../services/socketService');
const {
  hasFieldErrors,
  normalizeEnumValue,
  parseDateValue,
  respondValidationError,
  sanitizeText,
  validateDateRange,
} = require('../utils/adminValidation');

const router = express.Router();

const AUDIENCE_VALUES = ['all', 'patients', 'staff'];
const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'];
const STATUS_VALUES = ['draft', 'published', 'archived'];
const DELIVERY_STATUS_VALUES = ['pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'cancelled'];

const TABLE_COLUMN_CACHE_TTL_MS = 5 * 60 * 1000;
const tableColumnCache = new Map();

const sanitizeAnnouncementPayload = (payload = {}) => {
  const errors = {};

  const title = sanitizeText(payload.title, { maxLength: 150 });
  const content = sanitizeText(payload.content, {
    maxLength: 2000,
    preserveNewLines: true,
  });

  const targetAudienceInput = sanitizeText(payload.target_audience).toLowerCase();
  const priorityInput = sanitizeText(payload.priority).toLowerCase();
  const statusInput = sanitizeText(payload.status).toLowerCase();

  const targetAudience = targetAudienceInput
    ? normalizeEnumValue(targetAudienceInput, AUDIENCE_VALUES, '')
    : 'all';
  const priority = priorityInput
    ? normalizeEnumValue(priorityInput, PRIORITY_VALUES, '')
    : 'medium';
  const status = statusInput
    ? normalizeEnumValue(statusInput, STATUS_VALUES, '')
    : 'draft';

  const startDateRaw = sanitizeText(payload.start_date);
  const endDateRaw = sanitizeText(payload.end_date);
  const expiresAtRaw = sanitizeText(payload.expires_at);

  if (!title) {
    errors.title = 'Title is required';
  } else if (title.length < 3) {
    errors.title = 'Title must be at least 3 characters';
  }

  if (!content) {
    errors.content = 'Content is required';
  } else if (content.length < 10) {
    errors.content = 'Content must be at least 10 characters';
  }

  if (!targetAudience) {
    errors.target_audience = `target_audience must be one of: ${AUDIENCE_VALUES.join(', ')}`;
  }

  if (!priority) {
    errors.priority = `priority must be one of: ${PRIORITY_VALUES.join(', ')}`;
  }

  if (!status) {
    errors.status = `status must be one of: ${STATUS_VALUES.join(', ')}`;
  }

  if (startDateRaw && !parseDateValue(startDateRaw)) {
    errors.start_date = 'start_date must be a valid date';
  }

  if (endDateRaw && !parseDateValue(endDateRaw)) {
    errors.end_date = 'end_date must be a valid date';
  }

  if (expiresAtRaw && !parseDateValue(expiresAtRaw)) {
    errors.expires_at = 'expires_at must be a valid date';
  }

  Object.assign(
    errors,
    validateDateRange({
      startDate: startDateRaw,
      endDate: endDateRaw,
      startKey: 'start_date',
      endKey: 'end_date',
      startLabel: 'Start date',
      endLabel: 'End date',
    }),
  );

  return {
    normalized: {
      title,
      content,
      target_audience: targetAudience,
      priority,
      status,
      start_date: startDateRaw || null,
      end_date: endDateRaw || null,
      expires_at: expiresAtRaw || null,
    },
    errors,
  };
};

const parseAnnouncementId = (rawId) => {
  const id = parseInt(rawId, 10);
  if (Number.isNaN(id) || id <= 0) {
    return null;
  }
  return id;
};

const toPositiveInteger = (rawValue, fallback, options = {}) => {
  const { min = 1, max = Number.MAX_SAFE_INTEGER } = options;
  const parsed = parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
};

const getTableColumns = async (client, tableName) => {
  const cacheKey = String(tableName);
  const now = Date.now();
  const cached = tableColumnCache.get(cacheKey);

  if (cached && now - cached.cachedAt < TABLE_COLUMN_CACHE_TTL_MS) {
    return cached.columns;
  }

  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName],
  );

  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnCache.set(cacheKey, { columns, cachedAt: now });
  return columns;
};

const isTableAvailable = async (client, tableName) => {
  const columns = await getTableColumns(client, tableName);
  return columns.size > 0;
};

const resolveAnnouncementRecipients = async (client, targetAudienceValue) => {
  const usersColumns = await getTableColumns(client, 'users');
  if (!usersColumns.has('id')) {
    return [];
  }

  const normalizedAudience = sanitizeText(targetAudienceValue).toLowerCase();
  if (!AUDIENCE_VALUES.includes(normalizedAudience)) {
    return [];
  }

  const selectParts = ['u.id AS user_id'];
  selectParts.push(
    usersColumns.has('guardian_id')
      ? 'u.guardian_id AS recipient_guardian_id'
      : 'NULL::integer AS recipient_guardian_id',
  );
  selectParts.push(
    usersColumns.has('username')
      ? 'u.username AS recipient_username'
      : 'NULL::text AS recipient_username',
  );
  selectParts.push(
    usersColumns.has('email') ? 'u.email AS recipient_email' : 'NULL::text AS recipient_email',
  );
  selectParts.push(
    usersColumns.has('contact')
      ? 'u.contact AS recipient_phone'
      : 'NULL::text AS recipient_phone',
  );

  const whereParts = ['1 = 1'];
  if (usersColumns.has('is_active')) {
    whereParts.push('u.is_active = true');
  }

  if (usersColumns.has('guardian_id')) {
    if (normalizedAudience === 'patients') {
      whereParts.push('u.guardian_id IS NOT NULL');
    } else if (normalizedAudience === 'staff') {
      whereParts.push('u.guardian_id IS NULL');
    }
  } else {
    const roleFragments = [];
    if (usersColumns.has('runtime_role')) {
      roleFragments.push('NULLIF(TRIM(u.runtime_role), \'\')');
    }
    if (usersColumns.has('role_type')) {
      roleFragments.push('NULLIF(TRIM(u.role_type), \'\')');
    }
    if (usersColumns.has('role')) {
      roleFragments.push('NULLIF(TRIM(u.role), \'\')');
    }

    const roleExpression =
      roleFragments.length > 0
        ? `LOWER(COALESCE(${roleFragments.join(', ')}, ''))`
        : null;

    if (normalizedAudience === 'patients') {
      if (roleExpression) {
        whereParts.push(`${roleExpression} IN ('guardian', 'user', 'parent')`);
      } else {
        whereParts.push('1 = 0');
      }
    }

    if (normalizedAudience === 'staff' && roleExpression) {
      whereParts.push(`${roleExpression} NOT IN ('guardian', 'user', 'parent')`);
    }
  }

  const query = `
    SELECT ${selectParts.join(', ')}
    FROM users u
    WHERE ${whereParts.join(' AND ')}
    ORDER BY u.id ASC
  `;

  const result = await client.query(query);
  return result.rows.map((row) => ({
    user_id: row.user_id,
    recipient_guardian_id: row.recipient_guardian_id ? parseInt(row.recipient_guardian_id, 10) : null,
    recipient_username: row.recipient_username || null,
    recipient_email: row.recipient_email || null,
    recipient_phone: row.recipient_phone || null,
  }));
};

const buildNotificationInsertPayload = ({ announcement, recipient, actorUserId }) => {
  const isGuardianRecipient = Boolean(recipient.recipient_guardian_id);
  const recipientLabel =
    recipient.recipient_username ||
    (isGuardianRecipient
      ? `Guardian #${recipient.recipient_guardian_id}`
      : `User #${recipient.user_id}`);

  return {
    user_id: recipient.user_id,
    title: announcement.title,
    message: announcement.content,
    type: 'info',
    category: 'general',
    is_read: false,
    notification_type: 'system_announcement',
    target_type: isGuardianRecipient ? 'guardian' : 'user',
    target_id: isGuardianRecipient ? recipient.recipient_guardian_id : recipient.user_id,
    recipient_name: recipientLabel,
    recipient_email: recipient.recipient_email,
    recipient_phone: recipient.recipient_phone,
    channel: 'email',
    status: 'pending',
    subject: `Announcement: ${announcement.title}`,
    related_entity_type: 'announcement',
    related_entity_id: announcement.id,
    action_required: false,
    action_url: isGuardianRecipient ? '/guardian/notifications' : '/announcements',
    guardian_id: recipient.recipient_guardian_id,
    target_role: isGuardianRecipient ? 'guardian' : 'staff',
    created_by: actorUserId || null,
    priority: announcement.priority === 'medium' ? 'normal' : (announcement.priority || 'normal'),
    metadata: JSON.stringify({
      announcement_id: announcement.id,
      target_audience: announcement.target_audience,
      recipient_user_id: recipient.user_id,
      recipient_guardian_id: recipient.recipient_guardian_id || null,
    }),
  };
};

const insertNotificationForRecipient = async (client, payload) => {
  const notificationColumns = await getTableColumns(client, 'notifications');
  if (notificationColumns.size === 0) {
    return null;
  }

  const keys = Object.keys(payload).filter(
    (key) => notificationColumns.has(key) && payload[key] !== undefined,
  );

  if (keys.length === 0 || !keys.includes('message')) {
    return null;
  }

  const placeholders = keys.map((_, index) => `$${index + 1}`);
  const values = keys.map((key) => payload[key]);

  try {
    await client.query('SAVEPOINT notify_insert');
    const result = await client.query(
      `
        INSERT INTO notifications (${keys.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING id
      `,
      values,
    );
    await client.query('RELEASE SAVEPOINT notify_insert');
    return result.rows[0]?.id || null;
  } catch (error) {
    try {
      await client.query('ROLLBACK TO SAVEPOINT notify_insert');
    } catch (rollbackError) {
      console.error('Error rolling back notify_insert savepoint:', rollbackError.message);
    }
    console.error('Error inserting announcement notification:', error instanceof Error ? error.message : String(error));
    return null;
  }
};

const insertDeliveryRecord = async (
  client,
  {
    announcementId,
    recipient,
    notificationId,
    resolvedTargetAudience,
    deliveryStatus,
    deliveryAttempts = 0,
    queuedAt = null,
    sentAt = null,
    deliveredAt = null,
    failedAt = null,
    failureReason = null,
    metadata = {},
  },
) => {
  try {
    await client.query('SAVEPOINT delivery_insert');
    await client.query(
      `
        INSERT INTO announcement_recipient_deliveries (
          announcement_id,
          recipient_user_id,
          recipient_guardian_id,
          notification_id,
          resolved_target_audience,
          delivery_channel,
          delivery_status,
          delivery_attempts,
          queued_at,
          sent_at,
          delivered_at,
          failed_at,
          failure_reason,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      `,
      [
        announcementId,
        recipient.user_id,
        recipient.recipient_guardian_id,
        notificationId,
        resolvedTargetAudience,
        'in_app',
        deliveryStatus,
        deliveryAttempts,
        queuedAt,
        sentAt,
        deliveredAt,
        failedAt,
        failureReason,
        JSON.stringify(metadata || {}),
      ],
    );
    await client.query('RELEASE SAVEPOINT delivery_insert');
  } catch (error) {
    try {
      await client.query('ROLLBACK TO SAVEPOINT delivery_insert');
    } catch (rollbackError) {
      console.error('Error rolling back delivery_insert savepoint:', rollbackError.message);
    }
    console.error('Error inserting delivery record:', error instanceof Error ? error.message : String(error));
  }
};

const baseDeliverySummary = (announcementId) => ({
  announcement_id: announcementId,
  total_recipients: 0,
  pending_count: 0,
  queued_count: 0,
  sent_count: 0,
  delivered_count: 0,
  read_count: 0,
  failed_count: 0,
  cancelled_count: 0,
});

const parseCount = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const fetchDeliverySummary = async (client, announcementId) => {
  const deliveryTableExists = await isTableAvailable(client, 'announcement_recipient_deliveries');
  if (!deliveryTableExists) {
    return baseDeliverySummary(announcementId);
  }

  const result = await client.query(
    `
      SELECT
        COUNT(*)::int AS total_recipients,
        COUNT(*) FILTER (WHERE delivery_status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE delivery_status = 'queued')::int AS queued_count,
        COUNT(*) FILTER (WHERE delivery_status = 'sent')::int AS sent_count,
        COUNT(*) FILTER (WHERE delivery_status = 'delivered')::int AS delivered_count,
        COUNT(*) FILTER (WHERE delivery_status = 'read')::int AS read_count,
        COUNT(*) FILTER (WHERE delivery_status = 'failed')::int AS failed_count,
        COUNT(*) FILTER (WHERE delivery_status = 'cancelled')::int AS cancelled_count
      FROM announcement_recipient_deliveries
      WHERE announcement_id = $1
    `,
    [announcementId],
  );

  const row = result.rows[0] || {};
  return {
    announcement_id: announcementId,
    total_recipients: parseCount(row.total_recipients),
    pending_count: parseCount(row.pending_count),
    queued_count: parseCount(row.queued_count),
    sent_count: parseCount(row.sent_count),
    delivered_count: parseCount(row.delivered_count),
    read_count: parseCount(row.read_count),
    failed_count: parseCount(row.failed_count),
    cancelled_count: parseCount(row.cancelled_count),
  };
};

const emitAnnouncementDeliverySummary = (announcementId, summary) => {
  const payload = {
    announcement_id: announcementId,
    summary,
  };
  socketService.broadcast('announcement_delivery_summary_updated', payload);
  socketService.sendToRoom(`announcement:${announcementId}`, 'announcement_delivery_summary_updated', payload);
};

// Middleware to authenticate all announcement routes
router.use(authenticateToken);

// Role-based access control for announcement management
const requireManagementRole = requireRole(['admin', 'super_admin', 'doctor', 'nurse', 'staff']);

// Delivery summary for a list of announcements
router.get('/delivery/summary', requireManagementRole, async (req, res) => {
  try {
    const rawIds = Array.isArray(req.query.announcement_ids)
      ? req.query.announcement_ids.join(',')
      : sanitizeText(req.query.announcement_ids);

    if (!rawIds) {
      return res.json({});
    }

    const announcementIds = [...new Set(
      rawIds
        .split(',')
        .map((item) => parseInt(item.trim(), 10))
        .filter((item) => Number.isInteger(item) && item > 0),
    )];

    if (announcementIds.length === 0) {
      return res.json({});
    }

    const deliveryTableExists = await isTableAvailable(pool, 'announcement_recipient_deliveries');
    if (!deliveryTableExists) {
      const fallback = announcementIds.reduce((accumulator, id) => {
        accumulator[String(id)] = baseDeliverySummary(id);
        return accumulator;
      }, {});
      return res.json(fallback);
    }

    const result = await pool.query(
      `
        SELECT
          announcement_id,
          COUNT(*)::int AS total_recipients,
          COUNT(*) FILTER (WHERE delivery_status = 'pending')::int AS pending_count,
          COUNT(*) FILTER (WHERE delivery_status = 'queued')::int AS queued_count,
          COUNT(*) FILTER (WHERE delivery_status = 'sent')::int AS sent_count,
          COUNT(*) FILTER (WHERE delivery_status = 'delivered')::int AS delivered_count,
          COUNT(*) FILTER (WHERE delivery_status = 'read')::int AS read_count,
          COUNT(*) FILTER (WHERE delivery_status = 'failed')::int AS failed_count,
          COUNT(*) FILTER (WHERE delivery_status = 'cancelled')::int AS cancelled_count
        FROM announcement_recipient_deliveries
        WHERE announcement_id = ANY($1::int[])
        GROUP BY announcement_id
      `,
      [announcementIds],
    );

    const summaryByAnnouncement = announcementIds.reduce((accumulator, id) => {
      accumulator[String(id)] = baseDeliverySummary(id);
      return accumulator;
    }, {});

    result.rows.forEach((row) => {
      const announcementId = parseCount(row.announcement_id);
      summaryByAnnouncement[String(announcementId)] = {
        announcement_id: announcementId,
        total_recipients: parseCount(row.total_recipients),
        pending_count: parseCount(row.pending_count),
        queued_count: parseCount(row.queued_count),
        sent_count: parseCount(row.sent_count),
        delivered_count: parseCount(row.delivered_count),
        read_count: parseCount(row.read_count),
        failed_count: parseCount(row.failed_count),
        cancelled_count: parseCount(row.cancelled_count),
      };
    });

    res.json(summaryByAnnouncement);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get announcement statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const [total, published, draft, archived, highPriority] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM announcements'),
      pool.query('SELECT COUNT(*) as count FROM announcements WHERE status = \'published\''),
      pool.query('SELECT COUNT(*) as count FROM announcements WHERE status = \'draft\''),
      pool.query('SELECT COUNT(*) as count FROM announcements WHERE status = \'archived\''),
      pool.query(
        'SELECT COUNT(*) as count FROM announcements WHERE priority = \'high\' AND status = \'published\'',
      ),
    ]);

    res.json({
      totalAnnouncements: parseInt(total.rows[0].count, 10),
      activeAnnouncements: parseInt(published.rows[0].count, 10),
      draftAnnouncements: parseInt(draft.rows[0].count, 10),
      archivedAnnouncements: parseInt(archived.rows[0].count, 10),
      highPriority: parseInt(highPriority.rows[0].count, 10),
      unreadCount: 0,
      pendingAcknowledgments: 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search announcements
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        error: 'Search query must be at least 2 characters long',
      });
    }

    const sanitizedQuery = query.replace(/[%_]/g, '\\$&');

    const result = await pool.query(
      `
        SELECT a.*, u.email as created_by_email
        FROM announcements a
        LEFT JOIN users u ON a.created_by = u.id
        WHERE a.title ILIKE $1 OR a.content ILIKE $1
        ORDER BY a.created_at DESC
      `,
      [`%${sanitizedQuery}%`],
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: 'An error occurred while searching announcements',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Get active announcements for specific audience
router.get('/active/:audience', async (req, res) => {
  try {
    const audience = sanitizeText(req.params.audience).toLowerCase();
    if (!AUDIENCE_VALUES.includes(audience)) {
      return res.status(400).json({
        error: `audience must be one of: ${AUDIENCE_VALUES.join(', ')}`,
      });
    }

    const result = await pool.query(
      `
        SELECT a.*, u.email as created_by_email
        FROM announcements a
        LEFT JOIN users u ON a.created_by = u.id
        WHERE a.status = 'published'
          AND (a.target_audience = 'all' OR a.target_audience = $1)
          AND (a.start_date IS NULL OR a.start_date <= CURRENT_DATE)
          AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
          AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)
        ORDER BY a.priority DESC, a.created_at DESC
      `,
      [audience],
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get announcements by priority
router.get('/priority/:priority', async (req, res) => {
  try {
    const priority = sanitizeText(req.params.priority).toLowerCase();
    if (!PRIORITY_VALUES.includes(priority)) {
      return res.status(400).json({
        error: `priority must be one of: ${PRIORITY_VALUES.join(', ')}`,
      });
    }

    const result = await pool.query(
      `
        SELECT a.*, u.email as created_by_email
        FROM announcements a
        LEFT JOIN users u ON a.created_by = u.id
        WHERE a.priority = $1 AND a.status = 'published'
        ORDER BY a.created_at DESC
      `,
      [priority],
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk update announcements (must be before /:id route to avoid route shadowing)
router.put('/bulk-update', requireManagementRole, async (req, res) => {
  try {
    const { announcement_ids, updates } = req.body || {};

    if (!Array.isArray(announcement_ids) || announcement_ids.length === 0) {
      return res.status(400).json({ error: 'Announcement IDs array is required' });
    }

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates must be an object' });
    }

    const validIds = [...new Set(
      announcement_ids
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0),
    )];

    if (validIds.length !== announcement_ids.length) {
      return res.status(400).json({ error: 'All announcement IDs must be positive integers' });
    }

    const allowedFields = [
      'title',
      'content',
      'target_audience',
      'priority',
      'status',
      'start_date',
      'end_date',
      'expires_at',
    ];

    const incomingFields = Object.keys(updates);
    if (incomingFields.length === 0) {
      return res.status(400).json({ error: 'At least one update field is required' });
    }

    const invalidFields = incomingFields.filter((field) => !allowedFields.includes(field));
    if (invalidFields.length > 0) {
      return res.status(400).json({ error: `Invalid fields: ${invalidFields.join(', ')}` });
    }

    const setParts = [];
    const values = [];
    let paramIndex = 1;

    incomingFields.forEach((field) => {
      setParts.push(`${field} = $${paramIndex}`);
      values.push(updates[field]);
      paramIndex += 1;
    });

    const idParam = paramIndex;
    values.push(validIds);

    const query = `
      UPDATE announcements
      SET ${setParts.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($${idParam}::int[])
      RETURNING *
    `;

    const result = await pool.query(query, values);

    result.rows.forEach((announcement) => {
      socketService.broadcast('announcement_updated', announcement);
    });

    res.json({
      updated: result.rows.length,
      announcements: result.rows,
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: 'An error occurred while updating announcements',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

// Get all announcements
router.get('/', async (req, res) => {
  try {
    const { status, priority, target_audience } = req.query;
    let query = `
      SELECT a.*, u.email as created_by_email
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND a.status = $' + (params.length + 1);
      params.push(status);
    }

    if (priority) {
      query += ' AND a.priority = $' + (params.length + 1);
      params.push(priority);
    }

    if (target_audience) {
      query += ' AND (a.target_audience = \'all\' OR a.target_audience = $' + (params.length + 1) + ')';
      params.push(target_audience);
    }

    query += ' ORDER BY a.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create announcement
router.post('/', requireManagementRole, async (req, res) => {
  try {
    const { normalized, errors } = sanitizeAnnouncementPayload(req.body);
    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    const duplicateCheck = await pool.query(
      `
        SELECT id
        FROM announcements
        WHERE LOWER(TRIM(title)) = LOWER($1)
          AND LOWER(TRIM(content)) = LOWER($2)
          AND status <> 'archived'
        LIMIT 1
      `,
      [normalized.title, normalized.content],
    );

    if (duplicateCheck.rows.length > 0) {
      return respondValidationError(
        res,
        {
          title: 'An active announcement with the same title and content already exists',
          content: 'An active announcement with the same title and content already exists',
        },
        'Duplicate announcement detected',
        409,
      );
    }

    const userId = req.user.id;

    const result = await pool.query(
      `
        INSERT INTO announcements (
          title, content, target_audience, priority,
          status, start_date, end_date, expires_at, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [
        normalized.title,
        normalized.content,
        normalized.target_audience,
        normalized.priority,
        normalized.status,
        normalized.start_date,
        normalized.end_date,
        normalized.expires_at,
        userId,
      ],
    );

    socketService.broadcast('announcement_created', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Delivery summary for one announcement
router.get('/:id/delivery-summary', requireManagementRole, async (req, res) => {
  try {
    const announcementId = parseAnnouncementId(req.params.id);
    if (!announcementId) {
      return res.status(400).json({ error: 'Announcement ID must be a positive integer' });
    }

    const announcementResult = await pool.query('SELECT * FROM announcements WHERE id = $1', [
      announcementId,
    ]);

    if (announcementResult.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const summary = await fetchDeliverySummary(pool, announcementId);
    res.json({
      announcement: announcementResult.rows[0],
      summary,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delivery details for one announcement
router.get('/:id/deliveries', requireManagementRole, async (req, res) => {
  try {
    const announcementId = parseAnnouncementId(req.params.id);
    if (!announcementId) {
      return res.status(400).json({ error: 'Announcement ID must be a positive integer' });
    }

    const status = sanitizeText(req.query.status).toLowerCase();
    if (status && !DELIVERY_STATUS_VALUES.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${DELIVERY_STATUS_VALUES.join(', ')}`,
      });
    }

    const search = sanitizeText(req.query.search, { maxLength: 120 });
    const limit = toPositiveInteger(req.query.limit, 100, { min: 1, max: 500 });
    const offset = toPositiveInteger(req.query.offset, 0, { min: 0, max: 100000 });

    const deliveryTableExists = await isTableAvailable(pool, 'announcement_recipient_deliveries');
    if (!deliveryTableExists) {
      return res.json({
        rows: [],
        total: 0,
        limit,
        offset,
      });
    }

    const conditions = ['d.announcement_id = $1'];
    const params = [announcementId];

    if (status) {
      params.push(status);
      conditions.push(`d.delivery_status = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.replace(/[%_]/g, '\\$&')}%`);
      conditions.push(`(COALESCE(u.username, '') ILIKE $${params.length} OR COALESCE(g.name, '') ILIKE $${params.length})`);
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM announcement_recipient_deliveries d
        LEFT JOIN users u ON d.recipient_user_id = u.id
        LEFT JOIN guardians g ON d.recipient_guardian_id = g.id
        WHERE ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, limit, offset];
    const rowsResult = await pool.query(
      `
        SELECT
          d.id,
          d.announcement_id,
          d.recipient_user_id,
          d.recipient_guardian_id,
          COALESCE(u.username, g.name, CONCAT('Recipient #', COALESCE(d.recipient_user_id, d.recipient_guardian_id))) AS recipient_label,
          u.username AS recipient_username,
          u.email AS recipient_email,
          g.name AS recipient_guardian_name,
          d.notification_id,
          n.status AS notification_status,
          d.resolved_target_audience,
          d.delivery_channel,
          d.delivery_status,
          d.delivery_attempts,
          d.queued_at,
          d.sent_at,
          d.delivered_at,
          d.read_at,
          d.failed_at,
          d.failure_reason,
          d.metadata,
          d.created_at,
          d.updated_at
        FROM announcement_recipient_deliveries d
        LEFT JOIN users u ON d.recipient_user_id = u.id
        LEFT JOIN guardians g ON d.recipient_guardian_id = g.id
        LEFT JOIN notifications n ON d.notification_id = n.id
        WHERE ${whereClause}
        ORDER BY d.created_at DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `,
      dataParams,
    );

    res.json({
      rows: rowsResult.rows,
      total: parseCount(countResult.rows[0]?.total),
      limit,
      offset,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Publish announcement with per-recipient delivery tracking
router.put('/:id/publish', requireManagementRole, async (req, res) => {
  const announcementId = parseAnnouncementId(req.params.id);
  if (!announcementId) {
    return res.status(400).json({ error: 'Announcement ID must be a positive integer' });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const result = await client.query(
      `
        UPDATE announcements SET
          status = 'published',
          published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [announcementId],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const announcement = result.rows[0];
    const recipients = await resolveAnnouncementRecipients(client, announcement.target_audience);
    const deliveryTableExists = await isTableAvailable(client, 'announcement_recipient_deliveries');

    let deliverySummary = {
      ...baseDeliverySummary(announcement.id),
      total_recipients: recipients.length,
    };

    const notificationsToEmit = [];
    const now = new Date();

    if (deliveryTableExists) {
      await client.query('DELETE FROM announcement_recipient_deliveries WHERE announcement_id = $1', [
        announcement.id,
      ]);
    }

    for (const recipient of recipients) {
      const notificationPayload = buildNotificationInsertPayload({
        announcement,
        recipient,
        actorUserId: req.user.id,
      });

      const notificationId = await insertNotificationForRecipient(client, notificationPayload);
      const isDelivered = Boolean(notificationId);

      if (isDelivered) {
        notificationsToEmit.push({
          userId: recipient.user_id,
          notification: {
            id: notificationId,
            title: announcement.title,
            message: announcement.content,
            type: 'info',
            notification_type: 'system_announcement',
            category: 'general',
            is_read: false,
            created_at: now.toISOString(),
            action_url: Boolean(recipient.recipient_guardian_id) ? '/guardian/notifications' : '/announcements',
            related_entity_type: 'announcement',
            related_entity_id: announcement.id,
          },
        });
      }

      if (deliveryTableExists) {
        await insertDeliveryRecord(client, {
          announcementId: announcement.id,
          recipient,
          notificationId,
          resolvedTargetAudience: announcement.target_audience,
          deliveryStatus: isDelivered ? 'delivered' : 'failed',
          deliveryAttempts: 1,
          queuedAt: now,
          sentAt: isDelivered ? now : null,
          deliveredAt: isDelivered ? now : null,
          failedAt: isDelivered ? null : now,
          failureReason: isDelivered ? null : 'Notification record could not be persisted',
          metadata: {
            published_by: req.user.id,
          },
        });
      }
    }

    if (deliveryTableExists) {
      deliverySummary = await fetchDeliverySummary(client, announcement.id);
    }

    await client.query('COMMIT');

    socketService.broadcast('announcement_updated', announcement);
    if (deliveryTableExists) {
      emitAnnouncementDeliverySummary(announcement.id, deliverySummary);
    }

    recipients.forEach((recipient) => {
      socketService.sendToUser(recipient.user_id, 'announcement_published', {
        announcement: {
          id: announcement.id,
          title: announcement.title,
          content: announcement.content,
          priority: announcement.priority,
          target_audience: announcement.target_audience,
          published_at: announcement.published_at,
        },
      });
    });

    notificationsToEmit.forEach(({ userId, notification }) => {
      socketService.sendToUser(userId, 'notification', { notification });
    });

    res.json({
      ...announcement,
      recipient_count: recipients.length,
      delivery_summary: deliverySummary,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (_e) { /* ignore */ }
    }
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Archive announcement
router.put('/:id/archive', requireManagementRole, async (req, res) => {
  const announcementId = parseAnnouncementId(req.params.id);
  if (!announcementId) {
    return res.status(400).json({ error: 'Announcement ID must be a positive integer' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const result = await client.query(
      `
        UPDATE announcements SET
          status = 'archived',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [announcementId],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const announcement = result.rows[0];
    const deliveryTableExists = await isTableAvailable(client, 'announcement_recipient_deliveries');
    let deliverySummary = baseDeliverySummary(announcement.id);

    if (deliveryTableExists) {
      await client.query(
        `
          UPDATE announcement_recipient_deliveries
          SET
            delivery_status = CASE
              WHEN delivery_status IN ('read', 'failed', 'cancelled') THEN delivery_status
              ELSE 'cancelled'
            END,
            updated_at = CURRENT_TIMESTAMP
          WHERE announcement_id = $1
        `,
        [announcement.id],
      );

      deliverySummary = await fetchDeliverySummary(client, announcement.id);
    }

    await client.query('COMMIT');

    socketService.broadcast('announcement_updated', announcement);
    if (deliveryTableExists) {
      emitAnnouncementDeliverySummary(announcement.id, deliverySummary);
    }

    res.json({
      ...announcement,
      delivery_summary: deliverySummary,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
    }
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Get announcement by ID (read-only, no side effects)
router.get('/:id', async (req, res) => {
  try {
    const announcementId = parseAnnouncementId(req.params.id);
    if (!announcementId) {
      return res.status(400).json({ error: 'Announcement ID must be a positive integer' });
    }

    const result = await pool.query(
      `
        SELECT a.*, u.email as created_by_email
        FROM announcements a
        LEFT JOIN users u ON a.created_by = u.id
        WHERE a.id = $1
      `,
      [announcementId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update announcement
router.put('/:id', requireManagementRole, async (req, res) => {
  try {
    const announcementId = parseAnnouncementId(req.params.id);
    if (!announcementId) {
      return res.status(400).json({ error: 'Announcement ID must be a positive integer' });
    }

    const { normalized, errors } = sanitizeAnnouncementPayload(req.body);
    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    const duplicateCheck = await pool.query(
      `
        SELECT id
        FROM announcements
        WHERE LOWER(TRIM(title)) = LOWER($1)
          AND LOWER(TRIM(content)) = LOWER($2)
          AND id <> $3
          AND status <> 'archived'
        LIMIT 1
      `,
      [normalized.title, normalized.content, announcementId],
    );

    if (duplicateCheck.rows.length > 0) {
      return respondValidationError(
        res,
        {
          title: 'An active announcement with the same title and content already exists',
          content: 'An active announcement with the same title and content already exists',
        },
        'Duplicate announcement detected',
        409,
      );
    }

    const result = await pool.query(
      `
        UPDATE announcements SET
          title = $1,
          content = $2,
          target_audience = $3,
          priority = $4,
          status = $5,
          start_date = $6,
          end_date = $7,
          expires_at = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
        RETURNING *
      `,
      [
        normalized.title,
        normalized.content,
        normalized.target_audience,
        normalized.priority,
        normalized.status,
        normalized.start_date,
        normalized.end_date,
        normalized.expires_at,
        announcementId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    socketService.broadcast('announcement_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Delete announcement
router.delete('/:id', requireManagementRole, async (req, res) => {
  try {
    const announcementId = parseAnnouncementId(req.params.id);
    if (!announcementId) {
      return res.status(400).json({ error: 'Announcement ID must be a positive integer' });
    }

    const result = await pool.query('DELETE FROM announcements WHERE id = $1 RETURNING *', [announcementId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    socketService.broadcast('announcement_deleted', { id: announcementId });
    res.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

module.exports = router;
