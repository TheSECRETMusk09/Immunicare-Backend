/**
 * Settings Seeding Script
 * Populates default settings for all users
 */

const pool = require('./db');

async function seedSettings() {
  console.log('=== Seeding User Settings ===\n');

  // Get all users
  const usersResult = await pool.query('SELECT id, username FROM users');
  console.log(`Found ${usersResult.rows.length} users`);

  // Default settings to insert
  const defaultSettings = [
    // General settings
    { category: 'general', key: 'language', value: 'en', type: 'string' },
    { category: 'general', key: 'timezone', value: 'Asia/Singapore', type: 'string' },
    { category: 'general', key: 'theme', value: 'light', type: 'string' },
    { category: 'general', key: 'date_format', value: 'YYYY-MM-DD', type: 'string' },
    { category: 'general', key: 'time_format', value: '24h', type: 'string' },

    // Profile settings
    { category: 'profile', key: 'display_name', value: '', type: 'string' },
    { category: 'profile', key: 'bio', value: '', type: 'string' },
    { category: 'profile', key: 'email', value: '', type: 'string' },
    { category: 'profile', key: 'phone', value: '', type: 'string' },

    // Security settings
    { category: 'security', key: 'two_factor_enabled', value: 'false', type: 'boolean' },
    { category: 'security', key: 'login_notifications', value: 'true', type: 'boolean' },
    { category: 'security', key: 'session_timeout', value: '30', type: 'number' },
    { category: 'security', key: 'password_expiry_days', value: '90', type: 'number' },

    // Notification settings
    { category: 'notification', key: 'email_enabled', value: 'true', type: 'boolean' },
    { category: 'notification', key: 'push_enabled', value: 'true', type: 'boolean' },
    { category: 'notification', key: 'sms_enabled', value: 'false', type: 'boolean' },
    { category: 'notification', key: 'digest_frequency', value: 'daily', type: 'string' }
  ];

  let insertedCount = 0;

  for (const user of usersResult.rows) {
    console.log(`Processing user: ${user.username} (ID: ${user.id})`);

    for (const setting of defaultSettings) {
      try {
        await pool.query(
          `INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, category, settings_key) DO NOTHING`,
          [user.id, setting.category, setting.key, setting.value, setting.type]
        );
        insertedCount++;
      } catch (err) {
        console.error(`Error inserting setting ${setting.key}:`, err.message);
      }
    }
  }

  // Verify settings count
  const countResult = await pool.query('SELECT COUNT(*) as count FROM user_settings');
  console.log(`\nTotal user settings after seeding: ${countResult.rows[0].count}`);

  await pool.end();
  console.log('\n=== Seeding Complete ===');
}

seedSettings().catch((e) => {
  console.error(e);
  process.exit(1);
});
