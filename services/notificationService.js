const pool = require('../db');
const logger = require('../config/logger');
const smsService = require('./smsService');
const { getTransporter, EMAIL_CONFIG } = require('../config/email');

const NOTIFICATION_COLUMNS_CACHE_TTL = 5 * 60 * 1000;
let notificationColumnsCache = null;
let notificationColumnsCachedAt = 0;

const getNotificationColumns = async () => {
  const now = Date.now();
  if (notificationColumnsCache && now - notificationColumnsCachedAt < NOTIFICATION_COLUMNS_CACHE_TTL) {
    return notificationColumnsCache;
  }

  const result = await pool.query(
    `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notifications'
    `,
  );

  notificationColumnsCache = new Map(
    result.rows.map((row) => [row.column_name, { dataType: row.data_type, udtName: row.udt_name }]),
  );
  notificationColumnsCachedAt = now;
  return notificationColumnsCache;
};

const normalizeJsonPayload = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch (_error) {
      return JSON.stringify(value);
    }
  }

  return JSON.stringify(value);
};

const PRIORITY_LABELS = ['low', 'normal', 'high', 'urgent'];
const toPriorityLabel = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (PRIORITY_LABELS.includes(normalized)) {
      return normalized;
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 4) {
      return 'urgent';
    }
    if (value >= 3) {
      return 'high';
    }
    if (value <= 1) {
      return 'low';
    }
  }

  return 'normal';
};

const toPriorityNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(5, Math.round(value)));
  }

  const normalized = toPriorityLabel(value);
  switch (normalized) {
  case 'urgent':
    return 5;
  case 'high':
    return 4;
  case 'low':
    return 2;
  default:
    return 3;
  }
};

class NotificationService {
  constructor() {
    this.transporter = null;
    this.transporterPromise = null;
  }

  async getEmailTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    if (!this.transporterPromise) {
      this.transporterPromise = getTransporter()
        .then((transporter) => {
          this.transporter = transporter;
          return transporter;
        })
        .catch((error) => {
          this.transporterPromise = null;
          throw error;
        });
    }

    return this.transporterPromise;
  }

  async sendNotification(notificationData) {
    try {
      const {
        notification_type,
        event_type,
        target_type,
        target_id,
        channel,
        priority,
        subject,
        message,
        template_id,
        template_data,
        language = 'en',
        scheduled_for,
        user_id,
        guardian_id,
      } = notificationData;

      // Check user notification preferences before sending
      const effectiveUserId = user_id || guardian_id;
      if (effectiveUserId && notification_type) {
        // Check debounce settings and skip if recently notified
        const debounceSettings = await this.getDebounceSettings(effectiveUserId);
        if (debounceSettings && debounceSettings.enabled) {
          const debounceResult = await this.checkAndRecordDebounce(
            effectiveUserId,
            notification_type,
            debounceSettings.debounce_minutes || 10
          );
          if (debounceResult.debounced) {
            logger.info(`Notification ${notification_type} debounced for user ${effectiveUserId}`);
            return { success: false, reason: 'debounced', skipped: true };
          }
        }

        // First check guardian-specific preferences (for guardian users)
        if (guardian_id) {
          const isChannelEnabled = await this.isGuardianChannelEnabled(guardian_id, notification_type, channel);
          if (!isChannelEnabled) {
            logger.info(`Notification ${notification_type} skipped - channel ${channel} disabled by guardian preference for guardian ${guardian_id}`);
            return { success: false, reason: 'channel_disabled_by_guardian', skipped: true };
          }

          // Check guardian preferred time
          const guardianPref = await this.getGuardianNotificationPreferenceByType(guardian_id, notification_type);
          if (guardianPref && guardianPref.preferred_time) {
            const now = new Date();
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const [prefHour, prefMinute] = guardianPref.preferred_time.split(':').map(Number);

            // Only send if current time is within 2 hours of preferred time
            const currentTotalMinutes = currentHour * 60 + currentMinute;
            const prefTotalMinutes = prefHour * 60 + prefMinute;
            const diffMinutes = Math.abs(currentTotalMinutes - prefTotalMinutes);

            if (diffMinutes > 120) { // More than 2 hours away from preferred time
              logger.info(`Notification ${notification_type} rescheduled to preferred time ${guardianPref.preferred_time} for guardian ${guardian_id}`);
              // Reschedule to preferred time
              const scheduleDate = new Date(now);
              scheduleDate.setHours(prefHour, prefMinute, 0, 0);
              if (scheduleDate <= now) {
                scheduleDate.setDate(scheduleDate.getDate() + 1);
              }
              scheduled_for = scheduled_for || scheduleDate.toISOString();
            }
          }
        } else {
          // Check admin preferences (for admin users)
          const preference = await this.getNotificationPreferenceByType(effectiveUserId, notification_type);
          if (preference) {
            // Check if this notification type is disabled
            if (!preference.enabled) {
              logger.info(`Notification ${notification_type} skipped - disabled by admin preference for user ${effectiveUserId}`);
              return { success: false, reason: 'disabled_by_user', skipped: true };
            }

            // Check quiet hours
            if (preference.quiet_hours_start && preference.quiet_hours_end) {
              const now = new Date();
              const currentTime = now.toTimeString().slice(0, 8); // HH:MM:SS

              // Simple quiet hours check
              if (currentTime >= preference.quiet_hours_start && currentTime <= preference.quiet_hours_end) {
                logger.info(`Notification ${notification_type} rescheduled due to quiet hours (${preference.quiet_hours_start}-${preference.quiet_hours_end}) for user ${effectiveUserId}`);
                // Reschedule for end of quiet hours
                const scheduleDate = new Date(now);
                const [hours, minutes, seconds] = preference.quiet_hours_end.split(':');
                scheduleDate.setHours(parseInt(hours), parseInt(minutes), parseInt(seconds));
                if (scheduleDate <= now) {
                  // Next day
                  scheduleDate.setDate(scheduleDate.getDate() + 1);
                }
                scheduled_for = scheduled_for || scheduleDate.toISOString();
              }
            }

            // Check channel preference
            if (preference.channel && channel) {
              const allowedChannels = preference.channel === 'both'
                ? ['sms', 'email', 'push']
                : [preference.channel];

              if (!allowedChannels.includes(channel)) {
                logger.info(`Notification ${notification_type} skipped - channel ${channel} not preferred by user for user ${effectiveUserId}`);
                return { success: false, reason: 'channel_not_preferred', skipped: true };
              }
            }
          }
        }
      }

      // Create notification record (adapt to schema columns)
      const columns = await getNotificationColumns();
      const resolvePriority = (value) => {
        if (!columns.has('priority')) {
          return undefined;
        }

        const columnInfo = columns.get('priority');
        if (!columnInfo) {
          return value;
        }

        if (columnInfo.dataType === 'integer') {
          return toPriorityNumber(value);
        }

        if (columnInfo.dataType === 'USER-DEFINED') {
          return toPriorityLabel(value);
        }

        return value;
      };
      const resolvedPriority = resolvePriority(priority);
      const payload = {
        notification_type,
        event_type: event_type || notification_type,
        target_type,
        target_id,
        recipient_name: notificationData.recipient_name || null,
        recipient_email: notificationData.recipient_email || null,
        recipient_phone: notificationData.recipient_phone || null,
        channel,
        priority: resolvedPriority,
        status: scheduled_for ? 'scheduled' : 'pending',
        trace_id: notificationData.trace_id || null,
        idempotency_key: notificationData.idempotency_key || null,
        channel_status: notificationData.channel_status || null,
        callback_status: notificationData.callback_status || null,
        subject,
        message,
        template_id: template_id || null,
        template_data: template_data || {},
        language,
        scheduled_for: scheduled_for || null,
        created_by: notificationData.created_by || null,
        guardian_id: notificationData.guardian_id || null,
        recipient_guardian_id: notificationData.recipient_guardian_id || null,
        recipient_user_id: notificationData.recipient_user_id || null,
        recipient_admin_id: notificationData.recipient_admin_id || null,
        orchestration_version: notificationData.orchestration_version || 'v1',
        target_role: notificationData.target_role || null,
        metadata: notificationData.metadata || null,
        title: notificationData.title || subject || notification_type || 'Notification',
        type: notificationData.type || notification_type || 'info',
        category: notificationData.category || 'general',
        is_read: notificationData.is_read ?? false,
      };

      const keys = Object.keys(payload).filter((key) => {
        if (!columns.has(key) || payload[key] === undefined) {
          return false;
        }

        const columnInfo = columns.get(key);
        if (!columnInfo) {
          return true;
        }

        const isJsonColumn =
          columnInfo.dataType === 'json' || columnInfo.dataType === 'jsonb' || columnInfo.udtName === 'jsonb';

        if (isJsonColumn) {
          payload[key] = normalizeJsonPayload(payload[key]);
        }

        return true;
      });

      if (keys.length === 0) {
        throw new Error('Notification table schema is missing required columns');
      }

      const placeholders = keys.map((_, index) => `$${index + 1}`);
      const values = keys.map((key) => payload[key]);

      const result = await pool.query(
        `INSERT INTO notifications (
          ${keys.join(', ')}
        ) VALUES (${placeholders.join(', ')})
        RETURNING *`,
        values,
      );

      const notification = result.rows[0];

      // Send immediately if not scheduled (unless orchestration already dispatched channels)
      const skipImmediateProcessing = Boolean(notificationData.skipImmediateProcessing);
      if (!scheduled_for && !skipImmediateProcessing) {
        await this.processNotification(notification.id);
      }

      return {
        success: true,
        notification,
      };
    } catch (error) {
      logger.error('Error creating notification:', error);
      throw error;
    }
  }

  async processNotification(notificationId) {
    try {
      const notification = await this.getNotification(notificationId);

      if (!notification) {
        throw new Error('Notification not found');
      }

      // Update status to sending and increment delivery attempts
      await this.updateNotificationStatus(notificationId, 'sending');
      await this.incrementDeliveryAttempts(notificationId);

      let success = false;
      let errorMessage = null;

      try {
        switch (notification.channel) {
        case 'email':
          await this.sendEmail(notification);
          success = true;
          break;
        case 'sms':
          await this.sendSMS(notification);
          success = true;
          break;
        case 'push':
          await this.sendPushNotification(notification);
          success = true;
          break;
        case 'both':
          await Promise.all([
            this.sendEmail(notification),
            this.sendSMS(notification),
          ]);
          success = true;
          break;
        default:
          throw new Error(`Unsupported channel: ${notification.channel}`);
        }
      } catch (sendError) {
        errorMessage = sendError.message;
        success = false;
      }

      // Update notification status and delivery tracking
      if (success) {
        await this.updateNotificationStatus(notificationId, 'sent');
        await this.updateNotificationSentAt(notificationId);
        await this.updateNotificationDeliveredAt(notificationId);
      } else {
        await this.updateNotificationStatus(notificationId, 'failed');
        await this.updateNotificationFailureReason(
          notificationId,
          errorMessage,
        );
      }

      return {
        success,
        notificationId,
        errorMessage,
      };
    } catch (error) {
      logger.error('Error processing notification:', error);
      throw error;
    }
  }

  async sendEmail(notification) {
    if (!notification.recipient_email) {
      throw new Error('No email address provided');
    }

    if (EMAIL_CONFIG.emailDisabled) {
      logger.info('Email delivery skipped because EMAIL_DISABLED=true', {
        notificationId: notification.id,
      });
      return;
    }

    const fromAddress = EMAIL_CONFIG.from.address;
    if (!fromAddress) {
      throw new Error('MAIL_FROM_EMAIL is required to send email notifications');
    }

    const transporter = await this.getEmailTransporter();
    const fromName = EMAIL_CONFIG.from.name || 'Immunicare';
    const formattedFrom = fromAddress.includes('<')
      ? fromAddress
      : `${fromName} <${fromAddress}>`;

    const mailOptions = {
      from: formattedFrom,
      to: notification.recipient_email,
      subject: notification.subject,
      text: notification.message,
      html: this.generateEmailHTML(notification),
    };

    await transporter.sendMail(mailOptions);
  }

  async sendSMS(notification) {
    if (!notification.recipient_phone) {
      throw new Error('No phone number provided');
    }

    await smsService.sendSMS(
      notification.recipient_phone,
      notification.message,
      notification.notification_type || 'notification',
      {
        notificationId: notification.id,
        targetType: notification.target_type,
        targetId: notification.target_id,
      },
    );
  }

  async sendPushNotification(notification) {
    // Push notification implementation would go here
    // This would typically use Firebase Cloud Messaging or similar
    logger.info(
      `Push notification to ${notification.target_type} ${notification.target_id}: ${notification.message}`,
    );
  }

  generateEmailHTML(notification) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${notification.subject}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #3B82F6; color: white; padding: 20px; text-align: center; }
          .content { background: #f8f9fa; padding: 20px; border-radius: 8px; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          .priority-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
          .priority-high { background: #ef4444; color: white; }
          .priority-normal { background: #3b82f6; color: white; }
          .priority-low { background: #10b981; color: white; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Immunicare Notification</h1>
            <span class="priority-badge priority-${
  notification.priority
}">${notification.priority.toUpperCase()}</span>
          </div>
          <div class="content">
            <h2>${notification.subject}</h2>
            <p>${notification.message}</p>
            ${
  notification.template_data
    ? this.generateTemplateDataHTML(notification.template_data)
    : ''
}
          </div>
          <div class="footer">
            <p>This is an automated message from Immunicare System</p>
            <p>Please do not reply to this email</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateTemplateDataHTML(templateData) {
    if (!templateData || Object.keys(templateData).length === 0) {
      return '';
    }

    let html =
      '<div style="margin-top: 20px; padding: 15px; background: white; border-radius: 4px;">';
    html += '<h3>Additional Information:</h3>';
    html += '<ul style="list-style: none; padding: 0;">';

    Object.entries(templateData).forEach(([key, value]) => {
      html += `<li><strong>${key}:</strong> ${value}</li>`;
    });

    html += '</ul></div>';
    return html;
  }

  async getNotification(id) {
    const result = await pool.query(
      'SELECT * FROM notifications WHERE id = $1',
      [id],
    );
    return result.rows[0] || null;
  }

  async getNotificationsByTarget(targetType, targetId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE target_type = $1 AND target_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [targetType, targetId, limit, offset],
    );
    return result.rows;
  }

  async getNotificationsByUser(userId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT n.*, u.name as created_by_name
       FROM notifications n
       LEFT JOIN users u ON n.created_by = u.id
       WHERE n.target_type = 'user' AND n.target_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return result.rows;
  }

  async getUnreadNotifications(targetType, targetId) {
    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE target_type = $1 AND target_id = $2 AND status NOT IN ('read', 'dismissed')
       ORDER BY created_at DESC`,
      [targetType, targetId],
    );
    return result.rows;
  }

  async markAsRead(notificationId) {
    await this.updateNotificationStatus(notificationId, 'read');
    await this.updateNotificationReadAt(notificationId);
  }

  async markAsDismissed(notificationId) {
    await this.updateNotificationStatus(notificationId, 'dismissed');
  }

  async updateNotificationStatus(id, status) {
    await pool.query(
      'UPDATE notifications SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, id],
    );
  }

  async updateNotificationSentAt(id) {
    await pool.query(
      'UPDATE notifications SET sent_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id],
    );
  }

  async updateNotificationReadAt(id) {
    await pool.query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id],
    );
  }

  async updateNotificationFailureReason(id, reason) {
    await pool.query(
      'UPDATE notifications SET failure_reason = $1 WHERE id = $2',
      [reason, id],
    );
  }

  async incrementDeliveryAttempts(id) {
    const columns = await getNotificationColumns();
    const updateClauses = [];

    if (columns.has('delivery_attempts')) {
      updateClauses.push('delivery_attempts = COALESCE(delivery_attempts, 0) + 1');
    } else if (columns.has('retry_count')) {
      updateClauses.push('retry_count = COALESCE(retry_count, 0) + 1');
    }

    if (columns.has('last_attempt_at')) {
      updateClauses.push('last_attempt_at = CURRENT_TIMESTAMP');
    } else if (columns.has('updated_at')) {
      updateClauses.push('updated_at = CURRENT_TIMESTAMP');
    }

    if (updateClauses.length === 0) {
      return;
    }

    await pool.query(
      `UPDATE notifications SET ${updateClauses.join(', ')} WHERE id = $1`,
      [id],
    );
  }

  async updateNotificationDeliveredAt(id) {
    await pool.query(
      'UPDATE notifications SET delivered_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id],
    );
  }

  // Notification Preferences Methods - for Admin notifications
  async getNotificationPreferences(adminId) {
    const result = await pool.query(
      'SELECT * FROM notification_preferences WHERE admin_id = $1',
      [adminId],
    );
    return result.rows;
  }

  async getNotificationPreferenceByType(adminId, notificationType) {
    const result = await pool.query(
      'SELECT * FROM notification_preferences WHERE admin_id = $1 AND notification_type = $2',
      [adminId, notificationType],
    );
    return result.rows[0] || null;
  }

  async updateNotificationPreference(adminId, notificationType, channel, isEnabled) {
    const result = await pool.query(
      `INSERT INTO notification_preferences (
         admin_id, notification_type, channel, enabled
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (admin_id, notification_type, channel)
       DO UPDATE SET
         enabled = EXCLUDED.enabled,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [adminId, notificationType, channel, isEnabled],
    );
    return result.rows[0];
  }

  async deleteNotificationPreference(adminId, notificationType, channel) {
    await pool.query(
      'DELETE FROM notification_preferences WHERE admin_id = $1 AND notification_type = $2 AND channel = $3',
      [adminId, notificationType, channel],
    );
    return { success: true };
  }

  // Guardian Notification Preferences - uses guardian_id
  // Table schema: guardian_id, notification_type, email_enabled, sms_enabled, push_enabled, preferred_time
  async getGuardianNotificationPreferences(guardianId) {
    try {
      const result = await pool.query(
        'SELECT * FROM guardian_notification_preferences WHERE guardian_id = $1',
        [guardianId],
      );
      return result.rows;
    } catch (error) {
      if (error?.code === '42P01') {
        return [];
      }

      throw error;
    }
  }

  async getGuardianNotificationPreferenceByType(guardianId, notificationType) {
    try {
      const result = await pool.query(
        'SELECT * FROM guardian_notification_preferences WHERE guardian_id = $1 AND notification_type = $2',
        [guardianId, notificationType],
      );
      return result.rows[0] || null;
    } catch (error) {
      if (error?.code === '42P01') {
        return null;
      }

      throw error;
    }
  }

  async updateGuardianNotificationPreference(guardianId, notificationType, emailEnabled = true, smsEnabled = true, pushEnabled = true, preferredTime = '08:00:00') {
    const result = await pool.query(
      `INSERT INTO guardian_notification_preferences (
         guardian_id, notification_type, email_enabled, sms_enabled, push_enabled, preferred_time
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (guardian_id, notification_type)
       DO UPDATE SET
         email_enabled = EXCLUDED.email_enabled,
         sms_enabled = EXCLUDED.sms_enabled,
         push_enabled = EXCLUDED.push_enabled,
         preferred_time = EXCLUDED.preferred_time,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [guardianId, notificationType, emailEnabled, smsEnabled, pushEnabled, preferredTime],
    );
    return result.rows[0];
  }

  async deleteGuardianNotificationPreference(guardianId, notificationType) {
    await pool.query(
      'DELETE FROM guardian_notification_preferences WHERE guardian_id = $1 AND notification_type = $2',
      [guardianId, notificationType],
    );
    return { success: true };
  }

  // Check if guardian wants notifications via specific channel
  async isGuardianChannelEnabled(guardianId, notificationType, channel) {
    const pref = await this.getGuardianNotificationPreferenceByType(guardianId, notificationType);
    if (!pref) {
      // Default: all channels enabled if no preference set
      return true;
    }

    switch (channel) {
    case 'sms':
      return pref.sms_enabled !== false;
    case 'email':
      return pref.email_enabled !== false;
    case 'push':
      return pref.push_enabled !== false;
    default:
      return true;
    }
  }

  // Notification grouping/batching for reducing notification fatigue
  async addToNotificationBatch(batchId, notificationData) {
    try {
      const result = await pool.query(
        `INSERT INTO notification_batches (batch_id, notification_data, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [batchId, JSON.stringify(notificationData)],
      );
      return result.rows[0];
    } catch (error) {
      logger.error('Error adding to notification batch:', error);
      return null;
    }
  }

  async processNotificationBatch(batchId, channel) {
    try {
      // Get all pending notifications in the batch
      const batchResult = await pool.query(
        'SELECT * FROM notification_batches WHERE batch_id = $1 AND status = \'pending\' ORDER BY created_at',
        [batchId],
      );

      if (batchResult.rows.length === 0) {
        return { success: true, processed: 0 };
      }

      // Group notifications by recipient
      const groupedByRecipient = {};
      for (const row of batchResult.rows) {
        const data = row.notification_data;
        const key = `${data.recipient_phone || data.recipient_email || data.recipient_guardian_id || 'unknown'}`;
        if (!groupedByRecipient[key]) {
          groupedByRecipient[key] = [];
        }
        groupedByRecipient[key].push(data);
      }

      // Send grouped notifications
      let processedCount = 0;
      for (const [recipient, notifications] of Object.entries(groupedByRecipient)) {
        // Combine messages into a single batched notification
        const combinedMessage = this.combineNotificationMessages(notifications);

        // Send the combined notification
        await this.sendNotification({
          ...notifications[0],
          message: combinedMessage,
          is_batched: true,
          batch_size: notifications.length,
        });

        // Mark all notifications in group as processed
        for (const notification of notifications) {
          await pool.query(
            'UPDATE notification_batches SET status = \'sent\', processed_at = CURRENT_TIMESTAMP WHERE batch_id = $1 AND notification_data @> $2',
            [batchId, JSON.stringify(notification)],
          );
        }
        processedCount += notifications.length;
      }

      return { success: true, processed: processedCount };
    } catch (error) {
      logger.error('Error processing notification batch:', error);
      return { success: false, error: error.message };
    }
  }

  combineNotificationMessages(notifications) {
    if (notifications.length === 1) {
      return notifications[0].message;
    }

    const lines = notifications.map((n, i) => `${i + 1}. ${n.message}`);
    return `You have ${notifications.length} updates:\n${lines.join('\n')}`;
  }

  async getNotificationBatchingSettings(userId) {
    const result = await pool.query(
      'SELECT * FROM notification_batching_settings WHERE user_id = $1',
      [userId],
    );
    return result.rows[0] || { enabled: false, batch_interval_minutes: 60 };
  }

  async updateNotificationBatchingSettings(userId, enabled, batchIntervalMinutes = 60) {
    const result = await pool.query(
      `INSERT INTO notification_batching_settings (user_id, enabled, batch_interval_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET enabled = EXCLUDED.enabled, batch_interval_minutes = EXCLUDED.batch_interval_minutes, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, enabled, batchIntervalMinutes],
    );
    return result.rows[0];
  }

  // Debouncing - prevent spam from duplicate notifications
  async checkAndRecordDebounce(userId, notificationType, debounceMinutes = 10) {
    const cutoffTime = new Date(Date.now() - debounceMinutes * 60 * 1000);
    const notificationColumns = await getNotificationColumns();
    const recipientColumn = notificationColumns.has('recipient_guardian_id')
      ? 'recipient_guardian_id'
      : notificationColumns.has('guardian_id')
        ? 'guardian_id'
        : null;

    if (!recipientColumn) {
      return { debounced: false };
    }

    // Check if similar notification was sent recently
    const result = await pool.query(
      `SELECT id FROM notifications
       WHERE ${recipientColumn} = $1
         AND notification_type = $2
         AND created_at > $3
         AND status NOT IN ('failed', 'cancelled')
       LIMIT 1`,
      [userId, notificationType, cutoffTime],
    );

    if (result.rows.length > 0) {
      logger.info(`Notification ${notificationType} debounced for user ${userId} - similar notification sent within ${debounceMinutes} minutes`);
      return { debounced: true, existingNotificationId: result.rows[0].id };
    }

    return { debounced: false };
  }

  // Get debounce settings for a user
  async getDebounceSettings(userId) {
    try {
      const result = await pool.query(
        'SELECT * FROM notification_debounce_settings WHERE user_id = $1',
        [userId],
      );
      return result.rows[0] || { enabled: true, debounce_minutes: 10 };
    } catch (error) {
      if (error?.code === '42P01') {
        return { enabled: true, debounce_minutes: 10 };
      }

      throw error;
    }
  }

  // Update debounce settings
  async updateDebounceSettings(userId, enabled, debounceMinutes = 10) {
    const result = await pool.query(
      `INSERT INTO notification_debounce_settings (user_id, enabled, debounce_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET enabled = EXCLUDED.enabled, debounce_minutes = EXCLUDED.debounce_minutes, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, enabled, debounceMinutes],
    );
    return result.rows[0];
  }

  async getNotificationStats() {
    const result = await pool.query(`
      SELECT
        status,
        COUNT(*) as count,
        COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
      FROM notifications
      GROUP BY status
      ORDER BY count DESC
    `);
    return result.rows;
  }

  async getNotificationAnalytics(timeRange = '30days') {
    const dateFilter = this.getDateFilter(timeRange);

    const [total, byType, byChannel, byStatus] = await Promise.all([
      pool.query(
        'SELECT COUNT(*) as count FROM notifications WHERE created_at >= $1',
        [dateFilter],
      ),
      pool.query(
        'SELECT notification_type, COUNT(*) as count FROM notifications WHERE created_at >= $1 GROUP BY notification_type',
        [dateFilter],
      ),
      pool.query(
        'SELECT channel, COUNT(*) as count FROM notifications WHERE created_at >= $1 GROUP BY channel',
        [dateFilter],
      ),
      pool.query(
        'SELECT status, COUNT(*) as count FROM notifications WHERE created_at >= $1 GROUP BY status',
        [dateFilter],
      ),
    ]);

    return {
      total: parseInt(total.rows[0].count),
      byType: byType.rows,
      byChannel: byChannel.rows,
      byStatus: byStatus.rows,
    };
  }

  getDateFilter(timeRange) {
    const now = new Date();
    switch (timeRange) {
    case '7days':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30days':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90days':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case '1year':
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    default:
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  async scheduleNotification(notificationData, scheduledFor) {
    return this.sendNotification({
      ...notificationData,
      scheduled_for: scheduledFor,
    });
  }

  async processScheduledNotifications() {
    try {
      const result = await pool.query(`
        SELECT * FROM notifications
        WHERE status = 'scheduled' AND scheduled_for <= NOW()
      `);

      const notifications = result.rows;

      for (const notification of notifications) {
        await this.processNotification(notification.id);
      }

      return {
        success: true,
        processed: notifications.length,
      };
    } catch (error) {
      logger.error('Error processing scheduled notifications:', error);
      throw error;
    }
  }

  /**
   * Retrieves recent notifications for the dashboard activity feed.
   */
  async getRecentActivityFeed(limit = 10) {
    try {
      const result = await pool.query(`
        SELECT id, subject as description, created_at as time, notification_type
        FROM notifications
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching recent activity feed:', error);
      return [];
    }
  }
}

module.exports = NotificationService;
