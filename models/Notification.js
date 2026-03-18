const pool = require('../db');

class Notification {
  constructor(notificationData) {
    // Initialize notification properties
    this.id = notificationData?.id;
    this.userId = notificationData?.user_id || notificationData?.userId;
    this.title = notificationData?.title;
    this.message = notificationData?.message;
    this.type = notificationData?.type;
    this.category = notificationData?.category;
    this.isRead = notificationData?.is_read !== undefined ? notificationData.is_read : false;
    this.priority = notificationData?.priority || 'normal';
    this.relatedEntityType =
      notificationData?.related_entity_type || notificationData?.relatedEntityType;
    this.relatedEntityId = notificationData?.related_entity_id || notificationData?.relatedEntityId;
    this.createdAt = notificationData?.created_at || notificationData?.createdAt;
    this.updatedAt = notificationData?.updated_at || notificationData?.updatedAt;
    this.expiresAt = notificationData?.expires_at || notificationData?.expiresAt;
    this.actionRequired =
      notificationData?.action_required !== undefined ? notificationData.action_required : false;
    this.actionUrl = notificationData?.action_url || notificationData?.actionUrl;
    this.channel = notificationData?.channel;
    // Delivery tracking fields
    this.status = notificationData?.status || 'pending';
    this.deliveryAttempts = notificationData?.delivery_attempts || 0;
    this.firstAttemptAt = notificationData?.first_attempt_at || null;
    this.lastAttemptAt = notificationData?.last_attempt_at || null;
    this.deliveredAt = notificationData?.delivered_at || null;
    this.failureReason = notificationData?.failure_reason || null;
    this.channelMessageId = notificationData?.channel_message_id || null;
    this.channelStatus = notificationData?.channel_status || null;
  }

  static async findAll(limit = 100) {
    try {
      const result = await pool.query(
        'SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1',
        [limit],
      );
      return result.rows.map((row) => new Notification(row));
    } catch (error) {
      console.error('Error finding all notifications:', error);
      return [];
    }
  }

  static async findById(id) {
    try {
      const result = await pool.query('SELECT * FROM notifications WHERE id = $1', [id]);
      return result.rows.length > 0 ? new Notification(result.rows[0]) : null;
    } catch (error) {
      console.error('Error finding notification by id:', error);
      return null;
    }
  }

  static async findByUserId(userId, limit = 100, filters = {}) {
    try {
      let query = `
        SELECT * FROM notifications
        WHERE (user_id = $1 OR user_id IS NULL)
      `;
      const params = [userId];

      // Apply filters - priority is ENUM type ('low', 'normal', 'high', 'urgent')
      if (filters.priority) {
        query += ` AND priority = $${params.length + 1}`;
        params.push(filters.priority);
      }

      if (filters.category) {
        query += ` AND category = $${params.length + 1}`;
        params.push(filters.category);
      }

      if (filters.isRead !== undefined) {
        query += ` AND is_read = $${params.length + 1}`;
        params.push(filters.isRead);
      }

      // Priority sorting - handle ENUM priority type
      query += ` ORDER BY
        CASE priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END, created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await pool.query(query, params);
      return result.rows.map((row) => new Notification(row));
    } catch (error) {
      console.error('Error finding notifications by user id:', error);
      return [];
    }
  }

  static async findUnreadByUserId(userId) {
    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE (user_id = $1 OR user_id IS NULL) AND is_read = FALSE
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map((row) => new Notification(row));
  }

  static async create(notificationData) {
    const result = await pool.query(
      `INSERT INTO notifications (
        user_id, title, message, type, category, priority,
        related_entity_type, related_entity_id, expires_at,
        action_required, action_url, channel,
        status, delivery_attempts, first_attempt_at, last_attempt_at,
        delivered_at, failure_reason, channel_message_id, channel_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *`,
      [
        notificationData.userId,
        notificationData.title,
        notificationData.message,
        notificationData.type,
        notificationData.category,
        notificationData.priority || 'normal',
        notificationData.relatedEntityType,
        notificationData.relatedEntityId,
        notificationData.expiresAt,
        notificationData.actionRequired || false,
        notificationData.actionUrl,
        notificationData.channel,
        notificationData.status || 'pending',
        notificationData.deliveryAttempts || 0,
        notificationData.firstAttemptAt || null,
        notificationData.lastAttemptAt || null,
        notificationData.deliveredAt || null,
        notificationData.failureReason || null,
        notificationData.channelMessageId || null,
        notificationData.channelStatus || null,
      ],
    );
    return new Notification(result.rows[0]);
  }

  async save() {
    if (this.id) {
      // Update existing notification
      const result = await pool.query(
        `UPDATE notifications SET
           is_read = $1,
           updated_at = CURRENT_TIMESTAMP,
           status = $2,
           delivery_attempts = $3,
           first_attempt_at = $4,
           last_attempt_at = $5,
           delivered_at = $6,
           failure_reason = $7,
           channel_message_id = $8,
           channel_status = $9
         WHERE id = $10 RETURNING *`,
        [
          this.isRead,
          this.status,
          this.deliveryAttempts,
          this.firstAttemptAt,
          this.lastAttemptAt,
          this.deliveredAt,
          this.failureReason,
          this.channelMessageId,
          this.channelStatus,
          this.id,
        ],
      );
      return new Notification(result.rows[0]);
    } else {
      // Create new notification
      return Notification.create(this);
    }
  }

  async markAsRead() {
    this.isRead = true;
    this.status = 'read';
    const result = await pool.query(
      `UPDATE notifications SET
         is_read = $1,
         updated_at = CURRENT_TIMESTAMP,
         status = $2
       WHERE id = $3 RETURNING *`,
      [this.isRead, this.status, this.id],
    );
    return new Notification(result.rows[0]);
  }

  static async markAllAsRead(userId) {
    const result = await pool.query(
      `UPDATE notifications SET
        is_read = TRUE,
        updated_at = CURRENT_TIMESTAMP
      WHERE (user_id = $1 OR user_id IS NULL) AND is_read = FALSE
      RETURNING *`,
      [userId],
    );
    return result.rows.map((row) => new Notification(row));
  }

  static async getStats(userId) {
    // Handle ENUM priority type - map to integer for comparison
    const result = await pool.query(
      `SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN is_read = FALSE THEN 1 ELSE 0 END) as unread_count,
        SUM(CASE WHEN priority IN ('urgent', 'high') THEN 1 ELSE 0 END) as high_priority_count,
        SUM(CASE WHEN priority = 'normal' THEN 1 ELSE 0 END) as medium_priority_count,
        SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END) as low_priority_count
      FROM notifications
      WHERE user_id = $1 OR user_id IS NULL`,
      [userId],
    );
    return result.rows[0];
  }

  static async deleteExpired() {
    const result = await pool.query(
      `DELETE FROM notifications
       WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
       RETURNING *`,
    );
    return result.rows.map((row) => new Notification(row));
  }

  static async findByRelatedEntity(relatedEntityType, relatedEntityId) {
    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE related_entity_type = $1 AND related_entity_id = $2
       ORDER BY created_at DESC`,
      [relatedEntityType, relatedEntityId],
    );
    return result.rows.map((row) => new Notification(row));
  }
}

class Alert {
  constructor(alertData) {
    this.id = alertData?.id;
    this.title = alertData?.title;
    this.message = alertData?.message;
    this.severity = alertData?.severity;
    this.category = alertData?.category;
    this.isActive = alertData?.is_active !== undefined ? alertData.is_active : true;
    this.isAcknowledged =
      alertData?.is_acknowledged !== undefined ? alertData.is_acknowledged : false;
    this.acknowledgedBy = alertData?.acknowledged_by || alertData?.acknowledgedBy;
    this.acknowledgedAt = alertData?.acknowledged_at || alertData?.acknowledgedAt;
    this.createdAt = alertData?.created_at || alertData?.createdAt;
    this.expiresAt = alertData?.expires_at || alertData?.expiresAt;
    this.thresholdValue = alertData?.threshold_value || alertData?.thresholdValue;
    this.currentValue = alertData?.current_value || alertData?.currentValue;
    this.triggerCondition = alertData?.trigger_condition || alertData?.triggerCondition;
  }

  static async findAll(limit = 100) {
    const result = await pool.query('SELECT * FROM alerts ORDER BY created_at DESC LIMIT $1', [
      limit,
    ]);
    return result.rows.map((row) => new Alert(row));
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM alerts WHERE id = $1', [id]);
    return result.rows.length > 0 ? new Alert(result.rows[0]) : null;
  }

  static async findActive() {
    const result = await pool.query(
      `SELECT * FROM alerts
       WHERE is_active = TRUE AND is_acknowledged = FALSE
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END, created_at DESC`,
    );
    return result.rows.map((row) => new Alert(row));
  }

  static async create(alertData) {
    const result = await pool.query(
      `INSERT INTO alerts (
        title, message, severity, category, expires_at,
        threshold_value, current_value, trigger_condition
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        alertData.title,
        alertData.message,
        alertData.severity,
        alertData.category,
        alertData.expiresAt,
        alertData.thresholdValue,
        alertData.currentValue,
        alertData.triggerCondition,
      ],
    );
    return new Alert(result.rows[0]);
  }

  async acknowledge(userId) {
    this.isAcknowledged = true;
    this.acknowledgedBy = userId;
    this.acknowledgedAt = new Date();

    const result = await pool.query(
      `UPDATE alerts SET
        is_acknowledged = TRUE,
        acknowledged_by = $1,
        acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [userId, this.id],
    );
    return new Alert(result.rows[0]);
  }

  async resolve(resolutionNotes) {
    const result = await pool.query(
      `UPDATE alerts SET
        is_active = FALSE,
        resolution_notes = $1,
        resolved_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [resolutionNotes, this.id],
    );
    return new Alert(result.rows[0]);
  }
}

class NotificationPreference {
  constructor(preferenceData) {
    this.id = preferenceData?.id;
    this.userId = preferenceData?.user_id || preferenceData?.userId;
    this.notificationType = preferenceData?.notification_type || preferenceData?.notificationType;
    this.channel = preferenceData?.channel;
    this.isEnabled = preferenceData?.is_enabled !== undefined ? preferenceData.is_enabled : true;
    this.createdAt = preferenceData?.created_at || preferenceData?.createdAt;
    this.updatedAt = preferenceData?.updated_at || preferenceData?.updatedAt;
  }

  static async findByUserId(userId) {
    const result = await pool.query('SELECT * FROM notification_preferences WHERE user_id = $1', [
      userId,
    ]);
    return result.rows.map((row) => new NotificationPreference(row));
  }

  static async findByUserAndType(userId, notificationType) {
    const result = await pool.query(
      `SELECT * FROM notification_preferences
       WHERE user_id = $1 AND notification_type = $2`,
      [userId, notificationType],
    );
    return result.rows.map((row) => new NotificationPreference(row));
  }

  static async upsert(preferenceData) {
    const result = await pool.query(
      `INSERT INTO notification_preferences (
        user_id, notification_type, channel, is_enabled
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, notification_type, channel)
      DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        preferenceData.userId,
        preferenceData.notificationType,
        preferenceData.channel,
        preferenceData.isEnabled,
      ],
    );
    return new NotificationPreference(result.rows[0]);
  }
}

module.exports = {
  Notification,
  Alert,
  NotificationPreference,
};
