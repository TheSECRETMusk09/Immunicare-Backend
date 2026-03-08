const express = require('express');
const router = express.Router();
const { authenticateToken: auth } = require('../middleware/auth');
const { Notification, Alert } = require('../models/Notification');
const User = require('../models/User');
const socketService = require('../services/socketService');
const notificationAnalytics = require('../services/notificationAnalytics');
const notificationPreferences = require('../services/notificationPreferences');
const { sendEmailNotification, sendSMSNotification } = require('../services/notificationService');
const logger = require('../config/logger');

// Initialize analytics and preferences tables
notificationAnalytics.initializeAnalyticsTable();
notificationPreferences.initializePreferencesTable();

// Get all notifications for current user with enhanced filtering
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { priority, category, isRead, type, limit = 100, offset = 0 } = req.query;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let notifications;
    const filters = {};

    if (priority) {
      filters.priority = parseInt(priority);
    }
    if (category) {
      filters.category = category;
    }
    if (isRead !== undefined) {
      filters.isRead = isRead === 'true';
    }
    if (type) {
      filters.type = type;
    }

    if (user.roleName === 'admin') {
      notifications = await Notification.findAll(parseInt(limit));
      // Apply filters manually for admin
      if (filters.priority) {
        notifications = notifications.filter((n) => n.priority === filters.priority);
      }
      if (filters.category) {
        notifications = notifications.filter((n) => n.category === filters.category);
      }
      if (filters.isRead !== undefined) {
        notifications = notifications.filter((n) => n.isRead === filters.isRead);
      }
      if (filters.type) {
        notifications = notifications.filter((n) => n.type === filters.type);
      }
    } else {
      notifications = await Notification.findByUserId(userId, parseInt(limit), filters);
    }

    // Apply pagination
    const paginatedNotifications = notifications.slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit)
    );

    res.json({
      notifications: paginatedNotifications,
      total: notifications.length,
      offset: parseInt(offset),
      limit: parseInt(limit)
    });
  } catch (error) {
    logger.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get notifications with priority-based filtering
router.get('/filtered', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { minPriority, maxPriority, categories, types, unreadOnly } = req.query;

    let query = `
      SELECT * FROM notifications 
      WHERE (user_id = $1 OR user_id IS NULL)
    `;
    const params = [userId];
    let paramIndex = 2;

    if (minPriority) {
      query += ` AND priority >= $${paramIndex++}`;
      params.push(parseInt(minPriority));
    }

    if (maxPriority) {
      query += ` AND priority <= $${paramIndex++}`;
      params.push(parseInt(maxPriority));
    }

    if (categories) {
      const categoryArray = categories.split(',');
      query += ` AND category = ANY($${paramIndex++})`;
      params.push(categoryArray);
    }

    if (types) {
      const typeArray = types.split(',');
      query += ` AND type = ANY($${paramIndex++})`;
      params.push(typeArray);
    }

    if (unreadOnly === 'true') {
      query += ' AND is_read = FALSE';
    }

    query += ` ORDER BY 
      CASE 
        WHEN priority >= 4 THEN 1 
        WHEN priority >= 2 THEN 2 
        ELSE 3 
      END, created_at DESC`;

    const result = await require('../db').query(query, params);
    const notifications = result.rows.map((row) => new Notification(row));

    res.json(notifications);
  } catch (error) {
    logger.error('Error fetching filtered notifications:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get notification statistics with analytics
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { timeRange = '30days' } = req.query;

    const [stats, performance, userEngagement] = await Promise.all([
      Notification.getStats(userId),
      notificationAnalytics.getNotificationPerformance(timeRange),
      notificationAnalytics.getUserEngagement(userId, timeRange)
    ]);

    res.json({
      unreadCount: stats.unread_count || 0,
      totalCount: stats.total_count || 0,
      highPriorityCount: stats.high_priority_count || 0,
      mediumPriorityCount: stats.medium_priority_count || 0,
      lowPriorityCount: stats.low_priority_count || 0,
      performance,
      userEngagement
    });
  } catch (error) {
    logger.error('Error fetching notification stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get notification analytics
router.get('/analytics', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (user.roleName !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { timeRange = '30days' } = req.query;

    const [overall, funnel, trending, bestTimes] = await Promise.all([
      notificationAnalytics.getOverallStats(timeRange),
      notificationAnalytics.getFunnelAnalysis(timeRange),
      notificationAnalytics.getTrendingTypes(timeRange),
      notificationAnalytics.getBestSendTimes(null, timeRange)
    ]);

    res.json({
      overall,
      funnel,
      trending,
      bestSendTimes: bestTimes
    });
  } catch (error) {
    logger.error('Error fetching notification analytics:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user notification preferences
router.get('/preferences', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await notificationPreferences.getUserPreferences(userId);
    res.json(preferences);
  } catch (error) {
    logger.error('Error fetching notification preferences:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user notification preferences
router.put('/preferences', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await notificationPreferences.updateUserPreferences(userId, req.body);
    res.json(preferences);
  } catch (error) {
    logger.error('Error updating notification preferences:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset user preferences to defaults
router.post('/preferences/reset', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await notificationPreferences.resetToDefaults(userId);
    res.json(preferences);
  } catch (error) {
    logger.error('Error resetting notification preferences:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Set do not disturb mode
router.post('/preferences/dnd', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { enabled, durationMinutes } = req.body;
    const preferences = await notificationPreferences.setDoNotDisturb(
      userId,
      enabled,
      durationMinutes
    );
    res.json(preferences);
  } catch (error) {
    logger.error('Error setting do not disturb:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update quiet hours
router.put('/preferences/quiet-hours', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const quietHours = await notificationPreferences.updateQuietHours(userId, req.body);
    res.json(quietHours);
  } catch (error) {
    logger.error('Error updating quiet hours:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user summary
router.get('/summary', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await notificationPreferences.getUserSummary(userId);
    res.json(summary);
  } catch (error) {
    logger.error('Error fetching user summary:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new notification with real-time delivery
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const {
      title,
      message,
      type,
      category,
      userId: targetUserId,
      priority = 1,
      relatedEntityType,
      relatedEntityId,
      actionRequired = false,
      actionUrl,
      channel = 'in_app',
      actions = []
    } = req.body;

    // Check if notification should be sent based on preferences
    if (targetUserId) {
      const prefCheck = await notificationPreferences.shouldSendNotification(targetUserId, {
        type,
        category,
        priority
      });

      if (!prefCheck.allowed) {
        return res.status(200).json({
          message: 'Notification skipped due to user preferences',
          reason: prefCheck.reason
        });
      }
    }

    // Create notification
    const notification = await Notification.create({
      userId: targetUserId,
      title,
      message,
      type,
      category,
      priority,
      relatedEntityType,
      relatedEntityId,
      actionRequired,
      actionUrl,
      channel
    });

    // Track delivery
    await notificationAnalytics.trackDelivery(notification.id, channel, 'delivered');

    // Send real-time notification via Socket.io
    if (targetUserId) {
      if (actions && actions.length > 0) {
        socketService.sendActionableNotification(targetUserId, notification, actions);
      } else {
        socketService.sendPriorityNotification(targetUserId, notification);
      }

      // Send email/SMS if enabled in preferences
      const user = await User.findById(targetUserId);
      if (user) {
        const prefs = await notificationPreferences.getUserPreferences(targetUserId);

        if (prefs.channels.email && channel !== 'sms') {
          try {
            await sendEmailNotification(user.email, title, message);
            await notificationAnalytics.trackDelivery(notification.id, 'email', 'delivered');
          } catch (emailError) {
            logger.error('Error sending email notification:', emailError);
            await notificationAnalytics.trackDelivery(notification.id, 'email', 'failed');
          }
        }

        if (prefs.channels.sms && channel !== 'email') {
          try {
            await sendSMSNotification(user.contact, `${title}: ${message}`);
            await notificationAnalytics.trackDelivery(notification.id, 'sms', 'delivered');
          } catch (smsError) {
            logger.error('Error sending SMS notification:', smsError);
            await notificationAnalytics.trackDelivery(notification.id, 'sms', 'failed');
          }
        }
      }
    }

    res.status(201).json(notification);
  } catch (error) {
    logger.error('Error creating notification:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark notification as read with analytics tracking
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);

    if (user.roleName !== 'admin' && notification.userId?.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const updatedNotification = await notification.markAsRead();

    // Track open event
    await notificationAnalytics.trackOpen(notification.id, userId);

    // Send real-time update
    socketService.sendNotificationUpdate(userId, notification.id, { isRead: true });

    res.json(updatedNotification);
  } catch (error) {
    logger.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Track notification click/action
router.post('/:id/click', auth, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;
    const { actionType, metadata = {} } = req.body;

    // Track click event
    await notificationAnalytics.trackClick(notificationId, userId, actionType, metadata);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error tracking notification click:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Dismiss notification with analytics tracking
router.patch('/:id/dismiss', auth, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);

    if (user.roleName !== 'admin' && notification.userId?.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Mark as read
    const updatedNotification = await notification.markAsRead();

    // Track dismissal
    await notificationAnalytics.trackDismissal(notification.id, userId);

    // Send real-time update
    socketService.sendNotificationUpdate(userId, notification.id, { dismissed: true });

    res.json(updatedNotification);
  } catch (error) {
    logger.error('Error dismissing notification:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark all notifications as read
router.patch('/read-all', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const updatedNotifications = await Notification.markAllAsRead(userId);

    // Track opens for all notifications
    for (const notification of updatedNotifications) {
      await notificationAnalytics.trackOpen(notification.id, userId);
    }

    // Send real-time update
    socketService.sendToUser(userId, 'notifications-read-all', {
      count: updatedNotifications.length
    });

    res.json({ success: true, modifiedCount: updatedNotifications.length });
  } catch (error) {
    logger.error('Error marking all notifications as read:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get notification engagement metrics
router.get('/:id/engagement', auth, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const user = await User.findById(req.user.id);

    if (user.roleName !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const engagement = await notificationAnalytics.getNotificationEngagement(notificationId);
    res.json(engagement);
  } catch (error) {
    logger.error('Error fetching notification engagement:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get active alerts
router.get('/alerts', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let alerts;
    if (user.roleName === 'admin') {
      alerts = await Alert.findActive();
    } else {
      alerts = await Alert.findByHealthCenter(user.clinicId);
    }

    res.json(alerts);
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new alert with real-time delivery
router.post('/alerts', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { type, severity, vaccineId, patientId, healthCenterId, message, additionalData } =
      req.body;

    const alert = await Alert.create({
      title: `New ${type.replace('_', ' ')} Alert`,
      message: message || `A new ${type} alert has been triggered`,
      severity,
      category: type.includes('stock')
        ? 'inventory'
        : type.includes('appointment')
          ? 'appointment'
          : 'system',
      expiresAt: additionalData?.expiresAt,
      thresholdValue: additionalData?.thresholdValue,
      currentValue: additionalData?.currentValue,
      triggerCondition: additionalData?.triggerCondition
    });

    // Send real-time alert
    socketService.sendAlert(alert);

    // Create corresponding notification
    const notification = await Notification.create({
      title: `New ${type.replace('_', ' ')} Alert`,
      message: message || `A new ${type} alert has been triggered`,
      type: 'alert',
      category: type.includes('stock')
        ? 'inventory'
        : type.includes('appointment')
          ? 'appointment'
          : 'system',
      priority: severity === 'critical' ? 5 : severity === 'high' ? 4 : 3,
      relatedEntityType: 'alert',
      relatedEntityId: alert.id
    });

    res.status(201).json({ alert, notification });
  } catch (error) {
    logger.error('Error creating alert:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Resolve an alert
router.patch('/alerts/:id/resolve', auth, async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);

    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);

    if (
      user.roleName !== 'admin' &&
      alert.healthCenterId?.toString() !== user.clinicId?.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const resolutionNotes = req.body.resolutionNotes || 'Alert resolved';
    const resolvedAlert = await alert.resolve(resolutionNotes);

    // Send real-time update
    socketService.broadcast('alert-resolved', { alertId: alert.id, resolvedBy: userId });

    res.json(resolvedAlert);
  } catch (error) {
    logger.error('Error resolving alert:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get unread notifications count
router.get('/unread-count', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const unreadNotifications = await Notification.findUnreadByUserId(userId);

    res.json({ count: unreadNotifications.length });
  } catch (error) {
    logger.error('Error fetching unread count:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get notifications by category
router.get('/category/:category', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const category = req.params.category;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let notifications;
    if (user.roleName === 'admin') {
      notifications = await require('../db').query(
        'SELECT * FROM notifications WHERE category = $1 ORDER BY created_at DESC',
        [category]
      );
    } else {
      notifications = await require('../db').query(
        `SELECT * FROM notifications 
         WHERE category = $1 AND (user_id = $2 OR user_id IS NULL)
         ORDER BY created_at DESC`,
        [category, userId]
      );
    }

    res.json(notifications.rows);
  } catch (error) {
    logger.error('Error fetching notifications by category:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
