/**
 * Critical Stock Monitor Service
 * Canonical schema aligned (admin/healthcare_facilities/facility_id)
 * Handles low/critical stock synchronization + alert surfacing.
 */

const pool = require('../db');
const smsService = require('./smsService');
const socketService = require('./socketService');

const FATAL_DB_CONFIG_ERROR_CODES = new Set([
  '28P01',
  '28000',
  '3D000',
  '3F000',
  '42501',
]);

const isFatalDbConfigError = (code) => FATAL_DB_CONFIG_ERROR_CODES.has(code);

class CriticalStockMonitor {
  constructor() {
    this.checkInterval = null;
    this.intervalMinutes = 15;
    this.dbUnavailable = false;
  }

  start() {
    console.log('Starting Critical Stock Monitor...');
    this.checkStockLevels();

    this.checkInterval = setInterval(() => {
      this.checkStockLevels();
    }, this.intervalMinutes * 60 * 1000);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('Critical Stock Monitor stopped');
    }
  }

  async getSystemConfig() {
    const configQuery = `
      SELECT config_key, config_value::text
      FROM system_config
      WHERE config_key IN (
        'critical_alert_sms_enabled',
        'critical_alert_recipients',
        'low_stock_alert_enabled'
      )
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

    return config;
  }

  // Helper to determine the correct facility column name for vaccine_stock_alerts table
  async getStockAlertsFacilityColumn() {
    const resolveFirstExistingColumn = async (tableName, candidateColumns, fallback = candidateColumns[0]) => {
      const cacheKey = `${tableName}:${candidateColumns.join(',')}`;
      // Simple cache implementation for this service
      if (global.stockAlertsColumnCache && global.stockAlertsColumnCache.has(cacheKey)) {
        return global.stockAlertsColumnCache.get(cacheKey);
      }

      try {
        const result = await pool.query(
          `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = ANY($2::text[])
          `,
          [tableName, candidateColumns],
        );

        const availableColumns = new Set(result.rows.map((row) => row.column_name));
        const resolvedColumn =
          candidateColumns.find((columnName) => availableColumns.has(columnName)) ||
          fallback;

        // Initialize cache if needed
        if (!global.stockAlertsColumnCache) {
          global.stockAlertsColumnCache = new Map();
        }
        global.stockAlertsColumnCache.set(cacheKey, resolvedColumn);
        return resolvedColumn;
      } catch (_error) {
        // Initialize cache if needed
        if (!global.stockAlertsColumnCache) {
          global.stockAlertsColumnCache = new Map();
        }
        global.stockAlertsColumnCache.set(cacheKey, fallback);
        return fallback;
      }
    };

    return resolveFirstExistingColumn('vaccine_stock_alerts', ['clinic_id', 'facility_id'], 'clinic_id');
  }

  async synchronizeStockFlagsAndAlerts() {
    await pool.query('BEGIN');

    try {
      const inventoryRows = await pool.query(
        `
          SELECT
            vi.id,
            vi.vaccine_id,
            vi.clinic_id,
            vi.beginning_balance,
            vi.received_during_period,
            vi.transferred_in,
            vi.transferred_out,
            vi.expired_wasted,
            vi.issuance,
            vi.low_stock_threshold,
            vi.critical_stock_threshold,
            vi.is_low_stock,
            vi.is_critical_stock,
            v.name AS vaccine_name,
            hf.name AS facility_name
          FROM vaccine_inventory vi
          JOIN vaccines v ON v.id = vi.vaccine_id
          JOIN clinics hf ON hf.id = vi.clinic_id
        `,
      );

      const stockAlertsFacilityColumn = await this.getStockAlertsFacilityColumn();
      const criticalItems = [];
      const lowItems = [];

      for (const row of inventoryRows.rows) {
        const stockOnHand =
          Number(row.beginning_balance || 0) +
          Number(row.received_during_period || 0) +
          Number(row.transferred_in || 0) -
          Number(row.transferred_out || 0) -
          Number(row.expired_wasted || 0) -
          Number(row.issuance || 0);

        const lowThreshold = Number(row.low_stock_threshold || 10);
        const criticalThreshold = Number(row.critical_stock_threshold || 5);
        const isCritical = stockOnHand <= criticalThreshold;
        const isLow = stockOnHand <= lowThreshold;

        if (Boolean(row.is_low_stock) !== isLow || Boolean(row.is_critical_stock) !== isCritical) {
          await pool.query(
            `
              UPDATE vaccine_inventory
              SET is_low_stock = $1,
                  is_critical_stock = $2,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $3
            `,
            [isLow, isCritical, row.id],
          );
        }

        const alertType = isCritical ? 'CRITICAL_STOCK' : isLow ? 'LOW_STOCK' : null;

        if (alertType) {
          const thresholdValue = isCritical ? criticalThreshold : lowThreshold;
          const priority = isCritical ? 'URGENT' : 'HIGH';

          const existing = await pool.query(
            `
              SELECT id
              FROM vaccine_stock_alerts
              WHERE vaccine_inventory_id = $1
                AND status = 'ACTIVE'
                AND alert_type = $2
              LIMIT 1
            `,
            [row.id, alertType],
          );

          if (existing.rows.length === 0) {
            await pool.query(
              `
                INSERT INTO vaccine_stock_alerts (
                  vaccine_inventory_id,
                  vaccine_id,
                  ${stockAlertsFacilityColumn},
                  alert_type,
                  current_stock,
                  threshold_value,
                  status,
                  message,
                  priority
                ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $8)
              `,
              [
                row.id,
                row.vaccine_id,
                row.clinic_id,
                alertType,
                stockOnHand,
                thresholdValue,
                `${row.vaccine_name} at ${row.facility_name} is ${alertType === 'CRITICAL_STOCK' ? 'critical' : 'low'}: ${stockOnHand} remaining.`,
                priority,
              ],
            );
          } else {
            await pool.query(
              `
                UPDATE vaccine_stock_alerts
                SET current_stock = $1,
                    threshold_value = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
              `,
              [stockOnHand, thresholdValue, existing.rows[0].id],
            );
          }

          if (isCritical) {
            criticalItems.push({
              ...row,
              stock_on_hand: stockOnHand,
              critical_stock_threshold: criticalThreshold,
            });
          } else {
            lowItems.push({
              ...row,
              stock_on_hand: stockOnHand,
              low_stock_threshold: lowThreshold,
            });
          }
        } else {
          await pool.query(
            `
              UPDATE vaccine_stock_alerts
              SET status = 'RESOLVED',
                  resolved_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP,
                  resolution_notes = COALESCE(resolution_notes, 'Auto-resolved by stock monitor')
              WHERE vaccine_inventory_id = $1
                AND status = 'ACTIVE'
            `,
            [row.id],
          );
        }
      }

      await pool.query('COMMIT');
      return { criticalItems, lowItems };
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  async getFallbackAdminPhones() {
    const adminQuery = `
      SELECT contact AS phone
      FROM admin
      WHERE is_active = true
        AND contact IS NOT NULL
        AND TRIM(contact) <> ''
      LIMIT 5
    `;
    const adminResult = await pool.query(adminQuery);
    return adminResult.rows.map((row) => row.phone).filter(Boolean);
  }

  async notifyDashboardStreams(criticalItems, lowItems) {
    const total = criticalItems.length + lowItems.length;
    if (total === 0) {
      return;
    }

    socketService.sendToRole('SYSTEM_ADMIN', 'alert', {
      alert: {
        type: 'inventory_stock_monitor',
        severity: criticalItems.length > 0 ? 'critical' : 'warning',
        message: `${criticalItems.length} critical and ${lowItems.length} low stock inventory alerts synchronized.`,
        currentValue: total,
      },
    });
  }

  async sendCriticalSmsAlerts(config, criticalItems) {
    if (criticalItems.length === 0) {
      return;
    }

    if (config.critical_alert_sms_enabled === false) {
      console.log('Critical stock SMS alerts are disabled');
      return;
    }

    let recipients = Array.isArray(config.critical_alert_recipients)
      ? config.critical_alert_recipients
      : [];

    if (recipients.length === 0) {
      recipients = await this.getFallbackAdminPhones();
    }

    for (const recipient of recipients) {
      await this.sendCriticalAlert(recipient, criticalItems);
    }
  }

  async checkStockLevels() {
    if (this.dbUnavailable) {
      console.warn('Skipping critical stock monitor check due to DB authentication/configuration error');
      return;
    }

    try {
      console.log('Checking critical stock levels...');
      const config = await this.getSystemConfig();
      const { criticalItems, lowItems } = await this.synchronizeStockFlagsAndAlerts();

      await Promise.all([
        this.sendCriticalSmsAlerts(config, criticalItems),
        this.notifyDashboardStreams(criticalItems, lowItems),
      ]);

      console.log(
        `Stock monitor sync complete. Critical: ${criticalItems.length}, Low: ${lowItems.length}`,
      );
    } catch (error) {
      if (isFatalDbConfigError(error?.code)) {
        this.dbUnavailable = true;
        console.error('Disabling critical stock monitor DB operations for this process due to authentication/configuration error:', error.message);
        return;
      }

      console.error('Error checking critical stock:', error);
    }
  }

  async sendCriticalAlert(phoneNumber, items) {
    try {
      const itemList = items
        .map(
          (item) =>
            `- ${item.vaccine_name}: ${item.stock_on_hand} (threshold: ${item.critical_stock_threshold})`,
        )
        .join('\n');

      const message =
        '🚨 CRITICAL STOCK ALERT\n\n' +
        'The following vaccines are at CRITICAL stock levels:\n\n' +
        `${itemList}\n\n` +
        'Please arrange for immediate restocking.';

      const formattedPhone = smsService.formatPhoneNumber(phoneNumber);
      if (!formattedPhone) {
        console.error('Invalid phone number:', phoneNumber);
        return;
      }

      const result = await smsService.sendSMS(formattedPhone, message, 'critical_stock_alert', {
        vaccineCount: items.length,
        facilityId: items[0]?.facility_id,
      });

      console.log(`Critical stock alert sent to ${formattedPhone}`);
      return result;
    } catch (error) {
      console.error('Error sending critical stock alert:', error);
    }
  }

  async manualCheck() {
    console.log('Manual critical stock check triggered');
    await this.checkStockLevels();
  }
}

module.exports = new CriticalStockMonitor();
