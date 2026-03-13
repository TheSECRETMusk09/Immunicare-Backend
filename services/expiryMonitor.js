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

const NON_FATAL_DB_SCHEMA_ERROR_CODES = new Set(['42P01', '42703']);

const DEFAULT_EXPIRY_MONITOR_CONFIG = Object.freeze({
  expiry_alert_enabled: true,
  expiry_warning_days: 30,
  expiry_alert_recipients: [],
});

const isFatalDbConfigError = (code) => FATAL_DB_CONFIG_ERROR_CODES.has(code);
const isMissingDbObjectError = (code) => NON_FATAL_DB_SCHEMA_ERROR_CODES.has(code);

class ExpiryMonitor {
  constructor() {
    this.checkInterval = null;
    this.intervalHours = 24; // Check once daily
    this.dbUnavailable = false;
    this.systemConfigMissingWarned = false;
    this.expiryDataSchemaMissingWarned = false;
    this.expiryDataSchema = null;
    this.expiryDataSchemaPromise = null;
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

  warnOnce(flagName, message) {
    if (this[flagName]) {
      return;
    }

    this[flagName] = true;
    console.warn(message);
  }

  async getSystemConfig() {
    const config = { ...DEFAULT_EXPIRY_MONITOR_CONFIG };

    try {
      const configResult = await pool.query(
        `SELECT config_key, config_value::text
         FROM system_config
         WHERE config_key IN ('expiry_alert_enabled', 'expiry_warning_days', 'expiry_alert_recipients')`,
      );

      configResult.rows.forEach((row) => {
        try {
          config[row.config_key] = JSON.parse(row.config_value);
        } catch {
          config[row.config_key] = row.config_value;
        }
      });

      return config;
    } catch (error) {
      if (isMissingDbObjectError(error?.code)) {
        this.warnOnce(
          'systemConfigMissingWarned',
          'system_config table is unavailable; using default expiry monitor settings',
        );
        return config;
      }

      throw error;
    }
  }

  async resolveExpiryDataSchema() {
    if (this.expiryDataSchema) {
      return this.expiryDataSchema;
    }

    if (!this.expiryDataSchemaPromise) {
      this.expiryDataSchemaPromise = Promise.all([
        pool.query(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'vaccine_batches'`,
        ),
        pool.query(
          `SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN ('clinics', 'healthcare_facilities')`,
        ),
      ])
        .then(([batchColumnsResult, facilityTablesResult]) => {
          const batchColumns = new Set(batchColumnsResult.rows.map((row) => row.column_name));
          const facilityTables = new Set(
            facilityTablesResult.rows.map((row) => row.table_name),
          );

          const scopeColumn = batchColumns.has('clinic_id')
            ? 'clinic_id'
            : batchColumns.has('facility_id')
              ? 'facility_id'
              : null;

          const facilityTable =
            scopeColumn === 'facility_id'
              ? facilityTables.has('healthcare_facilities')
                ? 'healthcare_facilities'
                : facilityTables.has('clinics')
                  ? 'clinics'
                  : null
              : facilityTables.has('clinics')
                ? 'clinics'
                : facilityTables.has('healthcare_facilities')
                  ? 'healthcare_facilities'
                  : null;

          const resolvedSchema =
            scopeColumn && facilityTable ? { scopeColumn, facilityTable } : null;

          this.expiryDataSchema = resolvedSchema;
          return resolvedSchema;
        })
        .finally(() => {
          this.expiryDataSchemaPromise = null;
        });
    }

    return this.expiryDataSchemaPromise;
  }

  async getAlertRecipients(configRecipients = []) {
    const recipients = [];
    const addRecipient = (value) => {
      const normalizedValue = String(value || '').trim();
      if (normalizedValue && !recipients.includes(normalizedValue)) {
        recipients.push(normalizedValue);
      }
    };

    const adminQueries = [
      `SELECT contact AS phone
       FROM users
       WHERE role_id = (SELECT id FROM roles WHERE name = 'admin')
         AND is_active = true
         AND contact IS NOT NULL
         AND TRIM(contact) <> ''
       LIMIT 5`,
      `SELECT contact AS phone
       FROM admin
       WHERE is_active = true
         AND contact IS NOT NULL
         AND TRIM(contact) <> ''
       LIMIT 5`,
    ];

    for (const adminQuery of adminQueries) {
      try {
        const adminResult = await pool.query(adminQuery);
        adminResult.rows.forEach((row) => addRecipient(row.phone));

        if (recipients.length > 0) {
          break;
        }
      } catch (error) {
        if (isMissingDbObjectError(error?.code)) {
          continue;
        }

        throw error;
      }
    }

    if (Array.isArray(configRecipients)) {
      configRecipients.forEach((recipient) => addRecipient(recipient));
    } else if (typeof configRecipients === 'string' && configRecipients.includes(',')) {
      configRecipients.split(',').forEach((recipient) => addRecipient(recipient));
    } else {
      addRecipient(configRecipients);
    }

    return recipients;
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

      const config = await this.getSystemConfig();

      // Check if expiry alerts are enabled
      if (config.expiry_alert_enabled === false) {
        console.log('Expiry alerts are disabled');
        return;
      }

      const warningDays = Number.parseInt(config.expiry_warning_days, 10);
      const normalizedWarningDays = Number.isFinite(warningDays) && warningDays > 0 ? warningDays : 30;
      const dataSchema = await this.resolveExpiryDataSchema();

      if (!dataSchema) {
        this.warnOnce(
          'expiryDataSchemaMissingWarned',
          'Expiry monitor could not resolve vaccine batch facility schema; skipping expiry alert query',
        );
        await this.markExpiredBatches();
        return;
      }

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
                    vb.${dataSchema.scopeColumn} as clinic_id,
                    f.name as clinic_name,
                    (vb.expiry_date - CURRENT_DATE)::integer as days_until_expiry
                FROM vaccine_batches vb
                JOIN vaccines v ON vb.vaccine_id = v.id
                JOIN ${dataSchema.facilityTable} f ON vb.${dataSchema.scopeColumn} = f.id
                WHERE vb.expiry_date <= CURRENT_DATE + ($1::integer * INTERVAL '1 day')
                AND vb.expiry_date > CURRENT_DATE
                AND vb.qty_current > 0
                AND vb.status = 'active'
                AND vb.is_active = true
                ORDER BY vb.expiry_date ASC
            `;

      const expiringResult = await pool.query(expiringQuery, [normalizedWarningDays]);

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
          await this.sendExpiryAlert('CRITICAL', critical, config);
        }
        if (warning.length > 0) {
          await this.sendExpiryAlert('WARNING', warning, config);
        }
        if (notice.length > 0) {
          await this.sendExpiryAlert('NOTICE', notice, config);
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
  async sendExpiryAlert(alertType, items, config = null) {
    if (this.dbUnavailable) {
      return;
    }

    try {
      const resolvedConfig = config || (await this.getSystemConfig());
      const recipients = await this.getAlertRecipients(resolvedConfig.expiry_alert_recipients);

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
