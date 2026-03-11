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
  inventoryScope: 'clinic_id',
  inventoryScopeFallback: null,
  inventoryTransactionsScope: 'clinic_id',
  inventoryTransactionsScopeFallback: null,
  inventoryAlertsScope: 'clinic_id',
  inventoryAlertsScopeFallback: null,
  notificationsScope: null,
  notificationsScopeFallback: null,
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
          'patients',
          'vaccine_inventory',
          'vaccine_inventory_transactions',
          'vaccine_stock_alerts',
          'notifications',
        ],
        ['patient_id', 'infant_id', 'facility_id', 'clinic_id'],
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

    if (available.has('vaccine_inventory.facility_id')) {
      mappings.inventoryScope = 'facility_id';
      mappings.inventoryScopeFallback = available.has('vaccine_inventory.clinic_id')
        ? 'clinic_id'
        : null;
    } else if (available.has('vaccine_inventory.clinic_id')) {
      mappings.inventoryScope = 'clinic_id';
      mappings.inventoryScopeFallback = null;
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
            AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
            AND ($2::int IS NULL OR p.guardian_id = $2)
        ) AS total_infants,
        (
          SELECT COUNT(DISTINCT p.guardian_id)::int
          FROM patients p
          WHERE COALESCE(p.is_active, true) = true
            AND p.guardian_id IS NOT NULL
            AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
            AND ($2::int IS NULL OR p.guardian_id = $2)
        ) AS total_guardians
    `,
    [facilityId, guardianId],
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
  const { patientsScope, patientsScopeFallback } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);

  const rows = await mapRows(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE ir.admin_date = CURRENT_DATE
            AND COALESCE(NULLIF(LOWER(ir.status), ''), 'completed') IN ('completed', 'attended')
        )::int AS completed_today,
        COUNT(*) FILTER (
          WHERE ir.admin_date BETWEEN $2::date AND $3::date
            AND COALESCE(NULLIF(LOWER(ir.status), ''), 'completed') IN ('completed', 'attended')
        )::int AS administered_in_period,
        COUNT(*) FILTER (
          WHERE ir.next_due_date BETWEEN $2::date AND $3::date
            AND COALESCE(NULLIF(LOWER(ir.status), ''), 'scheduled') IN ('scheduled', 'pending')
        )::int AS due_in_period,
        COUNT(*) FILTER (
          WHERE ir.next_due_date < CURRENT_DATE
            AND COALESCE(NULLIF(LOWER(ir.status), ''), 'scheduled') IN ('scheduled', 'pending')
        )::int AS overdue_count,
        COUNT(DISTINCT ir.patient_id) FILTER (
          WHERE ir.admin_date BETWEEN $2::date AND $3::date
            AND COALESCE(NULLIF(LOWER(ir.status), ''), 'completed') IN ('completed', 'attended')
        )::int AS unique_infants_served
      FROM immunization_records ir
      JOIN patients p ON p.id = ir.patient_id
      WHERE COALESCE(ir.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND ($1::int IS NULL OR ${patientScopeExpr} = $1)
        AND ($7::int IS NULL OR p.guardian_id = $7)
        AND ($4::int[] IS NULL OR ir.vaccine_id = ANY($4::int[]))
        AND (
          $5::text[] IS NULL
          OR COALESCE(NULLIF(LOWER(ir.status), ''), 'scheduled') = ANY($5::text[])
        )
        AND (
          $6::boolean = false
          OR (
            ir.next_due_date < CURRENT_DATE
            AND COALESCE(NULLIF(LOWER(ir.status), ''), 'scheduled') IN ('scheduled', 'pending')
          )
        )
    `,
    [
      facilityId,
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
  const { patientsScope, patientsScopeFallback } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);

  const rows = await mapRows(
    `
      SELECT
        COALESCE(NULLIF(LOWER(ir.status), ''), 'scheduled') AS status,
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
          OR COALESCE(NULLIF(LOWER(ir.status), ''), 'scheduled') = ANY($5::text[])
        )
      GROUP BY COALESCE(NULLIF(LOWER(ir.status), ''), 'scheduled')
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
  const { inventoryScope, inventoryScopeFallback } = await getSchemaColumnMappings();
  const inventoryScopeExpr = buildScopedColumnExpression('vi', inventoryScope, inventoryScopeFallback);

  const rows = await mapRows(
    `
      SELECT
        COUNT(*)::int AS total_items,
        COALESCE(SUM(GREATEST(COALESCE(vi.stock_on_hand, 0), 0)), 0)::int AS total_available_doses,
        COUNT(*) FILTER (
          WHERE COALESCE(vi.stock_on_hand, 0) <= COALESCE(vi.low_stock_threshold, 0)
        )::int AS low_stock_count,
        COUNT(*) FILTER (
          WHERE COALESCE(vi.stock_on_hand, 0) <= COALESCE(vi.critical_stock_threshold, 0)
        )::int AS critical_stock_count,
        COUNT(*) FILTER (WHERE COALESCE(vi.stock_on_hand, 0) <= 0)::int AS out_of_stock_count
      FROM vaccine_inventory vi
      WHERE COALESCE(vi.is_active, true) = true
        AND ($1::int IS NULL OR ${inventoryScopeExpr} = $1)
        AND ($2::int[] IS NULL OR vi.vaccine_id = ANY($2::int[]))
    `,
    [facilityId, toNullableArray(vaccineIds)],
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
  const { inventoryScope, inventoryScopeFallback } = await getSchemaColumnMappings();
  const inventoryScopeExpr = buildScopedColumnExpression('vi', inventoryScope, inventoryScopeFallback);

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
          COALESCE(SUM(GREATEST(COALESCE(vi.stock_on_hand, 0), 0)), 0)::int AS available_doses,
          BOOL_OR(COALESCE(vi.stock_on_hand, 0) <= COALESCE(vi.low_stock_threshold, 0)) AS low_stock,
          BOOL_OR(COALESCE(vi.stock_on_hand, 0) <= COALESCE(vi.critical_stock_threshold, 0)) AS critical_stock
        FROM vaccine_dim vd
        LEFT JOIN vaccine_inventory vi
          ON vi.vaccine_id = vd.vaccine_id
          AND COALESCE(vi.is_active, true) = true
          AND ($1::int IS NULL OR ${inventoryScopeExpr} = $1)
          AND ($2::int[] IS NULL OR vi.vaccine_id = ANY($2::int[]))
        WHERE vd.vaccine_key = ANY($3::text[])
        GROUP BY vd.vaccine_key
      )
      SELECT
        ir.vaccine_key,
        ${vaccineNameCaseFromKeyExpression('ir.vaccine_key')} AS vaccine_name,
        ir.available_doses,
        COALESCE(ir.low_stock, false) AS low_stock,
        COALESCE(ir.critical_stock, false) AS critical_stock
      FROM inventory_rollup ir
      ORDER BY array_position($3::text[], ir.vaccine_key)
    `,
    [facilityId, toNullableArray(vaccineIds), vaccineKeys],
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
  const { patientsScope, patientsScopeFallback } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);

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
          COALESCE(NULLIF(LOWER(ir.status), ''), 'scheduled') AS status,
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
  const { patientsScope, patientsScopeFallback } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);

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
          OR COALESCE(NULLIF(LOWER(ir.status), ''), 'scheduled') = ANY($5::text[])
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
  const { patientsScope, patientsScopeFallback } = await getSchemaColumnMappings();
  const patientScopeExpr = buildScopedColumnExpression('p', patientsScope, patientsScopeFallback);

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
          p.sex,
          p.gender
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
  const { notificationsScope, notificationsScopeFallback } = await getSchemaColumnMappings();
  const notificationScopeExpr = buildScopedColumnExpression(
    'n',
    notificationsScope,
    notificationsScopeFallback,
  );

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
        COUNT(*) FILTER (WHERE LOWER(n.channel::text) = 'sms')::int AS sms_sent,
        COUNT(*) FILTER (
          WHERE LOWER(n.channel::text) = 'sms'
            AND LOWER(n.status::text) IN ('delivered', 'read')
        )::int AS sms_delivered,
        COUNT(*) FILTER (
          WHERE LOWER(n.channel::text) = 'sms'
            AND LOWER(n.status::text) = 'failed'
        )::int AS sms_failed,
        COUNT(*) FILTER (WHERE COALESCE(n.is_read, false) = false)::int AS unread_notifications
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
    inventoryTransactionsScope,
    inventoryTransactionsScopeFallback,
    notificationsScope,
    notificationsScopeFallback,
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
            WHEN COALESCE(NULLIF(LOWER(ir.status), ''), 'completed') IN ('completed', 'attended')
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
          COALESCE(NULLIF(n.title, ''), 'Notification')::text AS title,
          COALESCE(NULLIF(n.subject, ''), NULLIF(n.message, ''), n.notification_type)::text AS description,
          n.created_at AS activity_at,
          CASE
            WHEN LOWER(n.status::text) = 'failed' THEN 'error'
            WHEN LOWER(n.priority::text) IN ('high', 'urgent') THEN 'warning'
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
  const { inventoryScope, inventoryScopeFallback } = await getSchemaColumnMappings();
  const inventoryScopeExpr = buildScopedColumnExpression('vi', inventoryScope, inventoryScopeFallback);

  const rows = await mapRows(
    `
      SELECT
        CONCAT('stock-', vi.id)::text AS id,
        'inventory'::text AS type,
        CASE
          WHEN COALESCE(vi.stock_on_hand, 0) <= COALESCE(vi.critical_stock_threshold, 0)
            THEN 'critical'
          ELSE 'warning'
        END::text AS severity,
        CONCAT(
          COALESCE(v.name, 'Vaccine'),
          ' stock is low (',
          COALESCE(vi.stock_on_hand, 0),
          ' remaining)'
        )::text AS message,
        vi.updated_at AS alert_at
      FROM vaccine_inventory vi
      LEFT JOIN vaccines v ON v.id = vi.vaccine_id
      WHERE COALESCE(vi.is_active, true) = true
        AND ($1::int IS NULL OR ${inventoryScopeExpr} = $1)
        AND ($2::int[] IS NULL OR vi.vaccine_id = ANY($2::int[]))
        AND COALESCE(vi.stock_on_hand, 0) <= COALESCE(vi.low_stock_threshold, 0)
      ORDER BY
        CASE
          WHEN COALESCE(vi.stock_on_hand, 0) <= COALESCE(vi.critical_stock_threshold, 0) THEN 0
          ELSE 1
        END ASC,
        COALESCE(vi.stock_on_hand, 0) ASC,
        vi.updated_at DESC
      LIMIT $3::int
    `,
    [facilityId, toNullableArray(vaccineIds), limit],
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
