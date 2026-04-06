/**
 * Guardian Notifications Routes
 * Dedicated routes for guardian-specific notifications
 * Ensures proper role-based filtering and no admin notifications leak through
 */

const express = require('express');
const router = express.Router();
const guardianNotificationService = require('../services/guardianNotificationService');
const socketService = require('../services/socketService');
const { authenticateGuardian } = require('../middleware/guardianAuth');
const logger = require('../config/logger');

const parseIntegerString = (value) => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return null;
  }

  return Number(trimmedValue);
};

const parseNonNegativeInteger = (value, fieldName, defaultValue) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsedValue = parseIntegerString(value);
  if (parsedValue === null || parsedValue < 0) {
    return {
      error: `${fieldName} must be a non-negative integer`,
    };
  }

  return parsedValue;
};

const parseNotificationId = (value) => {
  const parsedValue = parseIntegerString(value);
  return parsedValue === null || parsedValue <= 0 ? null : parsedValue;
};

/**
 * @route GET /api/guardian/notifications
 * @description Get all notifications for the authenticated guardian
 * @access Guardian only
 */
router.get('/', authenticateGuardian, async (req, res) => {
  try {
    const guardianId = req.guardian.id;
    const { limit = 50, offset = 0, unreadOnly, type, search } = req.query;
    const parsedLimit = parseNonNegativeInteger(limit, 'limit', 50);
    if (parsedLimit?.error) {
      return res.status(400).json({
        success: false,
        message: parsedLimit.error,
      });
    }

    const parsedOffset = parseNonNegativeInteger(offset, 'offset', 0);
    if (parsedOffset?.error) {
      return res.status(400).json({
        success: false,
        message: parsedOffset.error,
      });
    }

    const notifications = await guardianNotificationService.getGuardianNotifications(guardianId, {
      limit: parsedLimit,
      offset: parsedOffset,
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
    const notificationId = parseNotificationId(req.params.id);

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID',
      });
    }

    const notification = await guardianNotificationService.getNotificationById(
      notificationId,
      guardianId,
    );

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
    const notificationId = parseNotificationId(req.params.id);

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID',
      });
    }

    const notification = await guardianNotificationService.markAsRead(notificationId, guardianId);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or not authorized',
      });
    }

    res.json({
      success: true,
      data: notification,
      message: 'Notification marked as read',
    });
    socketService.sendToGuardian(guardianId, 'notification-updated', {
      notificationId,
      status: 'read',
      isRead: true,
      is_read: true,
    });
  } catch (error) {
    logger.error('Error marking notification as read:', error);

    const errorMessage = String(error?.message || '');
    if (errorMessage.includes('not found') || errorMessage.includes('not authorized')) {
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
 * @route PATCH /api/guardian/notifications/:id/unread
 * @description Mark a notification as unread
 * @access Guardian only (must own the notification)
 */
router.patch('/:id/unread', authenticateGuardian, async (req, res) => {
  try {
    const guardianId = req.guardian.id;
    const notificationId = parseNotificationId(req.params.id);

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID',
      });
    }

    const notification = await guardianNotificationService.markAsUnread(notificationId, guardianId);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or not authorized',
      });
    }

    res.json({
      success: true,
      data: notification,
      message: 'Notification marked as unread',
    });
    socketService.sendToGuardian(guardianId, 'notification-updated', {
      notificationId,
      status: 'unread',
      isRead: false,
      is_read: false,
    });
  } catch (error) {
    logger.error('Error marking notification as unread:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as unread',
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
    socketService.sendToGuardian(guardianId, 'notifications-read-all', {
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
    const notificationId = parseNotificationId(req.params.id);

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID',
      });
    }

    const deleted = await guardianNotificationService.deleteNotification(notificationId, guardianId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or not authorized',
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted',
    });
    socketService.sendToGuardian(guardianId, 'notification-deleted', {
      notificationId,
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
    const stats = await guardianNotificationService.getNotificationStats(guardianId);

    res.json({
      success: true,
      data: {
        total: parseInt(stats.total, 10) || 0,
        unread: parseInt(stats.unread, 10) || 0,
        urgentUnread: parseInt(stats.urgent_unread, 10) || 0,
        highUnread: parseInt(stats.high_unread, 10) || 0,
        appointmentReminders: parseInt(stats.appointment_reminders, 10) || 0,
        vaccinationReminders: parseInt(stats.vaccination_reminders, 10) || 0,
        healthAlerts: parseInt(stats.health_alerts, 10) || 0,
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
