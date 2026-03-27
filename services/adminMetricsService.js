const pool = require('../db');

const APPOINTMENT_PENDING_STATUSES = Object.freeze(['scheduled', 'confirmed', 'rescheduled']);
const APPOINTMENT_NO_SHOW_STATUSES = Object.freeze(['no_show', 'no-show']);

let schemaPromise = null;

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeScopeIds = (values = []) =>
  [...new Set((Array.isArray(values) ? values : [values]).map(parsePositiveInt).filter(Boolean))];

const parseMetricInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseMetricFloat = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDateInput = (value, label = 'Date') => {
  if (!value) {
    return '';
  }

  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const error = new Error(`${label} must use YYYY-MM-DD format.`);
    error.statusCode = 400;
    error.code = 'INVALID_DATE';
    throw error;
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${label} is invalid.`);
    error.statusCode = 400;
    error.code = 'INVALID_DATE';
    throw error;
  }

  return normalized;
};

const buildScopedColumnExpression = (alias, primaryColumn, fallbackColumn = null) => {
  const primary = primaryColumn ? `${alias}.${primaryColumn}` : null;
  const fallback = fallbackColumn ? `${alias}.${fallbackColumn}` : null;

  if (primary && fallback && primary !== fallback) {
    return `COALESCE(${primary}, ${fallback})`;
  }

  return primary || fallback || 'NULL';
};

const resolveSchema = async () => {
  try {
    const result = await pool.query(
      `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])
      `,
      [['patients', 'appointments', 'guardians', 'vaccine_inventory', 'vaccine_batches', 'users', 'roles']],
    );

    const available = new Set(
      (result.rows || []).map((row) => `${row.table_name}.${row.column_name}`),
    );

    const pickColumn = (tableName, preferred = []) =>
      preferred.find((columnName) => available.has(`${tableName}.${columnName}`)) || null;

    const pickFallbackColumn = (tableName, primaryColumn, candidates = []) =>
      candidates.find(
        (columnName) =>
          columnName &&
          columnName !== primaryColumn &&
          available.has(`${tableName}.${columnName}`),
      ) || null;

    const patientScopeColumn = pickColumn('patients', ['facility_id', 'clinic_id']);
    const appointmentScopeColumn = pickColumn('appointments', ['clinic_id', 'facility_id']);
    const guardianScopeColumn = pickColumn('guardians', ['clinic_id', 'facility_id']);
    const inventoryScopeColumn = pickColumn('vaccine_inventory', ['clinic_id', 'facility_id']);
    const batchScopeColumn = pickColumn('vaccine_batches', ['clinic_id', 'facility_id']);
    const userScopeColumn = pickColumn('users', ['clinic_id', 'facility_id']);

    return {
      patientScopeColumn,
      patientScopeFallbackColumn: pickFallbackColumn(
        'patients',
        patientScopeColumn,
        ['clinic_id', 'facility_id'],
      ),
      appointmentScopeColumn,
      appointmentScopeFallbackColumn: pickFallbackColumn(
        'appointments',
        appointmentScopeColumn,
        ['clinic_id', 'facility_id'],
      ),
      guardianScopeColumn,
      guardianScopeFallbackColumn: pickFallbackColumn(
        'guardians',
        guardianScopeColumn,
        ['clinic_id', 'facility_id'],
      ),
      inventoryScopeColumn,
      inventoryScopeFallbackColumn: pickFallbackColumn(
        'vaccine_inventory',
        inventoryScopeColumn,
        ['clinic_id', 'facility_id'],
      ),
      batchScopeColumn,
      batchScopeFallbackColumn: pickFallbackColumn(
        'vaccine_batches',
        batchScopeColumn,
        ['clinic_id', 'facility_id'],
      ),
      userScopeColumn,
      userScopeFallbackColumn: pickFallbackColumn(
        'users',
        userScopeColumn,
        ['clinic_id', 'facility_id'],
      ),
      inventoryStockColumn: pickColumn('vaccine_inventory', ['stock_on_hand']),
      inventoryLowStockThresholdColumn: pickColumn('vaccine_inventory', ['low_stock_threshold']),
      patientHasIsActive: available.has('patients.is_active'),
      guardianHasIsActive: available.has('guardians.is_active'),
      userHasIsActive: available.has('users.is_active'),
      inventoryHasIsActive: available.has('vaccine_inventory.is_active'),
      batchHasIsActive: available.has('vaccine_batches.is_active'),
      immunizationHasIsActive: true,
      appointmentHasIsActive: available.has('appointments.is_active'),
      immunizationStatusColumn: available.has('immunization_records.status') ? 'status' : null,
    };
  } catch (error) {
    console.error('Error resolving admin metrics schema:', error);
    return {
      patientScopeColumn: 'facility_id',
      patientScopeFallbackColumn: 'clinic_id',
      appointmentScopeColumn: 'clinic_id',
      appointmentScopeFallbackColumn: 'facility_id',
      guardianScopeColumn: 'clinic_id',
      guardianScopeFallbackColumn: 'facility_id',
      inventoryScopeColumn: 'clinic_id',
      inventoryScopeFallbackColumn: 'facility_id',
      batchScopeColumn: 'clinic_id',
      batchScopeFallbackColumn: 'facility_id',
      userScopeColumn: 'clinic_id',
      userScopeFallbackColumn: 'facility_id',
      inventoryStockColumn: 'stock_on_hand',
      inventoryLowStockThresholdColumn: null,
      patientHasIsActive: true,
      guardianHasIsActive: true,
      userHasIsActive: true,
      inventoryHasIsActive: true,
      batchHasIsActive: true,
      immunizationHasIsActive: true,
      appointmentHasIsActive: true,
      immunizationStatusColumn: 'status',
    };
  }
};

const getSchema = async () => {
  if (!schemaPromise) {
    schemaPromise = resolveSchema();
  }

  return schemaPromise;
};

const buildScopeClause = ({
  alias,
  primaryColumn,
  fallbackColumn = null,
  scopeIds = [],
  params,
}) => {
  const normalizedScopeIds = normalizeScopeIds(scopeIds);
  if ((!primaryColumn && !fallbackColumn) || normalizedScopeIds.length === 0) {
    return '';
  }

  const scopeExpression = buildScopedColumnExpression(alias, primaryColumn, fallbackColumn);
  params.push(normalizedScopeIds.length === 1 ? normalizedScopeIds[0] : normalizedScopeIds);
  return normalizedScopeIds.length === 1
    ? ` AND ${scopeExpression} = $${params.length}`
    : ` AND ${scopeExpression} = ANY($${params.length}::int[])`;
};

const buildDateClause = (expression, startDate, endDate, params) => {
  let clause = '';

  if (startDate) {
    params.push(startDate);
    clause += ` AND ${expression} >= $${params.length}`;
  }

  if (endDate) {
    params.push(endDate);
    clause += ` AND ${expression} <= $${params.length}`;
  }

  return clause;
};

const buildImmunizationStatusExpression = (schema, alias = 'ir') => {
  if (schema.immunizationStatusColumn) {
    return `LOWER(COALESCE(NULLIF(${alias}.${schema.immunizationStatusColumn}::text, ''), CASE WHEN ${alias}.admin_date IS NOT NULL THEN 'completed' ELSE 'scheduled' END))`;
  }

  return `LOWER(CASE WHEN ${alias}.admin_date IS NOT NULL THEN 'completed' ELSE 'scheduled' END)`;
};

const buildInventoryStockExpression = (schema, alias = 'vi') => {
  if (schema.inventoryStockColumn) {
    return `GREATEST(COALESCE(${alias}.${schema.inventoryStockColumn}, 0), 0)`;
  }

  return `GREATEST(
    COALESCE(${alias}.beginning_balance, 0)
    + COALESCE(${alias}.received_during_period, 0)
    + COALESCE(${alias}.transferred_in, 0)
    - COALESCE(${alias}.transferred_out, 0)
    - COALESCE(${alias}.expired_wasted, 0)
    - COALESCE(${alias}.issuance, 0),
    0
  )`;
};

const executeMetricsQueries = async ({
  startDate = '',
  endDate = '',
  facilityId = null,
  scopeIds = [],
} = {}) => {
  const schema = await getSchema();
  const resolvedScopeIds = normalizeScopeIds(
    scopeIds.length > 0 ? scopeIds : [facilityId],
  );
  const immunizationStatusExpression = buildImmunizationStatusExpression(schema, 'ir');
  const childStatusExpression = buildImmunizationStatusExpression(schema, 'irx');
  const inventoryStockExpression = buildInventoryStockExpression(schema, 'vi');
  const inventoryLowStockThresholdExpression = schema.inventoryLowStockThresholdColumn
    ? `COALESCE(vi.${schema.inventoryLowStockThresholdColumn}, 10)`
    : '10';
  const patientActiveExpression = schema.patientHasIsActive ? 'COALESCE(p.is_active, true)' : 'true';
  const guardianActiveExpression = schema.guardianHasIsActive ? 'COALESCE(g.is_active, true)' : 'true';
  const inventoryActiveExpression = schema.inventoryHasIsActive ? 'COALESCE(vi.is_active, true)' : 'true';
  const batchActiveExpression = schema.batchHasIsActive ? 'COALESCE(vb.is_active, true)' : 'true';
  const userActiveExpression = schema.userHasIsActive ? 'COALESCE(u.is_active, true)' : 'true';
  const appointmentActiveExpression = schema.appointmentHasIsActive ? 'COALESCE(a.is_active, true)' : 'true';

  const vaccinationParams = [];
  const vaccinationScopeClause = buildScopeClause({
    alias: 'p',
    primaryColumn: schema.patientScopeColumn,
    fallbackColumn: schema.patientScopeFallbackColumn,
    scopeIds: resolvedScopeIds,
    params: vaccinationParams,
  });
  const vaccinationDateClause = buildDateClause('ir.admin_date::date', startDate, endDate, vaccinationParams);
  const vaccinationQuery = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${immunizationStatusExpression} IN ('completed', 'attended'))::int AS completed,
      COUNT(*) FILTER (WHERE ${immunizationStatusExpression} IN ('pending', 'scheduled'))::int AS pending,
      COUNT(*) FILTER (WHERE ${immunizationStatusExpression} = 'cancelled')::int AS cancelled
    FROM immunization_records ir
    JOIN patients p ON p.id = ir.patient_id
    WHERE COALESCE(ir.is_active, true) = true
      AND ${patientActiveExpression}
      ${vaccinationScopeClause}
      ${vaccinationDateClause}
  `;

  const inventoryParams = [];
  const inventoryScopeClause = buildScopeClause({
    alias: 'vi',
    primaryColumn: schema.inventoryScopeColumn,
    fallbackColumn: schema.inventoryScopeFallbackColumn,
    scopeIds: resolvedScopeIds,
    params: inventoryParams,
  });
  const inventoryQuery = `
    SELECT
      COUNT(*)::int AS total_items,
      COUNT(*) FILTER (
        WHERE ${inventoryStockExpression} <= ${inventoryLowStockThresholdExpression}
      )::int AS low_stock_items,
      0::numeric AS total_value
    FROM vaccine_inventory vi
    WHERE ${inventoryActiveExpression}
      ${inventoryScopeClause}
  `;

  const expiredParams = [];
  const batchScopeClause = buildScopeClause({
    alias: 'vb',
    primaryColumn: schema.batchScopeColumn,
    fallbackColumn: schema.batchScopeFallbackColumn,
    scopeIds: resolvedScopeIds,
    params: expiredParams,
  });
  const expiredQuery = `
    SELECT COUNT(*)::int AS expired_items
    FROM vaccine_batches vb
    WHERE ${batchActiveExpression}
      AND vb.expiry_date < CURRENT_DATE
      ${batchScopeClause}
  `;

  const appointmentParams = [];
  const appointmentScopeClause = buildScopeClause({
    alias: 'a',
    primaryColumn: schema.appointmentScopeColumn,
    fallbackColumn: schema.appointmentScopeFallbackColumn,
    scopeIds: resolvedScopeIds,
    params: appointmentParams,
  });
  const appointmentDateClause = buildDateClause('a.scheduled_date::date', startDate, endDate, appointmentParams);
  const appointmentQuery = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(a.status::text, '')) = 'scheduled')::int AS scheduled,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(a.status::text, '')) = 'attended')::int AS completed,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(a.status::text, '')) = 'cancelled')::int AS cancelled,
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(a.status::text, '')) = ANY($${appointmentParams.length + 1}::text[])
      )::int AS no_show,
      COUNT(*) FILTER (
        WHERE a.scheduled_date::date < CURRENT_DATE
          AND LOWER(COALESCE(a.status::text, '')) = ANY($${appointmentParams.length + 2}::text[])
      )::int AS missed_follow_up_load
    FROM appointments a
    WHERE ${appointmentActiveExpression}
      ${appointmentScopeClause}
      ${appointmentDateClause}
  `;
  appointmentParams.push(APPOINTMENT_NO_SHOW_STATUSES, [...APPOINTMENT_PENDING_STATUSES, ...APPOINTMENT_NO_SHOW_STATUSES]);

  const guardianParams = [];
  const guardianScopeClause = buildScopeClause({
    alias: 'g',
    primaryColumn: schema.guardianScopeColumn,
    fallbackColumn: schema.guardianScopeFallbackColumn,
    scopeIds: resolvedScopeIds,
    params: guardianParams,
  });
  const guardianDateClause = buildDateClause('g.created_at::date', startDate, endDate, guardianParams);
  const guardianQuery = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${guardianActiveExpression})::int AS active,
      COUNT(*) FILTER (WHERE g.created_at >= NOW() - INTERVAL '30 days')::int AS new_last_30_days
    FROM guardians g
    WHERE 1 = 1
      ${guardianScopeClause}
      ${guardianDateClause}
  `;

  const infantParams = [];
  const infantScopeClause = buildScopeClause({
    alias: 'p',
    primaryColumn: schema.patientScopeColumn,
    fallbackColumn: schema.patientScopeFallbackColumn,
    scopeIds: resolvedScopeIds,
    params: infantParams,
  });
  const infantDateClause = buildDateClause('p.created_at::date', startDate, endDate, infantParams);
  const infantQuery = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${patientActiveExpression})::int AS active,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM immunization_records irx
          WHERE irx.patient_id = p.id
            AND COALESCE(irx.is_active, true) = true
            AND ${childStatusExpression} IN ('completed', 'attended')
        )
      )::int AS up_to_date,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM immunization_records irx
          WHERE irx.patient_id = p.id
            AND COALESCE(irx.is_active, true) = true
        )
        AND NOT EXISTS (
          SELECT 1
          FROM immunization_records irx
          WHERE irx.patient_id = p.id
            AND COALESCE(irx.is_active, true) = true
            AND ${childStatusExpression} IN ('completed', 'attended')
        )
      )::int AS partially_vaccinated,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1
          FROM immunization_records irx
          WHERE irx.patient_id = p.id
            AND COALESCE(irx.is_active, true) = true
        )
      )::int AS not_vaccinated
    FROM patients p
    WHERE 1 = 1
      ${infantScopeClause}
      ${infantDateClause}
  `;

  const usersParams = [];
  const usersScopeClause = buildScopeClause({
    alias: 'u',
    primaryColumn: schema.userScopeColumn,
    fallbackColumn: schema.userScopeFallbackColumn,
    scopeIds: resolvedScopeIds,
    params: usersParams,
  });
  const usersQuery = `
    SELECT
      COUNT(*) FILTER (WHERE ${userActiveExpression})::int AS total,
      COUNT(*) FILTER (
        WHERE ${userActiveExpression}
          AND COALESCE(u.guardian_id, 0) = 0
          AND LOWER(COALESCE(r.name, '')) <> 'guardian'
      )::int AS staff
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE 1 = 1
      ${usersScopeClause}
  `;

  const [vaccinationResult, inventoryResult, expiredResult, appointmentResult, guardianResult, infantResult, usersResult] =
    await Promise.all([
      pool.query(vaccinationQuery, vaccinationParams),
      pool.query(inventoryQuery, inventoryParams),
      pool.query(expiredQuery, expiredParams),
      pool.query(appointmentQuery, appointmentParams),
      pool.query(guardianQuery, guardianParams),
      pool.query(infantQuery, infantParams),
      pool.query(usersQuery, usersParams),
    ]);

  const vaccination = vaccinationResult.rows[0] || {};
  const inventory = inventoryResult.rows[0] || {};
  const expired = expiredResult.rows[0] || {};
  const appointments = appointmentResult.rows[0] || {};
  const guardians = guardianResult.rows[0] || {};
  const infants = infantResult.rows[0] || {};
  const users = usersResult.rows[0] || {};

  return {
    vaccination: {
      total: parseMetricInt(vaccination.total),
      completed: parseMetricInt(vaccination.completed),
      pending: parseMetricInt(vaccination.pending),
      cancelled: parseMetricInt(vaccination.cancelled),
    },
    inventory: {
      total_items: parseMetricInt(inventory.total_items),
      low_stock_items: parseMetricInt(inventory.low_stock_items),
      expired_items: parseMetricInt(expired.expired_items),
      total_value: parseMetricFloat(inventory.total_value),
    },
    appointments: {
      total: parseMetricInt(appointments.total),
      scheduled: parseMetricInt(appointments.scheduled),
      completed: parseMetricInt(appointments.completed),
      cancelled: parseMetricInt(appointments.cancelled),
      no_show: parseMetricInt(appointments.no_show),
      missed_follow_up_load: parseMetricInt(appointments.missed_follow_up_load),
    },
    guardians: {
      total: parseMetricInt(guardians.total),
      active: parseMetricInt(guardians.active),
      new_last_30_days: parseMetricInt(guardians.new_last_30_days),
    },
    infants: {
      total: parseMetricInt(infants.total),
      active: parseMetricInt(infants.active),
      up_to_date: parseMetricInt(infants.up_to_date),
      partially_vaccinated: parseMetricInt(infants.partially_vaccinated),
      not_vaccinated: parseMetricInt(infants.not_vaccinated),
    },
    users: {
      total: parseMetricInt(users.total),
      staff: parseMetricInt(users.staff),
    },
    scope: {
      facilityId: resolvedScopeIds[0] || null,
      type: resolvedScopeIds.length > 0 ? 'clinic' : 'system',
    },
  };
};

const getAdminMetricsSummary = async ({
  startDate = '',
  endDate = '',
  facilityId = null,
  scopeIds = [],
} = {}) => {
  const normalizedStartDate = startDate ? normalizeDateInput(startDate, 'Start date') : '';
  const normalizedEndDate = endDate ? normalizeDateInput(endDate, 'End date') : '';

  if (normalizedStartDate && normalizedEndDate && normalizedEndDate < normalizedStartDate) {
    const error = new Error('End date cannot be earlier than start date.');
    error.statusCode = 400;
    error.code = 'REPORT_INVALID_DATE_RANGE';
    throw error;
  }

  return executeMetricsQueries({
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
    facilityId,
    scopeIds,
  });
};

const getDashboardMetrics = async ({ facilityId = null, scopeIds = [] } = {}) => {
  const summary = await executeMetricsQueries({ facilityId, scopeIds });

  return {
    infants: summary.infants.total,
    total_infants: summary.infants.total,
    up_to_date_infants: summary.infants.up_to_date,
    vaccinations: summary.vaccination.total,
    total_vaccinations: summary.vaccination.total,
    completed_vaccinations: summary.vaccination.completed,
    appointments: summary.appointments.total,
    total_appointments: summary.appointments.total,
    completed_appointments: summary.appointments.completed,
    no_show_appointments: summary.appointments.no_show,
    missed_follow_up_load: summary.appointments.missed_follow_up_load,
    guardians: summary.guardians.total,
    total_guardians: summary.guardians.total,
    active_guardians: summary.guardians.active,
    users: summary.users.total,
    staff_users: summary.users.staff,
    inventory_items: summary.inventory.total_items,
    total_inventory_items: summary.inventory.total_items,
    low_stock: summary.inventory.low_stock_items,
    low_stock_items: summary.inventory.low_stock_items,
    expired_lots: summary.inventory.expired_items,
    expired_items: summary.inventory.expired_items,
    vaccination: summary.vaccination,
    inventory: summary.inventory,
    appointments_summary: summary.appointments,
    guardians_summary: summary.guardians,
    infants_summary: summary.infants,
    users_summary: summary.users,
    scope: summary.scope.type,
    clinicId: summary.scope.facilityId,
  };
};

module.exports = {
  getAdminMetricsSummary,
  getDashboardMetrics,
};
