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
let announcementsSchemaPromise = null;
let announcementsSchemaFailed = false;
let notificationCreatedByReferenceCache = {
  cachedAt: 0,
  hasValue: false,
  tableName: null,
};
const notificationCreatedByValidityCache = new Map();
const NOTIFICATION_CREATED_BY_REFERENCE_TABLES = new Set(['admin', 'users']);

const isPoolUnavailableError = (error) =>
  (typeof pool.isPoolEndedError === 'function' && pool.isPoolEndedError(error)) ||
  String(error?.message || '').toLowerCase().includes('cannot use a pool after calling end on the pool');

const isDatabaseClientAvailable = (client, context) => {
  if (client && client !== pool) {
    if (client._ending || client._queryable === false) {
      console.warn(`[Announcements] Skipping ${context}; database client is unavailable.`);
      return false;
    }
    return true;
  }

  if (typeof pool.warnIfPoolUnavailable === 'function') {
    return !pool.warnIfPoolUnavailable(`announcements.${context}`);
  }

  if (pool.ended) {
    console.warn(`[Announcements] Skipping ${context}; database pool is closed.`);
    return false;
  }

  return true;
};

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

const sanitizeAnnouncementFilterQuery = (query = {}) => {
  const errors = {};

  const statusInput = sanitizeText(query.status).toLowerCase();
  const priorityInput = sanitizeText(query.priority).toLowerCase();
  const targetAudienceInput = sanitizeText(query.target_audience).toLowerCase();
  const periodStartRaw = sanitizeText(query.period_start);
  const periodEndRaw = sanitizeText(query.period_end);

  const status = statusInput
    ? normalizeEnumValue(statusInput, STATUS_VALUES, '')
    : '';
  const priority = priorityInput
    ? normalizeEnumValue(priorityInput, PRIORITY_VALUES, '')
    : '';
  const targetAudience = targetAudienceInput
    ? normalizeEnumValue(targetAudienceInput, AUDIENCE_VALUES, '')
    : '';

  if (statusInput && !status) {
    errors.status = `status must be one of: ${STATUS_VALUES.join(', ')}`;
  }

  if (priorityInput && !priority) {
    errors.priority = `priority must be one of: ${PRIORITY_VALUES.join(', ')}`;
  }

  if (targetAudienceInput && !targetAudience) {
    errors.target_audience = `target_audience must be one of: ${AUDIENCE_VALUES.join(', ')}`;
  }

  Object.assign(
    errors,
    validateDateRange({
      startDate: periodStartRaw,
      endDate: periodEndRaw,
      startKey: 'period_start',
      endKey: 'period_end',
      startLabel: 'Start date',
      endLabel: 'End date',
    }),
  );

  return {
    normalized: {
      status,
      priority,
      target_audience: targetAudience,
      period_start: periodStartRaw || '',
      period_end: periodEndRaw || '',
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
  if (!isDatabaseClientAvailable(client, `getTableColumns:${tableName}`)) {
    return new Set();
  }

  const cacheKey = String(tableName);
  const now = Date.now();
  const cached = tableColumnCache.get(cacheKey);

  if (cached && now - cached.cachedAt < TABLE_COLUMN_CACHE_TTL_MS) {
    return cached.columns;
  }

  let result;
  try {
    result = await client.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
      `,
      [tableName],
    );
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      console.warn(`[Announcements] Skipping column lookup for ${tableName}; database pool is unavailable.`);
      return new Set();
    }
    throw error;
  }

  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnCache.set(cacheKey, { columns, cachedAt: now });
  return columns;
};

const isTableAvailable = async (client, tableName) => {
  const columns = await getTableColumns(client, tableName);
  return columns.size > 0;
};

const getNotificationCreatedByReferenceTable = async (client) => {
  if (!isDatabaseClientAvailable(client, 'getNotificationCreatedByReferenceTable')) {
    return null;
  }

  const now = Date.now();
  if (
    notificationCreatedByReferenceCache.hasValue &&
    now - notificationCreatedByReferenceCache.cachedAt < TABLE_COLUMN_CACHE_TTL_MS
  ) {
    return notificationCreatedByReferenceCache.tableName;
  }

  const result = await client.query(
    `
      SELECT ccu.table_name AS referenced_table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = 'notifications'
        AND kcu.column_name = 'created_by'
      LIMIT 1
    `,
  );

  const tableName = result.rows[0]?.referenced_table_name || null;
  notificationCreatedByReferenceCache = {
    cachedAt: now,
    hasValue: true,
    tableName,
  };
  return tableName;
};

const resolveValidNotificationCreatedBy = async (client, rawCreatedBy) => {
  const createdBy = parseInt(rawCreatedBy, 10);
  if (!Number.isInteger(createdBy) || createdBy <= 0) {
    return null;
  }

  let referenceTableName;
  try {
    referenceTableName = await getNotificationCreatedByReferenceTable(client);
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      console.warn('[Announcements] Skipping notification created_by validation because database pool is unavailable.');
      return null;
    }
    console.warn('[Announcements] Unable to inspect notifications.created_by constraint; omitting created_by.', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (!referenceTableName) {
    return createdBy;
  }

  if (!NOTIFICATION_CREATED_BY_REFERENCE_TABLES.has(referenceTableName)) {
    console.warn('[Announcements] Unsupported notifications.created_by reference table; omitting created_by.', {
      referenceTableName,
    });
    return null;
  }

  const cacheKey = `${referenceTableName}:${createdBy}`;
  const now = Date.now();
  const cached = notificationCreatedByValidityCache.get(cacheKey);
  if (cached && now - cached.cachedAt < TABLE_COLUMN_CACHE_TTL_MS) {
    return cached.isValid ? createdBy : null;
  }

  try {
    const result = await client.query(
      `SELECT 1 FROM ${referenceTableName} WHERE id = $1 LIMIT 1`,
      [createdBy],
    );
    const isValid = result.rows.length > 0;
    notificationCreatedByValidityCache.set(cacheKey, { cachedAt: now, isValid });
    return isValid ? createdBy : null;
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      console.warn('[Announcements] Skipping notification created_by validation because database pool is unavailable.');
      return null;
    }
    console.warn('[Announcements] Unable to validate notifications.created_by; omitting created_by.', {
      message: error instanceof Error ? error.message : String(error),
      referenceTableName,
    });
    return null;
  }
};

const clearTableColumnCache = (...tableNames) => {
  tableNames
    .filter(Boolean)
    .forEach((tableName) => tableColumnCache.delete(String(tableName)));
};

const escapeSqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

const ensureConstraint = async (client, tableName, constraintName, definitionSql) => {
  await client.query(
    `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = ${escapeSqlLiteral(constraintName)}
            AND conrelid = to_regclass(${escapeSqlLiteral(`public.${tableName}`)})
        ) THEN
          ALTER TABLE ${tableName}
            ADD CONSTRAINT ${constraintName}
            ${definitionSql};
        END IF;
      END $$;
    `,
  );
};

const ensureAnnouncementsSchema = async (client = pool) => {
  if (!isDatabaseClientAvailable(client, 'ensureAnnouncementsSchema')) {
    return;
  }

  if (announcementsSchemaFailed) {
    return;
  }
  if (!announcementsSchemaPromise) {
    announcementsSchemaPromise = (async () => {
      const [usersAvailable, adminAvailable] = await Promise.all([
        isTableAvailable(client, 'users'),
        isTableAvailable(client, 'admin'),
      ]);
      const createdByTable = usersAvailable ? 'users' : (adminAvailable ? 'admin' : null);

      if (!createdByTable) {
        throw new Error('Unable to initialize announcements schema because users/admin tables are unavailable.');
      }

      await client.query(
        `
          CREATE TABLE IF NOT EXISTS announcements (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            priority VARCHAR(20) NOT NULL DEFAULT 'medium',
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            target_audience VARCHAR(20) NOT NULL DEFAULT 'all',
            start_date DATE,
            end_date DATE,
            published_at TIMESTAMP WITHOUT TIME ZONE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            expires_at TIMESTAMP WITHOUT TIME ZONE,
            created_by INTEGER NOT NULL REFERENCES ${createdByTable}(id),
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP WITHOUT TIME ZONE
          )
        `,
      );

      await client.query('CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_announcements_priority ON announcements(priority)');
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_announcements_target_audience ON announcements(target_audience)',
      );
      await client.query('CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON announcements(created_by)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_announcements_is_active ON announcements(is_active)');

      await ensureConstraint(
        client,
        'announcements',
        'chk_announcements_priority',
        `CHECK (priority IN ('low', 'medium', 'high', 'urgent'))`,
      );
      await ensureConstraint(
        client,
        'announcements',
        'chk_announcements_status',
        `CHECK (status IN ('draft', 'published', 'archived'))`,
      );
      await ensureConstraint(
        client,
        'announcements',
        'chk_announcements_target_audience',
        `CHECK (target_audience IN ('all', 'patients', 'staff'))`,
      );

      await client.query(
        `
          CREATE TABLE IF NOT EXISTS announcement_recipient_deliveries (
            id SERIAL PRIMARY KEY,
            announcement_id INTEGER NOT NULL,
            recipient_user_id INTEGER,
            recipient_guardian_id INTEGER,
            notification_id INTEGER,
            resolved_target_audience VARCHAR(50) NOT NULL DEFAULT 'all',
            delivery_channel VARCHAR(30) NOT NULL DEFAULT 'in_app',
            delivery_status VARCHAR(30) NOT NULL DEFAULT 'pending',
            delivery_attempts INTEGER NOT NULL DEFAULT 0,
            queued_at TIMESTAMP WITHOUT TIME ZONE,
            sent_at TIMESTAMP WITHOUT TIME ZONE,
            delivered_at TIMESTAMP WITHOUT TIME ZONE,
            read_at TIMESTAMP WITHOUT TIME ZONE,
            failed_at TIMESTAMP WITHOUT TIME ZONE,
            failure_reason TEXT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
      );

      await ensureConstraint(
        client,
        'announcement_recipient_deliveries',
        'chk_ard_recipient_present',
        'CHECK (recipient_user_id IS NOT NULL OR recipient_guardian_id IS NOT NULL)',
      );
      await ensureConstraint(
        client,
        'announcement_recipient_deliveries',
        'chk_ard_delivery_status',
        `CHECK (delivery_status IN ('pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'cancelled'))`,
      );
      await ensureConstraint(
        client,
        'announcement_recipient_deliveries',
        'chk_ard_delivery_attempts_non_negative',
        'CHECK (delivery_attempts >= 0)',
      );
      await ensureConstraint(
        client,
        'announcement_recipient_deliveries',
        'fk_ard_announcement_id',
        'FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON UPDATE CASCADE ON DELETE CASCADE',
      );

      if (usersAvailable) {
        await ensureConstraint(
          client,
          'announcement_recipient_deliveries',
          'fk_ard_recipient_user_id',
          'FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL',
        );
      }

      if (await isTableAvailable(client, 'guardians')) {
        await ensureConstraint(
          client,
          'announcement_recipient_deliveries',
          'fk_ard_recipient_guardian_id',
          'FOREIGN KEY (recipient_guardian_id) REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE SET NULL',
        );
      }

      if (await isTableAvailable(client, 'notifications')) {
        await ensureConstraint(
          client,
          'announcement_recipient_deliveries',
          'fk_ard_notification_id',
          'FOREIGN KEY (notification_id) REFERENCES notifications(id) ON UPDATE CASCADE ON DELETE SET NULL',
        );
      }

      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_ard_announcement_id ON announcement_recipient_deliveries(announcement_id)',
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_ard_recipient_user_id ON announcement_recipient_deliveries(recipient_user_id)',
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_ard_recipient_guardian_id ON announcement_recipient_deliveries(recipient_guardian_id)',
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_ard_notification_id ON announcement_recipient_deliveries(notification_id)',
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_ard_delivery_status ON announcement_recipient_deliveries(delivery_status)',
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_ard_created_at_desc ON announcement_recipient_deliveries(created_at DESC)',
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_ard_announcement_status ON announcement_recipient_deliveries(announcement_id, delivery_status)',
      );
      await client.query(
        `
          CREATE UNIQUE INDEX IF NOT EXISTS uq_ard_announcement_user
            ON announcement_recipient_deliveries(announcement_id, recipient_user_id)
            WHERE recipient_user_id IS NOT NULL
        `,
      );
      await client.query(
        `
          CREATE UNIQUE INDEX IF NOT EXISTS uq_ard_announcement_guardian
            ON announcement_recipient_deliveries(announcement_id, recipient_guardian_id)
            WHERE recipient_user_id IS NULL AND recipient_guardian_id IS NOT NULL
        `,
      );

      clearTableColumnCache('announcements', 'announcement_recipient_deliveries');
    })().catch((error) => {
      if (isPoolUnavailableError(error)) {
        announcementsSchemaPromise = null;
        console.warn('[Announcements] Schema initialization skipped because database pool is unavailable.', {
          message: error.message,
        });
        return;
      }

      announcementsSchemaFailed = true;
      announcementsSchemaPromise = null;
      console.error(
        '[Announcements] Schema initialization failed permanently. Announcement routes will be disabled until server restart.',
        { message: error.message, code: error.code, detail: error.detail },
      );
    });
  }

  return announcementsSchemaPromise;
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

const insertNotificationForRecipient = async (client, payload, options = {}) => {
  const { useSavepoint = true } = options || {};
  if (!isDatabaseClientAvailable(client, 'insertNotificationForRecipient')) {
    return null;
  }

  let notificationColumns;
  try {
    notificationColumns = await getTableColumns(client, 'notifications');
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      console.warn('[Announcements] Skipping notification insert because database pool is unavailable.');
      return null;
    }
    throw error;
  }

  if (notificationColumns.size === 0) {
    return null;
  }

  const insertPayload = { ...(payload || {}) };
  if (notificationColumns.has('created_by')) {
    insertPayload.created_by = await resolveValidNotificationCreatedBy(client, insertPayload.created_by);
  }

  const keys = Object.keys(insertPayload).filter(
    (key) => notificationColumns.has(key) && insertPayload[key] !== undefined,
  );

  if (keys.length === 0 || !keys.includes('message')) {
    return null;
  }

  const placeholders = keys.map((_, index) => `$${index + 1}`);
  const values = keys.map((key) => insertPayload[key]);

  try {
    if (useSavepoint) {
      await client.query('SAVEPOINT notify_insert');
    }
    const result = await client.query(
      `
        INSERT INTO notifications (${keys.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING id
      `,
      values,
    );
    if (useSavepoint) {
      await client.query('RELEASE SAVEPOINT notify_insert');
    }
    return result.rows[0]?.id || null;
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      console.warn('[Announcements] Skipping notification insert because database pool is unavailable.', {
        message: error.message,
      });
      return null;
    }

    if (useSavepoint) {
      try {
        await client.query('ROLLBACK TO SAVEPOINT notify_insert');
      } catch (rollbackError) {
        console.error('Error rolling back notify_insert savepoint:', rollbackError.message);
      }
    }
    console.error('Error inserting announcement notification:', {
      message: error instanceof Error ? error.message : String(error),
      code: error?.code ?? null,
      detail: error?.detail ?? null,
    });
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
    throwOnError = false,
    useSavepoint = true,
  },
) => {
  if (!isDatabaseClientAvailable(client, 'insertDeliveryRecord')) {
    return;
  }

  try {
    if (useSavepoint) {
      await client.query('SAVEPOINT delivery_insert');
    }
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
    if (useSavepoint) {
      await client.query('RELEASE SAVEPOINT delivery_insert');
    }
  } catch (error) {
    if (isPoolUnavailableError(error)) {
      console.warn('[Announcements] Skipping delivery record insert because database pool is unavailable.', {
        announcementId,
        message: error.message,
      });
      return;
    }

    if (useSavepoint) {
      try {
        await client.query('ROLLBACK TO SAVEPOINT delivery_insert');
      } catch (rollbackError) {
        console.error('Error rolling back delivery_insert savepoint:', rollbackError.message);
      }
    }
    console.error('Error inserting delivery record:', error instanceof Error ? error.message : String(error));
    if (throwOnError) {
      throw error;
    }
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

const resolveAnnouncementRecipientsWithCache = async (client, targetAudienceValue, recipientCache) => {
  const normalizedAudience = sanitizeText(targetAudienceValue).toLowerCase();
  if (!recipientCache) {
    return resolveAnnouncementRecipients(client, normalizedAudience);
  }

  if (recipientCache.has(normalizedAudience)) {
    return recipientCache.get(normalizedAudience);
  }

  const recipients = await resolveAnnouncementRecipients(client, normalizedAudience);
  recipientCache.set(normalizedAudience, recipients);
  return recipients;
};

const getValidGuardianIds = async (client, recipients) => {
  const guardianIds = [...new Set(
    (recipients || [])
      .map((recipient) => parseInt(recipient.recipient_guardian_id, 10))
      .filter((id) => Number.isInteger(id) && id > 0),
  )];

  if (guardianIds.length === 0 || !(await isTableAvailable(client, 'guardians'))) {
    return new Set();
  }

  const result = await client.query(
    'SELECT id FROM guardians WHERE id = ANY($1::int[])',
    [guardianIds],
  );
  return new Set(result.rows.map((row) => parseInt(row.id, 10)));
};

const bulkInsertBackfilledDeliveryRecords = async (client, announcement, recipients) => {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return;
  }

  const backfilledAt = new Date();
  const deliveredAt = announcement.published_at || announcement.created_at || backfilledAt;
  const validGuardianIds = await getValidGuardianIds(client, recipients);
  const recipientRows = recipients
    .map((recipient) => {
      const userId = parseInt(recipient.user_id, 10);
      const guardianId = parseInt(recipient.recipient_guardian_id, 10);
      return {
        recipient_user_id: Number.isInteger(userId) && userId > 0 ? userId : null,
        recipient_guardian_id:
          Number.isInteger(guardianId) && guardianId > 0 && validGuardianIds.has(guardianId)
            ? guardianId
            : null,
      };
    })
    .filter((recipient) => recipient.recipient_user_id || recipient.recipient_guardian_id);

  if (recipientRows.length === 0) {
    return;
  }

  await client.query(
    `
      WITH recipient_rows AS (
        SELECT recipient_user_id, recipient_guardian_id
        FROM jsonb_to_recordset($5::jsonb)
          AS r(recipient_user_id INTEGER, recipient_guardian_id INTEGER)
      )
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
      )
      SELECT
        $1::integer,
        recipient_user_id,
        recipient_guardian_id,
        NULL::integer,
        $2::varchar,
        'in_app',
        'delivered',
        1,
        $3::timestamp,
        $3::timestamp,
        $3::timestamp,
        NULL::timestamp,
        NULL::text,
        $4::jsonb
      FROM recipient_rows
      WHERE recipient_user_id IS NOT NULL OR recipient_guardian_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `,
    [
      announcement.id,
      sanitizeText(announcement.target_audience).toLowerCase() || 'all',
      deliveredAt,
      JSON.stringify({
        backfilled: true,
        backfilled_at: backfilledAt.toISOString(),
        notification_created: false,
        source: 'announcement_delivery_tracking_backfill',
      }),
      JSON.stringify(recipientRows),
    ],
  );
};

const healBackfilledNotificationPersistenceFailures = async (client, announcementId) => {
  await client.query(
    `
      UPDATE announcement_recipient_deliveries
      SET
        delivery_status = 'delivered',
        sent_at = COALESCE(sent_at, queued_at, CURRENT_TIMESTAMP),
        delivered_at = COALESCE(delivered_at, sent_at, queued_at, CURRENT_TIMESTAMP),
        failed_at = NULL,
        failure_reason = NULL,
        metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE announcement_id = $1
        AND delivery_status = 'failed'
        AND failure_reason = 'Notification record could not be persisted'
        AND COALESCE(metadata, '{}'::jsonb)->>'backfilled' = 'true'
    `,
    [
      announcementId,
      JSON.stringify({
        notification_created: false,
        healed_notification_fk_failure: true,
        healed_at: new Date().toISOString(),
      }),
    ],
  );
};

const ensureAnnouncementDeliveryBackfill = async (client, announcement, options = {}) => {
  if (!announcement || announcement.status !== 'published') {
    return;
  }

  const deliveryTableExists = await isTableAvailable(client, 'announcement_recipient_deliveries');
  if (!deliveryTableExists) {
    return;
  }

  await healBackfilledNotificationPersistenceFailures(client, announcement.id);

  const existingCountResult = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM announcement_recipient_deliveries
      WHERE announcement_id = $1
    `,
    [announcement.id],
  );

  const existingCount = parseCount(existingCountResult.rows[0]?.count);
  const recipients = await resolveAnnouncementRecipientsWithCache(
    client,
    announcement.target_audience,
    options.recipientCache,
  );
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return;
  }

  if (existingCount >= recipients.length) {
    return;
  }

  await bulkInsertBackfilledDeliveryRecords(client, announcement, recipients);
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
router.use((req, res, next) => {
  ensureAnnouncementsSchema(pool)
    .then(() => next())
    .catch((error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
        return;
      }
      next(error);
    });
});

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

    if (!res.headersSent) {
      return res.json(summaryByAnnouncement);
    }
    return undefined;
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
    return undefined;
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
    const { normalized, errors } = sanitizeAnnouncementFilterQuery(req.query);
    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors, 'Invalid announcement filters');
    }

    let query = `
      SELECT a.*, u.email as created_by_email
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (normalized.status) {
      query += ' AND a.status = $' + (params.length + 1);
      params.push(normalized.status);
    }

    if (normalized.priority) {
      query += ' AND a.priority = $' + (params.length + 1);
      params.push(normalized.priority);
    }

    if (normalized.target_audience) {
      query += ' AND a.target_audience = $' + (params.length + 1);
      params.push(normalized.target_audience);
    }

    if (normalized.period_start) {
      query += ' AND DATE(a.created_at) >= $' + (params.length + 1);
      params.push(normalized.period_start);
    }

    if (normalized.period_end) {
      query += ' AND DATE(a.created_at) <= $' + (params.length + 1);
      params.push(normalized.period_end);
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

// Get my announcements
router.get('/my', async (req, res) => {
  try {
    const userId = req.user.id;
    const deliveryTableExists = await isTableAvailable(pool, 'announcement_recipient_deliveries');

    let query;
    let params = [];

    if (deliveryTableExists) {
      query = `
        SELECT a.*, u.email as created_by_email,
               d.delivery_status,
               CASE WHEN d.delivery_status = 'read' THEN true ELSE false END as has_acknowledged
        FROM announcements a
        JOIN announcement_recipient_deliveries d ON a.id = d.announcement_id
        LEFT JOIN users u ON a.created_by = u.id
        WHERE d.recipient_user_id = $1 AND a.status = 'published'
        ORDER BY a.priority DESC, a.created_at DESC
      `;
      params = [userId];
    } else {
      query = `
        SELECT a.*, u.email as created_by_email, false as has_acknowledged
        FROM announcements a
        LEFT JOIN users u ON a.created_by = u.id
        WHERE a.status = 'published'
          AND (a.target_audience = 'all' OR a.target_audience = 'patients')
        ORDER BY a.priority DESC, a.created_at DESC
      `;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
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

    await ensureAnnouncementDeliveryBackfill(pool, announcementResult.rows[0]);
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
          throwOnError: true,
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

    if (!res.headersSent) {
      return res.json({
        ...announcement,
        recipient_count: recipients.length,
        delivery_summary: deliverySummary,
      });
    }
    return undefined;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (_e) { /* ignore */ }
    }
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
    return undefined;
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

// Acknowledge announcement
router.post('/:id/acknowledge', async (req, res) => {
  try {
    const announcementId = parseAnnouncementId(req.params.id);
    const userId = req.user.id;

    if (!announcementId) {
      return res.status(400).json({ error: 'Invalid announcement ID' });
    }

    const deliveryTableExists = await isTableAvailable(pool, 'announcement_recipient_deliveries');
    if (deliveryTableExists) {
      await pool.query(
        `UPDATE announcement_recipient_deliveries
         SET delivery_status = 'read', read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE announcement_id = $1 AND recipient_user_id = $2`,
        [announcementId, userId]
      );
    }

    res.json({ success: true, message: 'Announcement acknowledged' });
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
