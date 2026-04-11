/**
 * Inventory Calculation Service
 * Single source of truth for all inventory calculations
 * Ensures consistency across all tabs and summary views
 */

const pool = require('../db');
const { CLINIC_TODAY_SQL, getClinicTodayDateKey } = require('../utils/clinicCalendar');
const schemaCache = {
  columns: new Map(),
  tables: new Map(),
};
const INVENTORY_SCHEMA_DEFAULTS = Object.freeze({
  facilityColumn: 'clinic_id',
  issuedColumn: 'issuance',
  wastedColumn: 'expired_wasted',
  stockOnHandColumn: 'stock_on_hand',
  lowStockThresholdColumn: 'low_stock_threshold',
  criticalStockThresholdColumn: 'critical_stock_threshold',
  lotBatchNumberColumn: 'lot_batch_number',
  expiryDateColumn: 'expiry_date',
  periodStartColumn: 'period_start',
  periodEndColumn: 'period_end',
  updatedAtColumn: 'updated_at',
  createdAtColumn: 'created_at',
  isActiveColumn: 'is_active',
});

let inventorySchemaPromise = null;

const normalizeScopeIds = (value) => {
  const rawValues = Array.isArray(value) ? value : [value];
  return [...new Set(
    rawValues
      .map((entry) => Number.parseInt(entry, 10))
      .filter((entry) => Number.isInteger(entry) && entry > 0),
  )];
};

const normalizeInventoryTransactionType = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return '';
  }

  return normalized === 'WASTAGE' ? 'WASTE' : normalized;
};

const CORE_VACCINE_KEY_CASE_SQL = `
  CASE
    WHEN (
        UPPER(COALESCE(v.code, '')) = 'BCG'
        OR (
          UPPER(COALESCE(v.name, '')) LIKE 'BCG%'
          AND UPPER(COALESCE(v.name, '')) NOT LIKE '%DILUENT%'
        )
      )
      AND UPPER(COALESCE(v.name, '')) NOT LIKE '%DILUENT%'
      THEN 'BCG'
    WHEN (
        REGEXP_REPLACE(UPPER(COALESCE(v.code, '')), '[^A-Z0-9]', '', 'g') IN ('HEPB', 'HEPATITISB')
        OR UPPER(COALESCE(v.name, '')) LIKE '%HEPA%B%'
        OR UPPER(COALESCE(v.name, '')) LIKE '%HEPATITIS%B%'
      )
      AND UPPER(COALESCE(v.name, '')) NOT LIKE '%DILUENT%'
      THEN 'HEPB'
    WHEN (
        UPPER(COALESCE(v.code, '')) LIKE 'PENTA%'
        OR UPPER(COALESCE(v.name, '')) LIKE '%PENTA%'
      )
      AND UPPER(COALESCE(v.name, '')) NOT LIKE '%DILUENT%'
      THEN 'PENTA'
    WHEN (
        UPPER(COALESCE(v.code, '')) LIKE 'OPV%'
        OR UPPER(COALESCE(v.name, '')) LIKE '%ORAL%POLIO%'
        OR UPPER(COALESCE(v.name, '')) LIKE '%OPV%'
      )
      AND UPPER(COALESCE(v.name, '')) NOT LIKE '%DILUENT%'
      THEN 'OPV'
    WHEN (
        UPPER(COALESCE(v.code, '')) LIKE 'IPV%'
        OR UPPER(COALESCE(v.name, '')) LIKE '%INACTIVATED%POLIO%'
        OR UPPER(COALESCE(v.name, '')) LIKE '%IPV%'
      )
      AND UPPER(COALESCE(v.name, '')) NOT LIKE '%DILUENT%'
      THEN 'IPV'
    WHEN (
        UPPER(COALESCE(v.code, '')) LIKE 'PCV%'
        OR UPPER(COALESCE(v.name, '')) LIKE '%PNEUMOCOCCAL%'
        OR UPPER(COALESCE(v.name, '')) LIKE '%PCV%'
      )
      AND UPPER(COALESCE(v.name, '')) NOT LIKE '%DILUENT%'
      THEN 'PCV'
    WHEN (
        UPPER(COALESCE(v.code, '')) IN ('MMR', 'MR')
        OR UPPER(COALESCE(v.name, '')) LIKE '%MMR%'
        OR UPPER(COALESCE(v.name, '')) LIKE '%MEASLES%RUBELLA%'
      )
      AND UPPER(COALESCE(v.name, '')) NOT LIKE '%DILUENT%'
      THEN 'MMR'
    ELSE NULL
  END
`;

const CORE_VACCINE_NAME_SQL = `
  CASE ${CORE_VACCINE_KEY_CASE_SQL}
    WHEN 'BCG' THEN 'BCG'
    WHEN 'HEPB' THEN 'Hepatitis B'
    WHEN 'PENTA' THEN 'Pentavalent'
    WHEN 'OPV' THEN 'Oral Polio Vaccine'
    WHEN 'IPV' THEN 'Inactivated Polio Vaccine'
    WHEN 'PCV' THEN 'Pneumococcal Conjugate Vaccine'
    WHEN 'MMR' THEN 'MMR'
    ELSE v.name
  END
`;

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

const pickInventoryColumn = (availableColumns, candidates = [], fallback = null) =>
  candidates.find((columnName) => availableColumns.has(columnName)) || fallback;

const resolveInventorySchema = async () => {
  try {
    const result = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vaccine_inventory'
      `,
    );

    const availableColumns = new Set((result.rows || []).map((row) => row.column_name));

    return {
      facilityColumn: pickInventoryColumn(
        availableColumns,
        ['clinic_id', 'facility_id'],
        INVENTORY_SCHEMA_DEFAULTS.facilityColumn,
      ),
      issuedColumn: pickInventoryColumn(
        availableColumns,
        ['issuance', 'doses_administered', 'issued'],
        null,
      ),
      wastedColumn: pickInventoryColumn(
        availableColumns,
        ['expired_wasted', 'doses_wasted', 'wasted_expired'],
        null,
      ),
      stockOnHandColumn: pickInventoryColumn(
        availableColumns,
        ['stock_on_hand', 'ending_balance'],
        null,
      ),
      lowStockThresholdColumn: pickInventoryColumn(
        availableColumns,
        ['low_stock_threshold'],
        null,
      ),
      criticalStockThresholdColumn: pickInventoryColumn(
        availableColumns,
        ['critical_stock_threshold'],
        null,
      ),
      lotBatchNumberColumn: pickInventoryColumn(
        availableColumns,
        ['lot_batch_number', 'lot_number'],
        null,
      ),
      expiryDateColumn: pickInventoryColumn(
        availableColumns,
        ['expiry_date'],
        null,
      ),
      periodStartColumn: pickInventoryColumn(
        availableColumns,
        ['period_start'],
        null,
      ),
      periodEndColumn: pickInventoryColumn(
        availableColumns,
        ['period_end'],
        null,
      ),
      updatedAtColumn: pickInventoryColumn(
        availableColumns,
        ['updated_at'],
        null,
      ),
      createdAtColumn: pickInventoryColumn(
        availableColumns,
        ['created_at'],
        null,
      ),
      isActiveColumn: pickInventoryColumn(
        availableColumns,
        ['is_active'],
        null,
      ),
    };
  } catch (_error) {
    return { ...INVENTORY_SCHEMA_DEFAULTS };
  }
};

const getInventorySchema = async () => {
  if (!inventorySchemaPromise) {
    inventorySchemaPromise = resolveInventorySchema();
  }

  return inventorySchemaPromise;
};

const buildInventoryColumnSql = (alias, columnName, fallbackSql = 'NULL') =>
  columnName ? `${alias}.${columnName}` : fallbackSql;

const buildInventoryCoalescedSql = (alias, columnName, fallbackSql = '0') =>
  columnName ? `COALESCE(${alias}.${columnName}, 0)` : fallbackSql;

const buildInventorySqlContext = (alias, inventorySchema = {}) => {
  const beginningBalanceExpression = `COALESCE(${alias}.beginning_balance, 0)`;
  const receivedExpression = `COALESCE(${alias}.received_during_period, 0)`;
  const transferredInExpression = `COALESCE(${alias}.transferred_in, 0)`;
  const transferredOutExpression = `COALESCE(${alias}.transferred_out, 0)`;
  const issuedExpression = buildInventoryCoalescedSql(alias, inventorySchema.issuedColumn, '0');
  const wastedExpression = buildInventoryCoalescedSql(alias, inventorySchema.wastedColumn, '0');
  const calculatedStockExpression = `(
    ${beginningBalanceExpression}
    + ${receivedExpression}
    + ${transferredInExpression}
    - ${transferredOutExpression}
    - ${wastedExpression}
    - ${issuedExpression}
  )`;
  const stockOnHandExpression = inventorySchema.stockOnHandColumn
    ? buildInventoryCoalescedSql(alias, inventorySchema.stockOnHandColumn, calculatedStockExpression)
    : calculatedStockExpression;
  const lowStockThresholdExpression = inventorySchema.lowStockThresholdColumn
    ? `COALESCE(${alias}.${inventorySchema.lowStockThresholdColumn}, 10)`
    : '10';
  const criticalStockThresholdExpression = inventorySchema.criticalStockThresholdColumn
    ? `COALESCE(${alias}.${inventorySchema.criticalStockThresholdColumn}, 5)`
    : '5';
  const lotBatchNumberExpression = buildInventoryColumnSql(
    alias,
    inventorySchema.lotBatchNumberColumn,
    'NULL::text',
  );
  const expiryDateExpression = buildInventoryColumnSql(
    alias,
    inventorySchema.expiryDateColumn,
    'NULL::date',
  );
  const isActiveExpression = inventorySchema.isActiveColumn
    ? `COALESCE(${alias}.${inventorySchema.isActiveColumn}, true)`
    : 'true';
  const sortDateCandidates = [
    inventorySchema.periodEndColumn ? `${alias}.${inventorySchema.periodEndColumn}` : null,
    inventorySchema.updatedAtColumn ? `${alias}.${inventorySchema.updatedAtColumn}::date` : null,
    inventorySchema.createdAtColumn ? `${alias}.${inventorySchema.createdAtColumn}::date` : null,
  ].filter(Boolean);
  const sortDateExpression = sortDateCandidates.length > 0
    ? `COALESCE(${sortDateCandidates.join(', ')})`
    : 'CURRENT_DATE';
  const updatedAtOrderExpression = inventorySchema.updatedAtColumn
    ? `${alias}.${inventorySchema.updatedAtColumn}`
    : `${sortDateExpression}::timestamp`;

  return {
    beginningBalanceExpression,
    receivedExpression,
    transferredInExpression,
    transferredOutExpression,
    issuedExpression,
    wastedExpression,
    calculatedStockExpression,
    stockOnHandExpression,
    lowStockThresholdExpression,
    criticalStockThresholdExpression,
    lotBatchNumberExpression,
    expiryDateExpression,
    isActiveExpression,
    sortDateExpression,
    updatedAtOrderExpression,
  };
};

class InventoryCalculationService {
  async getInventoryAggregateRows(clinicScope) {
    const scopeIds = normalizeScopeIds(clinicScope);
    if (scopeIds.length === 0) {
      return [];
    }

    const inventorySchema = await getInventorySchema();
    const inventoryFacilityColumn = inventorySchema.facilityColumn || await resolveFirstExistingColumn(
      'vaccine_inventory',
      ['clinic_id', 'facility_id'],
      'clinic_id',
    );
    const inventorySql = buildInventorySqlContext('vi', inventorySchema);
    const scopeParam = scopeIds.length === 1 ? scopeIds[0] : scopeIds;
    const scopeClause = scopeIds.length === 1
      ? `vi.${inventoryFacilityColumn} = $1`
      : `vi.${inventoryFacilityColumn} = ANY($1::int[])`;

    const result = await pool.query(
      `
        WITH scoped_inventory AS (
          SELECT
            vi.id,
            vi.vaccine_id,
            ${CORE_VACCINE_KEY_CASE_SQL} AS vaccine_key,
            ${CORE_VACCINE_NAME_SQL} AS vaccine_name,
            ${inventorySql.beginningBalanceExpression}::int AS beginning_balance,
            ${inventorySql.receivedExpression}::int AS received,
            ${inventorySql.transferredInExpression}::int AS transferred_in,
            ${inventorySql.transferredOutExpression}::int AS transferred_out,
            ${inventorySql.issuedExpression}::int AS issued,
            ${inventorySql.wastedExpression}::int AS wasted_expired,
            ${inventorySql.stockOnHandExpression}::int AS stock_on_hand,
            ${inventorySql.lowStockThresholdExpression}::int AS low_stock_threshold,
            ${inventorySql.criticalStockThresholdExpression}::int AS critical_stock_threshold,
            ${inventorySql.lotBatchNumberExpression} AS lot_batch_number,
            ${inventorySql.expiryDateExpression} AS expiry_date,
            ROW_NUMBER() OVER (
              PARTITION BY ${CORE_VACCINE_KEY_CASE_SQL}
              ORDER BY
                ${inventorySql.sortDateExpression} DESC,
                ${inventorySql.updatedAtOrderExpression} DESC,
                vi.id DESC
            ) AS row_rank
          FROM vaccine_inventory vi
          JOIN vaccines v ON v.id = vi.vaccine_id
          WHERE ${scopeClause}
            AND ${inventorySql.isActiveExpression} = true
        )
        SELECT
          MAX(vaccine_id)::int AS vaccine_id,
          vaccine_name,
          vaccine_key AS vaccine_code,
          COALESCE(SUM(beginning_balance), 0)::int AS beginning_balance,
          COALESCE(SUM(received), 0)::int AS received,
          COALESCE(SUM(transferred_in), 0)::int AS transferred_in,
          COALESCE(SUM(transferred_out), 0)::int AS transferred_out,
          COALESCE(SUM(issued), 0)::int AS issued,
          COALESCE(SUM(wasted_expired), 0)::int AS wasted_expired,
          COALESCE(SUM(stock_on_hand), 0)::int AS stock_on_hand,
          COALESCE(SUM(
            beginning_balance
            + received
            + transferred_in
            - transferred_out
            - issued
            - wasted_expired
          ), 0)::int AS calculated_total_stock,
          MAX(low_stock_threshold)::int AS low_stock_threshold,
          MAX(critical_stock_threshold)::int AS critical_stock_threshold,
          MAX(CASE WHEN row_rank = 1 THEN id END)::int AS representative_inventory_id,
          MAX(CASE WHEN row_rank = 1 THEN lot_batch_number END) AS lot_batch_number,
          MAX(CASE WHEN row_rank = 1 THEN expiry_date END) AS expiry_date
        FROM scoped_inventory
        WHERE vaccine_key IS NOT NULL
        GROUP BY vaccine_key, vaccine_name
        ORDER BY vaccine_name ASC
      `,
      [scopeParam],
    );

    return result.rows || [];
  }

  buildAggregateAlertMetadata(row = {}) {
    const currentStock = Number.parseInt(row.stock_on_hand, 10) || 0;
    const lowThreshold = Number.parseInt(row.low_stock_threshold, 10) || 10;
    const criticalThreshold = Number.parseInt(row.critical_stock_threshold, 10) || 5;

    if (currentStock <= 0) {
      return {
        alert_type: 'OUT_OF_STOCK',
        priority: 'URGENT',
        threshold_value: criticalThreshold,
        message: `${row.vaccine_name} is out of stock (${currentStock} remaining).`,
      };
    }

    if (currentStock <= criticalThreshold) {
      return {
        alert_type: 'CRITICAL_STOCK',
        priority: 'URGENT',
        threshold_value: criticalThreshold,
        message: `${row.vaccine_name} is at critical stock (${currentStock} remaining).`,
      };
    }

    if (currentStock <= lowThreshold) {
      return {
        alert_type: 'LOW_STOCK',
        priority: 'HIGH',
        threshold_value: lowThreshold,
        message: `${row.vaccine_name} is low on stock (${currentStock} remaining).`,
      };
    }

    return null;
  }

  async syncStockAlerts(clinicScope) {
    const scopeIds = normalizeScopeIds(clinicScope);
    if (scopeIds.length === 0) {
      return [];
    }

    const stockAlertsFacilityColumn = await resolveFirstExistingColumn(
      'vaccine_stock_alerts',
      ['clinic_id', 'facility_id'],
      'clinic_id',
    );
    const scopeParam = scopeIds.length === 1 ? scopeIds[0] : scopeIds;
    const scopeClause = scopeIds.length === 1
      ? `${stockAlertsFacilityColumn} = $1`
      : `${stockAlertsFacilityColumn} = ANY($1::int[])`;

    const [aggregateRows, activeAlertsResult] = await Promise.all([
      this.getInventoryAggregateRows(scopeIds),
      pool.query(
        `
          SELECT *
          FROM vaccine_stock_alerts
          WHERE ${scopeClause}
            AND status <> 'RESOLVED'
          ORDER BY updated_at DESC, id DESC
        `,
        [scopeParam],
      ),
    ]);

    const activeAlertsByVaccine = new Map();
    for (const alert of activeAlertsResult.rows || []) {
      const vaccineId = Number.parseInt(alert.vaccine_id, 10);
      if (!Number.isInteger(vaccineId)) {
        continue;
      }

      if (!activeAlertsByVaccine.has(vaccineId)) {
        activeAlertsByVaccine.set(vaccineId, []);
      }

      activeAlertsByVaccine.get(vaccineId).push(alert);
    }

    for (const row of aggregateRows) {
      const alertMetadata = this.buildAggregateAlertMetadata(row);
      const vaccineId = Number.parseInt(row.vaccine_id, 10);
      const existingAlerts = activeAlertsByVaccine.get(vaccineId) || [];

      if (!alertMetadata) {
        for (const alert of existingAlerts) {
          await pool.query(
            `
              UPDATE vaccine_stock_alerts
              SET status = 'RESOLVED',
                  resolved_at = CURRENT_TIMESTAMP,
                  resolution_notes = COALESCE(resolution_notes, 'Auto-resolved by inventory reconciliation'),
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `,
            [alert.id],
          );
        }
        continue;
      }

      const primaryAlert = existingAlerts[0] || null;
      const nextStatus =
        primaryAlert && String(primaryAlert.status || '').toUpperCase() === 'ACKNOWLEDGED'
          && primaryAlert.alert_type === alertMetadata.alert_type
          ? 'ACKNOWLEDGED'
          : 'ACTIVE';

      if (primaryAlert) {
        await pool.query(
          `
            UPDATE vaccine_stock_alerts
            SET vaccine_inventory_id = $1,
                alert_type = $2,
                current_stock = $3,
                threshold_value = $4,
                status = $5,
                message = $6,
                priority = $7,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $8
          `,
          [
            row.representative_inventory_id,
            alertMetadata.alert_type,
            row.stock_on_hand,
            alertMetadata.threshold_value,
            nextStatus,
            alertMetadata.message,
            alertMetadata.priority,
            primaryAlert.id,
          ],
        );

        for (const duplicateAlert of existingAlerts.slice(1)) {
          await pool.query(
            `
              UPDATE vaccine_stock_alerts
              SET status = 'RESOLVED',
                  resolved_at = CURRENT_TIMESTAMP,
                  resolution_notes = COALESCE(resolution_notes, 'Merged into current inventory alert'),
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `,
            [duplicateAlert.id],
          );
        }
        continue;
      }

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
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $8)
        `,
        [
          row.representative_inventory_id,
          row.vaccine_id,
          scopeIds[0],
          alertMetadata.alert_type,
          row.stock_on_hand,
          alertMetadata.threshold_value,
          alertMetadata.message,
          alertMetadata.priority,
        ],
      );
    }

    return aggregateRows;
  }

  /**
   * Calculate comprehensive inventory totals for a facility
   * @param {number} clinicId - Facility/clinic ID
   * @returns {Object} Complete inventory summary
   */
  async calculateInventoryTotals(clinicScope) {
    try {
      const aggregateRows = await this.getInventoryAggregateRows(clinicScope);
      if (aggregateRows.length === 0) {
        return this.getEmptyTotals();
      }

      return aggregateRows.reduce(
        (summary, row) => {
          const stockOnHand = Number.parseInt(row.stock_on_hand, 10) || 0;
          const criticalThreshold = Number.parseInt(row.critical_stock_threshold, 10) || 5;
          const lowThreshold = Number.parseInt(row.low_stock_threshold, 10) || 10;

          return {
            total_vaccines: summary.total_vaccines + 1,
            beginning_balance: summary.beginning_balance + (Number.parseInt(row.beginning_balance, 10) || 0),
            received: summary.received + (Number.parseInt(row.received, 10) || 0),
            transferred_in: summary.transferred_in + (Number.parseInt(row.transferred_in, 10) || 0),
            transferred_out: summary.transferred_out + (Number.parseInt(row.transferred_out, 10) || 0),
            issued: summary.issued + (Number.parseInt(row.issued, 10) || 0),
            wasted_expired: summary.wasted_expired + (Number.parseInt(row.wasted_expired, 10) || 0),
            stock_on_hand: summary.stock_on_hand + stockOnHand,
            calculated_total_stock:
              summary.calculated_total_stock + (Number.parseInt(row.calculated_total_stock, 10) || 0),
            critical_count:
              summary.critical_count + (stockOnHand > 0 && stockOnHand <= criticalThreshold ? 1 : 0),
            low_stock_count:
              summary.low_stock_count + (
                stockOnHand > criticalThreshold && stockOnHand > 0 && stockOnHand <= lowThreshold ? 1 : 0
              ),
            out_of_stock_count: summary.out_of_stock_count + (stockOnHand <= 0 ? 1 : 0),
            total_inventory_records: summary.total_inventory_records + 1,
          };
        },
        this.getEmptyTotals(),
      );
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
  async calculateStockMovements(clinicScope) {
    try {
      const options =
        clinicScope &&
        typeof clinicScope === 'object' &&
        !Array.isArray(clinicScope)
          ? clinicScope
          : { clinicScope };
      const scopeIds = normalizeScopeIds(options.clinicScope);
      if (scopeIds.length === 0) {
        return this.getEmptyMovements();
      }

      const [
        transactionFacilityColumn,
        transactionDateColumn,
      ] = await Promise.all([
        resolveFirstExistingColumn(
          'vaccine_inventory_transactions',
          ['clinic_id', 'facility_id'],
          'clinic_id',
        ),
        resolveFirstExistingColumn(
          'vaccine_inventory_transactions',
          ['transaction_date'],
          null,
        ),
      ]);
      const scopeParam = scopeIds.length === 1 ? scopeIds[0] : scopeIds;
      const scopeClause = scopeIds.length === 1
        ? `vit.${transactionFacilityColumn} = $1`
        : `vit.${transactionFacilityColumn} = ANY($1::int[])`;
      const movementDateExpr = transactionDateColumn
        ? `COALESCE(vit.${transactionDateColumn}::date, vit.created_at::date)`
        : 'vit.created_at::date';
      const whereClauses = [scopeClause];
      const params = [scopeParam];
      let paramIndex = 2;

      if (Number.isInteger(Number.parseInt(options.vaccineId, 10))) {
        whereClauses.push(`vit.vaccine_id = $${paramIndex}`);
        params.push(Number.parseInt(options.vaccineId, 10));
        paramIndex += 1;
      }

      const normalizedVaccineName = String(options.vaccineName || '').trim().toLowerCase();
      if (normalizedVaccineName) {
        whereClauses.push(`LOWER(TRIM(COALESCE(v.name, ''))) = $${paramIndex}`);
        params.push(normalizedVaccineName);
        paramIndex += 1;
      }

      const normalizedTransactionType = normalizeInventoryTransactionType(
        options.transactionType,
      );
      if (normalizedTransactionType) {
        if (normalizedTransactionType === 'WASTE') {
          whereClauses.push(`UPPER(COALESCE(vit.transaction_type::text, '')) = ANY($${paramIndex}::text[])`);
          params.push(['WASTE', 'WASTAGE']);
        } else {
          whereClauses.push(`UPPER(COALESCE(vit.transaction_type::text, '')) = $${paramIndex}`);
          params.push(normalizedTransactionType);
        }
        paramIndex += 1;
      }

      if (options.startDate) {
        whereClauses.push(`${movementDateExpr} >= $${paramIndex}::date`);
        params.push(options.startDate);
        paramIndex += 1;
      }

      if (options.endDate) {
        whereClauses.push(`${movementDateExpr} <= $${paramIndex}::date`);
        params.push(options.endDate);
        paramIndex += 1;
      }

      const result = await pool.query(
        `
        SELECT 
          COUNT(*)::int as movement_records,
          
          -- Stock In (additions)
          COALESCE(SUM(
            CASE
              WHEN UPPER(COALESCE(vit.transaction_type::text, '')) IN ('RECEIVE', 'RECEIPT', 'TRANSFER_IN')
              THEN ABS(COALESCE(vit.quantity, 0))
              ELSE 0
            END
          ), 0)::int as stock_in,
          
          -- Stock Out (deductions)
          COALESCE(SUM(
            CASE
              WHEN UPPER(COALESCE(vit.transaction_type::text, '')) IN ('ISSUE', 'TRANSFER_OUT')
              THEN ABS(COALESCE(vit.quantity, 0))
              ELSE 0
            END
          ), 0)::int as stock_out,
          
          -- Wasted/Expired specifically
          COALESCE(SUM(
            CASE
              WHEN UPPER(COALESCE(vit.transaction_type::text, '')) IN ('WASTE', 'WASTAGE', 'EXPIRE')
              THEN ABS(COALESCE(vit.quantity, 0))
              ELSE 0
            END
          ), 0)::int as wasted_expired,
          
          -- Count of waste/expire transactions
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(vit.transaction_type::text, '')) IN ('WASTE', 'WASTAGE', 'EXPIRE')
          )::int as wasted_expired_count
          
        FROM vaccine_inventory_transactions vit
        JOIN vaccines v ON v.id = vit.vaccine_id
        WHERE ${whereClauses.join(' AND ')}
        `,
        params
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
            AND (vb.expiry_date IS NULL OR vb.expiry_date >= ${CLINIC_TODAY_SQL})
          ORDER BY vb.expiry_date ASC NULLS LAST, vb.qty_current DESC, vb.id DESC
          `,
          [vaccineId, clinicId]
        );

        return batchResult.rows.map((row) => ({
          batch_id: row.batch_id,
          inventory_id: row.batch_id,
          vaccine_id: row.vaccine_id,
          clinic_id: clinicId,
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

      const inventorySchema = await getInventorySchema();
      const inventorySql = buildInventorySqlContext('vi', inventorySchema);
      const inventoryFacilityColumn = inventorySchema.facilityColumn || 'clinic_id';

      const result = await pool.query(
        `
        SELECT 
          vi.id as inventory_id,
          ${inventorySql.lotBatchNumberExpression} AS lot_batch_number,
          ${inventorySql.stockOnHandExpression}::int AS stock_on_hand,
          ${inventorySql.expiryDateExpression} AS expiry_date,
          ${inventorySql.lowStockThresholdExpression}::int AS low_stock_threshold,
          ${inventorySql.criticalStockThresholdExpression}::int AS critical_stock_threshold,
          v.name as vaccine_name,
          v.code as vaccine_code
        FROM vaccine_inventory vi
        JOIN vaccines v ON v.id = vi.vaccine_id
        WHERE vi.vaccine_id = $1
          AND vi.${inventoryFacilityColumn} = $2
          AND ${inventorySql.stockOnHandExpression}::int > 0
          AND ${inventorySql.isActiveExpression} = true
        ORDER BY ${inventorySql.expiryDateExpression} ASC NULLS LAST, ${inventorySql.stockOnHandExpression}::int DESC
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
      const aggregateRows = await this.getInventoryAggregateRows(clinicId);
      const clinicToday = getClinicTodayDateKey();
      const clinicTodayDate = clinicToday ? new Date(`${clinicToday}T00:00:00.000Z`) : new Date();

      const alerts = {
        critical: [],
        low: [],
        out_of_stock: [],
        expiring_soon: [],
      };

      aggregateRows.forEach((row) => {
        const currentStock = Number.parseInt(row.stock_on_hand, 10) || 0;
        const lowThreshold = Number.parseInt(row.low_stock_threshold, 10) || 10;
        const criticalThreshold = Number.parseInt(row.critical_stock_threshold, 10) || 5;
        const daysUntilExpiry = row.expiry_date
          ? Math.floor(
            (new Date(`${row.expiry_date}T00:00:00.000Z`).getTime() - clinicTodayDate.getTime()) /
              (24 * 60 * 60 * 1000),
          )
          : null;
        const alert = {
          id: row.representative_inventory_id,
          vaccine_name: row.vaccine_name,
          vaccine_code: row.vaccine_code,
          stock: currentStock,
          lot_number: row.lot_batch_number,
          expiry_date: row.expiry_date,
          days_until_expiry: daysUntilExpiry,
        };

        if (currentStock <= 0) {
          alerts.out_of_stock.push(alert);
        } else if (currentStock <= criticalThreshold) {
          alerts.critical.push(alert);
        } else if (currentStock <= lowThreshold) {
          alerts.low.push(alert);
        }

        if (daysUntilExpiry !== null && daysUntilExpiry <= 30 && daysUntilExpiry >= 0) {
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
