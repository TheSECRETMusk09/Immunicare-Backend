const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { requirePermission, getCanonicalRole, CANONICAL_ROLES } = require('../middleware/rbac');
const { getDashboardMetrics } = require('../services/adminMetricsService');
const {
  getAdminInfantVaccinationMonitoring,
} = require('../services/adminVaccinationMonitoringService');
const {
  resolvePatientColumn,
  resolvePatientTable,
  resolvePatientScopeExpression,
} = require('../utils/schemaHelpers');
const {
  resolveFirstExistingColumn,
} = require('../utils/queryCompatibility');
const { resolveGuardianId } = require('../middleware/guardianScope');
const {
  resolveEffectiveScope,
  resolveUserScopeIds,
} = require('../services/entityScopeService');
const immunizationScheduleService = require('../services/immunizationScheduleService');
const patientService = require('../services/patientService');
const {
  CLINIC_TODAY_SQL,
  getClinicTodayDateKey,
  parseClinicDate,
} = require('../utils/clinicCalendar');

const noCache = (res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

const sanitizeLimit = (value, fallback = 10, max = 100) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
};

const normalizeOptionalDateFilter = (value, fieldName) => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return { value: null };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return {
      error: `${fieldName} must be a valid date`,
    };
  }

  return { value: normalizedValue };
};

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

const canAccessGuardian = (req, guardianId) => {
  if (isGuardian(req)) {
    const resolvedGuardianId = resolveGuardianId(req.user);
    return resolvedGuardianId === parseInt(guardianId, 10);
  }
  return getCanonicalRole(req) === CANONICAL_ROLES.SYSTEM_ADMIN;
};

const guardianScopeFilterSql = `
  p.guardian_id
`;

const PROVIDER_FALLBACK_LABEL = 'Provider unavailable';
const PROVIDER_FALLBACK_LABEL_SQL = PROVIDER_FALLBACK_LABEL.replace(/'/g, '\'\'');
const PROVIDER_NAME_COLUMNS = ['full_name', 'name', 'username', 'email'];
const APPOINTMENT_PROVIDER_ROLES = [
  'nurse',
  'midwife',
  'healthcare_worker',
  'health_worker',
  'physician',
  'doctor',
];
const APPOINTMENT_PROVIDER_ROLE_SQL = `ARRAY[${APPOINTMENT_PROVIDER_ROLES
  .map((roleName) => `'${roleName.replace(/'/g, '\'\'')}'`)
  .join(', ')}]::text[]`;
const GUARDIAN_READINESS_TIMEOUT_MS = 4000;

let providerSchemaPromise = null;

const resolveProviderSchema = async () => {
  try {
    const [tablesResult, columnsResult] = await Promise.all([
      db.query(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])
        `,
        [['users', 'admin', 'roles']],
      ),
      db.query(
        `
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = ANY($1::text[])
            AND column_name = ANY($2::text[])
        `,
        [['users', 'admin'], PROVIDER_NAME_COLUMNS],
      ),
    ]);

    const availableTables = new Set((tablesResult.rows || []).map((row) => row.table_name));
    const columnsByTable = {
      users: new Set(),
      admin: new Set(),
    };

    (columnsResult.rows || []).forEach((row) => {
      if (!columnsByTable[row.table_name]) {
        columnsByTable[row.table_name] = new Set();
      }
      columnsByTable[row.table_name].add(row.column_name);
    });

    return {
      tables: availableTables,
      columnsByTable,
    };
  } catch (error) {
    console.error('Error resolving dashboard vaccination provider schema:', error);
    return {
      tables: new Set(['users']),
      columnsByTable: {
        users: new Set(['username', 'email']),
        admin: new Set(),
      },
    };
  }
};

const getProviderSchema = async () => {
  if (!providerSchemaPromise) {
    providerSchemaPromise = resolveProviderSchema();
  }

  return providerSchemaPromise;
};

const buildProviderNameCandidates = (alias, availableColumns) =>
  PROVIDER_NAME_COLUMNS
    .filter((column) => availableColumns.has(column))
    .map((column) => `NULLIF(TRIM(${alias}.${column}), '')`);

const getProviderSqlFragments = async () => {
  const schema = await getProviderSchema();
  const providerJoins = [];
  const providerNameCandidates = [];

  if (schema.tables.has('users')) {
    providerJoins.push('LEFT JOIN users provider_user ON provider_user.id = ir.administered_by');
    providerNameCandidates.push(
      ...buildProviderNameCandidates('provider_user', schema.columnsByTable.users || new Set()),
    );
  }

  if (schema.tables.has('admin')) {
    providerJoins.push('LEFT JOIN admin provider_admin ON provider_admin.id = ir.administered_by');
    providerNameCandidates.push(
      ...buildProviderNameCandidates('provider_admin', schema.columnsByTable.admin || new Set()),
    );
  }

  const providerValueExpression =
    providerNameCandidates.length > 0
      ? `COALESCE(${providerNameCandidates.join(', ')}, '${PROVIDER_FALLBACK_LABEL_SQL}')`
      : `'${PROVIDER_FALLBACK_LABEL_SQL}'`;

  return {
    providerJoinsSql: providerJoins.join('\n'),
    providerValueExpression,
  };
};

const getAppointmentProviderSqlFragments = async (appointmentAlias = 'a') => {
  const schema = await getProviderSchema();
  const usersColumns = schema.columnsByTable.users || new Set();

  if (!schema.tables.has('users') || !schema.tables.has('roles')) {
    return {
      appointmentProviderJoinSql: '',
      appointmentProviderValueExpression: `'${PROVIDER_FALLBACK_LABEL_SQL}'`,
    };
  }

  const createdByNameCandidates = buildProviderNameCandidates(
    'appointment_created_by_user',
    usersColumns,
  );
  const fallbackNameCandidates = buildProviderNameCandidates(
    'appointment_fallback_user',
    usersColumns,
  );
  const createdByNameExpression =
    createdByNameCandidates.length > 0
      ? `COALESCE(${createdByNameCandidates.join(', ')})`
      : 'NULL';
  const fallbackNameExpression =
    fallbackNameCandidates.length > 0
      ? `COALESCE(${fallbackNameCandidates.join(', ')})`
      : 'NULL';

  const appointmentProviderJoinSql = `
    LEFT JOIN LATERAL (
      SELECT provider_name
      FROM (
        SELECT
          ${createdByNameExpression} AS provider_name,
          0 AS provider_priority,
          0 AS clinic_priority,
          appointment_created_by_user.id AS provider_user_id
        FROM users appointment_created_by_user
        JOIN roles appointment_created_by_role
          ON appointment_created_by_role.id = appointment_created_by_user.role_id
        WHERE appointment_created_by_user.id = ${appointmentAlias}.created_by
          AND appointment_created_by_user.is_active = true
          AND LOWER(appointment_created_by_role.name) = ANY(${APPOINTMENT_PROVIDER_ROLE_SQL})

        UNION ALL

        SELECT
          ${fallbackNameExpression} AS provider_name,
          1 AS provider_priority,
          CASE
            WHEN ${appointmentAlias}.clinic_id IS NOT NULL
              AND appointment_fallback_user.clinic_id = ${appointmentAlias}.clinic_id THEN 0
            ELSE 1
          END AS clinic_priority,
          appointment_fallback_user.id AS provider_user_id
        FROM users appointment_fallback_user
        JOIN roles appointment_fallback_role
          ON appointment_fallback_role.id = appointment_fallback_user.role_id
        WHERE appointment_fallback_user.is_active = true
          AND LOWER(appointment_fallback_role.name) = ANY(${APPOINTMENT_PROVIDER_ROLE_SQL})
          AND (
            ${appointmentAlias}.clinic_id IS NULL
            OR appointment_fallback_user.clinic_id = ${appointmentAlias}.clinic_id
            OR appointment_fallback_user.clinic_id IS NULL
          )
      ) provider_candidates
      WHERE provider_name IS NOT NULL
      ORDER BY provider_priority, clinic_priority, provider_user_id
      LIMIT 1
    ) appointment_provider ON true
  `;

  return {
    appointmentProviderJoinSql,
    appointmentProviderValueExpression:
      `COALESCE(appointment_provider.provider_name, '${PROVIDER_FALLBACK_LABEL_SQL}')`,
  };
};

const normalizeVaccinationProvider = (record) => {
  const providerName =
    record?.provider_name || record?.administered_by_name || PROVIDER_FALLBACK_LABEL;

  return {
    ...record,
    provider_name: providerName,
    administered_by_name: record?.administered_by_name || providerName,
  };
};

const normalizeGuardianChildRow = (record = {}) => ({
  ...record,
  completed_vaccinations: Number.parseInt(record.completed_vaccinations, 10) || 0,
  pending_vaccinations: Number.parseInt(record.pending_vaccinations, 10) || 0,
  upcoming_appointments: Number.parseInt(record.upcoming_appointments, 10) || 0,
});

const mergeGuardianScheduleSummaries = (children = [], summaryMap = new Map()) =>
  children.map((child) => {
    const summary = summaryMap.get(Number.parseInt(child?.id, 10));
    if (!summary) {
      return normalizeGuardianChildRow(child);
    }

    return normalizeGuardianChildRow({
      ...child,
      completed_vaccinations: summary.completed,
      pending_vaccinations: summary.pendingActionCount,
    });
  });

const buildDueVaccineIdentity = (childId, vaccine = {}, dueDate = '') => {
  const vaccineId =
    vaccine?.vaccineId ||
    vaccine?.vaccine_id ||
    vaccine?.vaccineCode ||
    vaccine?.vaccine_code ||
    vaccine?.label ||
    'vaccine';
  const doseNumber = vaccine?.doseNumber || vaccine?.dose_number || 'dose';
  return `${childId || 'child'}-${vaccineId}-${doseNumber}-${dueDate || 'no-date'}`;
};

const withTimeout = (promise, timeoutMs, message) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const collectGuardianDueVaccines = async (
  children = [],
  limit = 5,
  readinessTimeoutMs = GUARDIAN_READINESS_TIMEOUT_MS,
) => {
  if (!Array.isArray(children) || children.length === 0) {
    return {
      allDueVaccines: [],
      visibleDueVaccines: [],
      readinessFailures: 0,
      readinessProcessed: 0,
    };
  }

  const clinicTodayKey = getClinicTodayDateKey();
  const today = clinicTodayKey ? parseClinicDate(clinicTodayKey) : new Date();
  const dueVaccinesList = [];
  const seenDueVaccines = new Set();
  let readinessFailures = 0;

  const readinessResults = await Promise.allSettled(
    children.map((child) =>
      withTimeout(
        immunizationScheduleService.getGuardianScheduleProjection(child.id),
        readinessTimeoutMs,
        `Guardian schedule projection timed out for child ${child.id}`,
      ),
    ),
  );

  readinessResults.forEach((result, index) => {
    const child = children[index];
    if (!child?.id) {
      return;
    }

    if (
      result.status !== 'fulfilled' ||
      result.value?.error
    ) {
      readinessFailures += 1;
      return;
    }

    const scheduleProjection = result.value;
    const candidateVaccines = (Array.isArray(scheduleProjection?.schedules)
      ? scheduleProjection.schedules
      : [])
      .filter(
        (scheduleItem) =>
          !scheduleItem.isCompleted &&
          scheduleItem.isNextDueDose &&
          scheduleItem.dueDate,
      )
      .map((scheduleItem) => {
        const dueDateKey = String(scheduleItem.dueDateKey || '').trim();
        const dueDate = parseClinicDate(dueDateKey) || new Date(`${dueDateKey}T00:00:00`);
        const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

        return {
          id: buildDueVaccineIdentity(child.id, scheduleItem, dueDateKey),
          childId: child.id,
          childName:
            String(
              child.name ||
                `${child.first_name || ''} ${child.last_name || ''}`.trim() ||
                'Child',
            ).trim(),
          vaccineName: `${scheduleItem.vaccineName} (Dose ${scheduleItem.doseNumber})`,
          dueDate: dueDateKey,
          daysUntilDue,
          status:
            daysUntilDue < 0 ? 'overdue' : daysUntilDue <= 7 ? 'due_soon' : 'upcoming',
        };
      });

    candidateVaccines.forEach((vaccine) => {
      if (!vaccine?.dueDate) {
        return;
      }

      const identity = vaccine.id || buildDueVaccineIdentity(child.id, vaccine, vaccine.dueDate);
      if (seenDueVaccines.has(identity)) {
        return;
      }

      seenDueVaccines.add(identity);

      dueVaccinesList.push({
        id: identity,
        childId: vaccine.childId,
        childName: vaccine.childName,
        vaccineName: vaccine.vaccineName,
        dueDate: vaccine.dueDate,
        daysUntilDue: vaccine.daysUntilDue,
        status: vaccine.status,
      });
    });
  });

  dueVaccinesList.sort((left, right) => left.daysUntilDue - right.daysUntilDue);

  return {
    allDueVaccines: dueVaccinesList,
    visibleDueVaccines: dueVaccinesList.slice(0, limit),
    readinessFailures,
    readinessProcessed: Math.max(children.length - readinessFailures, 0),
  };
};

router.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1 as status');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      uptime: process.uptime(),
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

router.get('/stats', authenticateToken, requirePermission('dashboard:analytics'), async (req, res, next) => {
  try {
    noCache(res);
    const canonicalRole = getCanonicalRole(req);
    const scopeIds = resolveUserScopeIds(req.user);
    const requestedScope = String(req.query.scope || '').trim().toLowerCase();
    const allowSystemScope =
      canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN && requestedScope === 'system';
    const useClinicScope = scopeIds.length > 0 && !allowSystemScope;

    const stats = await getDashboardMetrics({
      facilityId: useClinicScope && scopeIds.length > 0 ? scopeIds[0] : null,
      scopeIds: useClinicScope ? scopeIds : [],
    });

    const vaccinesResult = await db.query(
      'SELECT COUNT(*)::int AS total FROM vaccines WHERE COALESCE(is_active, true) = true',
    );

    stats.vaccines = Number.parseInt(vaccinesResult.rows[0]?.total, 10) || 0;
    stats.scope = useClinicScope ? 'clinic' : 'system';
    stats.clinicId = useClinicScope ? scopeIds[0] : null;

    res.json(stats);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    next(error);
  }
});

router.get('/appointments', authenticateToken, requirePermission('appointment:view'), async (req, res, next) => {
  try {
    noCache(res);

    const limit = sanitizeLimit(req.query.limit, 20, 100);
    const patientColumn = await resolvePatientColumn();
    const patientTable = await resolvePatientTable();
    const patientScopeExpression = await resolvePatientScopeExpression('p');
    const canonicalRole = getCanonicalRole(req);
    const scopeIds = resolveUserScopeIds(req.user);
    const requestedScope = String(req.query.scope || '').trim().toLowerCase();
    const allowSystemScope =
      canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN && requestedScope === 'system';
    const useClinicScope = scopeIds.length > 0 && !allowSystemScope;

    const params = [];
    let scopeClause = '';

    if (useClinicScope && patientScopeExpression) {
      scopeClause = `
        AND ${patientScopeExpression} = ANY($1::int[])
      `;
      params.push(scopeIds);
    }

    params.push(limit);

    const result = await db.query(
      `
        SELECT
          a.id,
          a.${patientColumn} as patient_id,
          a.scheduled_date,
          a.status,
          a.type,
          COALESCE(a.location, 'Main Health Center') as location,
          p.first_name,
          p.last_name,
          COALESCE(
            NULLIF(TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))), ''),
            'Infant'
          ) as patient_name,
          COALESCE(NULLIF(TRIM(g.name), ''), 'Guardian unavailable') as guardian_name
        FROM appointments a
        LEFT JOIN ${patientTable} p ON p.id = a.${patientColumn}
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE a.scheduled_date >= CURRENT_DATE
          AND a.is_active = true
          AND p.is_active = true
          ${scopeClause}
        ORDER BY a.scheduled_date
        LIMIT $${params.length}
      `,
      params,
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error('Dashboard appointments error:', error);
    next(error);
  }
});

router.get('/guardian/:guardianId/stats', authenticateToken, async (req, res, next) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    if (Number.isNaN(guardianId)) {
      return res.status(400).json({ error: 'Invalid guardian ID' });
    }

    if (!canAccessGuardian(req, guardianId)) {
      return res.status(403).json({ error: 'Access denied for guardian scope' });
    }

    noCache(res);

    const childrenResult = await db.query(
      `
        SELECT id, first_name, last_name, dob
        FROM patients
        WHERE guardian_id = $1
          AND is_active = true
        ORDER BY created_at DESC
      `,
      [guardianId],
    );

    const children = childrenResult.rows || [];
    const childrenCount = children.length;
    const guardianSummaryMap = await immunizationScheduleService.getGuardianScheduleSummariesForPatients(
      children,
    );

    const patientColumn = await resolvePatientColumn();
    const patientTable = await resolvePatientTable();
    const {
      appointmentProviderJoinSql,
      appointmentProviderValueExpression,
    } = await getAppointmentProviderSqlFragments('a');
    
    const nextAppointmentResult = await db.query(
      `
        SELECT
          a.*,
          p.first_name,
          p.last_name,
          ${appointmentProviderValueExpression} as provider_name,
          ${appointmentProviderValueExpression} as health_worker_name
        FROM appointments a
        LEFT JOIN ${patientTable} p ON p.id = a.${patientColumn}
        ${appointmentProviderJoinSql}
        WHERE ${guardianScopeFilterSql} = $1
          AND (a.scheduled_date AT TIME ZONE 'Asia/Manila')::date >= ${CLINIC_TODAY_SQL}
          AND LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled')
          AND a.is_active = true
          AND p.is_active = true
        ORDER BY a.scheduled_date ASC
        LIMIT 1
      `,
      [guardianId],
    );

    res.json({
      childrenCount,
      completedVaccinations: Array.from(guardianSummaryMap.values()).reduce(
        (total, summary) => total + Number(summary?.completed || 0),
        0,
      ),
      pendingVaccinations: Array.from(guardianSummaryMap.values()).reduce(
        (total, summary) => total + Number(summary?.pendingActionCount || 0),
        0,
      ),
      upcomingVaccines: Array.from(guardianSummaryMap.values()).reduce(
        (total, summary) => total + Number(summary?.upcoming || 0),
        0,
      ),
      overdueVaccinations: Array.from(guardianSummaryMap.values()).reduce(
        (total, summary) => total + Number(summary?.overdue || 0),
        0,
      ),
      nextAppointment: nextAppointmentResult.rows[0] || null,
    });
  } catch (error) {
    console.error('Guardian stats error:', error);
    next(error);
  }
});

router.get('/guardian/:guardianId/overview', authenticateToken, async (req, res, next) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    if (Number.isNaN(guardianId)) {
      return res.status(400).json({ error: 'Invalid guardian ID' });
    }

    if (!canAccessGuardian(req, guardianId)) {
      return res.status(403).json({ error: 'Access denied for guardian scope' });
    }

    const appointmentLimit = sanitizeLimit(req.query.appointmentLimit, 5, 20);
    const dueLimit = sanitizeLimit(req.query.dueLimit, 5, 20);
    noCache(res);

    const patientColumn = await resolvePatientColumn();
    const patientTable = await resolvePatientTable();
    const {
      appointmentProviderJoinSql,
      appointmentProviderValueExpression,
    } = await getAppointmentProviderSqlFragments('a');

    const [childrenResult, appointmentsResult] = await Promise.all([
      db.query(
        `
          SELECT
            p.*,
            p.control_number,
            (
              SELECT COUNT(*)
              FROM appointments a
              WHERE a.${patientColumn} = p.id
                AND (a.scheduled_date AT TIME ZONE 'Asia/Manila')::date >= ${CLINIC_TODAY_SQL}
                AND LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled')
                AND a.is_active = true
            ) AS upcoming_appointments,
            (
              SELECT tic.id
              FROM transfer_in_cases tic
              WHERE tic.infant_id = p.id
              ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
              LIMIT 1
            ) AS latest_transfer_case_id,
            (
              SELECT tic.validation_status
              FROM transfer_in_cases tic
              WHERE tic.infant_id = p.id
              ORDER BY tic.updated_at DESC NULLS LAST, tic.created_at DESC
              LIMIT 1
            ) AS latest_transfer_case_status
          FROM patients p
          WHERE p.guardian_id = $1
            AND p.is_active = true
          ORDER BY p.created_at DESC
        `,
        [guardianId],
      ),
      db.query(
        `
          SELECT
            a.*,
            p.first_name,
            p.last_name,
            p.dob as infant_dob,
            COALESCE(a.location, 'Main Health Center') as location,
            COALESCE(a.type, 'Vaccination Appointment') as type,
            ${appointmentProviderValueExpression} as provider_name,
            ${appointmentProviderValueExpression} as health_worker_name
          FROM appointments a
          LEFT JOIN ${patientTable} p ON p.id = a.${patientColumn}
          ${appointmentProviderJoinSql}
          WHERE ${guardianScopeFilterSql} = $1
            AND (a.scheduled_date AT TIME ZONE 'Asia/Manila')::date >= ${CLINIC_TODAY_SQL}
            AND LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled')
            AND a.is_active = true
            AND p.is_active = true
          ORDER BY a.scheduled_date ASC
          LIMIT $2
        `,
        [guardianId, appointmentLimit],
      ),
    ]);

    const guardianSummaryMap = await immunizationScheduleService.getGuardianScheduleSummariesForPatients(
      childrenResult.rows || [],
    );
    const children = mergeGuardianScheduleSummaries(childrenResult.rows || [], guardianSummaryMap);
    const appointments = appointmentsResult.rows || [];
    const {
      allDueVaccines,
      visibleDueVaccines,
      readinessFailures,
      readinessProcessed,
    } = await collectGuardianDueVaccines(children, dueLimit);

    const warnings = [];
    if (readinessFailures > 0) {
      warnings.push(
        `${readinessFailures} child readiness record${readinessFailures === 1 ? ' was' : 's were'} unavailable during this refresh. Due-vaccine cards may be incomplete.`,
      );
    }

    const nextBookedAppointment = appointments[0] || null;
    const nextScheduleAction = allDueVaccines[0] || null;
    const stats = {
      childrenCount: children.length,
      completedVaccinations: Array.from(guardianSummaryMap.values()).reduce(
        (total, summary) => total + Number(summary?.completed || 0),
        0,
      ),
      pendingVaccinations: Array.from(guardianSummaryMap.values()).reduce(
        (total, summary) => total + Number(summary?.pendingActionCount || 0),
        0,
      ),
      upcomingVaccines: Array.from(guardianSummaryMap.values()).reduce(
        (total, summary) => total + Number(summary?.upcoming || 0),
        0,
      ),
      overdueVaccinations: Array.from(guardianSummaryMap.values()).reduce(
        (total, summary) => total + Number(summary?.overdue || 0),
        0,
      ),
      nextAppointment: nextBookedAppointment,
      nextActionDate:
        nextBookedAppointment?.scheduled_date ||
        nextBookedAppointment?.scheduledDate ||
        nextScheduleAction?.dueDate ||
        null,
      nextActionLabel: nextBookedAppointment
        ? 'Booked appointment'
        : nextScheduleAction?.vaccineName || null,
    };

    res.json({
      success: true,
      data: {
        stats,
        children,
        appointments,
        dueVaccines: visibleDueVaccines,
        diagnostics: {
          readinessProcessed,
          readinessFailures,
          warnings,
        },
      },
    });
  } catch (error) {
    console.error('Guardian overview error:', error);
    next(error);
  }
});

router.get('/guardian/:guardianId/appointments', authenticateToken, async (req, res, next) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    if (Number.isNaN(guardianId)) {
      return res.status(400).json({ error: 'Invalid guardian ID' });
    }

    if (!canAccessGuardian(req, guardianId)) {
      return res.status(403).json({ error: 'Access denied for guardian scope' });
    }

    const limit = sanitizeLimit(req.query.limit, 10, 100);
    const statusFilter = String(req.query.status || '').trim().toLowerCase().replace(/-/g, '_');
    noCache(res);

    const params = [guardianId];
    let whereClause = `
      WHERE ${guardianScopeFilterSql} = $1
        AND a.is_active = true
        AND p.is_active = true
    `;
    let orderClause = 'ORDER BY a.scheduled_date DESC';

    if (statusFilter === 'upcoming') {
      whereClause += `
        AND (a.scheduled_date AT TIME ZONE 'Asia/Manila')::date >= ${CLINIC_TODAY_SQL}
        AND LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled')
      `;
      orderClause = 'ORDER BY a.scheduled_date ASC';
    } else if (statusFilter) {
      const statusMap = {
        pending: ['pending'],
        scheduled: ['scheduled', 'confirmed', 'rescheduled'],
        attended: ['attended', 'completed'],
        cancelled: ['cancelled'],
        no_show: ['no_show', 'no-show'],
      };

      const statusValues = statusMap[statusFilter];
      if (!statusValues) {
        return res.status(400).json({
          error: 'Invalid status filter',
        });
      }

      whereClause += ` AND LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) = ANY($2::text[])`;
      params.push(statusValues);
    }

    params.push(limit);
    const patientColumn = await resolvePatientColumn();
    const patientTable = await resolvePatientTable();
    const {
      appointmentProviderJoinSql,
      appointmentProviderValueExpression,
    } = await getAppointmentProviderSqlFragments('a');

    const result = await db.query(
      `
        SELECT
          a.*,
          p.first_name,
          p.last_name,
          p.dob as infant_dob,
          COALESCE(a.location, 'Main Health Center') as location,
          COALESCE(a.type, 'Vaccination Appointment') as type,
          ${appointmentProviderValueExpression} as provider_name,
          ${appointmentProviderValueExpression} as health_worker_name
        FROM appointments a
        LEFT JOIN ${patientTable} p ON p.id = a.${patientColumn}
        ${appointmentProviderJoinSql}
        ${whereClause}
        ${orderClause}
        LIMIT $${params.length}
      `,
      params,
    );

    res.json({ data: result.rows || [] });
  } catch (error) {
    console.error('Guardian appointments error:', error);
    next(error);
  }
});

router.get('/guardian/:guardianId/children', authenticateToken, async (req, res, next) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    if (Number.isNaN(guardianId)) {
      return res.status(400).json({ error: 'Invalid guardian ID' });
    }

    if (!canAccessGuardian(req, guardianId)) {
      return res.status(403).json({ error: 'Access denied for guardian scope' });
    }

    noCache(res);
    
    const patientColumn = await resolvePatientColumn();

    const infantsResult = await db.query(
      `
        SELECT
          p.*,
           (
             SELECT COUNT(*)
             FROM appointments
             WHERE ${patientColumn} = p.id
               AND (scheduled_date AT TIME ZONE 'Asia/Manila')::date >= ${CLINIC_TODAY_SQL}
               AND LOWER(REPLACE(COALESCE(status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled')
               AND is_active = true
           ) as upcoming_appointments
        FROM patients p
        WHERE p.guardian_id = $1
          AND p.is_active = true
        ORDER BY p.created_at DESC
      `,
      [guardianId],
    );

    const guardianSummaryMap = await immunizationScheduleService.getGuardianScheduleSummariesForPatients(
      infantsResult.rows || [],
    );

    res.json({
      data: mergeGuardianScheduleSummaries(infantsResult.rows || [], guardianSummaryMap),
    });
  } catch (error) {
    console.error('Guardian children error:', error);
    next(error);
  }
});

router.get('/guardian/:guardianId/vaccinations', authenticateToken, async (req, res, next) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    if (Number.isNaN(guardianId)) {
      return res.status(400).json({ error: 'Invalid guardian ID' });
    }

    if (!canAccessGuardian(req, guardianId)) {
      return res.status(403).json({ error: 'Access denied for guardian scope' });
    }

    const limit = sanitizeLimit(req.query.limit, 20, 100);
    noCache(res);

    const { providerJoinsSql, providerValueExpression } = await getProviderSqlFragments();

    const result = await db.query(
      `
        SELECT
          ir.*,
          p.first_name,
          p.last_name,
          v.name as vaccine_name,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        LEFT JOIN patients p ON p.id = ir.patient_id
        JOIN vaccines v ON v.id = ir.vaccine_id
        ${providerJoinsSql}
        WHERE ${guardianScopeFilterSql} = $1
          AND ir.is_active = true
          AND p.is_active = true
        ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC
        LIMIT $2
      `,
      [guardianId, limit],
    );

    res.json({ data: result.rows.map(normalizeVaccinationProvider) });
  } catch (error) {
    console.error('Guardian vaccinations error:', error);
    next(error);
  }
});

router.get('/guardian/:guardianId/health-charts', authenticateToken, async (req, res, next) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    const infantId = req.query.infantId ? parseInt(req.query.infantId, 10) : null;

    if (Number.isNaN(guardianId)) {
      return res.status(400).json({ success: false, error: 'Invalid guardian ID', data: [] });
    }

    if (!canAccessGuardian(req, guardianId)) {
      return res.status(403).json({ success: false, error: 'Access denied for guardian scope', data: [] });
    }

    noCache(res);

    const params = [guardianId];
    let whereClause = `${guardianScopeFilterSql} = $1`;

    if (infantId && !Number.isNaN(infantId)) {
      whereClause += ' AND pg.patient_id = $2';
      params.push(infantId);
    }

    const result = await db.query(
      `
        SELECT
          pg.*,
          p.first_name,
          p.last_name,
          p.dob as infant_dob,
          EXTRACT(DAY FROM pg.measurement_date - p.dob) as age_days,
          EXTRACT(YEAR FROM AGE(pg.measurement_date, p.dob)) * 12 + EXTRACT(MONTH FROM AGE(pg.measurement_date, p.dob)) as age_months
        FROM patient_growth pg
        LEFT JOIN patients p ON p.id = pg.patient_id
        WHERE ${whereClause}
          AND pg.is_active = true
          AND p.is_active = true
        ORDER BY pg.patient_id, pg.measurement_date ASC
      `,
      params,
    );

    const groupedData = {};
    result.rows.forEach((row) => {
      const key = row.patient_id;
      if (!groupedData[key]) {
        groupedData[key] = {
          infant: {
            id: row.patient_id,
            first_name: row.first_name,
            last_name: row.last_name,
            dob: row.infant_dob,
          },
          measurements: [],
        };
      }

      groupedData[key].measurements.push({
        id: row.id,
        measurement_date: row.measurement_date,
        weight_kg: row.weight_kg,
        length_cm: row.length_cm,
        head_circumference_cm: row.head_circumference_cm,
        age_days: parseInt(row.age_days || 0, 10),
        age_months: parseFloat(row.age_months || 0),
        notes: row.notes,
      });
    });

    const data = Object.values(groupedData);
    const latestMeasurements = data.map((item) => ({
      infant: item.infant,
      latest: item.measurements[item.measurements.length - 1] || null,
    }));

    res.json({
      success: true,
      data,
      latestMeasurements,
      totalRecords: result.rows.length,
    });
  } catch (error) {
    console.error('Guardian health charts error:', error);
    next(error);
  }
});

router.get('/guardian/:guardianId/notifications', authenticateToken, async (req, res, next) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    if (Number.isNaN(guardianId)) {
      return res.status(400).json({ data: [] });
    }

    if (!canAccessGuardian(req, guardianId)) {
      return res.status(403).json({ data: [] });
    }

    const limit = sanitizeLimit(req.query.limit, 20, 100);
    noCache(res);

    const result = await db.query(
      `
        SELECT *
        FROM notifications
        WHERE guardian_id = $1
          AND target_role IS DISTINCT FROM 'admin'
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [guardianId, limit],
    );

    if (result.rows.length === 0) {
      return res.json({ data: [] });
    }

    res.json({ data: result.rows || [] });
  } catch (error) {
    console.error('Guardian notifications error:', error);
    next(error);
  }
});

router.get('/guardians', authenticateToken, requirePermission('user:view'), async (req, res, next) => {
  try {
    const scopeIds = resolveUserScopeIds(req.user);
    const canonicalRole = getCanonicalRole(req);
    const requestedScope = String(req.query.scope || '').trim().toLowerCase();
    const allowSystemScope = canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN && requestedScope === 'system';
    const useClinicScope = scopeIds.length > 0 && !allowSystemScope;
    
    let query = 'SELECT * FROM guardians';
    const params = [];
    
    if (useClinicScope) {
      query += ' WHERE COALESCE(facility_id, clinic_id) = ANY($1::int[])';
      params.push(scopeIds);
    }
    
    query += ' ORDER BY created_at DESC LIMIT 100';
    
    const result = await db.query(query, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Dashboard guardians error:', error);
    next(error);
  }
});

router.get('/infants', authenticateToken, requirePermission('patient:view'), async (req, res, next) => {
  try {
    const scopeIds = resolveUserScopeIds(req.user);
    const canonicalRole = getCanonicalRole(req);
    const requestedScope = String(req.query.scope || '').trim().toLowerCase();
    const allowSystemScope = canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN && requestedScope === 'system';
    const useClinicScope = scopeIds.length > 0 && !allowSystemScope;

    const requestedFields = String(req.query.fields || req.query.view || req.query.mode || '')
      .trim()
      .toLowerCase();
    const liteMode = requestedFields === 'lite' || requestedFields === 'minimal';
    const limit = sanitizeLimit(req.query.limit, liteMode ? 1000 : 100, liteMode ? 10000 : 1000);
    const page = sanitizeLimit(req.query.page, 1, 100000);
    const offset = (page - 1) * limit;
    const searchTerm = String(req.query.search || req.query.query || "")
      .trim()
      .replace(/\s+/g, " ");
    const includeGuardianJoin =
      !liteMode ||
      searchTerm.length > 0 ||
      String(req.query.include_guardian_name || '')
        .trim()
        .toLowerCase() === 'true';
    const dobStart = normalizeOptionalDateFilter(
      req.query.start_date || req.query.dob_start || req.query.date_of_birth_start,
      'start_date',
    );
    const dobEnd = normalizeOptionalDateFilter(
      req.query.end_date || req.query.dob_end || req.query.date_of_birth_end,
      'end_date',
    );
    const excludeFutureDob =
      ['true', '1', 'yes'].includes(
        String(req.query.exclude_future_dob || req.query.excludeFutureDob || '')
          .trim()
          .toLowerCase(),
      );
    if (dobStart.error || dobEnd.error) {
      return res.status(400).json({
        error: 'Invalid infant filters',
        errors: {
          ...(dobStart.error ? { start_date: dobStart.error } : {}),
          ...(dobEnd.error ? { end_date: dobEnd.error } : {}),
        },
      });
    }
    const patientTable = await resolvePatientTable();
    const controlNumberColumn =
      patientTable === 'patients' ? 'control_number' : 'patient_control_number';
    const scopeColumn = await resolveFirstExistingColumn(
      patientTable,
      ['facility_id', 'clinic_id'],
      null,
    );
    const scopeColumnSelect = scopeColumn
      ? `i.${scopeColumn} AS facility_id`
      : 'NULL::int AS facility_id';
    const scopeExpression = scopeColumn ? `i.${scopeColumn}` : null;
    let whereClause = 'WHERE i.is_active = true';
    const params = [];
    const joinClause = includeGuardianJoin ? 'LEFT JOIN guardians g ON i.guardian_id = g.id' : '';
    const guardianNameSelect = includeGuardianJoin
      ? `COALESCE(NULLIF(TRIM(g.name), ''), 'Guardian unavailable') as guardian_name`
      : 'NULL::text as guardian_name';
    
    if (useClinicScope && scopeExpression) {
      whereClause += ` AND ${scopeExpression} = ANY($${params.length + 1}::int[])`;
      params.push(scopeIds);
    }

    if (dobStart.value) {
      whereClause += ` AND i.dob::date >= $${params.length + 1}::date`;
      params.push(dobStart.value);
    }

    if (dobEnd.value) {
      whereClause += ` AND i.dob::date <= $${params.length + 1}::date`;
      params.push(dobEnd.value);
    }

    if (excludeFutureDob) {
      whereClause += ` AND i.dob::date <= ${CLINIC_TODAY_SQL}`;
    }

    if (searchTerm) {
      // FIX: Dashboard infant search must filter by CHILD name only. Removed
      // g.name so a guardian surname (e.g. 'samorin') no longer pulls every
      // child of that guardian regardless of the child's own last name.
      const searchCondition = patientService.buildTokenizedSearchCondition({
        searchValue: searchTerm,
        expressions: [
          ...patientService.buildPatientNameSearchExpressions('i'),
          `i.${controlNumberColumn}`,
          `TO_CHAR(i.dob, 'YYYY-MM-DD')`,
          `TO_CHAR(i.dob, 'MM/DD/YYYY')`,
        ],
        startingParamIndex: params.length + 1,
      });
      params.push(...searchCondition.params);
      whereClause += `
        AND (
          ${searchCondition.clause}
        )
      `;
    }

    const selectColumns = liteMode
      ? `
          i.id,
          i.first_name,
          i.middle_name,
          i.last_name,
          CONCAT_WS(
            ' ',
            NULLIF(BTRIM(i.first_name), ''),
            NULLIF(BTRIM(i.middle_name), ''),
            NULLIF(BTRIM(i.last_name), '')
          ) AS full_name,
          i.dob,
          i.${controlNumberColumn} AS control_number,
          i.guardian_id,
          ${scopeColumnSelect},
          i.sex,
          i.is_active,
          i.created_at,
          i.updated_at,
          ${guardianNameSelect}
        `
      : `i.*, i.${controlNumberColumn} AS control_number, ${guardianNameSelect}`;

    const result = await db.query(
      `
        SELECT ${selectColumns}
        FROM ${patientTable} i
        ${joinClause}
        ${whereClause}
        ORDER BY i.created_at DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `,
      [...params, limit, offset],
    );
    const countResult = await db.query(
      `
        SELECT COUNT(*)::INT AS total
        FROM ${patientTable} i
        ${joinClause}
        ${whereClause}
      `,
      params,
    );

    const total = Number.parseInt(countResult.rows[0]?.total, 10) || 0;
    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error('Dashboard infants error:', error);
    next(error);
  }
});

router.get('/activity', authenticateToken, requirePermission('dashboard:analytics'), async (req, res, next) => {
  try {
    const days = sanitizeLimit(req.query.days, 7, 90);
    const activity = [];
    const scopeIds = resolveUserScopeIds(req.user);
    const canonicalRole = getCanonicalRole(req);
    const requestedScope = String(req.query.scope || '').trim().toLowerCase();
    const allowSystemScope = canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN && requestedScope === 'system';
    const useClinicScope = scopeIds.length > 0 && !allowSystemScope;
    
    const patientScopeExpression = await resolvePatientScopeExpression('p');
    let scopeFilter = '';
    const vaccinationParams = [days];
    
    if (useClinicScope && patientScopeExpression) {
      scopeFilter = ` AND ${patientScopeExpression} = ANY($2::int[])`;
      vaccinationParams.push(scopeIds);
    }

    const vaccinations = await db.query(
      `
          SELECT
            'vaccination' as type,
            ir.admin_date as time,
            CONCAT(p.first_name, ' ', p.last_name) as patient,
            v.name as detail,
            'Vaccination recorded' as action
          FROM immunization_records ir
          LEFT JOIN patients p ON p.id = ir.patient_id
          JOIN vaccines v ON v.id = ir.vaccine_id
          WHERE ir.created_at >= CURRENT_DATE - ($1 * INTERVAL '1 day')
            AND ir.is_active = true
            AND p.is_active = true
            ${scopeFilter}
          ORDER BY ir.admin_date DESC
          LIMIT 20
        `,
      vaccinationParams,
    );
    vaccinations.rows.forEach((item) => activity.push(item));

    const patientColumn = await resolvePatientColumn();
    const patientTable = await resolvePatientTable();
    
    const appointmentParams = [days];
    if (useClinicScope && patientScopeExpression) {
      appointmentParams.push(scopeIds);
    }
    
    const appointments = await db.query(
      `
          SELECT
            'appointment' as type,
            a.scheduled_date as time,
            CONCAT(p.first_name, ' ', p.last_name) as patient,
            a.type as detail,
            CASE
              WHEN LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled') THEN 'Appointment scheduled'
              WHEN LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('completed', 'attended') THEN 'Appointment completed'
              WHEN LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) = 'cancelled' THEN 'Appointment cancelled'
              WHEN LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('no_show', 'no-show') THEN 'Appointment marked no-show'
              ELSE 'Appointment updated'
            END as action
          FROM appointments a
          LEFT JOIN ${patientTable} p ON p.id = a.${patientColumn}
          WHERE a.created_at >= CURRENT_DATE - ($1 * INTERVAL '1 day')
            AND a.is_active = true
            AND p.is_active = true
            ${scopeFilter}
          ORDER BY a.scheduled_date DESC
          LIMIT 20
        `,
      appointmentParams,
    );
    appointments.rows.forEach((item) => activity.push(item));

    activity.sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json({ data: activity.slice(0, 50) });
  } catch (error) {
    console.error('Dashboard activity error:', error);
    next(error);
  }
});

router.get('/admin/vaccination-monitoring', authenticateToken, requirePermission('dashboard:analytics'), async (req, res, next) => {
  try {
    noCache(res);
    const canonicalRole = getCanonicalRole(req);
    const effectiveScope = resolveEffectiveScope({
      query: req.query,
      user: req.user,
      canonicalRole,
    });
    const monitoringScopeIds = effectiveScope.useScope ? effectiveScope.scopeIds : [];

    const data = await getAdminInfantVaccinationMonitoring({
      infantId: req.query.infant_id ? parseInt(req.query.infant_id, 10) : null,
      clinicId: null,
      scopeIds: monitoringScopeIds,
      guardianId: req.query.guardian_id ? parseInt(req.query.guardian_id, 10) : null,
      status: req.query.status || null,
      dateFrom: req.query.date_from || null,
      dateTo: req.query.date_to || null,
      limit: req.query.limit || 50,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
    });

    const summary = data.reduce(
      (accumulator, item) => {
        accumulator.totalInfants += 1;
        accumulator.totalCompletedDoses += parseInt(item.completed_count || 0, 10);
        accumulator.totalPendingDoses += parseInt(item.pending_count || 0, 10);
        accumulator.totalUpcomingAppointments += parseInt(item.upcoming_appointments_count || 0, 10);

        if (item.next_status === 'overdue') {
          accumulator.overdueInfants += 1;
        }
        if (item.next_status === 'due_soon') {
          accumulator.dueSoonInfants += 1;
        }
        if (item.next_status === 'upcoming') {
          accumulator.upcomingInfants += 1;
        }
        if (item.next_status === 'no_pending_dose') {
          accumulator.fullyScheduledInfants += 1;
        }

        return accumulator;
      },
      {
        totalInfants: 0,
        overdueInfants: 0,
        dueSoonInfants: 0,
        upcomingInfants: 0,
        fullyScheduledInfants: 0,
        totalCompletedDoses: 0,
        totalPendingDoses: 0,
        totalUpcomingAppointments: 0,
      },
    );

    res.json({
      success: true,
      summary,
      data,
    });
  } catch (error) {
    console.error('Admin vaccination monitoring error:', error);
    next(error);
  }
});

router.get('/guardian/:guardianId/vaccinations/:infantId', authenticateToken, async (req, res, next) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    const infantId = parseInt(req.params.infantId, 10);

    if (Number.isNaN(guardianId) || Number.isNaN(infantId)) {
      return res.status(400).json({ data: [] });
    }

    if (!canAccessGuardian(req, guardianId)) {
      return res.status(403).json({ data: [] });
    }

    noCache(res);

    const ownershipResult = await db.query(
      `
        SELECT id
        FROM patients
        WHERE id = $1 AND guardian_id = $2 AND is_active = true
        LIMIT 1
      `,
      [infantId, guardianId],
    );

    if (ownershipResult.rows.length === 0) {
      return res.status(403).json({ error: 'Infant does not belong to this guardian' });
    }

    const { providerJoinsSql, providerValueExpression } = await getProviderSqlFragments();

    const result = await db.query(
      `
        SELECT
          ir.*,
          v.name as vaccine_name,
          vb.lot_no as batch_number,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        LEFT JOIN vaccine_batches vb ON vb.id = ir.batch_id
        ${providerJoinsSql}
        WHERE ir.patient_id = $1
          AND ir.is_active = true
        ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC
      `,
      [infantId],
    );

    res.json({ data: result.rows.map(normalizeVaccinationProvider) });
  } catch (error) {
    console.error('Guardian infant vaccinations error:', error);
    next(error);
  }
});

router.get('/guardian/:guardianId/growth/:infantId', authenticateToken, async (req, res, next) => {
  try {
    const guardianId = parseInt(req.params.guardianId, 10);
    const infantId = parseInt(req.params.infantId, 10);

    if (Number.isNaN(guardianId) || Number.isNaN(infantId)) {
      return res.status(400).json({ data: [] });
    }

    if (!canAccessGuardian(req, guardianId)) {
      return res.status(403).json({ data: [] });
    }

    noCache(res);

    const ownershipResult = await db.query(
      `
        SELECT id
        FROM patients
        WHERE id = $1 AND guardian_id = $2 AND is_active = true
        LIMIT 1
      `,
      [infantId, guardianId],
    );

    if (ownershipResult.rows.length === 0) {
      return res.status(403).json({ error: 'Infant does not belong to this guardian' });
    }

    const result = await db.query(
      `
        SELECT pg.*, p.first_name, p.last_name
        FROM patient_growth pg
        LEFT JOIN patients p ON p.id = pg.patient_id
        WHERE pg.patient_id = $1
          AND pg.is_active = true
        ORDER BY pg.measurement_date DESC
      `,
      [infantId],
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error('Guardian infant growth error:', error);
    next(error);
  }
});

router.use('/analytics', require('./analytics'));

module.exports = router;
module.exports.__testables = {
  collectGuardianDueVaccines,
  withTimeout,
};
