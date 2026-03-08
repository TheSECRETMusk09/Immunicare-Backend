const pool = require('../db');
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

class NotificationService {
  constructor() {
    this.transporter = null;
    this.initializeEmailTransporter();
  }

  initializeEmailTransporter() {
    // Configure email transporter for notifications
    // In production, use environment variables for credentials
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER || 'your-email@gmail.com',
        pass: process.env.SMTP_PASS || 'your-app-password',
      },
    });
  }

  async sendNotification(notificationData) {
    try {
      const {
        notification_type,
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
      } = notificationData;

      // Create notification record
      const result = await pool.query(
        `INSERT INTO notifications (
          notification_type, target_type, target_id, recipient_name,
          recipient_email, recipient_phone, channel, priority, status,
          subject, message, template_id, template_data, language,
          scheduled_for, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *`,
        [
          notification_type,
          target_type,
          target_id,
          notificationData.recipient_name || null,
          notificationData.recipient_email || null,
          notificationData.recipient_phone || null,
          channel,
          priority,
          scheduled_for ? 'scheduled' : 'pending',
          subject,
          message,
          template_id || null,
          JSON.stringify(template_data || {}),
          language,
          scheduled_for || null,
          notificationData.created_by || null,
        ],
      );

      const notification = result.rows[0];

      // Send immediately if not scheduled
      if (!scheduled_for) {
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

      // Update status to sending
      await this.updateNotificationStatus(notificationId, 'sending');

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

      // Update notification status
      if (success) {
        await this.updateNotificationStatus(notificationId, 'sent');
        await this.updateNotificationSentAt(notificationId);
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

    const mailOptions = {
      from: process.env.FROM_EMAIL || 'noreply@immunicare.com',
      to: notification.recipient_email,
      subject: notification.subject,
      text: notification.message,
      html: this.generateEmailHTML(notification),
    };

    await this.transporter.sendMail(mailOptions);
  }

  async sendSMS(notification) {
    // SMS implementation would go here
    // This would typically use a service like Twilio
    logger.info(
      `SMS to ${notification.recipient_phone}: ${notification.message}`,
    );

    // For now, simulate SMS sending
    if (!notification.recipient_phone) {
      throw new Error('No phone number provided');
    }
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
