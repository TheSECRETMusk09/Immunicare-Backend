const pool = require('../db');
const logger = require('../config/logger');

class NotificationPreferencesService {
  // Default preferences for new users
  static DEFAULT_PREFERENCES = {
    // Channel preferences
    channels: {
      inApp: true,
      email: true,
      sms: false,
      push: true
    },
    // Notification type preferences
    types: {
      appointment: {
        enabled: true,
        channels: ['inApp', 'email', 'push'],
        reminderDays: [1, 3, 7]
      },
      inventory: {
        enabled: true,
        channels: ['inApp', 'email'],
        lowStockThreshold: 10,
        expirationWarningDays: 30
      },
      system: {
        enabled: true,
        channels: ['inApp', 'email'],
        includeMaintenance: true,
        includeUpdates: true
      },
      compliance: {
        enabled: true,
        channels: ['inApp', 'email'],
        includeRegulatory: true,
        includeAudit: true
      },
      alerts: {
        enabled: true,
        channels: ['inApp', 'email', 'sms', 'push'],
        criticalOnly: false
      },
      reports: {
        enabled: true,
        channels: ['inApp', 'email'],
        dailySummary: false,
        weeklySummary: true,
        monthlySummary: false
      }
    },
    // Priority preferences
    priority: {
      critical: {
        enabled: true,
        sound: true,
        vibration: true,
        channels: ['inApp', 'email', 'sms', 'push']
      },
      high: {
        enabled: true,
        sound: true,
        vibration: true,
        channels: ['inApp', 'email', 'push']
      },
      medium: {
        enabled: true,
        sound: false,
        vibration: false,
        channels: ['inApp', 'email']
      },
      low: {
        enabled: true,
        sound: false,
        vibration: false,
        channels: ['inApp']
      }
    },
    // Quiet hours
    quietHours: {
      enabled: false,
      startTime: '22:00',
      endTime: '08:00',
      allowCritical: true,
      timezone: 'UTC'
    },
    // Do not disturb
    doNotDisturb: {
      enabled: false,
      until: null,
      allowCritical: true
    },
    // Frequency limits
    frequencyLimits: {
      maxPerHour: 10,
      maxPerDay: 50,
      cooldownMinutes: 5
    }
  };

  // Get user preferences
  async getUserPreferences(userId) {
    try {
      const result = await pool.query(
        'SELECT preferences FROM user_notification_preferences WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        // Return default preferences
        return { ...NotificationPreferencesService.DEFAULT_PREFERENCES };
      }

      // Merge with defaults to ensure all fields exist
      const userPrefs = result.rows[0].preferences || {};
      return this.mergePreferences(NotificationPreferencesService.DEFAULT_PREFERENCES, userPrefs);
    } catch (error) {
      logger.error('Error getting user preferences:', error);
      throw error;
    }
  }

  // Update user preferences
  async updateUserPreferences(userId, preferences) {
    try {
      const currentPrefs = await this.getUserPreferences(userId);
      const mergedPrefs = this.mergePreferences(currentPrefs, preferences);

      const result = await pool.query(
        `INSERT INTO user_notification_preferences (user_id, preferences, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id)
         DO UPDATE SET
           preferences = EXCLUDED.preferences,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [userId, JSON.stringify(mergedPrefs)]
      );

      logger.info(`Updated preferences for user ${userId}`);
      return result.rows[0].preferences;
    } catch (error) {
      logger.error('Error updating user preferences:', error);
      throw error;
    }
  }

  // Check if notification should be sent based on preferences
  async shouldSendNotification(userId, notification) {
    try {
      const prefs = await this.getUserPreferences(userId);

      // Check do not disturb
      if (prefs.doNotDisturb.enabled) {
        const until = prefs.doNotDisturb.until ? new Date(prefs.doNotDisturb.until) : null;
        if (until && until > new Date()) {
          // Allow critical notifications if configured
          if (!prefs.doNotDisturb.allowCritical || notification.priority < 4) {
            return { allowed: false, reason: 'do_not_disturb' };
          }
        }
      }

      // Check quiet hours
      if (prefs.quietHours.enabled) {
        const now = new Date();
        const currentTime = this.getCurrentTimeInTimezone(now, prefs.quietHours.timezone);

        if (this.isInQuietHours(currentTime, prefs.quietHours)) {
          // Allow critical notifications if configured
          if (!prefs.quietHours.allowCritical || notification.priority < 4) {
            return { allowed: false, reason: 'quiet_hours' };
          }
        }
      }

      // Check notification type preferences
      const typePrefs = prefs.types[notification.type] || prefs.types.system;
      if (!typePrefs.enabled) {
        return { allowed: false, reason: 'type_disabled' };
      }

      // Check priority preferences
      const priorityKey = this.getPriorityKey(notification.priority);
      const priorityPrefs = prefs.priority[priorityKey];
      if (!priorityPrefs.enabled) {
        return { allowed: false, reason: 'priority_disabled' };
      }

      // Determine allowed channels
      const allowedChannels = new Set([...typePrefs.channels, ...priorityPrefs.channels]);

      // Filter by enabled channels
      const enabledChannels = Object.entries(prefs.channels)
        .filter(([_, enabled]) => enabled)
        .map(([channel, _]) => channel);

      const finalChannels = [...allowedChannels].filter((c) => enabledChannels.includes(c));

      return {
        allowed: finalChannels.length > 0,
        channels: finalChannels,
        sound: priorityPrefs.sound,
        vibration: priorityPrefs.vibration
      };
    } catch (error) {
      logger.error('Error checking notification preferences:', error);
      // Default to allowing notification on error
      return { allowed: true, channels: ['inApp'] };
    }
  }

  // Get notification frequency for user
  async getNotificationFrequency(userId, timeRange = '1hour') {
    try {
      const dateFilter = this.getDateFilter(timeRange);

      const result = await pool.query(
        `SELECT COUNT(*) as count FROM notifications
         WHERE user_id = $1 AND created_at >= $2`,
        [userId, dateFilter]
      );

      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error('Error getting notification frequency:', error);
      return 0;
    }
  }

  // Check if user has exceeded frequency limits
  async checkFrequencyLimits(userId) {
    try {
      const prefs = await this.getUserPreferences(userId);
      const limits = prefs.frequencyLimits;

      const [hourlyCount, dailyCount] = await Promise.all([
        this.getNotificationFrequency(userId, '1hour'),
        this.getNotificationFrequency(userId, '1day')
      ]);

      if (hourlyCount >= limits.maxPerHour) {
        return {
          allowed: false,
          reason: 'hourly_limit_exceeded',
          count: hourlyCount,
          limit: limits.maxPerHour
        };
      }

      if (dailyCount >= limits.maxPerDay) {
        return {
          allowed: false,
          reason: 'daily_limit_exceeded',
          count: dailyCount,
          limit: limits.maxPerDay
        };
      }

      return { allowed: true, hourlyCount, dailyCount };
    } catch (error) {
      logger.error('Error checking frequency limits:', error);
      return { allowed: true };
    }
  }

  // Get user's notification summary
  async getUserSummary(userId) {
    try {
      const [prefs, stats] = await Promise.all([
        this.getUserPreferences(userId),
        pool.query(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN is_read = FALSE THEN 1 ELSE 0 END) as unread,
            SUM(CASE WHEN priority >= 4 THEN 1 ELSE 0 END) as critical,
            SUM(CASE WHEN priority >= 2 AND priority < 4 THEN 1 ELSE 0 END) as high,
            SUM(CASE WHEN priority < 2 THEN 1 ELSE 0 END) as normal
          FROM notifications
          WHERE user_id = $1`,
          [userId]
        )
      ]);

      return {
        preferences: prefs,
        stats: {
          total: parseInt(stats.rows[0].total),
          unread: parseInt(stats.rows[0].unread),
          critical: parseInt(stats.rows[0].critical),
          high: parseInt(stats.rows[0].high),
          normal: parseInt(stats.rows[0].normal)
        }
      };
    } catch (error) {
      logger.error('Error getting user summary:', error);
      throw error;
    }
  }

  // Reset user preferences to defaults
  async resetToDefaults(userId) {
    try {
      await pool.query('DELETE FROM user_notification_preferences WHERE user_id = $1', [userId]);

      logger.info(`Reset preferences to defaults for user ${userId}`);
      return NotificationPreferencesService.DEFAULT_PREFERENCES;
    } catch (error) {
      logger.error('Error resetting user preferences:', error);
      throw error;
    }
  }

  // Enable/disable do not disturb
  async setDoNotDisturb(userId, enabled, durationMinutes = null) {
    try {
      const prefs = await this.getUserPreferences(userId);

      prefs.doNotDisturb.enabled = enabled;
      if (enabled && durationMinutes) {
        const until = new Date();
        until.setMinutes(until.getMinutes() + durationMinutes);
        prefs.doNotDisturb.until = until.toISOString();
      } else {
        prefs.doNotDisturb.until = null;
      }

      return await this.updateUserPreferences(userId, prefs);
    } catch (error) {
      logger.error('Error setting do not disturb:', error);
      throw error;
    }
  }

  // Update quiet hours
  async updateQuietHours(userId, quietHours) {
    try {
      const prefs = await this.getUserPreferences(userId);
      prefs.quietHours = { ...prefs.quietHours, ...quietHours };
      return await this.updateUserPreferences(userId, prefs);
    } catch (error) {
      logger.error('Error updating quiet hours:', error);
      throw error;
    }
  }

  // Merge preferences with defaults
  mergePreferences(defaults, userPrefs) {
    const merged = JSON.parse(JSON.stringify(defaults));

    const deepMerge = (target, source) => {
      for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key]) {
            target[key] = {};
          }
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    };

    deepMerge(merged, userPrefs);
    return merged;
  }

  // Get priority key from numeric value
  getPriorityKey(priority) {
    if (priority >= 4) {
      return 'critical';
    }
    if (priority >= 3) {
      return 'high';
    }
    if (priority >= 2) {
      return 'medium';
    }
    return 'low';
  }

  // Get current time in timezone
  getCurrentTimeInTimezone(date, timezone) {
    try {
      const options = { timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false };
      const timeStr = date.toLocaleTimeString('en-US', options);
      const [hours, minutes] = timeStr.split(':').map(Number);
      return { hours, minutes };
    } catch (error) {
      // Fallback to UTC if timezone is invalid
      return { hours: date.getUTCHours(), minutes: date.getUTCMinutes() };
    }
  }

  // Check if current time is in quiet hours
  isInQuietHours(currentTime, quietHours) {
    const currentMinutes = currentTime.hours * 60 + currentTime.minutes;

    const [startHours, startMins] = quietHours.startTime.split(':').map(Number);
    const [endHours, endMins] = quietHours.endTime.split(':').map(Number);

    const startTotalMinutes = startHours * 60 + startMins;
    const endTotalMinutes = endHours * 60 + endMins;

    if (startTotalMinutes < endTotalMinutes) {
      // Same day range (e.g., 22:00 - 08:00 is not possible)
      return currentMinutes >= startTotalMinutes && currentMinutes < endTotalMinutes;
    } else {
      // Overnight range (e.g., 22:00 - 08:00)
      return currentMinutes >= startTotalMinutes || currentMinutes < endTotalMinutes;
    }
  }

  // Get date filter for time range
  getDateFilter(timeRange) {
    const now = new Date();
    switch (timeRange) {
    case '1hour':
      return new Date(now.getTime() - 60 * 60 * 1000);
    case '1day':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '1week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 60 * 60 * 1000);
    }
  }

  // Initialize preferences table
  async initializePreferencesTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_notification_preferences (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
          preferences JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create index
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id ON user_notification_preferences(user_id)'
      );

      logger.info('User notification preferences table initialized');
    } catch (error) {
      logger.error('Error initializing preferences table:', error);
      // Continue without preferences table if initialization fails
    }
  }
}

module.exports = new NotificationPreferencesService();
