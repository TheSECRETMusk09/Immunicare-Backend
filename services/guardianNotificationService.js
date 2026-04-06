// backend/services/guardianNotificationService.js

const pool = require('../db');
const logger = require('../config/logger');

const GUARDIAN_NOTIFICATION_TYPE_GROUPS = Object.freeze({
  appointment: Object.freeze([
    'appointment_confirmation',
    'appointment_confirmed',
    'appointment_status',
    'appointment_status_changed',
    'appointment_update',
    'appointment_updated',
    'appointment_rescheduled',
    'appointment_cancelled',
    'appointment_suggested',
    'sms_confirmation_sent',
  ]),
  vaccination_update: Object.freeze([
    'vaccine_administered',
    'infant_registration',
    'child_registration_success',
    'child_registered',
    'infant_created',
    'transfer_in',
    'transfer_in_submitted',
  ]),
  reminder: Object.freeze([
    'appointment_reminder',
    'vaccination_reminder',
    'vaccination_schedule',
    'vaccination_due',
    'immunization_schedule',
    'schedule_due',
    'vaccine_due',
    'upcoming_vaccine',
    'next_vaccine_computed',
    'missed_schedule',
    'missed_appointment',
    'missed_vaccine',
    'overdue_vaccination',
    'vaccine_overdue',
  ]),
  health_alert: Object.freeze(['health_alert']),
  general: Object.freeze([
    'system_announcement',
    'announcement',
    'new_message',
    'profile_update',
    'general',
    'notification',
    'auth',
    'security',
  ]),
});

const GUARDIAN_ALLOWED_NOTIFICATION_TYPES = Object.freeze(
  Array.from(new Set(Object.values(GUARDIAN_NOTIFICATION_TYPE_GROUPS).flat())),
);

const GUARDIAN_LEGACY_TYPE_FILTER_MAP = Object.freeze({
  vaccination_schedule: GUARDIAN_NOTIFICATION_TYPE_GROUPS.reminder,
  missed_schedule: GUARDIAN_NOTIFICATION_TYPE_GROUPS.reminder,
  infant_registration: GUARDIAN_NOTIFICATION_TYPE_GROUPS.vaccination_update,
  system_announcement: GUARDIAN_NOTIFICATION_TYPE_GROUPS.general,
});

const normalizeFilterValue = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const resolveGuardianTypeFilterValues = (rawType) => {
  const normalizedType = normalizeFilterValue(rawType);

  if (!normalizedType || normalizedType === 'all') {
    return [...GUARDIAN_ALLOWED_NOTIFICATION_TYPES];
  }

  if (GUARDIAN_NOTIFICATION_TYPE_GROUPS[normalizedType]) {
    return [...GUARDIAN_NOTIFICATION_TYPE_GROUPS[normalizedType]];
  }

  if (GUARDIAN_LEGACY_TYPE_FILTER_MAP[normalizedType]) {
    return [...GUARDIAN_LEGACY_TYPE_FILTER_MAP[normalizedType]];
  }

  if (GUARDIAN_ALLOWED_NOTIFICATION_TYPES.includes(normalizedType)) {
    return [normalizedType];
  }

  return [];
};

const buildGuardianVisibilityClause = (guardianIdPlaceholder, typesPlaceholder) => `
  guardian_id = ${guardianIdPlaceholder}
  AND target_role IS DISTINCT FROM 'admin'
  AND notification_type = ANY(${typesPlaceholder}::text[])
`;

class GuardianNotificationService {
  /**
   * Get notifications for a specific guardian
   */
  async getGuardianNotifications(guardianId, options = {}) {
    const { limit = 50, offset = 0, unreadOnly = false, type, search } = options;
    const typeFilterValues = resolveGuardianTypeFilterValues(type);

    if (type && type !== 'all' && typeFilterValues.length === 0) {
      return [];
    }

    try {
      let query = `
        SELECT * FROM notifications
        WHERE ${buildGuardianVisibilityClause('$1', '$2')}
      `;
      const params = [guardianId, typeFilterValues];
      let paramIndex = 3;

      // Filter unread only
      if (unreadOnly) {
        query += ' AND (is_read = FALSE OR is_read IS NULL)';
      }

      // Filter by notification type
      if (search) {
        query += ` AND (title ILIKE $${paramIndex} OR message ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      // Order by created_at
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching guardian notifications:', error);
      throw error;
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(guardianId) {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM notifications
         WHERE ${buildGuardianVisibilityClause('$1', '$2')}
         AND (is_read = FALSE OR is_read IS NULL)`,
        [guardianId, GUARDIAN_ALLOWED_NOTIFICATION_TYPES],
      );
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error('Error fetching unread notification count:', error);
      throw error;
    }
  }

  /**
   * Get a single notification by ID for a guardian
   */
  async getNotificationById(notificationId, guardianId) {
    try {
      const result = await pool.query(
        `SELECT *
         FROM notifications
         WHERE id = $1
           AND guardian_id = $2
           AND notification_type = ANY($3::text[])
           AND target_role IS DISTINCT FROM 'admin'
         LIMIT 1`,
        [notificationId, guardianId, GUARDIAN_ALLOWED_NOTIFICATION_TYPES],
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error fetching guardian notification by ID:', error);
      throw error;
    }
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(notificationId, guardianId) {
    try {
      const result = await pool.query(
        `UPDATE notifications
         SET is_read = TRUE, read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND guardian_id = $2
           AND notification_type = ANY($3::text[])
           AND target_role IS DISTINCT FROM 'admin'
         RETURNING *`,
        [notificationId, guardianId, GUARDIAN_ALLOWED_NOTIFICATION_TYPES],
      );
      return result.rows[0];
    } catch (error) {
      logger.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark a notification as unread
   */
  async markAsUnread(notificationId, guardianId) {
    try {
      const result = await pool.query(
        `UPDATE notifications
         SET is_read = FALSE, read_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND guardian_id = $2
           AND notification_type = ANY($3::text[])
           AND target_role IS DISTINCT FROM 'admin'
         RETURNING *`,
        [notificationId, guardianId, GUARDIAN_ALLOWED_NOTIFICATION_TYPES],
      );
      return result.rows[0];
    } catch (error) {
      logger.error('Error marking notification as unread:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a guardian
   */
  async markAllAsRead(guardianId) {
    try {
      const result = await pool.query(
        `UPDATE notifications
         SET is_read = TRUE, read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE ${buildGuardianVisibilityClause('$1', '$2')}
           AND (is_read = FALSE OR is_read IS NULL)
         RETURNING id`,
        [guardianId, GUARDIAN_ALLOWED_NOTIFICATION_TYPES],
      );
      return result.rows.length;
    } catch (error) {
      logger.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId, guardianId) {
    try {
      const result = await pool.query(
        `DELETE FROM notifications
         WHERE id = $1
           AND guardian_id = $2
           AND notification_type = ANY($3::text[])
           AND target_role IS DISTINCT FROM 'admin'
         RETURNING id`,
        [notificationId, guardianId, GUARDIAN_ALLOWED_NOTIFICATION_TYPES],
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting notification:', error);
      throw error;
    }
  }

  /**
   * Get notification preferences
   */
  async getPreferences(guardianId) {
    try {
      // Check if table exists first or handle error gracefully
      const result = await pool.query(
        'SELECT * FROM guardian_notification_preferences WHERE guardian_id = $1',
        [guardianId],
      );
      return result.rows[0] || {
        email_enabled: true,
        sms_enabled: true,
        in_app_enabled: true,
      };
    } catch (_error) {
      // Return defaults if table doesn't exist or error
      return {
        email_enabled: true,
        sms_enabled: true,
        in_app_enabled: true,
      };
    }
  }

  /**
   * Update notification preferences
   */
  async updatePreferences(guardianId, preferences) {
    const { email_enabled, sms_enabled, in_app_enabled } = preferences;
    try {
      // Ensure table exists (simplified check for this context)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS guardian_notification_preferences (
          guardian_id INTEGER PRIMARY KEY,
          email_enabled BOOLEAN DEFAULT TRUE,
          sms_enabled BOOLEAN DEFAULT TRUE,
          in_app_enabled BOOLEAN DEFAULT TRUE,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const result = await pool.query(
        `INSERT INTO guardian_notification_preferences (guardian_id, email_enabled, sms_enabled, in_app_enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (guardian_id)
         DO UPDATE SET
           email_enabled = EXCLUDED.email_enabled,
           sms_enabled = EXCLUDED.sms_enabled,
           in_app_enabled = EXCLUDED.in_app_enabled,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [guardianId, email_enabled, sms_enabled, in_app_enabled],
      );
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating preferences:', error);
      throw error;
    }
  }

  /**
   * Get guardian-safe notification summary stats
   */
  async getNotificationStats(guardianId) {
    try {
      const result = await pool.query(
        `SELECT
           COUNT(*)::int as total,
           COUNT(*) FILTER (WHERE is_read = FALSE OR is_read IS NULL)::int as unread,
           COUNT(*) FILTER (WHERE priority = 'urgent' AND (is_read = FALSE OR is_read IS NULL))::int as urgent_unread,
           COUNT(*) FILTER (WHERE priority = 'high' AND (is_read = FALSE OR is_read IS NULL))::int as high_unread,
           COUNT(*) FILTER (
             WHERE notification_type = ANY($2::text[])
               AND (is_read = FALSE OR is_read IS NULL)
           )::int as appointment_reminders,
           COUNT(*) FILTER (
             WHERE notification_type = ANY($3::text[])
               AND (is_read = FALSE OR is_read IS NULL)
           )::int as vaccination_reminders,
           COUNT(*) FILTER (
             WHERE notification_type = ANY($4::text[])
               AND (is_read = FALSE OR is_read IS NULL)
           )::int as health_alerts
         FROM notifications
         WHERE ${buildGuardianVisibilityClause('$1', '$5')}`,
        [
          guardianId,
          GUARDIAN_NOTIFICATION_TYPE_GROUPS.appointment
            .concat(['appointment_reminder', 'missed_schedule', 'missed_appointment']),
          GUARDIAN_NOTIFICATION_TYPE_GROUPS.reminder.filter(
            (type) => !['appointment_reminder', 'missed_schedule', 'missed_appointment'].includes(type),
          ),
          GUARDIAN_NOTIFICATION_TYPE_GROUPS.health_alert,
          GUARDIAN_ALLOWED_NOTIFICATION_TYPES,
        ],
      );

      return result.rows[0] || {
        total: 0,
        unread: 0,
        urgent_unread: 0,
        high_unread: 0,
        appointment_reminders: 0,
        vaccination_reminders: 0,
        health_alerts: 0,
      };
    } catch (error) {
      logger.error('Error fetching guardian notification stats:', error);
      throw error;
    }
  }
}

const guardianNotificationService = new GuardianNotificationService();

guardianNotificationService.resolveTypeFilterValues = resolveGuardianTypeFilterValues;
guardianNotificationService.allowedNotificationTypes = [...GUARDIAN_ALLOWED_NOTIFICATION_TYPES];

module.exports = guardianNotificationService;
