const express = require('express');
const router = express.Router();
const { authenticateToken: auth } = require('../middleware/auth');
const { Notification, Alert } = require('../models/Notification');
const User = require('../models/User');
const { sendEmailNotification, sendSMSNotification } = require('../services/notificationService');
const { cleanOldNotifications } = require('../services/cleanupService');
const pool = require('../db');
const {
  hasFieldErrors,
  normalizeBoolean,
  normalizeIntegerArray,
  respondValidationError,
  sanitizeText,
  validateNumberRange,
} = require('../utils/adminValidation');

const DEFAULT_NOTIFICATION_SETTINGS = {
  emailEnabled: true,
  smsEnabled: false,
  lowStockThreshold: 10,
  appointmentReminderDays: [1, 3, 7],
  regulatoryUpdates: true,
  inventoryAlerts: true,
  appointmentAlerts: true,
};

const normalizeNotificationSettingsPayload = (payload = {}) => {
  const thresholdCheck = validateNumberRange(payload.lowStockThreshold, {
    label: 'Low stock threshold',
    required: true,
    min: 1,
    max: 100,
    integer: true,
  });

  const reminderDaysRaw = payload.appointmentReminderDays;
  const reminderDays = normalizeIntegerArray(reminderDaysRaw, {
    min: 0,
    max: 30,
    unique: true,
  }).sort((a, b) => a - b);

  const errors = {};
  if (thresholdCheck.error) {
    errors.lowStockThreshold = thresholdCheck.error;
  }

  if (reminderDaysRaw !== undefined && !Array.isArray(reminderDaysRaw)) {
    errors.appointmentReminderDays = 'appointmentReminderDays must be an array of integers';
  } else if (reminderDays.length === 0) {
    errors.appointmentReminderDays =
      'Provide at least one reminder day between 0 and 30.';
  }

  return {
    normalized: {
      emailEnabled: normalizeBoolean(payload.emailEnabled, true),
      smsEnabled: normalizeBoolean(payload.smsEnabled, false),
      lowStockThreshold: thresholdCheck.value,
      appointmentReminderDays: reminderDays,
      regulatoryUpdates: normalizeBoolean(payload.regulatoryUpdates, true),
      inventoryAlerts: normalizeBoolean(payload.inventoryAlerts, true),
      appointmentAlerts: normalizeBoolean(payload.appointmentAlerts, true),
    },
    errors,
  };
};

// Get all notifications for current user - optimized with single query
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { priority, category, isRead } = req.query;

    // Build query based on user role - use single query instead of multiple
    let query = 'SELECT * FROM notifications';
    const params = [];
    const conditions = [];

    // Non-admin users only see their own notifications
    if (userRole !== 'admin' && userRole !== 'super_admin') {
      conditions.push(`(user_id = $${params.length + 1} OR user_id IS NULL)`);
      params.push(userId);
    }

    // Apply filters
    if (priority) {
      conditions.push(`priority = $${params.length + 1}`);
      params.push(priority);
    }
    if (category) {
      conditions.push(`category = $${params.length + 1}`);
      params.push(category);
    }
    if (isRead !== undefined) {
      conditions.push(`is_read = $${params.length + 1}`);
      params.push(isRead === 'true');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC LIMIT 100';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    // Return empty array instead of error for resilience
    res.json([]);
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
    console.error('Error fetching alerts:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark notification as read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Check if user has permission to mark this notification as read
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (user.roleName !== 'admin' && notification.userId?.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const updatedNotification = await notification.markAsRead();

    res.json(updatedNotification);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark all notifications as read
router.patch('/read-all', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const updatedNotifications = await Notification.markAllAsRead(userId);

    res.json({ success: true, modifiedCount: updatedNotifications.length });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get notification settings for current user - optimized with direct query
router.get('/settings', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Use direct query instead of User model to avoid multiple queries
    const result = await pool.query('SELECT notification_settings FROM users WHERE id = $1', [
      userId,
    ]);

    if (result.rows.length === 0) {
      // Return default settings if user not found
      return res.json(DEFAULT_NOTIFICATION_SETTINGS);
    }

    const settings = result.rows[0].notification_settings || DEFAULT_NOTIFICATION_SETTINGS;

    res.json(settings);
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    // Return default settings on error for resilience
    res.json(DEFAULT_NOTIFICATION_SETTINGS);
  }
});

// Update notification settings
router.put('/settings', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { normalized, errors } = normalizeNotificationSettingsPayload(req.body || {});
    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    const updatedUser = await user.updateNotificationSettings({
      ...normalized,
    });

    res.json(updatedUser.notificationSettings);
  } catch (error) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new notification (internal use)
router.post('/', auth, async (req, res) => {
  try {
    // Only admins can create notifications
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const {
      title,
      message,
      type,
      severity,
      category,
      userId,
      healthCenterId,
      relatedId,
      relatedType,
    } = req.body;

    const normalizedTitle = sanitizeText(title, { maxLength: 255 });
    const normalizedMessage = sanitizeText(message, {
      maxLength: 2000,
      preserveNewLines: true,
    });

    const createErrors = {};
    if (!normalizedTitle) {
      createErrors.title = 'Title is required';
    }
    if (!normalizedMessage) {
      createErrors.message = 'Message is required';
    }

    if (hasFieldErrors(createErrors)) {
      return respondValidationError(res, createErrors);
    }

    const notification = new Notification({
      title: normalizedTitle,
      message: normalizedMessage,
      type: sanitizeText(type, { maxLength: 100 }) || 'alert',
      severity: sanitizeText(severity, { maxLength: 50 }) || 'normal',
      category: sanitizeText(category, { maxLength: 100 }) || 'system',
      userId,
      healthCenterId,
      relatedEntityId: relatedId,
      relatedEntityType: sanitizeText(relatedType, { maxLength: 100 }) || null,
      createdBy: req.user.id,
    });

    const createdNotification = await notification.save();

    // Send real-time notifications if configured
    if (userId) {
      const recipientUser = await User.findById(userId);
      if (recipientUser && recipientUser.notificationSettings?.emailEnabled) {
        await sendEmailNotification(recipientUser.email, title, message);
      }
      if (
        recipientUser &&
        recipientUser.notificationSettings?.smsEnabled &&
        recipientUser.contact
      ) {
        await sendSMSNotification(recipientUser.contact, `${title}: ${message}`);
      }
    }

    res.status(201).json(createdNotification);
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new alert (internal use)
router.post('/alerts', auth, async (req, res) => {
  try {
    // Only admins can create alerts
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { type, severity, vaccineId, patientId, healthCenterId, message } =
      req.body;

    const normalizedType = sanitizeText(type, { maxLength: 100 }).toLowerCase();
    const normalizedSeverity = sanitizeText(severity, { maxLength: 50 }).toLowerCase();
    const normalizedMessage = sanitizeText(message, {
      maxLength: 2000,
      preserveNewLines: true,
    });

    const alertErrors = {};
    if (!normalizedType) {
      alertErrors.type = 'type is required';
    }

    if (!normalizedSeverity) {
      alertErrors.severity = 'severity is required';
    }

    if (hasFieldErrors(alertErrors)) {
      return respondValidationError(res, alertErrors);
    }

    const alert = new Alert({
      title: `New ${normalizedType.replace('_', ' ')} Alert`,
      message: normalizedMessage || `A new ${normalizedType} alert has been triggered`,
      severity: normalizedSeverity,
      category: normalizedType.includes('stock')
        ? 'inventory'
        : normalizedType.includes('appointment')
          ? 'appointment'
          : 'system',
      healthCenterId,
      vaccineId,
      patientId,
      createdBy: req.user.id,
    });

    const createdAlert = await alert.save();

    // Create corresponding notification
    const notificationTitle = `New ${normalizedType.replace('_', ' ')} Alert`;
    const notification = new Notification({
      title: notificationTitle,
      message: normalizedMessage || `A new ${normalizedType} alert has been triggered`,
      type: 'alert',
      severity: normalizedSeverity,
      category: normalizedType.includes('stock')
        ? 'inventory'
        : normalizedType.includes('appointment')
          ? 'appointment'
          : 'system',
      healthCenterId,
      relatedEntityId: createdAlert.id,
      relatedEntityType: 'alert',
      createdBy: req.user.id,
    });

    await notification.save();

    res.status(201).json(createdAlert);
  } catch (error) {
    console.error('Error creating alert:', error);
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

    // Check permissions
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (
      user.roleName !== 'admin' &&
      alert.healthCenterId?.toString() !== user.clinicId?.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const resolutionNotes =
      sanitizeText(req.body.resolutionNotes, {
        maxLength: 500,
        preserveNewLines: true,
      }) || 'Alert resolved';
    const resolvedAlert = await alert.resolve(userId, resolutionNotes);

    // Create resolution notification
    const notification = new Notification({
      title: `Alert Resolved: ${alert.type.replace('_', ' ')}`,
      message: `Alert for ${alert.vaccineId || alert.patientId || alert.type} has been resolved`,
      type: 'update',
      severity: 'low',
      category: 'system',
      healthCenterId: alert.healthCenterId,
      relatedEntityId: alert.id,
      relatedEntityType: 'alert',
      createdBy: userId,
    });

    await notification.save();

    res.json(resolvedAlert);
  } catch (error) {
    console.error('Error resolving alert:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get notification statistics for dashboard
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const stats = await Notification.getStats(userId);

    res.json({
      unreadCount: stats.unread_count || 0,
      totalCount: stats.total_count || 0,
      highSeverityCount: stats.high_priority_count || 0,
      mediumSeverityCount: stats.medium_priority_count || 0,
      lowSeverityCount: stats.low_priority_count || 0,
    });
  } catch (error) {
    console.error('Error fetching notification stats:', error);
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
    console.error('Error fetching unread count:', error);
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
      notifications = await pool.query(
        'SELECT * FROM notifications WHERE category = $1 ORDER BY created_at DESC',
        [category],
      );
    } else {
      notifications = await pool.query(
        `SELECT * FROM notifications
         WHERE category = $1 AND (user_id = $2 OR user_id IS NULL)
         ORDER BY created_at DESC`,
        [category, userId],
      );
    }

    res.json(notifications.rows);
  } catch (error) {
    console.error('Error fetching notifications by category:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Manual cleanup trigger for testing
router.post('/cleanup', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const daysCheck = validateNumberRange(req.body.days ?? 90, {
      label: 'days',
      required: true,
      min: 1,
      max: 3650,
      integer: true,
    });

    if (daysCheck.error) {
      return respondValidationError(res, { days: daysCheck.error });
    }

    const days = daysCheck.value;
    const deletedCount = await cleanOldNotifications(days);

    res.json({
      success: true,
      message: `Cleanup executed. Deleted ${deletedCount} notifications older than ${days} days.`,
      deletedCount,
    });
  } catch (error) {
    console.error('Error executing manual cleanup:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
