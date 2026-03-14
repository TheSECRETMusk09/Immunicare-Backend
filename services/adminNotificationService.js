/**
 * Admin Notification Service
 *
 * Unified service for sending admin notifications that:
 * - Persists notifications to the database
 * - Emits realtime socket updates
 * - Can invoke SMS or sms_logs fallback delivery
 *
 * Includes deduplication to prevent repeated alerts for the same condition.
 */

const pool = require('../db');
const notificationService = require('./notificationService');
const socketService = require('./socketService');
const smsService = require('./smsService');

// Deduplication cache - stores recent alert keys to prevent spam
const alertDeduplication = new Map();
const DEDUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEDUP_CACHE_MAX_SIZE = 1000;

// Notification categories for admin alerts
const NOTIFICATION_CATEGORIES = {
  EXPIRY_WARNING: 'expiry_warning',
  EXPIRY_CRITICAL: 'expiry_critical',
  OUT_OF_STOCK: 'out_of_stock',
  LOW_STOCK: 'low_stock',
  SYSTEM_ALERT: 'system_alert',
  REGISTRATION: 'registration',
  SECURITY: 'security',
};

// Priority mapping
const PRIORITY_MAP = {
  low: 2,
  normal: 3,
  high: 4,
  urgent: 5,
};

/**
 * Generate a unique key for deduplication
 * @param {string} category - Notification category
 * @param {string|number} targetId - Target ID (e.g., vaccine_id, inventory_id)
 * @param {string} alertType - Type of alert
 * @returns {string} Unique dedup key
 */
const generateDedupKey = (category, targetId, alertType) => {
  return `${category}:${targetId}:${alertType}`;
};

/**
 * Check if an alert should be sent based on deduplication
 * @param {string} dedupKey - Unique key for the alert
 * @returns {boolean} True if alert should be sent
 */
const shouldSendAlert = (dedupKey) => {
  const now = Date.now();

  // Clean up old entries if cache is too large
  if (alertDeduplication.size >= DEDUP_CACHE_MAX_SIZE) {
    for (const [key, timestamp] of alertDeduplication) {
      if (now - timestamp > DEDUP_CACHE_TTL_MS) {
        alertDeduplication.delete(key);
      }
    }
  }

  // Check if we've sent this alert recently
  const lastSent = alertDeduplication.get(dedupKey);
  if (lastSent && (now - lastSent) < DEDUP_CACHE_TTL_MS) {
    return false;
  }

  // Mark this alert as sent
  alertDeduplication.set(dedupKey, now);
  return true;
};

/**
 * Format phone number for SMS
 * @param {string} phone - Raw phone number
 * @returns {string} Formatted phone number
 */
const formatPhoneNumber = (phone) => {
  if (!phone) {
    return null;
  }

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Handle Philippine numbers
  if (digits.startsWith('63')) {
    return `+${digits}`;
  }
  if (digits.startsWith('0')) {
    return `+63${digits.substring(1)}`;
  }
  if (digits.length === 10) {
    return `+63${digits}`;
  }

  return `+${digits}`;
};

/**
 * Get admin users who should receive notifications
 * @param {string} role - Role to filter by (default: system_admin)
 * @returns {Promise<Array>} Array of admin user objects
 */
const getAdminRecipients = async (role = 'system_admin') => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, g.phone, g.name as guardian_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN guardians g ON u.guardian_id = g.id
       WHERE LOWER(r.name) = $1 AND u.is_active = true`,
      [role.toLowerCase()],
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching admin recipients:', error);
    return [];
  }
};

/**
 * Send an admin notification with all delivery channels
 *
 * @param {Object} options - Notification options
 * @param {string} options.category - Notification category (use NOTIFICATION_CATEGORIES)
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message
 * @param {string} options.priority - Priority: low, normal, high, urgent
 * @param {string|number} options.targetId - Target ID for deduplication
 * @param {string} options.alertType - Alert type for deduplication
 * @param {string} options.targetRole - Role to send notification to (default: system_admin)
 * @param {Object} options.metadata - Additional metadata
 * @param {boolean} options.skipDedup - Skip deduplication check
 * @param {boolean} options.sendSms - Whether to send SMS (default: true for urgent/high)
 * @param {string} options.smsRecipient - Specific SMS recipient (overrides admin phone)
 * @returns {Object} Result with success status and details
 */
const sendAdminNotification = async ({
  category,
  title,
  message,
  priority = 'normal',
  targetId,
  alertType,
  targetRole = 'system_admin',
  metadata = {},
  skipDedup = false,
  sendSms = null, // null means auto-determine based on priority
  smsRecipient = null,
}) => {
  const results = {
    persisted: false,
    socketEmitted: false,
    smsSent: false,
    smsLogged: false,
    dedupSkipped: false,
  };

  try {
    // Handle deduplication
    if (!skipDedup && targetId && alertType) {
      const dedupKey = generateDedupKey(category, targetId, alertType);
      if (!shouldSendAlert(dedupKey)) {
        results.dedupSkipped = true;
        console.log(`[AdminNotification] Deduplication skipped for: ${dedupKey}`);
        return {
          success: false,
          reason: 'deduplicated',
          results,
        };
      }
    }

    // Auto-determine SMS sending based on priority
    if (sendSms === null) {
      sendSms = priority === 'urgent' || priority === 'high';
    }

    // 1. Persist notification to database
    try {
      const notificationResult = await notificationService.sendNotification({
        notification_type: category,
        event_type: category,
        target_type: 'role',
        target_id: targetRole,
        channel: sendSms ? 'both' : 'push',
        priority: PRIORITY_MAP[priority] || 3,
        subject: title,
        message: message,
        category: category,
        target_role: targetRole,
        metadata: {
          ...metadata,
          alertType,
          targetId,
        },
        skipImmediateProcessing: false,
      });

      results.persisted = notificationResult.success;
    } catch (persistError) {
      console.error('[AdminNotification] Failed to persist notification:', persistError.message);
    }

    // 2. Emit realtime socket notification to admins
    try {
      socketService.sendToRole(targetRole, 'admin-notification', {
        id: Date.now(), // Temporary ID if not persisted
        category,
        title,
        message,
        priority,
        timestamp: new Date().toISOString(),
        metadata,
      });
      results.socketEmitted = true;
    } catch (socketError) {
      console.error('[AdminNotification] Failed to emit socket notification:', socketError.message);
    }

    // 3. Send SMS if required
    if (sendSms) {
      const smsRecipients = [];

      // Use specific recipient if provided
      if (smsRecipient) {
        const formatted = formatPhoneNumber(smsRecipient);
        if (formatted) {
          smsRecipients.push({ phone: formatted, type: 'specific' });
        }
      } else {
        // Get admin phone numbers
        const admins = await getAdminRecipients(targetRole);
        for (const admin of admins) {
          if (admin.phone) {
            const formatted = formatPhoneNumber(admin.phone);
            if (formatted) {
              smsRecipients.push({ phone: formatted, name: admin.guardian_name, type: 'admin' });
            }
          }
        }
      }

      // Send SMS to each recipient
      for (const recipient of smsRecipients) {
        try {
          // Truncate message for SMS if too long
          const smsMessage = message.length > 160
            ? message.substring(0, 157) + '...'
            : message;

          await smsService.sendSMS(
            recipient.phone,
            `[Immunicare] ${title}: ${smsMessage}`,
            'admin_alert',
          );
          results.smsSent = true;
          console.log(`[AdminNotification] SMS sent to ${recipient.phone}`);
        } catch (smsError) {
          console.error(`[AdminNotification] SMS send failed to ${recipient.phone}:`, smsError.message);

          // Fallback: log to sms_logs if available
          try {
            await logSmsFallback(recipient.phone, title, message, category);
            results.smsLogged = true;
          } catch (logError) {
            console.error('[AdminNotification] SMS fallback logging failed:', logError.message);
          }
        }
      }
    }

    return {
      success: true,
      results,
    };
  } catch (error) {
    console.error('[AdminNotification] Unexpected error:', error);
    return {
      success: false,
      error: error.message,
      results,
    };
  }
};

/**
 * Log SMS to fallback table if SMS fails
 */
const logSmsFallback = async (phone, title, message, category) => {
  try {
    // Try to insert into sms_logs if table exists
    await pool.query(
      `INSERT INTO sms_logs (phone_number, message, status, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT DO NOTHING`,
      [phone, `[FALLBACK] ${title}: ${message}`, 'failed'],
    );
    return true;
  } catch (error) {
    // Table might not exist, ignore
    console.log('[AdminNotification] sms_logs table not available for fallback');
    return false;
  }
};

/**
 * Send expiry alert for vaccine inventory
 */
const sendExpiryAlert = async (vaccineName, vaccineId, expiryDate, daysUntilExpiry, lotNumber) => {
  const isCritical = daysUntilExpiry <= 7;
  const category = isCritical
    ? NOTIFICATION_CATEGORIES.EXPIRY_CRITICAL
    : NOTIFICATION_CATEGORIES.EXPIRY_WARNING;

  const title = isCritical
    ? 'CRITICAL: Vaccine Expiring Soon'
    : 'Warning: Vaccine Expiring';

  const message = `${vaccineName} (Lot: ${lotNumber}) will expire on ${expiryDate.toISOString().split('T')[0]} (${daysUntilExpiry} days remaining)`;

  return sendAdminNotification({
    category,
    title,
    message,
    priority: isCritical ? 'urgent' : 'high',
    targetId: vaccineId,
    alertType: `expiry_${lotNumber}`,
    metadata: {
      vaccineId,
      vaccineName,
      expiryDate: expiryDate.toISOString(),
      daysUntilExpiry,
      lotNumber,
    },
  });
};

/**
 * Send out-of-stock alert for vaccine inventory
 */
const sendOutOfStockAlert = async (vaccineName, vaccineId, lotNumber) => {
  const title = 'CRITICAL: Vaccine Out of Stock';
  const message = `${vaccineName} (Lot: ${lotNumber}) is now out of stock. Immediate restocking required.`;

  return sendAdminNotification({
    category: NOTIFICATION_CATEGORIES.OUT_OF_STOCK,
    title,
    message,
    priority: 'urgent',
    targetId: vaccineId,
    alertType: `out_of_stock_${lotNumber}`,
    sendSms: true,
    metadata: {
      vaccineId,
      vaccineName,
      lotNumber,
    },
  });
};

/**
 * Send low stock warning
 */
const sendLowStockAlert = async (vaccineName, vaccineId, currentStock, lotNumber, threshold = 10) => {
  const title = 'Warning: Low Stock Level';
  const message = `${vaccineName} (Lot: ${lotNumber}) stock is low: ${currentStock} units (threshold: ${threshold})`;

  return sendAdminNotification({
    category: NOTIFICATION_CATEGORIES.LOW_STOCK,
    title,
    message,
    priority: 'high',
    targetId: vaccineId,
    alertType: `low_stock_${lotNumber}`,
    sendSms: false,
    metadata: {
      vaccineId,
      vaccineName,
      currentStock,
      lotNumber,
      threshold,
    },
  });
};

/**
 * Clear deduplication cache (useful for testing)
 */
const clearDedupCache = () => {
  alertDeduplication.clear();
};

/**
 * Get deduplication cache status
 */
const getDedupStatus = () => {
  const now = Date.now();
  let validCount = 0;
  let expiredCount = 0;

  for (const [key, timestamp] of alertDeduplication) {
    if (now - timestamp < DEDUP_CACHE_TTL_MS) {
      validCount++;
    } else {
      expiredCount++;
    }
  }

  return {
    total: alertDeduplication.size,
    valid: validCount,
    expired: expiredCount,
  };
};

module.exports = {
  sendAdminNotification,
  sendExpiryAlert,
  sendOutOfStockAlert,
  sendLowStockAlert,
  NOTIFICATION_CATEGORIES,
  clearDedupCache,
  getDedupStatus,
  generateDedupKey,
  shouldSendAlert,
};
