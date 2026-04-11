const pool = require('../db');
const inventoryCalculationService = require('./inventoryCalculationService');
const {
  CLINIC_TODAY_SQL,
  rollForwardWeekendDateSql,
  toClinicDateKey,
  toClinicDateSql,
  weekdayPredicateSql,
} = require('../utils/clinicCalendar');

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

  const clinicDateKey = toClinicDateKey(normalized);
  if (!clinicDateKey) {
    const error = new Error(`${label} is invalid.`);
    error.statusCode = 400;
    error.code = 'INVALID_DATE';
    throw error;
  }

  return clinicDateKey;
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
    const appointmentPatientColumn = pickColumn('appointments', ['patient_id', 'infant_id']);
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
      appointmentPatientColumn,
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
      appointmentPatientColumn: 'patient_id',
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

const buildScopeMatchClause = ({
  expressions = [],
  scopeIds = [],
  params,
}) => {
  const normalizedScopeIds = normalizeScopeIds(scopeIds);
  const scopedExpressions = [...new Set(expressions.filter((expression) => expression && expression !== 'NULL'))];

  if (scopedExpressions.length === 0 || normalizedScopeIds.length === 0) {
    return '';
  }

  params.push(normalizedScopeIds.length === 1 ? normalizedScopeIds[0] : normalizedScopeIds);
  const placeholder = `$${params.length}`;
  const scopePredicate = (expression) =>
    normalizedScopeIds.length === 1
      ? `${expression} = ${placeholder}`
      : `${expression} = ANY(${placeholder}::int[])`;

  return ` AND (${scopedExpressions.map(scopePredicate).join(' OR ')})`;
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

const buildVaccinationCompletionDateExpression = (alias = 'ir') => `
  COALESCE(
    ${toClinicDateSql(`${alias}.admin_date`)},
    ${toClinicDateSql(`${alias}.created_at`)}
  )
`;

const buildVaccinationStatusDateExpression = (statusExpression, alias = 'ir') => `
  CASE
    WHEN ${statusExpression} IN ('completed', 'attended')
      THEN ${buildVaccinationCompletionDateExpression(alias)}
    ELSE ${rollForwardWeekendDateSql(`(${alias}.next_due_date)::date`)}
  END
`;

const buildNormalizedAppointmentStatusExpression = (alias = 'a') => `
  CASE
    WHEN LOWER(REPLACE(COALESCE(${alias}.status::text, ''), '-', '_')) = 'completed' THEN 'attended'
    ELSE LOWER(REPLACE(COALESCE(${alias}.status::text, ''), '-', '_'))
  END
`;

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
  const vaccinationCompletionDateExpression = buildVaccinationCompletionDateExpression('ir');
  const vaccinationStatusDateExpression = buildVaccinationStatusDateExpression(
    immunizationStatusExpression,
    'ir',
  );
  const patientActiveExpression = schema.patientHasIsActive ? 'COALESCE(p.is_active, true)' : 'true';
  const batchActiveExpression = schema.batchHasIsActive ? 'COALESCE(vb.is_active, true)' : 'true';
  const userActiveExpression = schema.userHasIsActive ? 'COALESCE(u.is_active, true)' : 'true';
  const appointmentActiveExpression = schema.appointmentHasIsActive ? 'COALESCE(a.is_active, true)' : 'true';
  const guardianActiveExpression = schema.guardianHasIsActive ? 'COALESCE(g.is_active, true)' : 'true';
  const patientScopeExpression = buildScopedColumnExpression(
    'p',
    schema.patientScopeColumn,
    schema.patientScopeFallbackColumn,
  );
  const appointmentScopeExpression = buildScopedColumnExpression(
    'a',
    schema.appointmentScopeColumn,
    schema.appointmentScopeFallbackColumn,
  );
  const guardianScopeExpression = buildScopedColumnExpression(
    'g',
    schema.guardianScopeColumn,
    schema.guardianScopeFallbackColumn,
  );
  const appointmentStatusExpression = buildNormalizedAppointmentStatusExpression('a');
  const appointmentDateExpression = toClinicDateSql('a.scheduled_date');
  const vaccinationParams = [];
  const vaccinationScopeClause = buildScopeMatchClause({
    expressions: [patientScopeExpression, guardianScopeExpression],
    scopeIds: resolvedScopeIds,
    params: vaccinationParams,
  });
  const vaccinationDateClause = buildDateClause(
    vaccinationStatusDateExpression,
    startDate,
    endDate,
    vaccinationParams,
  );
  const vaccinationQuery = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${immunizationStatusExpression} IN ('completed', 'attended'))::int AS completed,
      COUNT(*) FILTER (WHERE ${immunizationStatusExpression} IN ('pending', 'scheduled'))::int AS pending,
      COUNT(*) FILTER (WHERE ${immunizationStatusExpression} = 'cancelled')::int AS cancelled
    FROM immunization_records ir
    JOIN patients p ON p.id = ir.patient_id
    LEFT JOIN guardians g ON g.id = p.guardian_id
    WHERE COALESCE(ir.is_active, true) = true
      AND ${patientActiveExpression}
      AND (
        ${immunizationStatusExpression} NOT IN ('completed', 'attended')
        OR ${weekdayPredicateSql(vaccinationCompletionDateExpression)}
      )
      ${vaccinationScopeClause}
      ${vaccinationDateClause}
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
      AND vb.expiry_date < ${CLINIC_TODAY_SQL}
      ${batchScopeClause}
  `;

  const appointmentParams = [];
  const appointmentJoins = schema.appointmentPatientColumn
    ? `
      LEFT JOIN patients p ON p.id = a.${schema.appointmentPatientColumn}
      LEFT JOIN guardians g ON g.id = p.guardian_id
    `
    : '';
  const appointmentScopeClause = schema.appointmentPatientColumn
    ? buildScopeMatchClause({
      expressions: [appointmentScopeExpression, patientScopeExpression, guardianScopeExpression],
      scopeIds: resolvedScopeIds,
      params: appointmentParams,
    })
    : buildScopeClause({
      alias: 'a',
      primaryColumn: schema.appointmentScopeColumn,
      fallbackColumn: schema.appointmentScopeFallbackColumn,
      scopeIds: resolvedScopeIds,
      params: appointmentParams,
    });
  const appointmentDateClause = buildDateClause(
    appointmentDateExpression,
    startDate,
    endDate,
    appointmentParams,
  );
  const appointmentPatientEligibilityClause = schema.appointmentPatientColumn
    ? schema.patientHasIsActive
      ? 'AND p.id IS NOT NULL AND COALESCE(p.is_active, false) = true'
      : 'AND p.id IS NOT NULL'
    : '';
  const appointmentQuery = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE ${appointmentStatusExpression} IN ('scheduled', 'confirmed', 'rescheduled')
      )::int AS scheduled,
      COUNT(*) FILTER (
        WHERE ${appointmentStatusExpression} = 'attended'
      )::int AS completed,
      COUNT(*) FILTER (
        WHERE ${appointmentStatusExpression} = 'cancelled'
      )::int AS cancelled,
      COUNT(*) FILTER (
        WHERE ${appointmentStatusExpression} = ANY($${appointmentParams.length + 1}::text[])
      )::int AS no_show,
      COUNT(*) FILTER (
        WHERE ${appointmentDateExpression} < ${CLINIC_TODAY_SQL}
          AND ${appointmentStatusExpression} = ANY($${appointmentParams.length + 2}::text[])
      )::int AS missed_follow_up_load
    FROM appointments a
    ${appointmentJoins}
    WHERE ${appointmentActiveExpression}
      ${appointmentPatientEligibilityClause}
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
  const guardianDateClause = buildDateClause(
    toClinicDateSql('g.created_at'),
    startDate,
    endDate,
    guardianParams,
  );
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
  const infantScopeClause = buildScopeMatchClause({
    expressions: [patientScopeExpression, guardianScopeExpression],
    scopeIds: resolvedScopeIds,
    params: infantParams,
  });
  const infantDateClause = buildDateClause(
    toClinicDateSql('p.created_at'),
    startDate,
    endDate,
    infantParams,
  );
  const infantQuery = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*)::int AS active,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM immunization_records irx
          WHERE irx.patient_id = p.id
            AND COALESCE(irx.is_active, true) = true
            AND ${childStatusExpression} IN ('completed', 'attended')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM immunization_records irx
          WHERE irx.patient_id = p.id
            AND COALESCE(irx.is_active, true) = true
            AND ${childStatusExpression} IN ('pending', 'scheduled')
            AND irx.admin_date IS NULL
        )
      )::int AS up_to_date,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM immunization_records irx
          WHERE irx.patient_id = p.id
            AND COALESCE(irx.is_active, true) = true
        )
        AND EXISTS (
          SELECT 1
          FROM immunization_records irx
          WHERE irx.patient_id = p.id
            AND COALESCE(irx.is_active, true) = true
            AND ${childStatusExpression} IN ('pending', 'scheduled')
            AND irx.admin_date IS NULL
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
    LEFT JOIN guardians g ON g.id = p.guardian_id
    WHERE ${patientActiveExpression}
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

  const [vaccinationResult, expiredResult, appointmentResult, guardianResult, infantResult, usersResult, inventorySummary] =
    await Promise.all([
      pool.query(vaccinationQuery, vaccinationParams),
      pool.query(expiredQuery, expiredParams),
      pool.query(appointmentQuery, appointmentParams),
      pool.query(guardianQuery, guardianParams),
      pool.query(infantQuery, infantParams),
      pool.query(usersQuery, usersParams),
      resolvedScopeIds.length > 0
        ? inventoryCalculationService.getUnifiedSummary(
          resolvedScopeIds.length === 1 ? resolvedScopeIds[0] : resolvedScopeIds,
        )
        : Promise.resolve({
          total_vaccines: 0,
          low_stock_count: 0,
          critical_count: 0,
          out_of_stock_count: 0,
          total_value: 0,
        }),
    ]);

  const vaccination = vaccinationResult.rows[0] || {};
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
      total_items: parseMetricInt(inventorySummary.total_vaccines),
      low_stock_items:
        parseMetricInt(inventorySummary.low_stock_count)
        + parseMetricInt(inventorySummary.critical_count)
        + parseMetricInt(inventorySummary.out_of_stock_count),
      expired_items: parseMetricInt(expired.expired_items),
      total_value: parseMetricFloat(inventorySummary.total_value),
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
