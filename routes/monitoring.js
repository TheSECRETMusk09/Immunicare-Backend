const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken: auth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { listAuditLogs, exportAuditLogsCsv } = require('../services/auditLogService');
const { ensureDigitalPapersCompatibility } = require('../services/digitalPapersCompatibilityService');
const {
  getUserNameExpressions,
  resolveFirstExistingColumn,
} = require('../utils/queryCompatibility');

// Root route - return API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Monitoring API',
    endpoints: [
      '/monitoring',
      '/alerts',
      '/audit-logs',
      '/usage-trends',
      '/user-activity',
      '/template-performance',
    ],
  });
});

const detectAuditAnomalies = (logs = []) =>
  logs.filter((log) => {
    const severity = String(log?.severity || '').toUpperCase();
    const eventType = String(log?.event_type || log?.action_type || '').toUpperCase();

    return (
      severity === 'CRITICAL' ||
      log?.success === false ||
      /DELETE|RESET|OVERRIDE|DISABLED|REJECTED|FAILED/.test(eventType)
    );
  });

const requireMonitoringAccess = requirePermission('dashboard:analytics');
const getCompletionStatusChildColumn = () =>
  resolveFirstExistingColumn('paper_completion_status', ['infant_id', 'patient_id'], 'infant_id');
const getDocumentDownloadsChildColumn = () =>
  resolveFirstExistingColumn('document_downloads', ['infant_id', 'patient_id'], 'infant_id');
const isSchemaCompatibilityError = (error) =>
  ['42P01', '42703', '42883'].includes(error?.code);

const normalizeDateFilter = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().split('T')[0];
};

const getLegacyInfantsJoinConfig = async () => {
  return {
    joinClause: '',
    firstNameExpression: '\'\'',
    lastNameExpression: '\'\'',
    dobExpression: 'NULL',
  };
};

// GET /api/monitoring/monitoring - Get real-time monitoring data
router.get('/monitoring', auth, requireMonitoringAccess, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Get document generation statistics
    const generationStats = await getGenerationStats(start_date, end_date);

    // Get completion status overview
    const completionOverview = await getCompletionOverview();

    // Get recent downloads
    const recentDownloads = await getRecentDownloads(start_date, end_date);

    // Get alerts for incomplete documents
    const alerts = await getIncompleteDocumentAlerts();

    // Get system performance metrics
    const performanceMetrics = await getPerformanceMetrics();

    res.json({
      success: true,
      data: {
        generation_stats: generationStats,
        completion_overview: completionOverview,
        recent_downloads: recentDownloads,
        alerts: alerts,
        performance_metrics: performanceMetrics,
      },
    });
  } catch (error) {
    console.error('Error fetching monitoring data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monitoring data',
      code: 'FETCH_ERROR',
    });
  }
});

// GET /api/monitoring/alerts - Get document completion alerts
router.get('/alerts', auth, requireMonitoringAccess, async (req, res) => {
  try {
    const { status = 'PENDING', limit = 20 } = req.query;
    await ensureDigitalPapersCompatibility();
    const childColumn = await getCompletionStatusChildColumn();
    const completedByExpressions = await getUserNameExpressions('u', {
      fallbackFirstName: 'System User',
    });
    const legacyInfantsJoin = await getLegacyInfantsJoinConfig('i', `pcs.${childColumn}`);
    const result = await db.query(
      `
        SELECT
          pcs.*,
          COALESCE(p.first_name, ${legacyInfantsJoin.firstNameExpression}, '') AS infant_first_name,
          COALESCE(p.last_name, ${legacyInfantsJoin.lastNameExpression}, '') AS infant_last_name,
          COALESCE(p.dob, ${legacyInfantsJoin.dobExpression}) AS infant_dob,
          pt.name AS template_name,
          pt.template_type,
          ${completedByExpressions.firstName} AS completed_by_first_name,
          ${completedByExpressions.lastName} AS completed_by_last_name,
          EXTRACT(DAY FROM NOW() - COALESCE(pcs.last_updated, CURRENT_TIMESTAMP)) AS days_since_update
        FROM paper_completion_status pcs
        LEFT JOIN patients p ON pcs.${childColumn} = p.id
        ${legacyInfantsJoin.joinClause}
        LEFT JOIN paper_templates pt ON pcs.template_id = pt.id
        LEFT JOIN users u ON pcs.completed_by = u.id
        WHERE pcs.completion_status = $1
        ORDER BY COALESCE(pcs.last_updated, CURRENT_TIMESTAMP) DESC
        LIMIT $2
      `,
      [status, parseInt(limit, 10)],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    if (isSchemaCompatibilityError(error)) {
      console.warn('Monitoring alerts unavailable due to schema mismatch:', error.message);
      return res.json({
        success: true,
        data: [],
        degraded: true,
        message: 'Monitoring alerts are temporarily unavailable while digital papers analytics catches up with the current schema.',
      });
    }

    console.error('Error fetching alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alerts',
      code: 'FETCH_ERROR',
    });
  }
});

// GET /api/monitoring/audit-logs - Get audit logs with anomaly detection
router.get('/audit-logs', auth, requirePermission('system:audit'), async (req, res) => {
  try {
    const {
      start_date,
      end_date,
      severity,
      action_type,
      user,
      username,
      dateRange,
      limit = 100,
      offset = 0,
    } = req.query;

    const logs = await listAuditLogs({
      user,
      username,
      actionType: action_type,
      severity,
      startDate: start_date,
      endDate: end_date,
      dateRange,
      limit,
      offset,
    });

    const anomalies = detectAuditAnomalies(logs);

    res.json({
      success: true,
      data: {
        logs,
        anomalies,
        anomaly_count: anomalies.length,
        summary: {
          total: logs.length,
          failed: logs.filter((log) => log.success === false).length,
          critical: logs.filter((log) => String(log.severity || '').toUpperCase() === 'CRITICAL').length,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs',
      code: 'FETCH_ERROR',
    });
  }
});

router.get('/audit-logs/export', auth, requirePermission('system:audit'), async (req, res) => {
  try {
    const csv = await exportAuditLogsCsv({
      user: req.query.user,
      username: req.query.username,
      actionType: req.query.action_type || req.query.actionType,
      severity: req.query.severity,
      startDate: req.query.start_date,
      endDate: req.query.end_date,
      dateRange: req.query.dateRange,
      limit: req.query.limit || 1000,
    });

    const exportDate = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${exportDate}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export audit logs',
      code: 'EXPORT_ERROR',
    });
  }
});

// GET /api/monitoring/usage-trends - Get usage trends over time
router.get('/usage-trends', auth, requireMonitoringAccess, async (req, res) => {
  try {
    const { start_date, end_date, interval = 'day' } = req.query;

    try {
      let groupByClause;
      switch (interval) {
      case 'week':
        groupByClause = 'DATE_TRUNC(\'week\', download_date)';
        break;
      case 'month':
        groupByClause = 'DATE_TRUNC(\'month\', download_date)';
        break;
      default:
        groupByClause = 'DATE(download_date)';
      }

      const result = await db.query(`
        SELECT
          ${groupByClause} as period,
          COUNT(*) as download_count,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT infant_id) as unique_infants,
          pt.template_type,
          pt.name as template_name
        FROM document_downloads dd
        JOIN paper_templates pt ON dd.template_id = pt.id
        WHERE 1=1
          ${start_date ? `AND download_date >= '${start_date}'` : ''}
          ${end_date ? `AND download_date <= '${end_date}'` : ''}
        GROUP BY ${groupByClause}, pt.template_type, pt.name
        ORDER BY period DESC, download_count DESC
      `);

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (dbError) {
      // Table doesn't exist, return empty data
      console.warn('Usage trends table not found:', dbError.message);
      res.json({
        success: true,
        data: [],
        message: 'Usage trends table not available',
      });
    }
  } catch (error) {
    console.error('Error fetching usage trends:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch usage trends',
      code: 'FETCH_ERROR',
    });
  }
});

// GET /api/monitoring/user-activity - Get user activity metrics
router.get('/user-activity', auth, requireMonitoringAccess, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    try {
      await ensureDigitalPapersCompatibility();
      const userNameExpressions = await getUserNameExpressions('u', {
        fallbackFirstName: 'System User',
      });
      const childColumn = await getDocumentDownloadsChildColumn();
      const result = await db.query(
        `
        SELECT
          u.id,
          ${userNameExpressions.firstName} AS first_name,
          ${userNameExpressions.lastName} AS last_name,
          u.role,
          COUNT(dd.id) as total_downloads,
          COUNT(DISTINCT dd.${childColumn}) as unique_infants,
          COUNT(DISTINCT dd.template_id) as unique_templates,
          MAX(dd.download_date) as last_activity
        FROM users u
        LEFT JOIN document_downloads dd ON u.id = dd.user_id
        WHERE u.role IN ('admin', 'nurse', 'doctor')
        GROUP BY u.id, ${userNameExpressions.firstName}, ${userNameExpressions.lastName}, u.role
        ORDER BY total_downloads DESC
        LIMIT $1
      `,
        [parseInt(limit)],
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (dbError) {
      // Table doesn't exist, return empty data
      console.warn('User activity table not found:', dbError.message);
      res.json({
        success: true,
        data: [],
        message: 'User activity table not available',
      });
    }
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user activity',
      code: 'FETCH_ERROR',
    });
  }
});

// GET /api/monitoring/template-performance - Get template performance metrics
router.get('/template-performance', auth, requireMonitoringAccess, async (req, res) => {
  try {
    try {
      const result = await db.query(`
        SELECT
          pt.id,
          pt.name as template_name,
          pt.template_type,
          pt.is_active,
          COUNT(dd.id) as total_generations,
          COUNT(DISTINCT dd.infant_id) as unique_infants,
          COUNT(DISTINCT dd.user_id) as unique_users,
          AVG(EXTRACT(EPOCH FROM (dd.download_date - dd.download_date))) as avg_generation_time,
          COUNT(CASE WHEN dd.download_status = 'COMPLETED' THEN 1 END) as successful_generations,
          COUNT(CASE WHEN dd.download_status = 'FAILED' THEN 1 END) as failed_generations
        FROM paper_templates pt
        LEFT JOIN document_downloads dd ON pt.id = dd.template_id
        GROUP BY pt.id, pt.name, pt.template_type, pt.is_active
        ORDER BY total_generations DESC
      `);

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (dbError) {
      // Table doesn't exist, return empty data
      console.warn('Template performance table not found:', dbError.message);
      res.json({
        success: true,
        data: [],
        message: 'Template performance table not available',
      });
    }
  } catch (error) {
    console.error('Error fetching template performance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch template performance',
      code: 'FETCH_ERROR',
    });
  }
});

// Helper functions
async function getGenerationStats(startDate, endDate) {
  try {
    await ensureDigitalPapersCompatibility();
    const params = [];
    const clauses = [];
    const normalizedStartDate = normalizeDateFilter(startDate);
    const normalizedEndDate = normalizeDateFilter(endDate);

    if (normalizedStartDate) {
      clauses.push(`download_date::date >= $${params.length + 1}::date`);
      params.push(normalizedStartDate);
    }

    if (normalizedEndDate) {
      clauses.push(`download_date::date <= $${params.length + 1}::date`);
      params.push(normalizedEndDate);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await db.query(`
      SELECT
        COUNT(*) as total_generations,
        COUNT(DISTINCT infant_id) as unique_infants,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT template_id) as unique_templates,
        COUNT(CASE WHEN download_status = 'COMPLETED' THEN 1 END) as successful_generations,
        COUNT(CASE WHEN download_status = 'FAILED' THEN 1 END) as failed_generations,
        AVG(EXTRACT(EPOCH FROM (download_date - download_date))) as avg_generation_time
      FROM document_downloads
      ${whereClause}
    `, params);

    return result.rows[0];
  } catch (error) {
    console.warn('Generation stats table not found:', error.message);
    return {
      total_generations: 0,
      unique_infants: 0,
      unique_users: 0,
      unique_templates: 0,
      successful_generations: 0,
      failed_generations: 0,
      avg_generation_time: 0,
    };
  }
}

async function getCompletionOverview() {
  try {
    await ensureDigitalPapersCompatibility();
    const result = await db.query(`
      SELECT
        completion_status,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
      FROM paper_completion_status
      GROUP BY completion_status
      ORDER BY count DESC
    `);

    return result.rows;
  } catch (error) {
    console.warn('Completion overview table not found:', error.message);
    return [];
  }
}

async function getRecentDownloads(startDate, endDate) {
  try {
    await ensureDigitalPapersCompatibility();
    const childColumn = await getDocumentDownloadsChildColumn();
    const userNameExpressions = await getUserNameExpressions('u', {
      fallbackFirstName: 'System User',
    });
    const legacyInfantsJoin = await getLegacyInfantsJoinConfig('i', `dd.${childColumn}`);
    const params = [];
    const clauses = [];
    const normalizedStartDate = normalizeDateFilter(startDate);
    const normalizedEndDate = normalizeDateFilter(endDate);

    if (normalizedStartDate) {
      clauses.push(`dd.download_date::date >= $${params.length + 1}::date`);
      params.push(normalizedStartDate);
    }

    if (normalizedEndDate) {
      clauses.push(`dd.download_date::date <= $${params.length + 1}::date`);
      params.push(normalizedEndDate);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(`
      SELECT
        dd.*,
        pt.name as template_name,
        pt.template_type,
        COALESCE(p.first_name, ${legacyInfantsJoin.firstNameExpression}, '') as infant_first_name,
        COALESCE(p.last_name, ${legacyInfantsJoin.lastNameExpression}, '') as infant_last_name,
        ${userNameExpressions.firstName} as user_first_name,
        ${userNameExpressions.lastName} as user_last_name
      FROM document_downloads dd
      LEFT JOIN paper_templates pt ON dd.template_id = pt.id
      LEFT JOIN patients p ON dd.${childColumn} = p.id
      ${legacyInfantsJoin.joinClause}
      LEFT JOIN users u ON dd.user_id = u.id
      ${whereClause}
      ORDER BY dd.download_date DESC
      LIMIT 10
    `, params);

    return result.rows;
  } catch (error) {
    console.warn('Recent downloads table not found:', error.message);
    return [];
  }
}

async function getIncompleteDocumentAlerts() {
  try {
    await ensureDigitalPapersCompatibility();
    const childColumn = await getCompletionStatusChildColumn();
    const legacyInfantsJoin = await getLegacyInfantsJoinConfig('i', `pcs.${childColumn}`);
    const result = await db.query(`
      SELECT
        pcs.*,
        COALESCE(p.first_name, ${legacyInfantsJoin.firstNameExpression}, '') as infant_first_name,
        COALESCE(p.last_name, ${legacyInfantsJoin.lastNameExpression}, '') as infant_last_name,
        COALESCE(p.dob, ${legacyInfantsJoin.dobExpression}) as infant_dob,
        pt.name as template_name,
        pt.template_type,
        EXTRACT(DAY FROM NOW() - pcs.last_updated) as days_since_update
      FROM paper_completion_status pcs
      LEFT JOIN patients p ON pcs.${childColumn} = p.id
      ${legacyInfantsJoin.joinClause}
      LEFT JOIN paper_templates pt ON pcs.template_id = pt.id
      WHERE pcs.completion_status = 'PENDING'
        AND pcs.last_updated < NOW() - INTERVAL '7 days'
      ORDER BY pcs.last_updated ASC
      LIMIT 20
    `);

    return result.rows;
  } catch (error) {
    console.warn('Incomplete document alerts table not found:', error.message);
    return [];
  }
}

async function getPerformanceMetrics() {
  try {
    await ensureDigitalPapersCompatibility();
    const result = await db.query(`
      SELECT
        'avg_generation_time' as metric,
        AVG(EXTRACT(EPOCH FROM (download_date - download_date))) as value
      FROM document_downloads
      WHERE download_status = 'COMPLETED'

      UNION ALL

      SELECT
        'failed_generation_rate' as metric,
        (COUNT(CASE WHEN download_status = 'FAILED' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0)) as value
      FROM document_downloads

      UNION ALL

      SELECT
        'avg_completion_percentage' as metric,
        AVG(completion_percentage) as value
      FROM paper_completion_status
    `);

    const metrics = {};
    result.rows.forEach((row) => {
      metrics[row.metric] = parseFloat(row.value || 0);
    });

    return metrics;
  } catch (error) {
    console.warn('Performance metrics table not found:', error.message);
    return {
      avg_generation_time: 0,
      failed_generation_rate: 0,
      avg_completion_percentage: 0,
    };
  }
}

module.exports = router;
