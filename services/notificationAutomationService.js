const pool = require('../db');
const socketService = require('./socketService');

const isPoolUnavailableError = (error) =>
  (typeof pool.isPoolEndedError === 'function' && pool.isPoolEndedError(error)) ||
  String(error?.message || '').toLowerCase().includes('cannot use a pool after calling end on the pool');

const isDatabaseAvailable = (context) => {
  if (typeof pool.warnIfPoolUnavailable === 'function') {
    return !pool.warnIfPoolUnavailable(`notificationAutomation.${context}`);
  }

  if (pool.ended) {
    console.warn(`[Automation Service] Skipping ${context}; database pool is closed.`);
    return false;
  }

  return true;
};

/**
 * Core Automation Service for Routing and Emitting Real-Time System Events
 * Satisfies Task 2 (Admin Notification Automation) and Task 14 (Guardian Real-Time Alerts)
 */
class NotificationAutomationService {

  /**
     * Automatically infers the severity of an event based on category and context
     */
  static inferSeverity(category, text = '') {
    const criticalCategories = ['inventory_out_of_stock', 'outbound_message_failed', 'missed_schedule', 'equipment_failure'];
    const highCategories = ['inventory_low_stock', 'appointment_cancelled', 'growth_anomaly'];
    const warningCategories = ['vaccination_due_soon', 'vaccine_expiring', 'appointment_rescheduled'];

    if (criticalCategories.includes(category)) {
      return 'critical';
    }
    if (highCategories.includes(category)) {
      return 'high';
    }
    if (warningCategories.includes(category)) {
      return 'warning';
    }

    const lowerText = text.toLowerCase();
    if (lowerText.includes('critical') || lowerText.includes('urgent')) {
      return 'critical';
    }

    return 'info';
  }

  /**
     * Dispatches an automated event, persists it to the database, and broadcasts it via WebSocket
     */
  static async dispatchEvent({
    userId = null,
    category,
    title,
    message,
    relatedEntityType = null,
    relatedEntityId = null,
    targetRole = 'admin',
    actionUrl = null,
  }) {
    const severity = this.inferSeverity(category, message);

    try {
      if (!isDatabaseAvailable('dispatchEvent')) {
        return null;
      }

      let query, params;

      if (targetRole === 'admin' && !userId) {
        // System-wide admin notification (no specific user)
        query = `
                    INSERT INTO notifications
                    (category, title, message, priority, type, status, related_entity_type, related_entity_id, target_role, action_url)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING *
                `;
        params = [category, title, message, severity, 'system_alert', 'pending', relatedEntityType, relatedEntityId, targetRole, actionUrl];
      } else {
        // Targeted user notification (Guardian or specific staff)
        query = `
                    INSERT INTO notifications
                    (user_id, category, title, message, priority, type, status, related_entity_type, related_entity_id, target_role, action_url)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    RETURNING *
                `;
        params = [userId, category, title, message, severity, 'user_alert', 'pending', relatedEntityType, relatedEntityId, targetRole, actionUrl];
      }

      const result = await pool.query(query, params);
      const notification = result.rows[0];

      // Instantly push to the UI via Socket.IO bus to eliminate polling
      socketService.broadcast(`new_${targetRole}_notification`, notification);

      return notification;
    } catch (error) {
      if (isPoolUnavailableError(error)) {
        console.warn('[Automation Service] Skipped real-time event persistence because database pool is unavailable.');
        return null;
      }
      console.error('[Automation Service] Failed to dispatch real-time event:', error);
    }
  }
}

module.exports = NotificationAutomationService;
