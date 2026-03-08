/**
 * Guardian Notifications Routes
 * Dedicated routes for guardian-specific notifications
 * Ensures proper role-based filtering and no admin notifications leak through
 */

const express = require('express');
const router = express.Router();
const guardianNotificationService = require('../services/guardianNotificationService');
const { authenticateGuardian } = require('../middleware/guardianAuth');
const logger = require('../config/logger');

/**
 * @route GET /api/guardian/notifications
 * @description Get all notifications for the authenticated guardian
 * @access Guardian only
 */
router.get('/', authenticateGuardian, async (req, res) => {
  try {
    const guardianId = req.guardian.id;
    const { limit = 50, offset = 0, unreadOnly, type, search } = req.query;

    const notifications = await guardianNotificationService.getGuardianNotifications(guardianId, {
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      unreadOnly: unreadOnly === 'true',
      type,
      search,
    });

    res.json({
      success: true,
      data: notifications,
      count: notifications.length,
    });
  } catch (error) {
    logger.error('Error fetching guardian notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route GET /api/guardian/notifications/unread-count
 * @description Get unread notification count for the authenticated guardian
 * @access Guardian only
 */
router.get('/unread-count', authenticateGuardian, async (req, res) => {
  try {
    const guardianId = req.guardian.id;
    const count = await guardianNotificationService.getUnreadCount(guardianId);

    res.json({
      success: true,
      count,
    });
  } catch (error) {
    logger.error('Error fetching unread notification count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count',
    });
  }
});

/**
 * @route GET /api/guardian/notifications/:id
 * @description Get a specific notification by ID
 * @access Guardian only (must own the notification)
 */
router.get('/:id', authenticateGuardian, async (req, res) => {
  try {
    const guardianId = req.guardian.id;
    const notificationId = parseInt(req.params.id, 10);

    const notifications = await guardianNotificationService.getGuardianNotifications(guardianId, {
      limit: 1,
    });

    const notification = notifications.find((n) => n.id === notificationId);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    res.json({
      success: true,
      data: notification,
    });
  } catch (error) {
    logger.error('Error fetching notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification',
    });
  }
});

/**
 * @route PATCH /api/guardian/notifications/:id/read
 * @description Mark a notification as read
 * @access Guardian only (must own the notification)
 */
router.patch('/:id/read', authenticateGuardian, async (req, res) => {
  try {
    const guardianId = req.guardian.id;
    const notificationId = parseInt(req.params.id, 10);

    const notification = await guardianNotificationService.markAsRead(notificationId, guardianId);

    res.json({
      success: true,
      data: notification,
      message: 'Notification marked as read',
    });
  } catch (error) {
    logger.error('Error marking notification as read:', error);

    if (error.message.includes('not found') || error.message.includes('not authorized')) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or not authorized',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
    });
  }
});

/**
 * @route PATCH /api/guardian/notifications/read-all
 * @description Mark all notifications as read for the authenticated guardian
 * @access Guardian only
 */
router.patch('/read-all', authenticateGuardian, async (req, res) => {
  try {
    const guardianId = req.guardian.id;
    const count = await guardianNotificationService.markAllAsRead(guardianId);

    res.json({
      success: true,
      message: `Marked ${count} notifications as read`,
      count,
    });
  } catch (error) {
    logger.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read',
    });
  }
});

/**
 * @route DELETE /api/guardian/notifications/:id
 * @description Delete a notification
 * @access Guardian only (must own the notification)
 */
router.delete('/:id', authenticateGuardian, async (req, res) => {
  try {
    const guardianId = req.guardian.id;
    const notificationId = parseInt(req.params.id, 10);

    // First verify the notification belongs to this guardian
    const pool = require('../db');
    const result = await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND guardian_id = $2 RETURNING id',
      [notificationId, guardianId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or not authorized',
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (error) {
    logger.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
    });
  }
});

/**
 * @route GET /api/guardian/notifications/stats/summary
 * @description Get notification statistics for the guardian dashboard
 * @access Guardian only
 */
router.get('/stats/summary', authenticateGuardian, async (req, res) => {
  try {
    const guardianId = req.guardian.id;
    const pool = require('../db');

    // Get various stats
    const statsResult = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_read = FALSE OR is_read IS NULL) as unread,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND (is_read = FALSE OR is_read IS NULL)) as urgent_unread,
        COUNT(*) FILTER (WHERE priority = 'high' AND (is_read = FALSE OR is_read IS NULL)) as high_unread,
        COUNT(*) FILTER (WHERE notification_type = 'appointment_reminder' AND (is_read = FALSE OR is_read IS NULL)) as appointment_reminders,
        COUNT(*) FILTER (WHERE notification_type = 'vaccination_reminder' AND (is_read = FALSE OR is_read IS NULL)) as vaccination_reminders,
        COUNT(*) FILTER (WHERE notification_type = 'health_alert' AND (is_read = FALSE OR is_read IS NULL)) as health_alerts
       FROM notifications
       WHERE guardian_id = $1
       AND target_role != 'admin'
       AND notification_type NOT IN ('inventory_alert', 'supplier_update', 'analytics_alert', 'staff_action', 'system_alert', 'low_stock_alert', 'critical_stock_alert', 'expiry_alert')`,
      [guardianId],
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      data: {
        total: parseInt(stats.total, 10),
        unread: parseInt(stats.unread, 10),
        urgentUnread: parseInt(stats.urgent_unread, 10),
        highUnread: parseInt(stats.high_unread, 10),
        appointmentReminders: parseInt(stats.appointment_reminders, 10),
        vaccinationReminders: parseInt(stats.vaccination_reminders, 10),
        healthAlerts: parseInt(stats.health_alerts, 10),
      },
    });
  } catch (error) {
    logger.error('Error fetching notification stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification statistics',
    });
  }
});

module.exports = router;
