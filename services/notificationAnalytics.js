const pool = require('../db');
const logger = require('../config/logger');

const RETRYABLE_CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  '08006',
  '08003',
  '57P01',
  '57P02',
  '57P03',
]);

const FATAL_DB_CONFIG_ERROR_CODES = new Set([
  '28P01',
  '28000',
  '3D000',
  '3F000',
  '42501',
]);

const isRetryableConnectionError = (code) => RETRYABLE_CONNECTION_ERROR_CODES.has(code);
const isFatalDbConfigError = (code) => FATAL_DB_CONFIG_ERROR_CODES.has(code);
const isScramPasswordTypeError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('sasl') && message.includes('client password must be a string');
};

class NotificationAnalytics {
  constructor() {
    this.analyticsReady = false;
    this.analyticsInitAttempted = false;
    this.analyticsDisabledReason = null;
  }

  markAnalyticsDisabled(reason, details = {}) {
    if (!this.analyticsDisabledReason) {
      this.analyticsDisabledReason = reason;
      logger.warn('Notification analytics disabled for this process', {
        reason,
        ...details,
      });
    }
    this.analyticsReady = false;
  }

  isAuthOrConfigError(error) {
    return isFatalDbConfigError(error?.code) || isScramPasswordTypeError(error);
  }

  async ensureAnalyticsReady() {
    if (this.analyticsReady) {
      return true;
    }

    if (this.analyticsDisabledReason) {
      return false;
    }

    if (!this.analyticsInitAttempted) {
      this.analyticsInitAttempted = true;
      await this.initializeAnalyticsTable();
    }

    return this.analyticsReady;
  }

  // Track notification delivery
  async trackDelivery(notificationId, channel, status, metadata = {}) {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return null;
    }

    try {
      const result = await pool.query(
        `INSERT INTO notification_analytics (
          notification_id, event_type, channel, status, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        RETURNING *`,
        [notificationId, 'delivery', channel, status, JSON.stringify(metadata)],
      );

      logger.info(`Tracked delivery for notification ${notificationId}: ${status}`);
      return result.rows[0];
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return null;
      }

      logger.error('Error tracking notification delivery:', error);
      throw error;
    }
  }

  // Track notification open/read
  async trackOpen(notificationId, userId, metadata = {}) {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return null;
    }

    try {
      const result = await pool.query(
        `INSERT INTO notification_analytics (
          notification_id, user_id, event_type, status, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (notification_id, user_id, event_type)
        DO UPDATE SET
          status = EXCLUDED.status,
          metadata = EXCLUDED.metadata,
          created_at = CURRENT_TIMESTAMP
        RETURNING *`,
        [notificationId, userId, 'open', 'opened', JSON.stringify(metadata)],
      );

      logger.info(`Tracked open for notification ${notificationId} by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return null;
      }

      logger.error('Error tracking notification open:', error);
      throw error;
    }
  }

  // Track notification click/action
  async trackClick(notificationId, userId, actionType, metadata = {}) {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return null;
    }

    try {
      const result = await pool.query(
        `INSERT INTO notification_analytics (
          notification_id, user_id, event_type, action_type, status, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        RETURNING *`,
        [notificationId, userId, 'click', actionType, 'clicked', JSON.stringify(metadata)],
      );

      logger.info(`Tracked click for notification ${notificationId}: ${actionType}`);
      return result.rows[0];
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return null;
      }

      logger.error('Error tracking notification click:', error);
      throw error;
    }
  }

  // Track notification dismissal
  async trackDismissal(notificationId, userId, metadata = {}) {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return null;
    }

    try {
      const result = await pool.query(
        `INSERT INTO notification_analytics (
          notification_id, user_id, event_type, status, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        RETURNING *`,
        [notificationId, userId, 'dismiss', 'dismissed', JSON.stringify(metadata)],
      );

      logger.info(`Tracked dismissal for notification ${notificationId} by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return null;
      }

      logger.error('Error tracking notification dismissal:', error);
      throw error;
    }
  }

  // Get engagement metrics for a notification
  async getNotificationEngagement(notificationId) {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return {};
    }

    try {
      const result = await pool.query(
        `SELECT
          event_type,
          COUNT(*) as count,
          COUNT(DISTINCT user_id) as unique_users,
          MIN(created_at) as first_event,
          MAX(created_at) as last_event
        FROM notification_analytics
        WHERE notification_id = $1
        GROUP BY event_type`,
        [notificationId],
      );

      const metrics = {};
      result.rows.forEach((row) => {
        metrics[row.event_type] = {
          count: parseInt(row.count),
          uniqueUsers: parseInt(row.unique_users),
          firstEvent: row.first_event,
          lastEvent: row.last_event,
        };
      });

      return metrics;
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return {};
      }

      logger.error('Error getting notification engagement:', error);
      throw error;
    }
  }

  // Get overall notification statistics
  async getOverallStats(timeRange = '30days') {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return {
        total: 0,
        byType: [],
        byCategory: [],
        byPriority: [],
        byChannel: [],
        engagement: [],
      };
    }

    try {
      const dateFilter = this.getDateFilter(timeRange);

      const [total, byType, byCategory, byPriority, byChannel, engagement] = await Promise.all([
        pool.query('SELECT COUNT(*) as count FROM notifications WHERE created_at >= $1', [
          dateFilter,
        ]),
        pool.query(
          'SELECT type, COUNT(*) as count FROM notifications WHERE created_at >= $1 GROUP BY type',
          [dateFilter],
        ),
        pool.query(
          'SELECT category, COUNT(*) as count FROM notifications WHERE created_at >= $1 GROUP BY category',
          [dateFilter],
        ),
        pool.query(
          'SELECT priority, COUNT(*) as count FROM notifications WHERE created_at >= $1 GROUP BY priority',
          [dateFilter],
        ),
        pool.query(
          'SELECT channel, COUNT(*) as count FROM notifications WHERE created_at >= $1 GROUP BY channel',
          [dateFilter],
        ),
        pool.query(
          `SELECT
            event_type,
            COUNT(*) as count,
            COUNT(DISTINCT notification_id) as unique_notifications,
            COUNT(DISTINCT user_id) as unique_users
          FROM notification_analytics
          WHERE created_at >= $1
          GROUP BY event_type`,
          [dateFilter],
        ),
      ]);

      return {
        total: parseInt(total.rows[0].count),
        byType: byType.rows,
        byCategory: byCategory.rows,
        byPriority: byPriority.rows,
        byChannel: byChannel.rows,
        engagement: engagement.rows,
      };
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return {
          total: 0,
          byType: [],
          byCategory: [],
          byPriority: [],
          byChannel: [],
          engagement: [],
        };
      }

      logger.error('Error getting overall stats:', error);
      throw error;
    }
  }

  // Get user engagement metrics
  async getUserEngagement(userId, timeRange = '30days') {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return {
        totalEvents: 0,
        byType: [],
        byAction: [],
        avgResponseTime: null,
      };
    }

    try {
      const dateFilter = this.getDateFilter(timeRange);

      const [total, byType, byAction, responseTime] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) as count FROM notification_analytics
           WHERE user_id = $1 AND created_at >= $2`,
          [userId, dateFilter],
        ),
        pool.query(
          `SELECT event_type, COUNT(*) as count FROM notification_analytics
           WHERE user_id = $1 AND created_at >= $2
           GROUP BY event_type`,
          [userId, dateFilter],
        ),
        pool.query(
          `SELECT action_type, COUNT(*) as count FROM notification_analytics
           WHERE user_id = $1 AND event_type = 'click' AND created_at >= $2
           GROUP BY action_type`,
          [userId, dateFilter],
        ),
        pool.query(
          `SELECT
            AVG(EXTRACT(EPOCH FROM (na.created_at - n.created_at))) as avg_response_seconds
          FROM notification_analytics na
          JOIN notifications n ON na.notification_id = n.id
          WHERE na.user_id = $1 AND na.event_type = 'open' AND na.created_at >= $2`,
          [userId, dateFilter],
        ),
      ]);

      return {
        totalEvents: parseInt(total.rows[0].count),
        byType: byType.rows,
        byAction: byAction.rows,
        avgResponseTime: responseTime.rows[0].avg_response_seconds
          ? parseFloat(responseTime.rows[0].avg_response_seconds)
          : null,
      };
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return {
          totalEvents: 0,
          byType: [],
          byAction: [],
          avgResponseTime: null,
        };
      }

      logger.error('Error getting user engagement:', error);
      throw error;
    }
  }

  // Get notification performance metrics
  async getNotificationPerformance(timeRange = '30days') {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return {
        delivery: [],
        openRate: {
          total: 0,
          opened: 0,
          uniqueUsers: 0,
          rate: 0,
        },
        clickRate: {
          total: 0,
          clicked: 0,
          uniqueUsers: 0,
          rate: 0,
        },
        dismissRate: {
          total: 0,
          dismissed: 0,
          uniqueUsers: 0,
          rate: 0,
        },
      };
    }

    try {
      const dateFilter = this.getDateFilter(timeRange);

      const [deliveryStats, openRate, clickRate, dismissRate] = await Promise.all([
        pool.query(
          `SELECT
            channel,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
          FROM notification_analytics
          WHERE event_type = 'delivery' AND created_at >= $1
          GROUP BY channel`,
          [dateFilter],
        ),
        pool.query(
          `SELECT
            COUNT(DISTINCT n.id) as total_notifications,
            COUNT(DISTINCT na.notification_id) as opened_notifications,
            COUNT(DISTINCT na.user_id) as unique_users
          FROM notifications n
          LEFT JOIN notification_analytics na ON n.id = na.notification_id AND na.event_type = 'open'
          WHERE n.created_at >= $1`,
          [dateFilter],
        ),
        pool.query(
          `SELECT
            COUNT(DISTINCT n.id) as total_notifications,
            COUNT(DISTINCT na.notification_id) as clicked_notifications,
            COUNT(DISTINCT na.user_id) as unique_users
          FROM notifications n
          LEFT JOIN notification_analytics na ON n.id = na.notification_id AND na.event_type = 'click'
          WHERE n.created_at >= $1`,
          [dateFilter],
        ),
        pool.query(
          `SELECT
            COUNT(DISTINCT n.id) as total_notifications,
            COUNT(DISTINCT na.notification_id) as dismissed_notifications,
            COUNT(DISTINCT na.user_id) as unique_users
          FROM notifications n
          LEFT JOIN notification_analytics na ON n.id = na.notification_id AND na.event_type = 'dismiss'
          WHERE n.created_at >= $1`,
          [dateFilter],
        ),
      ]);

      return {
        delivery: deliveryStats.rows.map((row) => ({
          channel: row.channel,
          total: parseInt(row.total),
          delivered: parseInt(row.delivered),
          failed: parseInt(row.failed),
          deliveryRate:
            row.total > 0 ? ((parseInt(row.delivered) / parseInt(row.total)) * 100).toFixed(2) : 0,
        })),
        openRate: {
          total: parseInt(openRate.rows[0].total_notifications),
          opened: parseInt(openRate.rows[0].opened_notifications),
          uniqueUsers: parseInt(openRate.rows[0].unique_users),
          rate:
            openRate.rows[0].total_notifications > 0
              ? (
                (parseInt(openRate.rows[0].opened_notifications) /
                    parseInt(openRate.rows[0].total_notifications)) *
                  100
              ).toFixed(2)
              : 0,
        },
        clickRate: {
          total: parseInt(clickRate.rows[0].total_notifications),
          clicked: parseInt(clickRate.rows[0].clicked_notifications),
          uniqueUsers: parseInt(clickRate.rows[0].unique_users),
          rate:
            clickRate.rows[0].total_notifications > 0
              ? (
                (parseInt(clickRate.rows[0].clicked_notifications) /
                    parseInt(clickRate.rows[0].total_notifications)) *
                  100
              ).toFixed(2)
              : 0,
        },
        dismissRate: {
          total: parseInt(dismissRate.rows[0].total_notifications),
          dismissed: parseInt(dismissRate.rows[0].dismissed_notifications),
          uniqueUsers: parseInt(dismissRate.rows[0].unique_users),
          rate:
            dismissRate.rows[0].total_notifications > 0
              ? (
                (parseInt(dismissRate.rows[0].dismissed_notifications) /
                    parseInt(dismissRate.rows[0].total_notifications)) *
                  100
              ).toFixed(2)
              : 0,
        },
      };
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return {
          delivery: [],
          openRate: {
            total: 0,
            opened: 0,
            uniqueUsers: 0,
            rate: 0,
          },
          clickRate: {
            total: 0,
            clicked: 0,
            uniqueUsers: 0,
            rate: 0,
          },
          dismissRate: {
            total: 0,
            dismissed: 0,
            uniqueUsers: 0,
            rate: 0,
          },
        };
      }

      logger.error('Error getting notification performance:', error);
      throw error;
    }
  }

  // Get trending notification types
  async getTrendingTypes(timeRange = '7days', limit = 10) {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return [];
    }

    try {
      const dateFilter = this.getDateFilter(timeRange);

      const result = await pool.query(
        `SELECT
          n.type,
          n.category,
          COUNT(*) as count,
          COUNT(DISTINCT na.user_id) as engaged_users,
          AVG(CASE WHEN na.event_type = 'open' THEN 1 ELSE 0 END) as open_rate
        FROM notifications n
        LEFT JOIN notification_analytics na ON n.id = na.notification_id
        WHERE n.created_at >= $1
        GROUP BY n.type, n.category
        ORDER BY count DESC
        LIMIT $2`,
        [dateFilter, limit],
      );

      return result.rows.map((row) => ({
        type: row.type,
        category: row.category,
        count: parseInt(row.count),
        engagedUsers: parseInt(row.engaged_users),
        openRate: row.open_rate ? parseFloat(row.open_rate * 100).toFixed(2) : 0,
      }));
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return [];
      }

      logger.error('Error getting trending types:', error);
      throw error;
    }
  }

  // Get best send times
  async getBestSendTimes(userId = null, timeRange = '30days') {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return [];
    }

    try {
      const dateFilter = this.getDateFilter(timeRange);

      const query = userId
        ? `SELECT
            EXTRACT(HOUR FROM n.created_at) as hour,
            COUNT(*) as sent,
            COUNT(DISTINCT CASE WHEN na.event_type = 'open' THEN na.notification_id END) as opened,
            COUNT(DISTINCT CASE WHEN na.event_type = 'click' THEN na.notification_id END) as clicked
          FROM notifications n
          LEFT JOIN notification_analytics na ON n.id = na.notification_id AND na.user_id = $1
          WHERE n.created_at >= $2
          GROUP BY hour
          ORDER BY opened DESC`
        : `SELECT
            EXTRACT(HOUR FROM n.created_at) as hour,
            COUNT(*) as sent,
            COUNT(DISTINCT CASE WHEN na.event_type = 'open' THEN na.notification_id END) as opened,
            COUNT(DISTINCT CASE WHEN na.event_type = 'click' THEN na.notification_id END) as clicked
          FROM notifications n
          LEFT JOIN notification_analytics na ON n.id = na.notification_id
          WHERE n.created_at >= $1
          GROUP BY hour
          ORDER BY opened DESC`;

      const params = userId ? [userId, dateFilter] : [dateFilter];
      const result = await pool.query(query, params);

      return result.rows.map((row) => ({
        hour: parseInt(row.hour),
        sent: parseInt(row.sent),
        opened: parseInt(row.opened),
        clicked: parseInt(row.clicked),
        openRate: row.sent > 0 ? ((parseInt(row.opened) / parseInt(row.sent)) * 100).toFixed(2) : 0,
        clickRate:
          row.sent > 0 ? ((parseInt(row.clicked) / parseInt(row.sent)) * 100).toFixed(2) : 0,
      }));
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return [];
      }

      logger.error('Error getting best send times:', error);
      throw error;
    }
  }

  // Get notification funnel analysis
  async getFunnelAnalysis(timeRange = '30days') {
    const ready = await this.ensureAnalyticsReady();
    if (!ready) {
      return [];
    }

    try {
      const dateFilter = this.getDateFilter(timeRange);

      const result = await pool.query(
        `SELECT
          n.type,
          COUNT(DISTINCT n.id) as sent,
          COUNT(DISTINCT CASE WHEN na.event_type = 'delivery' AND na.status = 'delivered' THEN na.notification_id END) as delivered,
          COUNT(DISTINCT CASE WHEN na.event_type = 'open' THEN na.notification_id END) as opened,
          COUNT(DISTINCT CASE WHEN na.event_type = 'click' THEN na.notification_id END) as clicked,
          COUNT(DISTINCT CASE WHEN na.event_type = 'dismiss' THEN na.notification_id END) as dismissed
        FROM notifications n
        LEFT JOIN notification_analytics na ON n.id = na.notification_id
        WHERE n.created_at >= $1
        GROUP BY n.type`,
        [dateFilter],
      );

      return result.rows.map((row) => ({
        type: row.type,
        sent: parseInt(row.sent),
        delivered: parseInt(row.delivered),
        opened: parseInt(row.opened),
        clicked: parseInt(row.clicked),
        dismissed: parseInt(row.dismissed),
        deliveryRate:
          row.sent > 0 ? ((parseInt(row.delivered) / parseInt(row.sent)) * 100).toFixed(2) : 0,
        openRate: row.sent > 0 ? ((parseInt(row.opened) / parseInt(row.sent)) * 100).toFixed(2) : 0,
        clickRate:
          row.sent > 0 ? ((parseInt(row.clicked) / parseInt(row.sent)) * 100).toFixed(2) : 0,
        dismissRate:
          row.sent > 0 ? ((parseInt(row.dismissed) / parseInt(row.sent)) * 100).toFixed(2) : 0,
      }));
    } catch (error) {
      if (this.isAuthOrConfigError(error)) {
        this.markAnalyticsDisabled('db_auth_or_config', {
          code: error.code || 'DB_AUTH_CONFIG',
          message: error.message,
        });
        return [];
      }

      logger.error('Error getting funnel analysis:', error);
      throw error;
    }
  }

  // Helper method to get date filter
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

  // Create analytics table if not exists
  async initializeAnalyticsTable({ maxRetries = 2, baseDelayMs = 500 } = {}) {
    if (this.analyticsDisabledReason) {
      return false;
    }

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await pool.query(`
            CREATE TABLE IF NOT EXISTS notification_analytics (
              id SERIAL PRIMARY KEY,
              notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
              user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
              event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('delivery', 'open', 'click', 'dismiss', 'error')),
              channel VARCHAR(50),
              action_type VARCHAR(50),
              status VARCHAR(50),
              metadata JSONB,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
          `);

          // Create indexes
          await pool.query(
            'CREATE INDEX IF NOT EXISTS idx_notification_analytics_notification_id ON notification_analytics(notification_id)',
          );
          await pool.query(
            'CREATE INDEX IF NOT EXISTS idx_notification_analytics_user_id ON notification_analytics(user_id)',
          );
          await pool.query(
            'CREATE INDEX IF NOT EXISTS idx_notification_analytics_event_type ON notification_analytics(event_type)',
          );
          await pool.query(
            'CREATE INDEX IF NOT EXISTS idx_notification_analytics_created_at ON notification_analytics(created_at)',
          );

          this.analyticsReady = true;
          this.analyticsDisabledReason = null;
          logger.info('Notification analytics table initialized');
          return true;
        } catch (error) {
          if (this.isAuthOrConfigError(error)) {
            this.markAnalyticsDisabled('db_auth_or_config', {
              code: error.code || 'DB_AUTH_CONFIG',
              message: error.message,
            });
            return false;
          }

          const canRetry = isRetryableConnectionError(error?.code) && attempt < maxRetries;
          if (!canRetry) {
            logger.error('Error initializing analytics table:', error);
            this.analyticsReady = false;
            return false;
          }

          const delay = baseDelayMs * Math.pow(2, attempt);
          logger.warn('Transient DB error during analytics initialization, retrying', {
            attempt: attempt + 1,
            maxAttempts: maxRetries + 1,
            delay,
            code: error.code,
            message: error.message,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      this.analyticsReady = false;
      return false;
    } catch (error) {
      logger.error('Error initializing analytics table:', error);
      // Continue without analytics table if initialization fails
      this.analyticsReady = false;
      return false;
    }
  }
}

module.exports = new NotificationAnalytics();
