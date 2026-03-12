/**
 * Expiry Monitor Service
 * Monitors vaccine batch expiry dates and sends SMS alerts
 */

const pool = require('../db');
const smsService = require('./smsService');

const FATAL_DB_CONFIG_ERROR_CODES = new Set([
  '28P01',
  '28000',
  '3D000',
  '3F000',
  '42501',
]);

const isFatalDbConfigError = (code) => FATAL_DB_CONFIG_ERROR_CODES.has(code);

class ExpiryMonitor {
  constructor() {
    this.checkInterval = null;
    this.intervalHours = 24; // Check once daily
    this.dbUnavailable = false;
  }

  /**
   * Start the expiry monitoring job
   */
  start() {
    console.log('Starting Expiry Monitor...');
    this.checkExpiringVaccines();

    // Set up periodic checking (daily)
    this.checkInterval = setInterval(
      () => {
        this.checkExpiringVaccines();
      },
      this.intervalHours * 60 * 60 * 1000,
    );
  }

  /**
   * Stop the monitoring job
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('Expiry Monitor stopped');
    }
  }

  /**
   * Check for expiring vaccines
   */
  async checkExpiringVaccines() {
    if (this.dbUnavailable) {
      console.warn('Skipping expiry monitor check due to DB authentication/configuration error');
      return;
    }

    try {
      console.log('Checking for expiring vaccines...');

      // Get system config for alert settings
      const configQuery = `
                SELECT config_key, config_value::text
                FROM system_config
                WHERE config_key IN ('expiry_alert_enabled', 'expiry_warning_days', 'expiry_alert_recipients')
            `;
      const configResult = await pool.query(configQuery);

      const config = {};
      configResult.rows.forEach((row) => {
        try {
          config[row.config_key] = JSON.parse(row.config_value);
        } catch {
          config[row.config_key] = row.config_value;
        }
      });

      // Check if expiry alerts are enabled
      if (config.expiry_alert_enabled === false) {
        console.log('Expiry alerts are disabled');
        return;
      }

      const warningDays = config.expiry_warning_days || 30;

      // Get vaccines expiring within warning period
      const expiringQuery = `
                SELECT
                    vb.id as batch_id,
                    vb.vaccine_id,
                    v.name as vaccine_name,
                    v.code as vaccine_code,
                    vb.lot_no,
                    vb.expiry_date,
                    vb.qty_current,
                    vb.clinic_id,
                    c.name as clinic_name,
                    (vb.expiry_date - CURRENT_DATE)::integer as days_until_expiry
                FROM vaccine_batches vb
                JOIN vaccines v ON vb.vaccine_id = v.id
                JOIN clinics c ON vb.clinic_id = c.id
                WHERE vb.expiry_date <= CURRENT_DATE + INTERVAL '${warningDays} days'
                AND vb.expiry_date > CURRENT_DATE
                AND vb.qty_current > 0
                AND vb.status = 'active'
                AND vb.is_active = true
                ORDER BY vb.expiry_date ASC
            `;

      const expiringResult = await pool.query(expiringQuery);

      if (expiringResult.rows.length > 0) {
        console.log(`Found ${expiringResult.rows.length} vaccine batches expiring soon`);

        // Group by expiry period
        const critical = expiringResult.rows.filter((r) => r.days_until_expiry <= 7);
        const warning = expiringResult.rows.filter(
          (r) => r.days_until_expiry > 7 && r.days_until_expiry <= 14,
        );
        const notice = expiringResult.rows.filter((r) => r.days_until_expiry > 14);

        // Send appropriate alerts
        if (critical.length > 0) {
          await this.sendExpiryAlert('CRITICAL', critical);
        }
        if (warning.length > 0) {
          await this.sendExpiryAlert('WARNING', warning);
        }
        if (notice.length > 0) {
          await this.sendExpiryAlert('NOTICE', notice);
        }
      }

      // Check for expired batches
      await this.markExpiredBatches();
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        this.dbUnavailable = true;
        console.error('Disabling expiry monitor DB operations for this process due to authentication/configuration error:', error.message);
        return;
      }

      console.error('Error checking expiring vaccines:', error);
    }
  }

  /**
   * Mark expired batches
   */
  async markExpiredBatches() {
    if (this.dbUnavailable) {
      return;
    }

    try {
      const updateQuery = `
                UPDATE vaccine_batches
                SET status = 'expired', updated_at = CURRENT_TIMESTAMP
                WHERE expiry_date <= CURRENT_DATE
                AND status = 'active'
                AND qty_current > 0
            `;

      const result = await pool.query(updateQuery);

      if (result.rowCount > 0) {
        console.log(`Marked ${result.rowCount} batches as expired`);
      }
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        this.dbUnavailable = true;
        console.error('Disabling expiry monitor DB operations for this process due to authentication/configuration error:', error.message);
        return;
      }

      console.error('Error marking expired batches:', error);
    }
  }

  /**
   * Send expiry alert SMS
   */
  async sendExpiryAlert(alertType, items) {
    if (this.dbUnavailable) {
      return;
    }

    try {
      const recipients = [];

      // Get admin recipients
      const adminQuery = `
                SELECT contact FROM users
                WHERE role_id = (SELECT id FROM roles WHERE name = 'admin')
                AND is_active = true
                LIMIT 5
            `;
      const adminResult = await pool.query(adminQuery);

      adminResult.rows.forEach((row) => {
        if (row.phone) {
          recipients.push(row.phone);
        }
      });

      // Also get from config
      const configQuery = `
                SELECT config_value::text as recipients
                FROM system_config
                WHERE config_key = 'expiry_alert_recipients'
            `;
      const configResult = await pool.query(configQuery);

      if (configResult.rows.length > 0) {
        try {
          const configRecipients = JSON.parse(configResult.rows[0].recipients);
          configRecipients.forEach((r) => {
            if (!recipients.includes(r)) {
              recipients.push(r);
            }
          });
        } catch {
          // Ignore parse errors for recipients
        }
      }

      if (recipients.length === 0) {
        console.log('No expiry alert recipients configured');
        return;
      }

      const urgencyPrefix =
        alertType === 'CRITICAL' ? '🚨 ' : alertType === 'WARNING' ? '⚠️ ' : '📅 ';

      const urgencyText =
        alertType === 'CRITICAL'
          ? 'EXPIRY ALERT - IMMEDIATE ACTION REQUIRED'
          : alertType === 'WARNING'
            ? 'EXPIRY WARNING'
            : 'EXPIRY NOTICE';

      const itemList = items
        .map(
          (item) =>
            `- ${item.vaccine_name} (Lot: ${item.lot_no}): ${item.days_until_expiry} days (${item.expiry_date}), qty: ${item.qty_current}`,
        )
        .join('\n');

      const message =
        `${urgencyPrefix}${urgencyText}\n\n` +
        'The following vaccines are expiring soon:\n\n' +
        `${itemList}\n\n` +
        'Please use these vaccines before expiry or arrange for proper disposal.';

      // Send to all recipients
      for (const phoneNumber of recipients) {
        const formattedPhone = smsService.formatPhoneNumber(phoneNumber);

        if (!formattedPhone) {
          continue;
        }

        try {
          await smsService.sendSMS(formattedPhone, message, 'expiry_alert', {
            alertType: alertType,
            vaccineCount: items.length,
          });

          console.log(`Expiry alert (${alertType}) sent to ${formattedPhone}`);
        } catch (error) {
          console.error(`Failed to send expiry alert to ${formattedPhone}:`, error);
        }
      }
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        this.dbUnavailable = true;
        console.error('Disabling expiry monitor DB operations for this process due to authentication/configuration error:', error.message);
        return;
      }

      console.error('Error sending expiry alert:', error);
    }
  }

  /**
   * Get expiring vaccines summary
   */
  async getExpiringSummary() {
    if (this.dbUnavailable) {
      return [];
    }

    const query = `
            SELECT
                CASE
                    WHEN (expiry_date - CURRENT_DATE)::integer <= 7 THEN 'critical'
                    WHEN (expiry_date - CURRENT_DATE)::integer <= 14 THEN 'warning'
                    WHEN (expiry_date - CURRENT_DATE)::integer <= 30 THEN 'notice'
                END as alert_type,
                COUNT(*) as count,
                SUM(qty_current) as total_quantity
            FROM vaccine_batches
            WHERE expiry_date <= CURRENT_DATE + INTERVAL '30 days'
            AND expiry_date > CURRENT_DATE
            AND qty_current > 0
            AND status = 'active'
            GROUP BY alert_type
        `;

    try {
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        this.dbUnavailable = true;
        console.error('Disabling expiry monitor DB operations for this process due to authentication/configuration error:', error.message);
        return [];
      }
      throw error;
    }
  }

  /**
   * Manual trigger for expiry check
   */
  async manualCheck() {
    console.log('Manual expiry check triggered');
    await this.checkExpiringVaccines();
  }
}

// Export singleton instance
module.exports = new ExpiryMonitor();
