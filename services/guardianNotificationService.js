// backend/services/guardianNotificationService.js

const pool = require('../db');
const logger = require('../config/logger');

class GuardianNotificationService {
  /**
   * Get notifications for a specific guardian
   */
  async getGuardianNotifications(guardianId, options = {}) {
    const { limit = 50, offset = 0, unreadOnly = false, type, search } = options;

    try {
      let query = `
        SELECT * FROM notifications
        WHERE guardian_id = $1
        AND target_role != 'admin'
      `;
      const params = [guardianId];
      let paramIndex = 2;

      // Filter unread only
      if (unreadOnly) {
        query += ' AND (is_read = FALSE OR is_read IS NULL)';
      }

      // Filter by notification type
      if (type && type !== 'all') {
        query += ` AND notification_type = $${paramIndex++}`;
        params.push(type);
      }

      // Search filter
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
         WHERE guardian_id = $1
         AND target_role != 'admin'
         AND (is_read = FALSE OR is_read IS NULL)`,
        [guardianId],
      );
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error('Error fetching unread notification count:', error);
      return 0;
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
         WHERE id = $1 AND guardian_id = $2
         RETURNING *`,
        [notificationId, guardianId],
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
         WHERE id = $1 AND guardian_id = $2
         RETURNING *`,
        [notificationId, guardianId],
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
         WHERE guardian_id = $1 AND (is_read = FALSE OR is_read IS NULL)
         RETURNING id`,
        [guardianId],
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
         WHERE id = $1 AND guardian_id = $2
         RETURNING id`,
        [notificationId, guardianId],
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
}

module.exports = new GuardianNotificationService();
