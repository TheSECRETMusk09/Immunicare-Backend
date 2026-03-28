const db = require('../db');

const REQUIRED_VACCINE_KEYS = Object.freeze([
  'BCG',
  'HEPB',
  'PENTA',
  'OPV',
  'IPV',
  'PCV',
  'MMR',
]);

const VACCINE_KEY_CASE_SQL = `
  CASE
    WHEN UPPER(COALESCE(v.code, '')) = 'BCG'
      OR (
        UPPER(COALESCE(v.name, '')) LIKE 'BCG%'
        AND UPPER(COALESCE(v.name, '')) NOT LIKE '%DILUENT%'
      ) THEN 'BCG'
    WHEN REGEXP_REPLACE(UPPER(COALESCE(v.code, '')), '[^A-Z0-9]', '', 'g') IN ('HEPB', 'HEPATITISB')
      OR UPPER(COALESCE(v.name, '')) LIKE '%HEPA%B%'
      OR UPPER(COALESCE(v.name, '')) LIKE '%HEPATITIS%B%'
      THEN 'HEPB'
    WHEN UPPER(COALESCE(v.code, '')) LIKE 'PENTA%'
      OR UPPER(COALESCE(v.name, '')) LIKE '%PENTA%'
      THEN 'PENTA'
    WHEN UPPER(COALESCE(v.code, '')) LIKE 'OPV%'
      OR UPPER(COALESCE(v.name, '')) LIKE '%ORAL%POLIO%'
      OR UPPER(COALESCE(v.name, '')) LIKE '%OPV%'
      THEN 'OPV'
    WHEN UPPER(COALESCE(v.code, '')) LIKE 'IPV%'
      OR UPPER(COALESCE(v.name, '')) LIKE '%INACTIVATED%POLIO%'
      OR UPPER(COALESCE(v.name, '')) LIKE '%IPV%'
      THEN 'IPV'
    WHEN UPPER(COALESCE(v.code, '')) LIKE 'PCV%'
      OR UPPER(COALESCE(v.name, '')) LIKE '%PNEUMOCOCCAL%'
      OR UPPER(COALESCE(v.name, '')) LIKE '%PCV%'
      THEN 'PCV'
    WHEN UPPER(COALESCE(v.code, '')) IN ('MMR', 'MR')
      OR UPPER(COALESCE(v.name, '')) LIKE '%MMR%'
      OR UPPER(COALESCE(v.name, '')) LIKE '%MEASLES%RUBELLA%'
      THEN 'MMR'
    ELSE NULL
  END
`;

const vaccineNameCaseFromKeyExpression = (expression) => `
  CASE ${expression}
    WHEN 'BCG' THEN 'BCG'
    WHEN 'HEPB' THEN 'Hepatitis B'
    WHEN 'PENTA' THEN 'Pentavalent'
    WHEN 'OPV' THEN 'Oral Polio Vaccine'
    WHEN 'IPV' THEN 'Inactivated Polio Vaccine'
    WHEN 'PCV' THEN 'Pneumococcal Conjugate Vaccine'
    WHEN 'MMR' THEN 'MMR'
    ELSE ${expression}
  END
`;

const toNullableArray = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  return value;
};

const FALLBACK_SCHEMA_COLUMNS = Object.freeze({
  appointmentsPatient: 'infant_id',
  appointmentsPatientFallback: null,
  appointmentsScope: 'clinic_id',
  appointmentsScopeFallback: null,
  patientsScope: 'facility_id',
  patientsScopeFallback: null,
  immunizationStatus: null,
  inventoryScope: null,
  inventoryScopeFallback: null,
  inventoryStockOnHand: null,
  inventoryBeginningBalance: null,
  inventoryReceivedDuringPeriod: null,
  inventoryTransferredIn: null,
  inventoryTransferredOut: null,
  inventoryExpiredWasted: null,
  inventoryIssuance: null,
  inventoryLowStockThreshold: null,
  inventoryCriticalStockThreshold: null,
  inventoryTransactionsScope: 'clinic_id',
  inventoryTransactionsScopeFallback: null,
  inventoryAlertsScope: 'clinic_id',
  inventoryAlertsScopeFallback: null,
  patientsSex: null,
  patientsGender: null,
  notificationsScope: null,
  notificationsScopeFallback: null,
  notificationsChannel: null,
  notificationsStatus: null,
  notificationsIsRead: null,
  notificationsTitle: null,
  notificationsSubject: null,
  notificationsMessage: null,
  notificationsType: null,
  notificationsPriority: null,
  stockAlertsStatus: null,
  stockAlertsPriority: null,
  stockAlertsAlertType: null,
  stockAlertsCurrentStock: null,
  stockAlertsThresholdValue: null,
  stockAlertsMessage: null,
  stockAlertsCreatedAt: null,
  stockAlertsUpdatedAt: null,
  stockAlertsResolvedAt: null,
  stockAlertsAcknowledgedAt: null,
});

let schemaColumnMappingPromise = null;

const resolveSchemaColumnMappings = async () => {
  const mappings = { ...FALLBACK_SCHEMA_COLUMNS };

  try {
    const result = await db.query(
      `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])
          AND column_name = ANY($2::text[])
      `,
      [
        [
          'appointments',
          'immunization_records',
          'patients',
          'inventory',
          'vaccine_inventory',
          'vaccine_inventory_transactions',
          'vaccine_stock_alerts',
          'notifications',
        ],
        [
          'patient_id',
          'infant_id',
          'facility_id',
          'clinic_id',
          'sex',
          'gender',
          'status',
          'quantity',
          'stock_on_hand',
          'beginning_balance',
          'received_during_period',
          'transferred_in',
          'transferred_out',
          'expired_wasted',
          'issuance',
          'low_stock_threshold',
          'critical_stock_threshold',
          'channel',
          'is_read',
          'title',
          'subject',
          'message',
          'notification_type',
          'priority',
          'alert_type',
          'current_stock',
          'threshold_value',
          'resolved_at',
          'acknowledged_at',
        ],
      ],
    );

    const available = new Set(
      (result.rows || []).map((row) => `${row.table_name}.${row.column_name}`),
    );

    if (available.has('appointments.patient_id')) {
      mappings.appointmentsPatient = 'patient_id';
      mappings.appointmentsPatientFallback = available.has('appointments.infant_id')
        ? 'infant_id'
        : null;
    } else if (available.has('appointments.infant_id')) {
      mappings.appointmentsPatient = 'infant_id';
      mappings.appointmentsPatientFallback = null;
    }

    if (available.has('appointments.facility_id')) {
      mappings.appointmentsScope = 'facility_id';
      mappings.appointmentsScopeFallback = available.has('appointments.clinic_id')
        ? 'clinic_id'
        : null;
    } else if (available.has('appointments.clinic_id')) {
      mappings.appointmentsScope = 'clinic_id';
      mappings.appointmentsScopeFallback = null;
    }

    if (available.has('patients.facility_id')) {
      mappings.patientsScope = 'facility_id';
      mappings.patientsScopeFallback = available.has('patients.clinic_id')
        ? 'clinic_id'
        : null;
    } else if (available.has('patients.clinic_id')) {
      mappings.patientsScope = 'clinic_id';
      mappings.patientsScopeFallback = null;
    }

    if (available.has('patients.sex')) {
      mappings.patientsSex = 'sex';
    }

    if (available.has('patients.gender')) {
      mappings.patientsGender = 'gender';
    }

    if (available.has('immunization_records.status')) {
      mappings.immunizationStatus = 'status';
    }

    // Inventory table doesn't have facility/clinic scoping - it's global
    // Only check vaccine_inventory table for backward compatibility
    if (available.has('vaccine_inventory.facility_id')) {
      mappings.inventoryScope = 'facility_id';
      mappings.inventoryScopeFallback = available.has('vaccine_inventory.clinic_id')
        ? 'clinic_id'
        : null;
    } else if (available.has('vaccine_inventory.clinic_id')) {
      mappings.inventoryScope = 'clinic_id';
      mappings.inventoryScopeFallback = null;
    }
    // Note: inventory table has no facility scoping, so inventoryScope stays null

    // Check for quantity column first (used by inventory table)
    if (available.has('inventory.quantity')) {
      mappings.inventoryQuantity = 'quantity';
    }
    
    if (available.has('inventory.stock_on_hand') || available.has('vaccine_inventory.stock_on_hand')) {
      mappings.inventoryStockOnHand = 'stock_on_hand';
    }

    if (available.has('inventory.beginning_balance') || available.has('vaccine_inventory.beginning_balance')) {
      mappings.inventoryBeginningBalance = 'beginning_balance';
    }

    if (available.has('inventory.received_during_period') || available.has('vaccine_inventory.received_during_period')) {
      mappings.inventoryReceivedDuringPeriod = 'received_during_period';
    }

    if (available.has('inventory.transferred_in') || available.has('vaccine_inventory.transferred_in')) {
      mappings.inventoryTransferredIn = 'transferred_in';
    }

    if (available.has('inventory.transferred_out') || available.has('vaccine_inventory.transferred_out')) {
      mappings.inventoryTransferredOut = 'transferred_out';
    }

    if (available.has('inventory.expired_wasted') || available.has('vaccine_inventory.expired_wasted')) {
      mappings.inventoryExpiredWasted = 'expired_wasted';
    }

    if (available.has('inventory.issuance') || available.has('vaccine_inventory.issuance')) {
      mappings.inventoryIssuance = 'issuance';
    }

    if (available.has('inventory.low_stock_threshold') || available.has('vaccine_inventory.low_stock_threshold')) {
      mappings.inventoryLowStockThreshold = 'low_stock_threshold';
    }

    if (available.has('inventory.critical_stock_threshold') || available.has('vaccine_inventory.critical_stock_threshold')) {
      mappings.inventoryCriticalStockThreshold = 'critical_stock_threshold';
    }

    if (available.has('vaccine_inventory_transactions.facility_id')) {
      mappings.inventoryTransactionsScope = 'facility_id';
      mappings.inventoryTransactionsScopeFallback = available.has('vaccine_inventory_transactions.clinic_id')
        ? 'clinic_id'
        : null;
    } else if (available.has('vaccine_inventory_transactions.clinic_id')) {
      mappings.inventoryTransactionsScope = 'clinic_id';
      mappings.inventoryTransactionsScopeFallback = null;
    }

    if (available.has('vaccine_stock_alerts.facility_id')) {
      mappings.inventoryAlertsScope = 'facility_id';
      mappings.inventoryAlertsScopeFallback = available.has('vaccine_stock_alerts.clinic_id')
        ? 'clinic_id'
        : null;
    } else if (available.has('vaccine_stock_alerts.clinic_id')) {
      mappings.inventoryAlertsScope = 'clinic_id';
      mappings.inventoryAlertsScopeFallback = null;
    }

    if (available.has('notifications.facility_id')) {
      mappings.notificationsScope = 'facility_id';
      mappings.notificationsScopeFallback = available.has('notifications.clinic_id')
        ? 'clinic_id'
        : null;
    } else if (available.has('notifications.clinic_id')) {
      mappings.notificationsScope = 'clinic_id';
      mappings.notificationsScopeFallback = null;
    }

    if (available.has('notifications.channel')) {
      mappings.notificationsChannel = 'channel';
    }

    if (available.has('notifications.status')) {
      mappings.notificationsStatus = 'status';
    }

    if (available.has('notifications.is_read')) {
      mappings.notificationsIsRead = 'is_read';
    }

    if (available.has('notifications.title')) {
      mappings.notificationsTitle = 'title';
    }

    if (available.has('notifications.subject')) {
      mappings.notificationsSubject = 'subject';
    }

    if (available.has('notifications.message')) {
      mappings.notificationsMessage = 'message';
    }

    if (available.has('notifications.notification_type')) {
      mappings.notificationsType = 'notification_type';
    }

    if (available.has('notifications.priority')) {
      mappings.notificationsPriority = 'priority';
    }

    if (available.has('vaccine_stock_alerts.status')) {
      mappings.stockAlertsStatus = 'status';
    }

    if (available.has('vaccine_stock_alerts.priority')) {
      mappings.stockAlertsPriority = 'priority';
    }

    if (available.has('vaccine_stock_alerts.alert_type')) {
      mappings.stockAlertsAlertType = 'alert_type';
    }

    if (available.has('vaccine_stock_alerts.current_stock')) {
      mappings.stockAlertsCurrentStock = 'current_stock';
    }

    if (available.has('vaccine_stock_alerts.threshold_value')) {
      mappings.stockAlertsThresholdValue = 'threshold_value';
    }

    if (available.has('vaccine_stock_alerts.message')) {
      mappings.stockAlertsMessage = 'message';
    }

    if (available.has('vaccine_stock_alerts.created_at')) {
      mappings.stockAlertsCreatedAt = 'created_at';
    }

    if (available.has('vaccine_stock_alerts.updated_at')) {
      mappings.stockAlertsUpdatedAt = 'updated_at';
    }

    if (available.has('vaccine_stock_alerts.resolved_at')) {
      mappings.stockAlertsResolvedAt = 'resolved_at';
    }

    if (available.has('vaccine_stock_alerts.acknowledged_at')) {
      mappings.stockAlertsAcknowledgedAt = 'acknowledged_at';
    }
  } catch (error) {
    console.error('Error resolving analytics schema column mappings:', error);
  }

  return mappings;
};

const getSchemaColumnMappings = async () => {
  if (!schemaColumnMappingPromise) {
    schemaColumnMappingPromise = resolveSchemaColumnMappings();
  }

  return schemaColumnMappingPromise;
};

const buildScopedColumnExpression = (alias, primaryColumn, fallbackColumn = null) => {
  const primary = primaryColumn ? `${alias}.${primaryColumn}` : null;
  const fallback = fallbackColumn ? `${alias}.${fallbackColumn}` : null;

  if (primary && fallback && primary !== fallback) {
    return `COALESCE(${primary}, ${fallback})`;
  }

  return primary || fallback || 'NULL';
};

const buildImmunizationStatusExpression = ({ alias, statusColumn }) => {
  const inferredStatus = `CASE WHEN ${alias}.admin_date IS NOT NULL THEN 'completed' ELSE 'scheduled' END`;

  if (!statusColumn) {
    return inferredStatus;
  }

  return `COALESCE(NULLIF(LOWER(${alias}.${statusColumn}::text), ''), ${inferredStatus})`;
};

const buildInventoryStockExpression = ({ alias, mappings }) => {
  // Prefer quantity column (used by inventory table)
  if (mappings.inventoryQuantity) {
    return `GREATEST(COALESCE(${alias}.${mappings.inventoryQuantity}, 0), 0)`;
  }
  
  // Then check for stock_on_hand (used by vaccine_inventory table)
  if (mappings.inventoryStockOnHand) {
    return `GREATEST(COALESCE(${alias}.${mappings.inventoryStockOnHand}, 0), 0)`;
  }

  // Calculate from additions and deductions
  const additions = [
    mappings.inventoryBeginningBalance,
    mappings.inventoryReceivedDuringPeriod,
    mappings.inventoryTransferredIn,
  ]
    .filter(Boolean)
    .map((column) => `COALESCE(${alias}.${column}, 0)`);

  const deductions = [
    mappings.inventoryTransferredOut,
    mappings.inventoryExpiredWasted,
    mappings.inventoryIssuance,
  ]
    .filter(Boolean)
    .map((column) => `COALESCE(${alias}.${column}, 0)`);

  const additionExpression = additions.length ? additions.join(' + ') : '0';

  // If no columns available, default to 0
  if (!additions.length && !deductions.length) {
    return '0';
  }

  if (!deductions.length) {
    return `GREATEST(${additionExpression}, 0)`;
  }

  return `GREATEST((${additionExpression}) - (${deductions.join(' + ')}), 0)`;
};

const buildStockAlertSeverityExpression = ({ alias, mappings, stockExpr, lowThresholdExpr, criticalThresholdExpr }) => {
  const priorityExpr = mappings.stockAlertsPriority
    ? `LOWER(COALESCE(${alias}.${mappings.stockAlertsPriority}::text, ''))`
    : null;
  const typeExpr = mappings.stockAlertsAlertType
    ? `LOWER(COALESCE(${alias}.${mappings.stockAlertsAlertType}::text, ''))`
    : null;

  const predicates = [
    priorityExpr ? `${priorityExpr} IN ('critical', 'urgent', 'high')` : null,
    typeExpr ? `${typeExpr} IN ('critical', 'critical_stock', 'out_of_stock')` : null,
    `${stockExpr} <= ${criticalThresholdExpr}`,
  ].filter(Boolean);

  const warningPredicates = [
    typeExpr ? `${typeExpr} IN ('low_stock', 'warning')` : null,
    `${stockExpr} <= ${lowThresholdExpr}`,
  ].filter(Boolean);

  return `
    CASE
      WHEN ${predicates.join(' OR ')} THEN 'critical'
      WHEN ${warningPredicates.join(' OR ')} THEN 'warning'
      ELSE 'warning'
    END
  `;
};

const buildStockAlertMessageExpression = ({ alias, mappings, stockExpr }) => {
  if (mappings.stockAlertsMessage) {
    return `COALESCE(NULLIF(${alias}.${mappings.stockAlertsMessage}, ''), CONCAT(COALESCE(v.name, 'Vaccine'), ' stock is low (', ${stockExpr}, ' remaining)'))`;
  }

  return `CONCAT(COALESCE(v.name, 'Vaccine'), ' stock is low (', ${stockExpr}, ' remaining)')`;
};

const buildStockAlertTimestampExpression = ({ alias, mappings }) => {
  const candidates = [
    mappings.stockAlertsUpdatedAt ? `${alias}.${mappings.stockAlertsUpdatedAt}` : null,
    mappings.stockAlertsCreatedAt ? `${alias}.${mappings.stockAlertsCreatedAt}` : null,
    mappings.stockAlertsResolvedAt ? `${alias}.${mappings.stockAlertsResolvedAt}` : null,
    mappings.stockAlertsAcknowledgedAt ? `${alias}.${mappings.stockAlertsAcknowledgedAt}` : null,
  ].filter(Boolean);

  if (!candidates.length) {
    return 'CURRENT_TIMESTAMP';
  }

  return `COALESCE(${candidates.join(', ')}, CURRENT_TIMESTAMP)`;
};

const buildActiveStockAlertPredicate = ({ alias, mappings }) => {
  if (!mappings.stockAlertsStatus) {
    return 'TRUE';
  }

  const statusExpr = `LOWER(COALESCE(${alias}.${mappings.stockAlertsStatus}::text, ''))`;
  return `${statusExpr} NOT IN ('resolved', 'inactive', 'closed')`;
};

const mapRows = async (query, params) => {
  const result = await db.query(query, params);
  return result.rows || [];
};

const getVaccineDimension = async () => {
  const rows = await mapRows(
    `
      WITH mapped AS (
        SELECT
          v.id AS vaccine_id,
          ${VACCINE_KEY_CASE_SQL} AS vaccine_key
        FROM vaccines v
        WHERE COALESCE(v.is_active, true) = true
      )
      SELECT
        m.vaccine_id,
        m.vaccine_key,
        ${vaccineNameCaseFromKeyExpression('m.vaccine_key')} AS vaccine_name
      FROM mapped m
      WHERE m.vaccine_key = ANY($1::text[])
      ORDER BY array_position($1::text[], m.vaccine_key), m.vaccine_id
    `,
    [REQUIRED_VACCINE_KEYS],
  );

  return rows;
};

const getInfantGuardianTotals = async ({ facilityId, guardianId }) => {
  const { patientsScope, patientsScopeFallback } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);

  const rows = await mapRows(
    `
      SELECT
        (
          SELECT COUNT(*)::int
          FROM patients p
          WHERE COALESCE(p.is_active, true) = true
            AND ($1::int IS NULL OR p.guardian_id = $1)
        ) AS total_infants,
        (
          SELECT COUNT(DISTINCT p.guardian_id)::int
          FROM patients p
          WHERE COALESCE(p.is_active, true) = true
            AND p.guardian_id IS NOT NULL
            AND ($1::int IS NULL OR p.guardian_id = $1)
        ) AS total_guardians
    `,
    [guardianId],
  );

  return rows[0] || { total_infants: 0, total_guardians: 0 };
};

const getVaccinationSnapshot = async ({
  facilityId,
  startDate,
  endDate,
  vaccineIds,
  statuses,
  overdueOnly,
  guardianId,
}) => {
  const { patientsScope, patientsScopeFallback, immunizationStatus } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);
  const immunizationStatusExpr = buildImmunizationStatusExpression({
    alias: 'ir',
    statusColumn: immunizationStatus,
  });

  const rows = await mapRows(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE (
            ir.admin_date = CURRENT_DATE
            OR (ir.admin_date IS NULL AND ir.created_at::date = CURRENT_DATE)
          )
          AND ${immunizationStatusExpr} IN ('completed', 'attended')
        )::int AS completed_today,
        COUNT(*) FILTER (
          WHERE (
            ir.admin_date BETWEEN $1::date AND $2::date
            OR (ir.admin_date IS NULL AND ir.created_at::date BETWEEN $1::date AND $2::date)
          )
          AND ${immunizationStatusExpr} IN ('completed', 'attended')
        )::int AS administered_in_period,
        COUNT(*) FILTER (
          WHERE ir.next_due_date BETWEEN $1::date AND $2::date
            AND ${immunizationStatusExpr} IN ('scheduled', 'pending')
        )::int AS due_in_period,
        COUNT(*) FILTER (
          WHERE ir.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
            AND ${immunizationStatusExpr} IN ('scheduled', 'pending')
        )::int AS due_soon_7_days,
        COUNT(*) FILTER (
          WHERE ir.next_due_date < CURRENT_DATE
            AND ${immunizationStatusExpr} IN ('scheduled', 'pending')
        )::int AS overdue_count,
        COUNT(DISTINCT ir.patient_id) FILTER (
          WHERE (
            ir.admin_date BETWEEN $1::date AND $2::date
            OR (ir.admin_date IS NULL AND ir.created_at::date BETWEEN $1::date AND $2::date)
          )
          AND ${immunizationStatusExpr} IN ('completed', 'attended')
        )::int AS unique_infants_served
      FROM immunization_records ir
      JOIN patients p ON p.id = ir.patient_id
      WHERE COALESCE(ir.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND ($6::int IS NULL OR p.guardian_id = $6)
        AND ($3::int[] IS NULL OR ir.vaccine_id = ANY($3::int[]))
        AND (
          $4::text[] IS NULL
          OR ${immunizationStatusExpr} = ANY($4::text[])
        )
        AND (
          $5::boolean = false
          OR (
            ir.next_due_date < CURRENT_DATE
            AND ${immunizationStatusExpr} IN ('scheduled', 'pending')
          )
        )
    `,
    [
      startDate,
      endDate,
      toNullableArray(vaccineIds),
      toNullableArray(statuses),
      Boolean(overdueOnly),
      guardianId,
    ],
  );

  return rows[0] || {
    completed_today: 0,
    administered_in_period: 0,
    due_in_period: 0,
    due_soon_7_days: 0,
    overdue_count: 0,
    unique_infants_served: 0,
  };
};

const getVaccinationStatusBreakdown = async ({
  facilityId,
  startDate,
  endDate,
  vaccineIds,
  statuses,
  guardianId,
}) => {
  const { patientsScope, patientsScopeFallback, immunizationStatus } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);
  const immunizationStatusExpr = buildImmunizationStatusExpression({
    alias: 'ir',
    statusColumn: immunizationStatus,
  });

  const rows = await mapRows(
    `
      SELECT
        ${immunizationStatusExpr} AS status,
        COUNT(*)::int AS count
      FROM immunization_records ir
      JOIN patients p ON p.id = ir.patient_id
      WHERE COALESCE(ir.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
        AND ($6::int IS NULL OR p.guardian_id = $6)
        AND ($2::int[] IS NULL OR ir.vaccine_id = ANY($2::int[]))
        AND (
          COALESCE(ir.admin_date, ir.next_due_date, ir.created_at::date) BETWEEN $3::date AND $4::date
        )
        AND (
          $5::text[] IS NULL
          OR ${immunizationStatusExpr} = ANY($5::text[])
        )
      GROUP BY ${immunizationStatusExpr}
      ORDER BY count DESC
    `,
    [facilityId, toNullableArray(vaccineIds), startDate, endDate, toNullableArray(statuses), guardianId],
  );

  return rows;
};

const getAppointmentSnapshot = async ({
  facilityId,
  startDate,
  endDate,
  statuses,
  overdueOnly,
  guardianId,
}) => {
  const {
    appointmentsScope,
    appointmentsScopeFallback,
    appointmentsPatient,
    appointmentsPatientFallback,
    patientsScope,
    patientsScopeFallback,
  } = await getSchemaColumnMappings();
  const appointmentPatientExpr = buildScopedColumnExpression(
    'a',
    appointmentsPatient,
    appointmentsPatientFallback,
  );
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);
  const appointmentScopeExpr = buildScopedColumnExpression(
    'a',
    appointmentsScope,
    appointmentsScopeFallback,
  );

  const rows = await mapRows(
    `
      SELECT
        COUNT(*) FILTER (WHERE a.scheduled_date::date BETWEEN $2::date AND $3::date)::int AS total_in_period,
        COUNT(*) FILTER (WHERE a.scheduled_date::date = CURRENT_DATE)::int AS today_total,
        COUNT(*) FILTER (
          WHERE a.scheduled_date::date BETWEEN $2::date AND $3::date
            AND a.status = 'attended'
        )::int AS attended_in_period,
        COUNT(*) FILTER (
          WHERE a.scheduled_date::date BETWEEN $2::date AND $3::date
            AND a.status IN ('scheduled', 'confirmed', 'rescheduled')
        )::int AS pending_in_period,
        COUNT(*) FILTER (
          WHERE a.scheduled_date::date BETWEEN $2::date AND $3::date
            AND a.status = 'cancelled'
        )::int AS cancelled_in_period,
        COUNT(*) FILTER (
          WHERE a.scheduled_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
            AND a.status IN ('scheduled', 'confirmed', 'rescheduled')
        )::int AS upcoming_7_days,
        COUNT(*) FILTER (
          WHERE a.scheduled_date::date < CURRENT_DATE
            AND a.status IN ('scheduled', 'confirmed', 'rescheduled', 'no-show')
        )::int AS overdue_followups,
        COUNT(*) FILTER (
          WHERE a.scheduled_date::date = CURRENT_DATE
            AND LOWER(COALESCE(a.type, '')) LIKE '%follow%'
        )::int AS followups_today,
        COUNT(*) FILTER (
          WHERE a.scheduled_date::date BETWEEN $2::date AND $3::date
            AND LOWER(COALESCE(a.type, '')) LIKE '%follow%'
        )::int AS followups_in_period
      FROM appointments a
      LEFT JOIN patients p ON p.id = ${appointmentPatientExpr}
      WHERE COALESCE(a.is_active, true) = true
        AND ($1::int IS NULL OR COALESCE(${patientScopeExpr}, ${appointmentScopeExpr}) = $1)
        AND ($6::int IS NULL OR p.guardian_id = $6)
        AND (
          $4::text[] IS NULL
          OR LOWER(a.status::text) = ANY($4::text[])
        )
        AND (
          $5::boolean = false
          OR (
            a.scheduled_date::date < CURRENT_DATE
            AND a.status IN ('scheduled', 'confirmed', 'rescheduled', 'no-show')
          )
        )
    `,
    [facilityId, startDate, endDate, toNullableArray(statuses), Boolean(overdueOnly), guardianId],
  );

  return rows[0] || {
    total_in_period: 0,
    today_total: 0,
    attended_in_period: 0,
    pending_in_period: 0,
    cancelled_in_period: 0,
    upcoming_7_days: 0,
    overdue_followups: 0,
    followups_today: 0,
    followups_in_period: 0,
  };
};

const getAppointmentStatusBreakdown = async ({
  facilityId,
  startDate,
  endDate,
  statuses,
  guardianId,
}) => {
  const {
    appointmentsScope,
    appointmentsScopeFallback,
    appointmentsPatient,
    appointmentsPatientFallback,
    patientsScope,
    patientsScopeFallback,
  } = await getSchemaColumnMappings();
  const appointmentPatientExpr = buildScopedColumnExpression(
    'a',
    appointmentsPatient,
    appointmentsPatientFallback,
  );
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);
  const appointmentScopeExpr = buildScopedColumnExpression(
    'a',
    appointmentsScope,
    appointmentsScopeFallback,
  );

  const rows = await mapRows(
    `
      SELECT
        LOWER(a.status::text) AS status,
        COUNT(*)::int AS count
      FROM appointments a
      LEFT JOIN patients p ON p.id = ${appointmentPatientExpr}
      WHERE COALESCE(a.is_active, true) = true
        AND ($1::int IS NULL OR COALESCE(${patientScopeExpr}, ${appointmentScopeExpr}) = $1)
        AND ($5::int IS NULL OR p.guardian_id = $5)
        AND a.scheduled_date::date BETWEEN $2::date AND $3::date
        AND (
          $4::text[] IS NULL
          OR LOWER(a.status::text) = ANY($4::text[])
        )
      GROUP BY LOWER(a.status::text)
      ORDER BY count DESC
    `,
    [facilityId, startDate, endDate, toNullableArray(statuses), guardianId],
  );

  return rows;
};

const getInventorySnapshot = async ({ facilityId, vaccineIds }) => {
  const mappings = await getSchemaColumnMappings();
  const {
    inventoryLowStockThreshold,
    inventoryCriticalStockThreshold,
  } = mappings;
  // NOTE: inventory table has no facility scoping, so we ignore inventoryScope
  const stockExpr = buildInventoryStockExpression({ alias: 'vi', mappings });
  const lowThresholdExpr = inventoryLowStockThreshold
    ? `COALESCE(vi.${inventoryLowStockThreshold}, 0)`
    : '10';
  const criticalThresholdExpr = inventoryCriticalStockThreshold
    ? `COALESCE(vi.${inventoryCriticalStockThreshold}, 0)`
    : '5';

  // Build WHERE clause - no facility filtering for inventory table
  const whereConditions = ['COALESCE(vi.is_active, true) = true'];
  const params = [];
  let paramIndex = 1;
  
  // Inventory table is global, no facility filtering
  
  whereConditions.push(`($${paramIndex}::int[] IS NULL OR vi.vaccine_id = ANY($${paramIndex}::int[]))`);
  params.push(toNullableArray(vaccineIds));

  const rows = await mapRows(
    `
      SELECT
        COUNT(*)::int AS total_items,
        COALESCE(SUM(${stockExpr}), 0)::int AS total_available_doses,
        COUNT(*) FILTER (
          WHERE ${stockExpr} <= ${lowThresholdExpr}
        )::int AS low_stock_count,
        COUNT(*) FILTER (
          WHERE ${stockExpr} <= ${criticalThresholdExpr}
        )::int AS critical_stock_count,
        COUNT(*) FILTER (WHERE ${stockExpr} <= 0)::int AS out_of_stock_count
      FROM vaccine_inventory vi
      WHERE ${whereConditions.join(' AND ')}
    `,
    params,
  );

  return rows[0] || {
    total_items: 0,
    total_available_doses: 0,
    low_stock_count: 0,
    critical_stock_count: 0,
    out_of_stock_count: 0,
  };
};

const getInventoryByVaccine = async ({ facilityId, vaccineIds, vaccineKeys }) => {
  const mappings = await getSchemaColumnMappings();
  const {
    inventoryLowStockThreshold,
    inventoryCriticalStockThreshold,
  } = mappings;
  // NOTE: inventory table has no facility scoping, so we ignore inventoryScope
  const stockExpr = buildInventoryStockExpression({ alias: 'vi', mappings });
  const lowThresholdExpr = inventoryLowStockThreshold
    ? `COALESCE(vi.${inventoryLowStockThreshold}, 0)`
    : '10';
  const criticalThresholdExpr = inventoryCriticalStockThreshold
    ? `COALESCE(vi.${inventoryCriticalStockThreshold}, 0)`
    : '5';

  // Build JOIN conditions - no facility filtering for inventory table
  const joinConditions = [
    'vi.vaccine_id = vd.vaccine_id',
    'COALESCE(vi.is_active, true) = true',
  ];
  const params = [];
  let paramIndex = 1;
  
  // Inventory table is global, no facility filtering
  
  joinConditions.push(`($${paramIndex}::int[] IS NULL OR vi.vaccine_id = ANY($${paramIndex}::int[]))`);
  params.push(toNullableArray(vaccineIds));
  paramIndex++;
  
  params.push(vaccineKeys);

  const rows = await mapRows(
    `
      WITH vaccine_dim AS (
        SELECT
          v.id AS vaccine_id,
          ${VACCINE_KEY_CASE_SQL} AS vaccine_key
        FROM vaccines v
        WHERE COALESCE(v.is_active, true) = true
      ),
      inventory_rollup AS (
        SELECT
          vd.vaccine_key,
          COALESCE(SUM(${stockExpr}), 0)::int AS available_doses,
          BOOL_OR(${stockExpr} <= ${lowThresholdExpr}) AS low_stock,
          BOOL_OR(${stockExpr} <= ${criticalThresholdExpr}) AS critical_stock
        FROM vaccine_dim vd
        LEFT JOIN vaccine_inventory vi
          ON ${joinConditions.join(' AND ')}
        WHERE vd.vaccine_key = ANY($${paramIndex}::text[])
        GROUP BY vd.vaccine_key
      )
      SELECT
        ir.vaccine_key,
        ${vaccineNameCaseFromKeyExpression('ir.vaccine_key')} AS vaccine_name,
        ir.available_doses,
        COALESCE(ir.low_stock, false) AS low_stock,
        COALESCE(ir.critical_stock, false) AS critical_stock
      FROM inventory_rollup ir
      ORDER BY ir.vaccine_key
    `,
    params,
  );

  return rows;
};
const getVaccineProgress = async ({
  facilityId,
  startDate,
  endDate,
  vaccineIds,
  statuses,
  vaccineKeys,
  guardianId,
}) => {
  const { patientsScope, patientsScopeFallback, immunizationStatus } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);
  const immunizationStatusExpr = buildImmunizationStatusExpression({
    alias: 'ir',
    statusColumn: immunizationStatus,
  });

  const rows = await mapRows(
    `
      WITH vaccine_dim AS (
        SELECT
          v.id AS vaccine_id,
          ${VACCINE_KEY_CASE_SQL} AS vaccine_key
        FROM vaccines v
        WHERE COALESCE(v.is_active, true) = true
      ),
      filtered_records AS (
        SELECT
          ir.patient_id,
          ir.vaccine_id,
          ${immunizationStatusExpr} AS status,
          ir.admin_date::date AS admin_date,
          ir.next_due_date::date AS next_due_date
        FROM immunization_records ir
        JOIN patients p ON p.id = ir.patient_id
        WHERE COALESCE(ir.is_active, true) = true
          AND COALESCE(p.is_active, true) = true
          AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
          AND ($7::int IS NULL OR p.guardian_id = $7)
      )
      SELECT
        vd.vaccine_key,
        ${vaccineNameCaseFromKeyExpression('vd.vaccine_key')} AS vaccine_name,
        COUNT(fr.*) FILTER (
          WHERE fr.admin_date BETWEEN $2::date AND $3::date
            AND fr.status IN ('completed', 'attended')
        )::int AS doses_administered,
        COUNT(DISTINCT fr.patient_id) FILTER (
          WHERE fr.admin_date BETWEEN $2::date AND $3::date
            AND fr.status IN ('completed', 'attended')
        )::int AS infants_covered,
        COUNT(fr.*) FILTER (
          WHERE fr.next_due_date BETWEEN $2::date AND $3::date
            AND fr.status IN ('scheduled', 'pending')
        )::int AS due_count,
        COUNT(fr.*) FILTER (
          WHERE fr.next_due_date < CURRENT_DATE
            AND fr.status IN ('scheduled', 'pending')
        )::int AS overdue_count
      FROM vaccine_dim vd
      LEFT JOIN filtered_records fr
        ON fr.vaccine_id = vd.vaccine_id
        AND ($4::int[] IS NULL OR fr.vaccine_id = ANY($4::int[]))
        AND ($5::text[] IS NULL OR fr.status = ANY($5::text[]))
      WHERE vd.vaccine_key = ANY($6::text[])
      GROUP BY vd.vaccine_key
      ORDER BY array_position($6::text[], vd.vaccine_key)
    `,
    [
      facilityId,
      startDate,
      endDate,
      toNullableArray(vaccineIds),
      toNullableArray(statuses),
      vaccineKeys,
      guardianId,
    ],
  );

  return rows;
};

const getDailyVaccinationTrend = async ({
  facilityId,
  startDate,
  endDate,
  vaccineIds,
  statuses,
  guardianId,
}) => {
  const { patientsScope, patientsScopeFallback, immunizationStatus } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);
  const immunizationStatusExpr = buildImmunizationStatusExpression({
    alias: 'ir',
    statusColumn: immunizationStatus,
  });

  const rows = await mapRows(
    `
      SELECT
        ir.admin_date::date AS day,
        COUNT(*)::int AS count
      FROM immunization_records ir
      JOIN patients p ON p.id = ir.patient_id
      WHERE COALESCE(ir.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND ir.admin_date BETWEEN $2::date AND $3::date
        AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
        AND ($6::int IS NULL OR p.guardian_id = $6)
        AND ($4::int[] IS NULL OR ir.vaccine_id = ANY($4::int[]))
        AND (
          $5::text[] IS NULL
          OR ${immunizationStatusExpr} = ANY($5::text[])
        )
      GROUP BY ir.admin_date::date
      ORDER BY ir.admin_date::date ASC
    `,
    [facilityId, startDate, endDate, toNullableArray(vaccineIds), toNullableArray(statuses), guardianId],
  );

  return rows;
};

const getDailyAppointmentTrend = async ({ facilityId, startDate, endDate, statuses, guardianId }) => {
  const {
    appointmentsScope,
    appointmentsScopeFallback,
    appointmentsPatient,
    appointmentsPatientFallback,
    patientsScope,
    patientsScopeFallback,
  } = await getSchemaColumnMappings();
  const appointmentPatientExpr = buildScopedColumnExpression(
    'a',
    appointmentsPatient,
    appointmentsPatientFallback,
  );
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);
  const appointmentScopeExpr = buildScopedColumnExpression(
    'a',
    appointmentsScope,
    appointmentsScopeFallback,
  );

  const rows = await mapRows(
    `
      SELECT
        a.scheduled_date::date AS day,
        COUNT(*)::int AS count
      FROM appointments a
      LEFT JOIN patients p ON p.id = ${appointmentPatientExpr}
      WHERE COALESCE(a.is_active, true) = true
        AND a.scheduled_date::date BETWEEN $2::date AND $3::date
        AND ($1::int IS NULL OR COALESCE(${patientScopeExpr}, ${appointmentScopeExpr}) = $1)
        AND ($5::int IS NULL OR p.guardian_id = $5)
        AND (
          $4::text[] IS NULL
          OR LOWER(a.status::text) = ANY($4::text[])
        )
      GROUP BY a.scheduled_date::date
      ORDER BY a.scheduled_date::date ASC
    `,
    [facilityId, startDate, endDate, toNullableArray(statuses), guardianId],
  );

  return rows;
};

const getDemographics = async ({ facilityId, guardianId }) => {
  const {
    patientsScope,
    patientsScopeFallback,
    patientsSex,
    patientsGender,
  } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);
  const patientSexExpr = patientsSex ? `p.${patientsSex}` : 'NULL';
  const patientGenderExpr = patientsGender ? `p.${patientsGender}` : 'NULL';

  const ageRows = await mapRows(
    `
      WITH scoped_patients AS (
        SELECT
          p.id,
          p.dob
        FROM patients p
        WHERE COALESCE(p.is_active, true) = true
          AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
          AND ($2::int IS NULL OR p.guardian_id = $2)
      )
      SELECT
        buckets.label,
        buckets.sort_order,
        COALESCE(
          COUNT(sp.id) FILTER (
            WHERE sp.dob IS NOT NULL
              AND (
                (buckets.sort_order = 1 AND AGE(CURRENT_DATE, sp.dob) < INTERVAL '6 months')
                OR (
                  buckets.sort_order = 2
                  AND AGE(CURRENT_DATE, sp.dob) >= INTERVAL '6 months'
                  AND AGE(CURRENT_DATE, sp.dob) < INTERVAL '12 months'
                )
                OR (
                  buckets.sort_order = 3
                  AND AGE(CURRENT_DATE, sp.dob) >= INTERVAL '12 months'
                  AND AGE(CURRENT_DATE, sp.dob) < INTERVAL '24 months'
                )
                OR (buckets.sort_order = 4 AND AGE(CURRENT_DATE, sp.dob) >= INTERVAL '24 months')
              )
          ),
          0
        )::int AS count
      FROM (
        VALUES
          (1, '0-5 months'),
          (2, '6-11 months'),
          (3, '12-23 months'),
          (4, '24+ months')
      ) AS buckets(sort_order, label)
      LEFT JOIN scoped_patients sp ON true
      GROUP BY buckets.label, buckets.sort_order
      ORDER BY buckets.sort_order ASC
    `,
    [facilityId, guardianId],
  );

  const genderRows = await mapRows(
    `
      WITH scoped_patients AS (
        SELECT
          p.id,
          ${patientSexExpr} AS sex,
          ${patientGenderExpr} AS gender
        FROM patients p
        WHERE COALESCE(p.is_active, true) = true
          AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
          AND ($2::int IS NULL OR p.guardian_id = $2)
      ),
      gender_counts AS (
        SELECT
          CASE
            WHEN UPPER(COALESCE(NULLIF(sp.sex, ''), NULLIF(sp.gender, ''), 'UNKNOWN')) LIKE 'M%' THEN 'Male'
            WHEN UPPER(COALESCE(NULLIF(sp.sex, ''), NULLIF(sp.gender, ''), 'UNKNOWN')) LIKE 'F%' THEN 'Female'
            ELSE 'Other / Not specified'
          END AS label,
          COUNT(*)::int AS count
        FROM scoped_patients sp
        GROUP BY 1
      )
      SELECT
        labels.label,
        COALESCE(gc.count, 0)::int AS count
      FROM (
        VALUES
          ('Male', 1),
          ('Female', 2),
          ('Other / Not specified', 3)
      ) AS labels(label, sort_order)
      LEFT JOIN gender_counts gc ON gc.label = labels.label
      ORDER BY labels.sort_order ASC
    `,
    [facilityId, guardianId],
  );

  const coverageRows = await mapRows(
    `
      SELECT
        COUNT(*)::int AS infants,
        COUNT(DISTINCT p.guardian_id)::int AS guardians
      FROM patients p
      WHERE COALESCE(p.is_active, true) = true
        AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
        AND ($2::int IS NULL OR p.guardian_id = $2)
    `,
    [facilityId, guardianId],
  );

  return {
    ageGroups: ageRows,
    genderBreakdown: genderRows,
    coverage: coverageRows[0] || { infants: 0, guardians: 0 },
  };
};

const getReminderStats = async ({ startDate, endDate, facilityId = null }) => {
  const {
    notificationsScope,
    notificationsScopeFallback,
    notificationsChannel,
    notificationsStatus,
    notificationsIsRead,
  } = await getSchemaColumnMappings();
  const notificationScopeExpr = buildScopedColumnExpression(
    'n',
    notificationsScope,
    notificationsScopeFallback,
  );

  const channelExpr = notificationsChannel
    ? `LOWER(COALESCE(n.${notificationsChannel}::text, ''))`
    : '\'\'';
  const statusExpr = notificationsStatus
    ? `LOWER(COALESCE(n.${notificationsStatus}::text, ''))`
    : '\'\'';
  const unreadExpr = notificationsIsRead
    ? `COALESCE(n.${notificationsIsRead}, false)`
    : 'false';

  const hasNotificationFacilityScope = notificationScopeExpr !== 'NULL';
  const notificationsScopeClause = hasNotificationFacilityScope
    ? ` AND ($3::int IS NULL OR ${notificationScopeExpr} = $3)`
    : '';

  const notificationParams = hasNotificationFacilityScope
    ? [startDate, endDate, facilityId]
    : [startDate, endDate];

  const notificationRows = await mapRows(
    `
      SELECT
        COUNT(*) FILTER (WHERE ${channelExpr} = 'sms')::int AS sms_sent,
        COUNT(*) FILTER (
          WHERE ${channelExpr} = 'sms'
            AND ${statusExpr} IN ('delivered', 'read')
        )::int AS sms_delivered,
        COUNT(*) FILTER (
          WHERE ${channelExpr} = 'sms'
            AND ${statusExpr} = 'failed'
        )::int AS sms_failed,
        COUNT(*) FILTER (WHERE ${unreadExpr} = false)::int AS unread_notifications
      FROM notifications n
      WHERE n.created_at::date BETWEEN $1::date AND $2::date
      ${notificationsScopeClause}
    `,
    notificationParams,
  );

  const smsRows = await mapRows(
    `
      SELECT
        COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status, '')) = 'failed')::int AS sms_log_failed,
        COUNT(*)::int AS sms_log_total
      FROM sms_logs s
      WHERE s.created_at::date BETWEEN $1::date AND $2::date
    `,
    [startDate, endDate],
  );

  return {
    ...(notificationRows[0] || {
      sms_sent: 0,
      sms_delivered: 0,
      sms_failed: 0,
      unread_notifications: 0,
    }),
    ...(smsRows[0] || { sms_log_failed: 0, sms_log_total: 0 }),
  };
};

const getRecentActivity = async ({
  facilityId,
  startDate,
  endDate,
  limit,
  guardianId,
}) => {
  const {
    appointmentsScope,
    appointmentsScopeFallback,
    appointmentsPatient,
    appointmentsPatientFallback,
    patientsScope,
    patientsScopeFallback,
    immunizationStatus,
    inventoryTransactionsScope,
    inventoryTransactionsScopeFallback,
    notificationsScope,
    notificationsScopeFallback,
    notificationsTitle,
    notificationsSubject,
    notificationsMessage,
    notificationsType,
    notificationsStatus,
    notificationsPriority,
  } = await getSchemaColumnMappings();
  const appointmentPatientExpr = buildScopedColumnExpression(
    'a',
    appointmentsPatient,
    appointmentsPatientFallback,
  );
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);
  const immunizationStatusExpr = buildImmunizationStatusExpression({
    alias: 'ir',
    statusColumn: immunizationStatus,
  });
  const appointmentScopeExpr = buildScopedColumnExpression(
    'a',
    appointmentsScope,
    appointmentsScopeFallback,
  );
  const inventoryTxnScopeExpr = buildScopedColumnExpression(
    'vit',
    inventoryTransactionsScope,
    inventoryTransactionsScopeFallback,
  );
  const notificationScopeExpr = buildScopedColumnExpression(
    'n',
    notificationsScope,
    notificationsScopeFallback,
  );

  const notificationTitleExpr = notificationsTitle
    ? `NULLIF(n.${notificationsTitle}, '')`
    : null;
  const notificationSubjectExpr = notificationsSubject
    ? `NULLIF(n.${notificationsSubject}, '')`
    : null;
  const notificationMessageExpr = notificationsMessage
    ? `NULLIF(n.${notificationsMessage}, '')`
    : null;
  const notificationTypeExpr = notificationsType
    ? `NULLIF(n.${notificationsType}, '')`
    : null;
  const notificationStatusExpr = notificationsStatus
    ? `LOWER(COALESCE(n.${notificationsStatus}::text, ''))`
    : '\'\'';
  const notificationPriorityExpr = notificationsPriority
    ? `LOWER(COALESCE(n.${notificationsPriority}::text, ''))`
    : '\'\'';

  const notificationTitleFallback = [
    notificationTitleExpr,
    notificationSubjectExpr,
    '\'Notification\'',
  ]
    .filter(Boolean)
    .join(', ');

  const notificationDescriptionFallback = [
    notificationSubjectExpr,
    notificationMessageExpr,
    notificationTypeExpr,
    '\'Notification event\'',
  ]
    .filter(Boolean)
    .join(', ');

  const notificationScopeClause = notificationScopeExpr !== 'NULL'
    ? ` AND ($1::int IS NULL OR ${notificationScopeExpr} = $1)`
    : '';

  const rows = await mapRows(
    `
      SELECT *
      FROM (
        SELECT
          CONCAT('vaccination-', ir.id)::text AS id,
          'vaccination'::text AS type,
          COALESCE(v.name, 'Vaccination')::text AS title,
          CONCAT(
            'Recorded for ',
            COALESCE(p.first_name, 'Infant'),
            ' ',
            COALESCE(p.last_name, '')
          )::text AS description,
          ir.created_at AS activity_at,
          CASE
            WHEN ${immunizationStatusExpr} IN ('completed', 'attended')
              THEN 'success'
            ELSE 'info'
          END::text AS severity
        FROM immunization_records ir
        JOIN patients p ON p.id = ir.patient_id
        LEFT JOIN vaccines v ON v.id = ir.vaccine_id
        WHERE COALESCE(ir.is_active, true) = true
          AND COALESCE(p.is_active, true) = true
          AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
          AND ($5::int IS NULL OR p.guardian_id = $5)
          AND ir.created_at::date BETWEEN $2::date AND $3::date

        UNION ALL

        SELECT
          CONCAT('appointment-', a.id)::text AS id,
          'appointment'::text AS type,
          'Appointment update'::text AS title,
          CONCAT(
            COALESCE(p.first_name, 'Infant'),
            ' ',
            COALESCE(p.last_name, ''),
            ' - ',
            LOWER(a.status::text)
          )::text AS description,
          a.updated_at AS activity_at,
          CASE
            WHEN a.status = 'cancelled' THEN 'warning'
            WHEN a.status = 'no-show' THEN 'error'
            ELSE 'info'
          END::text AS severity
        FROM appointments a
        LEFT JOIN patients p ON p.id = ${appointmentPatientExpr}
        WHERE COALESCE(a.is_active, true) = true
          AND ($1::int IS NULL OR COALESCE(${patientScopeExpr}, ${appointmentScopeExpr}) = $1)
          AND ($5::int IS NULL OR p.guardian_id = $5)
          AND a.updated_at::date BETWEEN $2::date AND $3::date

        UNION ALL

        SELECT
          CONCAT('inventory-', vit.id)::text AS id,
          'inventory'::text AS type,
          'Inventory movement'::text AS title,
          CONCAT(
            COALESCE(v.name, 'Vaccine'),
            ' ',
            COALESCE(vit.transaction_type, 'update'),
            ' (',
            COALESCE(vit.quantity, 0),
            ')'
          )::text AS description,
          vit.created_at AS activity_at,
          'info'::text AS severity
        FROM vaccine_inventory_transactions vit
        LEFT JOIN vaccines v ON v.id = vit.vaccine_id
        WHERE ($1::int IS NULL OR ${inventoryTxnScopeExpr} = $1)
          AND vit.created_at::date BETWEEN $2::date AND $3::date

        UNION ALL

        SELECT
          CONCAT('notification-', n.id)::text AS id,
          'reminder'::text AS type,
          COALESCE(${notificationTitleFallback})::text AS title,
          COALESCE(${notificationDescriptionFallback})::text AS description,
          n.created_at AS activity_at,
          CASE
            WHEN ${notificationStatusExpr} = 'failed' THEN 'error'
            WHEN ${notificationPriorityExpr} IN ('high', 'urgent', 'critical') THEN 'warning'
            ELSE 'info'
          END::text AS severity
        FROM notifications n
        WHERE n.created_at::date BETWEEN $2::date AND $3::date
          ${notificationScopeClause}
      ) activity
      ORDER BY activity.activity_at DESC
      LIMIT $4::int
    `,
    [facilityId, startDate, endDate, limit, guardianId],
  );

  return rows;
};

const resetSchemaColumnMappingCache = () => {
  schemaColumnMappingPromise = null;
};

const getLowStockAlerts = async ({ facilityId, vaccineIds, limit }) => {
  const mappings = await getSchemaColumnMappings();
  const {
    inventoryScope,
    inventoryScopeFallback,
    inventoryLowStockThreshold,
    inventoryCriticalStockThreshold,
  } = mappings;
  const inventoryScopeExpr = inventoryScope ? buildScopedColumnExpression('vi', inventoryScope, inventoryScopeFallback) : null;
  const stockExpr = buildInventoryStockExpression({ alias: 'vi', mappings });
  const lowThresholdExpr = inventoryLowStockThreshold
    ? `COALESCE(vi.${inventoryLowStockThreshold}, 0)`
    : '10';
  const criticalThresholdExpr = inventoryCriticalStockThreshold
    ? `COALESCE(vi.${inventoryCriticalStockThreshold}, 0)`
    : '5';

  const stockAlertSeverityExpr = buildStockAlertSeverityExpression({
    alias: 'vsa',
    mappings,
    stockExpr,
    lowThresholdExpr,
    criticalThresholdExpr,
  });

  const stockAlertMessageExpr = mappings.stockAlertsMessage
    ? `vsa.${mappings.stockAlertsMessage}`
    : `CONCAT(v.name, ' is low on stock (', ${stockExpr}, ' doses remaining)')`;

  const stockAlertTimestampExpr = mappings.stockAlertsCreatedAt
    ? `vsa.${mappings.stockAlertsCreatedAt}`
    : 'CURRENT_TIMESTAMP';

  // Since inventory table has no facility scoping, we ignore facilityId
  // and just query all low stock items globally
  const rows = await mapRows(
    `
      SELECT
        vi.id::text AS id,
        'inventory'::text AS type,
        CASE 
          WHEN ${stockExpr} <= ${criticalThresholdExpr} THEN 'critical'
          WHEN ${stockExpr} <= ${lowThresholdExpr} THEN 'warning'
          ELSE 'info'
        END AS severity,
        CONCAT(v.name, ' is low on stock (', ${stockExpr}, ' doses remaining)') AS message,
        CURRENT_TIMESTAMP AS alert_at,
        v.id AS vaccine_id,
        v.name AS vaccine_name,
        ${stockExpr}::int AS current_stock,
        ${lowThresholdExpr}::int AS threshold_value
      FROM vaccine_inventory vi
      LEFT JOIN vaccines v ON v.id = vi.vaccine_id
      WHERE COALESCE(vi.is_active, true) = true
        AND ($1::int[] IS NULL OR vi.vaccine_id = ANY($1::int[]))
        AND ${stockExpr} <= ${lowThresholdExpr}
      ORDER BY 
        CASE 
          WHEN ${stockExpr} <= ${criticalThresholdExpr} THEN 0
          ELSE 1
        END ASC,
        ${stockExpr} ASC
      LIMIT $2
    `,
    [toNullableArray(vaccineIds), limit || 50],
  );

  return rows;
};

const getFailedSmsCount = async ({ startDate, endDate }) => {
  const rows = await mapRows(
    `
      SELECT COUNT(*)::int AS failed_count
      FROM sms_logs s
      WHERE s.created_at::date BETWEEN $1::date AND $2::date
        AND LOWER(COALESCE(s.status, '')) = 'failed'
    `,
    [startDate, endDate],
  );

  return rows[0]?.failed_count || 0;
};

module.exports = {
  REQUIRED_VACCINE_KEYS,
  getSchemaColumnMappings,
  resetSchemaColumnMappingCache,
  getVaccineDimension,
  getInfantGuardianTotals,
  getVaccinationSnapshot,
  getVaccinationStatusBreakdown,
  getAppointmentSnapshot,
  getAppointmentStatusBreakdown,
  getInventorySnapshot,
  getInventoryByVaccine,
  getVaccineProgress,
  getDailyVaccinationTrend,
  getDailyAppointmentTrend,
  getDemographics,
  getReminderStats,
  getRecentActivity,
  getLowStockAlerts,
  getFailedSmsCount,
};
