const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');
const {
  getAdminInfantVaccinationMonitoring,
} = require('../services/adminVaccinationMonitoringService');

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

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

const canAccessGuardian = (req, guardianId) => {
  if (isGuardian(req)) {
    return parseInt(req.user.guardian_id, 10) === parseInt(guardianId, 10);
  }
  return getCanonicalRole(req) === CANONICAL_ROLES.SYSTEM_ADMIN;
};

const guardianScopeFilterSql = `
  p.guardian_id
`;

const PROVIDER_FALLBACK_LABEL = 'Provider unavailable';
const PROVIDER_FALLBACK_LABEL_SQL = PROVIDER_FALLBACK_LABEL.replace(/'/g, '\'\'');
const PROVIDER_NAME_COLUMNS = ['full_name', 'name', 'username', 'email'];

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
        [['users', 'admin']],
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

const normalizeVaccinationProvider = (record) => {
  const providerName =
    record?.provider_name || record?.administered_by_name || PROVIDER_FALLBACK_LABEL;

  return {
    ...record,
    provider_name: providerName,
    administered_by_name: record?.administered_by_name || providerName,
  };
};

// Health check endpoint (public)
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

// Dashboard overview stats (SYSTEM_ADMIN)
router.get('/stats', authenticateToken, requirePermission('dashboard:analytics'), async (req, res, next) => {
  try {
    noCache(res);

    const query = `
      SELECT
        (SELECT COUNT(*) FROM patients WHERE is_active = true) as infants,
        (SELECT COUNT(*) FROM immunization_records WHERE is_active = true) as vaccinations,
        (SELECT COUNT(*) FROM appointments WHERE is_active = true) as appointments,
        (SELECT COUNT(*) FROM users WHERE is_active = true) as users,
        (SELECT COUNT(*) FROM vaccines WHERE is_active = true) as vaccines,
        (SELECT COUNT(*) FROM guardians WHERE is_active = true) as guardians
    `;

    const { rows } = await db.query(query);
    const stats = {
      infants: parseInt(rows[0].infants, 10),
      vaccinations: parseInt(rows[0].vaccinations, 10),
      appointments: parseInt(rows[0].appointments, 10),
      users: parseInt(rows[0].users, 10),
      vaccines: parseInt(rows[0].vaccines, 10),
      guardians: parseInt(rows[0].guardians, 10),
    };

    res.json(stats);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    next(error);
  }
});

// Dashboard appointments (SYSTEM_ADMIN)
router.get('/appointments', authenticateToken, requirePermission('appointment:view'), async (req, res, next) => {
  try {
    noCache(res);

    const limit = sanitizeLimit(req.query.limit, 20, 100);

    const result = await db.query(
      `
        SELECT
          a.id,
          a.infant_id,
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
          COALESCE(NULLIF(TRIM(g.name), ''), 'Guardian unavailable') as guardian_name,
          p.control_number
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.infant_id
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE a.scheduled_date >= CURRENT_DATE
          AND a.is_active = true
        ORDER BY a.scheduled_date
        LIMIT $1
      `,
      [limit],
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error('Dashboard appointments error:', error);
    next(error);
  }
});

// Guardian dashboard stats
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
        SELECT COUNT(*) as count
        FROM patients
        WHERE guardian_id = $1 AND is_active = true
      `,
      [guardianId],
    );

    const childrenCount = parseInt(childrenResult.rows?.[0]?.count || 0, 10);

    const completedVaccinationsResult = await db.query(
      `
        SELECT COUNT(*) as count
        FROM immunization_records ir
        LEFT JOIN patients p ON p.id = ir.patient_id
        WHERE ${guardianScopeFilterSql} = $1
          AND ir.status = 'completed'
          AND ir.is_active = true
      `,
      [guardianId],
    );

    const pendingVaccinationsResult = await db.query(
      `
        SELECT COUNT(*) as count
        FROM immunization_records ir
        LEFT JOIN patients p ON p.id = ir.patient_id
        WHERE ${guardianScopeFilterSql} = $1
          AND ir.status IN ('scheduled', 'pending')
          AND ir.is_active = true
      `,
      [guardianId],
    );

    const upcomingVaccinesResult = await db.query(
      `
        SELECT COUNT(*) as count
        FROM immunization_records ir
        LEFT JOIN patients p ON p.id = ir.patient_id
        WHERE ${guardianScopeFilterSql} = $1
          AND ir.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          AND ir.status = 'scheduled'
          AND ir.is_active = true
      `,
      [guardianId],
    );

    const nextAppointmentResult = await db.query(
      `
        SELECT
          a.*,
          p.first_name,
          p.last_name,
          p.control_number
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.infant_id
        WHERE ${guardianScopeFilterSql} = $1
          AND a.scheduled_date >= CURRENT_DATE
          AND LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled')
          AND a.is_active = true
        ORDER BY a.scheduled_date ASC
        LIMIT 1
      `,
      [guardianId],
    );

    res.json({
      childrenCount,
      completedVaccinations: parseInt(completedVaccinationsResult.rows[0].count || 0, 10),
      pendingVaccinations: parseInt(pendingVaccinationsResult.rows[0].count || 0, 10),
      upcomingVaccines: parseInt(upcomingVaccinesResult.rows[0].count || 0, 10),
      nextAppointment: nextAppointmentResult.rows[0] || null,
    });
  } catch (error) {
    console.error('Guardian stats error:', error);
    next(error);
  }
});

// Guardian appointments
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
    noCache(res);

    const result = await db.query(
      `
        SELECT
          a.*,
          p.first_name,
          p.last_name,
          p.control_number,
          p.dob as infant_dob,
          COALESCE(a.location, 'Main Health Center') as location,
          COALESCE(a.type, 'Vaccination Appointment') as type
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.infant_id
        WHERE ${guardianScopeFilterSql} = $1
          AND a.is_active = true
        ORDER BY a.scheduled_date DESC
        LIMIT $2
      `,
      [guardianId, limit],
    );

    res.json({ data: result.rows || [] });
  } catch (error) {
    console.error('Guardian appointments error:', error);
    next(error);
  }
});

// Guardian children
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

    const infantsResult = await db.query(
      `
        SELECT
          p.*,
           (SELECT COUNT(*) FROM immunization_records WHERE patient_id = p.id AND status = 'completed' AND is_active = true) as completed_vaccinations,
           (SELECT COUNT(*) FROM immunization_records WHERE patient_id = p.id AND status IN ('scheduled', 'pending') AND is_active = true) as pending_vaccinations,
           (SELECT COUNT(*) FROM appointments WHERE infant_id = p.id AND scheduled_date >= CURRENT_DATE AND LOWER(REPLACE(COALESCE(status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled') AND is_active = true) as upcoming_appointments
        FROM patients p
        WHERE p.guardian_id = $1
          AND p.is_active = true
        ORDER BY p.created_at DESC
      `,
      [guardianId],
    );

    res.json({ data: infantsResult.rows });
  } catch (error) {
    console.error('Guardian children error:', error);
    next(error);
  }
});

// Guardian vaccinations
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
          p.control_number,
          v.name as vaccine_name,
          ${providerValueExpression} as provider_name,
          ${providerValueExpression} as administered_by_name
        FROM immunization_records ir
        LEFT JOIN patients p ON p.id = ir.patient_id
        JOIN vaccines v ON v.id = ir.vaccine_id
        ${providerJoinsSql}
        WHERE ${guardianScopeFilterSql} = $1
          AND ir.is_active = true
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

// Guardian health charts
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

// Guardian notifications
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
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [guardianId, limit],
    );

    // If no notifications found with guardian_id, return empty array
    // Note: guardians table doesn't have user_id column, so we skip that lookup
    if (result.rows.length === 0) {
      // Return empty result - no fallback to user_id since column doesn't exist
      return res.json({ data: [] });
    }

    res.json({ data: result.rows || [] });
  } catch (error) {
    console.error('Guardian notifications error:', error);
    next(error);
  }
});

// Dashboard guardians (SYSTEM_ADMIN)
router.get('/guardians', authenticateToken, requirePermission('user:view'), async (_req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM guardians ORDER BY created_at DESC LIMIT 100');
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Dashboard guardians error:', error);
    next(error);
  }
});

// Dashboard infants (SYSTEM_ADMIN)
router.get('/infants', authenticateToken, requirePermission('patient:view'), async (_req, res, next) => {
  try {
    const result = await db.query(
      `
        SELECT i.*, g.name as guardian_name
        FROM patients i
        LEFT JOIN guardians g ON i.guardian_id = g.id
        WHERE i.is_active = true
        ORDER BY i.created_at DESC
        LIMIT 100
      `,
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Dashboard infants error:', error);
    next(error);
  }
});

// Dashboard activity (SYSTEM_ADMIN)
router.get('/activity', authenticateToken, requirePermission('dashboard:analytics'), async (req, res, next) => {
  try {
    const days = sanitizeLimit(req.query.days, 7, 90);
    const activity = [];

    const vaccinations = await db.query(
      `
          SELECT
            'vaccination' as type,
            ir.admin_date as time,
            CONCAT(p.first_name, ' ', p.last_name) as patient,
            p.control_number,
            v.name as detail,
            'Vaccination recorded' as action
          FROM immunization_records ir
          LEFT JOIN patients p ON p.id = ir.patient_id
          JOIN vaccines v ON v.id = ir.vaccine_id
          WHERE ir.created_at >= CURRENT_DATE - INTERVAL '${days} days'
            AND ir.is_active = true
          ORDER BY ir.admin_date DESC
          LIMIT 20
        `,
    );
    vaccinations.rows.forEach((item) => activity.push(item));

    const appointments = await db.query(
      `
          SELECT
            'appointment' as type,
            a.scheduled_date as time,
            CONCAT(p.first_name, ' ', p.last_name) as patient,
            p.control_number,
            a.type as detail,
            CASE
              WHEN LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('scheduled', 'confirmed', 'rescheduled') THEN 'Appointment scheduled'
              WHEN LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('completed', 'attended') THEN 'Appointment completed'
              WHEN LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) = 'cancelled' THEN 'Appointment cancelled'
              WHEN LOWER(REPLACE(COALESCE(a.status::text, ''), '-', '_')) IN ('no_show', 'no-show') THEN 'Appointment marked no-show'
              ELSE 'Appointment updated'
            END as action
          FROM appointments a
          LEFT JOIN patients p ON p.id = a.infant_id
          WHERE a.created_at >= CURRENT_DATE - INTERVAL '${days} days'
            AND a.is_active = true
          ORDER BY a.scheduled_date DESC
          LIMIT 20
        `,
    );
    appointments.rows.forEach((item) => activity.push(item));

    activity.sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json({ data: activity.slice(0, 50) });
  } catch (error) {
    console.error('Dashboard activity error:', error);
    next(error);
  }
});

// Admin monitoring: full infant vaccination history + next-dose/upcoming appointments
router.get('/admin/vaccination-monitoring', authenticateToken, requirePermission('dashboard:analytics'), async (req, res, next) => {
  try {
    noCache(res);

    const data = await getAdminInfantVaccinationMonitoring({
      infantId: req.query.infant_id ? parseInt(req.query.infant_id, 10) : null,
      clinicId: req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null,
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

// Guardian vaccination records by infant
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

// Guardian growth records by infant
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
        SELECT pg.*, p.first_name, p.last_name, p.control_number
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
