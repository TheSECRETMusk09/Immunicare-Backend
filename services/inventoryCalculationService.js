/**
 * Inventory Calculation Service
 * Single source of truth for all inventory calculations
 * Ensures consistency across all tabs and summary views
 */

const pool = require('../db');
const schemaCache = {
  columns: new Map(),
  tables: new Map(),
};

const resolveFirstExistingColumn = async (
  tableName,
  candidateColumns,
  fallback = candidateColumns[0],
) => {
  const cacheKey = `${tableName}:${candidateColumns.join(',')}`;
  if (schemaCache.columns.has(cacheKey)) {
    return schemaCache.columns.get(cacheKey);
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

    schemaCache.columns.set(cacheKey, resolvedColumn);
    return resolvedColumn;
  } catch (_error) {
    schemaCache.columns.set(cacheKey, fallback);
    return fallback;
  }
};

const resolveFirstExistingTable = async (
  candidateTables,
  fallback = candidateTables[0],
) => {
  const cacheKey = candidateTables.join(',');
  if (schemaCache.tables.has(cacheKey)) {
    return schemaCache.tables.get(cacheKey);
  }

  try {
    const result = await pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [candidateTables],
    );

    const availableTables = new Set(result.rows.map((row) => row.table_name));
    const resolvedTable =
      candidateTables.find((tableName) => availableTables.has(tableName)) ||
      fallback;

    schemaCache.tables.set(cacheKey, resolvedTable);
    return resolvedTable;
  } catch (_error) {
    schemaCache.tables.set(cacheKey, fallback);
    return fallback;
  }
};

class InventoryCalculationService {
  /**
   * Calculate comprehensive inventory totals for a facility
   * @param {number} clinicId - Facility/clinic ID
   * @returns {Object} Complete inventory summary
   */
  async calculateInventoryTotals(clinicId) {
    try {
      const result = await pool.query(
        `
        SELECT 
          -- Unique vaccine count (actual vaccine types, not inventory rows)
          COUNT(DISTINCT vi.vaccine_id) as total_vaccines,
          
          -- Stock component totals
          COALESCE(SUM(vi.beginning_balance), 0)::int as beginning_balance,
          COALESCE(SUM(vi.received_during_period), 0)::int as received,
          COALESCE(SUM(vi.transferred_in), 0)::int as transferred_in,
          COALESCE(SUM(vi.transferred_out), 0)::int as transferred_out,
          COALESCE(SUM(vi.issuance), 0)::int as issued,
          COALESCE(SUM(vi.expired_wasted), 0)::int as wasted_expired,
          COALESCE(SUM(vi.stock_on_hand), 0)::int as stock_on_hand,
          
          -- Total stock calculation (should match stock_on_hand)
          COALESCE(SUM(
            vi.beginning_balance + 
            vi.received_during_period + 
            vi.transferred_in - 
            vi.transferred_out - 
            vi.issuance - 
            vi.expired_wasted
          ), 0)::int as calculated_total_stock,
          
          -- Alert counts based on thresholds
          COUNT(*) FILTER (
            WHERE vi.stock_on_hand <= COALESCE(vi.critical_stock_threshold, 5)
            AND vi.stock_on_hand > 0
          )::int as critical_count,
          
          COUNT(*) FILTER (
            WHERE vi.stock_on_hand <= COALESCE(vi.low_stock_threshold, 10)
            AND vi.stock_on_hand > COALESCE(vi.critical_stock_threshold, 5)
          )::int as low_stock_count,
          
          COUNT(*) FILTER (WHERE vi.stock_on_hand = 0)::int as out_of_stock_count,
          
          -- Total inventory records
          COUNT(*)::int as total_inventory_records
          
        FROM vaccine_inventory vi
        WHERE vi.clinic_id = $1 
          AND COALESCE(vi.is_active, true) = true
        `,
        [clinicId]
      );

      return result.rows[0] || this.getEmptyTotals();
    } catch (error) {
      console.error('Error calculating inventory totals:', error);
      throw error;
    }
  }

  /**
   * Calculate stock movement statistics
   * @param {number} clinicId - Facility/clinic ID
   * @returns {Object} Stock movement summary
   */
  async calculateStockMovements(clinicId) {
    try {
      const result = await pool.query(
        `
        SELECT 
          COUNT(*)::int as movement_records,
          
          -- Stock In (additions)
          COALESCE(SUM(
            CASE WHEN transaction_type IN ('RECEIVE', 'TRANSFER_IN', 'ADJUST') 
                 AND quantity > 0
            THEN quantity ELSE 0 END
          ), 0)::int as stock_in,
          
          -- Stock Out (deductions)
          COALESCE(SUM(
            CASE WHEN transaction_type IN ('ISSUE', 'TRANSFER_OUT', 'WASTE', 'EXPIRE') 
            THEN quantity ELSE 0 END
          ), 0)::int as stock_out,
          
          -- Wasted/Expired specifically
          COALESCE(SUM(
            CASE WHEN transaction_type IN ('WASTE', 'EXPIRE') 
            THEN quantity ELSE 0 END
          ), 0)::int as wasted_expired,
          
          -- Count of waste/expire transactions
          COUNT(*) FILTER (
            WHERE transaction_type IN ('WASTE', 'EXPIRE')
          )::int as wasted_expired_count
          
        FROM vaccine_inventory_transactions
        WHERE clinic_id = $1
        `,
        [clinicId]
      );

      return result.rows[0] || this.getEmptyMovements();
    } catch (error) {
      console.error('Error calculating stock movements:', error);
      throw error;
    }
  }

  /**
   * Get unified inventory summary (combines totals + movements)
   * @param {number} clinicId - Facility/clinic ID
   * @returns {Object} Complete unified summary
   */
  async getUnifiedSummary(clinicId) {
    try {
      const [totals, movements] = await Promise.all([
        this.calculateInventoryTotals(clinicId),
        this.calculateStockMovements(clinicId),
      ]);

      return {
        // Vaccine counts
        total_vaccines: totals.total_vaccines,
        total_inventory_records: totals.total_inventory_records,

        // Stock components
        beginning_balance: totals.beginning_balance,
        received: totals.received,
        transferred_in: totals.transferred_in,
        transferred_out: totals.transferred_out,
        issued: totals.issued,
        wasted_expired: totals.wasted_expired,
        stock_on_hand: totals.stock_on_hand,
        calculated_total_stock: totals.calculated_total_stock,

        // Alert counts
        critical_count: totals.critical_count,
        low_stock_count: totals.low_stock_count,
        out_of_stock_count: totals.out_of_stock_count,

        // Movement statistics
        movement_records: movements.movement_records,
        stock_in: movements.stock_in,
        stock_out: movements.stock_out,
        wasted_expired_transactions: movements.wasted_expired,
        wasted_expired_count: movements.wasted_expired_count,

        // Metadata
        calculated_at: new Date().toISOString(),
        clinic_id: clinicId,
      };
    } catch (error) {
      console.error('Error getting unified summary:', error);
      throw error;
    }
  }

  /**
   * Get available lots/batches for a vaccine
   * @param {number} vaccineId - Vaccine ID
   * @param {number} clinicId - Facility/clinic ID
   * @returns {Array} Available lots with stock info
   */
  async getAvailableLots(vaccineId, clinicId) {
    try {
      const batchesTableName = await resolveFirstExistingTable(['vaccine_batches'], null);

      if (batchesTableName) {
        const batchFacilityColumn = await resolveFirstExistingColumn(
          batchesTableName,
          ['clinic_id', 'facility_id'],
          'clinic_id',
        );
        const batchLotColumn = await resolveFirstExistingColumn(
          batchesTableName,
          ['lot_no', 'lot_number'],
          'lot_no',
        );
        const batchStorageColumn = await resolveFirstExistingColumn(
          batchesTableName,
          ['storage_location', 'storage_conditions'],
          'storage_conditions',
        );

        const batchResult = await pool.query(
          `
          SELECT
            vb.id AS batch_id,
            vb.vaccine_id,
            COALESCE(
              NULLIF(TRIM(vb.${batchLotColumn}), ''),
              'BATCH-' || vb.id::text
            ) AS lot_number,
            COALESCE(vb.qty_current, 0)::int AS available_quantity,
            vb.expiry_date,
            NULLIF(TRIM(vb.${batchStorageColumn}), '') AS storage_location,
            v.name AS vaccine_name,
            v.code AS vaccine_code
          FROM ${batchesTableName} vb
          JOIN vaccines v ON v.id = vb.vaccine_id
          WHERE vb.vaccine_id = $1
            AND vb.${batchFacilityColumn} = $2
            AND COALESCE(vb.qty_current, 0) > 0
            AND COALESCE(vb.is_active, true) = true
            AND (vb.expiry_date IS NULL OR vb.expiry_date >= CURRENT_DATE)
          ORDER BY vb.expiry_date ASC NULLS LAST, vb.qty_current DESC, vb.id DESC
          `,
          [vaccineId, clinicId]
        );

        return batchResult.rows.map((row) => ({
          batch_id: row.batch_id,
          inventory_id: row.batch_id,
          lot_number: row.lot_number,
          batch_number: row.lot_number,
          stock: row.available_quantity,
          available_quantity: row.available_quantity,
          expiry_date: row.expiry_date,
          storage_location: row.storage_location || null,
          vaccine_name: row.vaccine_name,
          vaccine_code: row.vaccine_code,
          is_low_stock: row.available_quantity <= 10,
          is_critical: row.available_quantity <= 5,
        }));
      }

      const result = await pool.query(
        `
        SELECT 
          vi.id as inventory_id,
          vi.lot_batch_number,
          vi.stock_on_hand,
          vi.expiry_date,
          vi.low_stock_threshold,
          vi.critical_stock_threshold,
          v.name as vaccine_name,
          v.code as vaccine_code
        FROM vaccine_inventory vi
        JOIN vaccines v ON v.id = vi.vaccine_id
        WHERE vi.vaccine_id = $1
          AND vi.clinic_id = $2
          AND vi.stock_on_hand > 0
          AND COALESCE(vi.is_active, true) = true
        ORDER BY vi.expiry_date ASC NULLS LAST, vi.stock_on_hand DESC
        `,
        [vaccineId, clinicId]
      );

      return result.rows.map(row => ({
        batch_id: row.inventory_id,
        inventory_id: row.inventory_id,
        lot_number: row.lot_batch_number || `INV-${row.inventory_id}`,
        batch_number: row.lot_batch_number,
        stock: row.stock_on_hand,
        available_quantity: row.stock_on_hand,
        expiry_date: row.expiry_date,
        storage_location: null,
        vaccine_name: row.vaccine_name,
        vaccine_code: row.vaccine_code,
        is_low_stock: row.stock_on_hand <= (row.low_stock_threshold || 10),
        is_critical: row.stock_on_hand <= (row.critical_stock_threshold || 5),
      }));
    } catch (error) {
      console.error('Error getting available lots:', error);
      throw error;
    }
  }

  /**
   * Get stock alerts (critical, low, expiring)
   * @param {number} clinicId - Facility/clinic ID
   * @returns {Object} Categorized alerts
   */
  async getStockAlerts(clinicId) {
    try {
      const result = await pool.query(
        `
        SELECT 
          vi.id,
          v.name as vaccine_name,
          v.code as vaccine_code,
          vi.stock_on_hand,
          vi.low_stock_threshold,
          vi.critical_stock_threshold,
          vi.expiry_date,
          vi.lot_batch_number,
          CASE 
            WHEN vi.stock_on_hand = 0 THEN 'OUT_OF_STOCK'
            WHEN vi.stock_on_hand <= COALESCE(vi.critical_stock_threshold, 5) THEN 'CRITICAL'
            WHEN vi.stock_on_hand <= COALESCE(vi.low_stock_threshold, 10) THEN 'LOW'
            ELSE 'NORMAL'
          END as alert_level,
          CASE 
            WHEN vi.expiry_date IS NOT NULL 
            THEN EXTRACT(DAY FROM (vi.expiry_date::timestamp - CURRENT_DATE::timestamp))::int
            ELSE NULL
          END as days_until_expiry
        FROM vaccine_inventory vi
        JOIN vaccines v ON v.id = vi.vaccine_id
        WHERE vi.clinic_id = $1
          AND COALESCE(vi.is_active, true) = true
          AND (
            vi.stock_on_hand <= COALESCE(vi.low_stock_threshold, 10)
            OR (vi.expiry_date IS NOT NULL AND vi.expiry_date <= CURRENT_DATE + INTERVAL '30 days')
          )
        ORDER BY 
          CASE 
            WHEN vi.stock_on_hand = 0 THEN 0
            WHEN vi.stock_on_hand <= COALESCE(vi.critical_stock_threshold, 5) THEN 1
            WHEN vi.stock_on_hand <= COALESCE(vi.low_stock_threshold, 10) THEN 2
            ELSE 3
          END,
          vi.stock_on_hand ASC
        `,
        [clinicId]
      );

      const alerts = {
        critical: [],
        low: [],
        out_of_stock: [],
        expiring_soon: [],
      };

      result.rows.forEach(row => {
        const alert = {
          id: row.id,
          vaccine_name: row.vaccine_name,
          vaccine_code: row.vaccine_code,
          stock: row.stock_on_hand,
          lot_number: row.lot_batch_number,
          expiry_date: row.expiry_date,
          days_until_expiry: row.days_until_expiry,
        };

        if (row.alert_level === 'OUT_OF_STOCK') {
          alerts.out_of_stock.push(alert);
        } else if (row.alert_level === 'CRITICAL') {
          alerts.critical.push(alert);
        } else if (row.alert_level === 'LOW') {
          alerts.low.push(alert);
        }

        if (row.days_until_expiry !== null && row.days_until_expiry <= 30 && row.days_until_expiry >= 0) {
          alerts.expiring_soon.push(alert);
        }
      });

      return alerts;
    } catch (error) {
      console.error('Error getting stock alerts:', error);
      throw error;
    }
  }

  /**
   * Get empty totals object
   */
  getEmptyTotals() {
    return {
      total_vaccines: 0,
      beginning_balance: 0,
      received: 0,
      transferred_in: 0,
      transferred_out: 0,
      issued: 0,
      wasted_expired: 0,
      stock_on_hand: 0,
      calculated_total_stock: 0,
      critical_count: 0,
      low_stock_count: 0,
      out_of_stock_count: 0,
      total_inventory_records: 0,
    };
  }

  /**
   * Get empty movements object
   */
  getEmptyMovements() {
    return {
      movement_records: 0,
      stock_in: 0,
      stock_out: 0,
      wasted_expired: 0,
      wasted_expired_count: 0,
    };
  }
}

module.exports = new InventoryCalculationService();
