const pool = require('../db');

class UserSettings {
  constructor(settingsData) {
    this.id = settingsData?.id;
    this.userId = settingsData?.user_id || settingsData?.userId;
    this.category = settingsData?.category;
    this.settingsKey = settingsData?.settings_key || settingsData?.settingsKey;
    this.settingsValue = settingsData?.settings_value || settingsData?.settingsValue;
    this.valueType = settingsData?.value_type || settingsData?.valueType || 'string';
    this.isEncrypted = settingsData?.is_encrypted !== undefined ? settingsData.is_encrypted : false;
    this.createdAt = settingsData?.created_at || settingsData?.createdAt;
    this.updatedAt = settingsData?.updated_at || settingsData?.updatedAt;
  }

  // Get all settings for a user
  static async getAllByUserId(userId) {
    const result = await pool.query(
      'SELECT * FROM user_settings WHERE user_id = $1 ORDER BY category, settings_key',
      [userId]
    );
    return result.rows.map((row) => new UserSettings(row));
  }

  // Get settings by category for a user
  static async getByCategory(userId, category) {
    const result = await pool.query(
      'SELECT * FROM user_settings WHERE user_id = $1 AND category = $2 ORDER BY settings_key',
      [userId, category]
    );
    return result.rows.map((row) => new UserSettings(row));
  }

  // Get a specific setting
  static async getSetting(userId, category, settingsKey) {
    const result = await pool.query(
      'SELECT * FROM user_settings WHERE user_id = $1 AND category = $2 AND settings_key = $3',
      [userId, category, settingsKey]
    );
    return result.rows.length > 0 ? new UserSettings(result.rows[0]) : null;
  }

  // Get settings as a grouped object
  static async getGroupedSettings(userId) {
    const settings = await this.getAllByUserId(userId);
    const grouped = {
      general: {},
      profile: {},
      security: {},
      notification: {}
    };

    settings.forEach((setting) => {
      if (grouped[setting.category]) {
        grouped[setting.category][setting.settingsKey] = this.parseValue(
          setting.settingsValue,
          setting.valueType
        );
      }
    });

    return grouped;
  }

  // Parse value based on type
  static parseValue(value, type) {
    if (value === null || value === undefined) {
      return null;
    }

    switch (type) {
    case 'boolean':
      return value === 'true' || value === true;
    case 'number':
      return parseFloat(value);
    case 'json':
      try {
        return JSON.parse(value);
      } catch (e) {
        return value;
      }
    default:
      return value;
    }
  }

  // Convert value to string based on type
  static stringifyValue(value, type) {
    if (value === null || value === undefined) {
      return null;
    }

    switch (type) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return String(value);
    case 'json':
      return JSON.stringify(value);
    default:
      return String(value);
    }
  }

  // Create or update a setting
  async save() {
    const stringValue = UserSettings.stringifyValue(this.settingsValue, this.valueType);

    const result = await pool.query(
      `INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type, is_encrypted)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, category, settings_key)
       DO UPDATE SET
         settings_value = EXCLUDED.settings_value,
         value_type = EXCLUDED.value_type,
         is_encrypted = EXCLUDED.is_encrypted,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [this.userId, this.category, this.settingsKey, stringValue, this.valueType, this.isEncrypted]
    );

    return new UserSettings(result.rows[0]);
  }

  // Update multiple settings at once
  static async updateMultiple(userId, settings) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const results = [];
      for (const setting of settings) {
        const stringValue = this.stringifyValue(setting.value, setting.type || 'string');
        const result = await client.query(
          `INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type, is_encrypted)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, category, settings_key)
           DO UPDATE SET
             settings_value = EXCLUDED.settings_value,
             value_type = EXCLUDED.value_type,
             is_encrypted = EXCLUDED.is_encrypted,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [
            userId,
            setting.category,
            setting.key,
            stringValue,
            setting.type || 'string',
            setting.isEncrypted || false
          ]
        );
        results.push(new UserSettings(result.rows[0]));
      }

      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Delete a setting
  async delete() {
    const result = await pool.query('DELETE FROM user_settings WHERE id = $1 RETURNING *', [
      this.id
    ]);
    return result.rows.length > 0;
  }

  // Delete all settings for a user in a category
  static async deleteByCategory(userId, category) {
    const result = await pool.query(
      'DELETE FROM user_settings WHERE user_id = $1 AND category = $2 RETURNING *',
      [userId, category]
    );
    return result.rows.length;
  }

  // Get audit log for a user
  static async getAuditLog(userId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM settings_audit_log
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }

  // Get settings summary
  static async getSummary(userId) {
    const result = await pool.query('SELECT * FROM user_settings_summary WHERE user_id = $1', [
      userId
    ]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  // Reset settings to defaults for a category
  static async resetToDefaults(userId, category) {
    const defaults = this.getDefaultSettings(category);
    const settings = Object.entries(defaults).map(([key, value]) => ({
      category,
      key,
      value,
      type:
        typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string'
    }));

    return this.updateMultiple(userId, settings);
  }

  // Get default settings for each category
  static getDefaultSettings(category) {
    const defaults = {
      general: {
        language: 'en',
        timezone: 'Asia/Singapore',
        theme: 'light',
        date_format: 'YYYY-MM-DD',
        time_format: '24h'
      },
      profile: {
        display_name: '',
        bio: '',
        avatar_url: '',
        phone: '',
        address: ''
      },
      security: {
        two_factor_enabled: false,
        login_notifications: true,
        session_timeout: 30,
        password_expiry_days: 90,
        ip_whitelist_enabled: false
      },
      notification: {
        email_enabled: true,
        push_enabled: true,
        sms_enabled: false,
        digest_frequency: 'daily',
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00'
      }
    };

    return defaults[category] || {};
  }

  // Validate setting value
  static validateSetting(category, key, value, type) {
    const errors = [];

    // Type validation
    switch (type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${category}.${key} must be a boolean`);
      }
      break;
    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(`${category}.${key} must be a number`);
      }
      break;
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${category}.${key} must be a string`);
      }
      break;
    }

    // Category-specific validation
    if (category === 'general') {
      if (key === 'language' && !['en', 'es', 'fr', 'de', 'zh', 'ja'].includes(value)) {
        errors.push('Invalid language code');
      }
      if (key === 'theme' && !['light', 'dark', 'auto'].includes(value)) {
        errors.push('Invalid theme value');
      }
    }

    if (category === 'security') {
      if (key === 'session_timeout' && (value < 5 || value > 120)) {
        errors.push('Session timeout must be between 5 and 120 minutes');
      }
      if (key === 'password_expiry_days' && (value < 30 || value > 365)) {
        errors.push('Password expiry must be between 30 and 365 days');
      }
    }

    if (category === 'notification') {
      if (
        key === 'digest_frequency' &&
        !['immediate', 'hourly', 'daily', 'weekly'].includes(value)
      ) {
        errors.push('Invalid digest frequency');
      }
    }

    return errors;
  }
}

module.exports = UserSettings;
