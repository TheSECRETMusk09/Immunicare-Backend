const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken: auth } = require('../middleware/auth');

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
      '/template-performance'
    ]
  });
});

// GET /api/monitoring/monitoring - Get real-time monitoring data
router.get('/monitoring', auth, async (req, res) => {
  try {
    // Check if user has admin role
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    const { start_date, end_date } = req.query;

    // Get document generation statistics
    const generationStats = await getGenerationStats(start_date, end_date);

    // Get completion status overview
    const completionOverview = await getCompletionOverview();

    // Get recent downloads
    const recentDownloads = await getRecentDownloads();

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
        performance_metrics: performanceMetrics
      }
    });
  } catch (error) {
    console.error('Error fetching monitoring data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monitoring data',
      code: 'FETCH_ERROR'
    });
  }
});

// GET /api/monitoring/alerts - Get document completion alerts
router.get('/alerts', auth, async (req, res) => {
  try {
    // Check if user has admin, super_admin, nurse, or doctor role
    if (!req.user || !['admin', 'super_admin', 'nurse', 'doctor'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Admin, nurse, or doctor access required',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    const { status = 'PENDING', limit = 20 } = req.query;

    try {
      const result = await db.query(
        `
        SELECT 
          pcs.*,
          i.first_name as infant_first_name,
          i.last_name as infant_last_name,
          i.dob as infant_dob,
          pt.name as template_name,
          pt.template_type,
          u.first_name as completed_by_first_name,
          u.last_name as completed_by_last_name
        FROM paper_completion_status pcs
        JOIN infants i ON pcs.infant_id = i.id
        JOIN paper_templates pt ON pcs.template_id = pt.id
        LEFT JOIN users u ON pcs.completed_by = u.id
        WHERE pcs.completion_status = $1
        ORDER BY pcs.last_updated DESC
        LIMIT $2
      `,
        [status, parseInt(limit)]
      );

      res.json({
        success: true,
        data: result.rows
      });
    } catch (dbError) {
      // Table doesn't exist, return empty data
      console.warn('Alerts table not found:', dbError.message);
      res.json({
        success: true,
        data: [],
        message: 'Alerts table not available'
      });
    }
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alerts',
      code: 'FETCH_ERROR'
    });
  }
});

// GET /api/monitoring/audit-logs - Get audit logs with anomaly detection
router.get('/audit-logs', auth, async (req, res) => {
  try {
    // Check if user has admin role
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    const { start_date, end_date, severity, action_type, limit = 100 } = req.query;

    try {
      let whereClause = 'WHERE 1=1';
      const params = [];

      if (start_date) {
        whereClause += ` AND timestamp >= ${params.length + 1}`;
        params.push(start_date);
      }

      if (end_date) {
        whereClause += ` AND timestamp <= ${params.length + 1}`;
        params.push(end_date);
      }

      if (severity) {
        whereClause += ` AND severity = ${params.length + 1}`;
        params.push(severity);
      }

      if (action_type) {
        whereClause += ` AND action_type = ${params.length + 1}`;
        params.push(action_type);
      }

      const result = await db.query(
        `
        SELECT 
          id,
          timestamp,
          user_id,
          action_type,
          severity,
          details,
          ip_address,
          user_agent
        FROM audit_logs
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ${params.length + 1}
      `,
        [...params, parseInt(limit)]
      );

      // Detect anomalies
      const anomalies = result.rows.filter(
        (log) =>
          log.severity === 'critical' ||
          (log.action_type.includes('delete') && log.severity === 'warning')
      );

      res.json({
        success: true,
        data: {
          logs: result.rows,
          anomalies: anomalies,
          anomaly_count: anomalies.length
        }
      });
    } catch (dbError) {
      // Table doesn't exist, return empty data
      console.warn('Audit logs table not found:', dbError.message);
      res.json({
        success: true,
        data: {
          logs: [],
          anomalies: [],
          anomaly_count: 0
        },
        message: 'Audit logs table not available'
      });
    }
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs',
      code: 'FETCH_ERROR'
    });
  }
});

// GET /api/monitoring/usage-trends - Get usage trends over time
router.get('/usage-trends', auth, async (req, res) => {
  try {
    // Check if user has admin role
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

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
        data: result.rows
      });
    } catch (dbError) {
      // Table doesn't exist, return empty data
      console.warn('Usage trends table not found:', dbError.message);
      res.json({
        success: true,
        data: [],
        message: 'Usage trends table not available'
      });
    }
  } catch (error) {
    console.error('Error fetching usage trends:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch usage trends',
      code: 'FETCH_ERROR'
    });
  }
});

// GET /api/monitoring/user-activity - Get user activity metrics
router.get('/user-activity', auth, async (req, res) => {
  try {
    // Check if user has admin role
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    const { limit = 10 } = req.query;

    try {
      const result = await db.query(
        `
        SELECT 
          u.id,
          u.first_name,
          u.last_name,
          u.role,
          COUNT(dd.id) as total_downloads,
          COUNT(DISTINCT dd.infant_id) as unique_infants,
          COUNT(DISTINCT dd.template_id) as unique_templates,
          MAX(dd.download_date) as last_activity
        FROM users u
        LEFT JOIN document_downloads dd ON u.id = dd.user_id
        WHERE u.role IN ('admin', 'nurse', 'doctor')
        GROUP BY u.id, u.first_name, u.last_name, u.role
        ORDER BY total_downloads DESC
        LIMIT $1
      `,
        [parseInt(limit)]
      );

      res.json({
        success: true,
        data: result.rows
      });
    } catch (dbError) {
      // Table doesn't exist, return empty data
      console.warn('User activity table not found:', dbError.message);
      res.json({
        success: true,
        data: [],
        message: 'User activity table not available'
      });
    }
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user activity',
      code: 'FETCH_ERROR'
    });
  }
});

// GET /api/monitoring/template-performance - Get template performance metrics
router.get('/template-performance', auth, async (req, res) => {
  try {
    // Check if user has admin role
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

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
        data: result.rows
      });
    } catch (dbError) {
      // Table doesn't exist, return empty data
      console.warn('Template performance table not found:', dbError.message);
      res.json({
        success: true,
        data: [],
        message: 'Template performance table not available'
      });
    }
  } catch (error) {
    console.error('Error fetching template performance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch template performance',
      code: 'FETCH_ERROR'
    });
  }
});

// Helper functions
async function getGenerationStats(startDate, endDate) {
  try {
    const whereClause =
      startDate || endDate
        ? `WHERE 1=1 ${startDate ? `AND download_date >= '${startDate}'` : ''} ${
          endDate ? `AND download_date <= '${endDate}'` : ''
        }`
        : '';

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
    `);

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
      avg_generation_time: 0
    };
  }
}

async function getCompletionOverview() {
  try {
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

async function getRecentDownloads() {
  try {
    const result = await db.query(`
      SELECT 
        dd.*,
        pt.name as template_name,
        pt.template_type,
        i.first_name as infant_first_name,
        i.last_name as infant_last_name,
        u.first_name as user_first_name,
        u.last_name as user_last_name
      FROM document_downloads dd
      JOIN paper_templates pt ON dd.template_id = pt.id
      JOIN infants i ON dd.infant_id = i.id
      JOIN users u ON dd.user_id = u.id
      ORDER BY dd.download_date DESC
      LIMIT 10
    `);

    return result.rows;
  } catch (error) {
    console.warn('Recent downloads table not found:', error.message);
    return [];
  }
}

async function getIncompleteDocumentAlerts() {
  try {
    const result = await db.query(`
      SELECT 
        pcs.*,
        i.first_name as infant_first_name,
        i.last_name as infant_last_name,
        i.dob as infant_dob,
        pt.name as template_name,
        pt.template_type,
        EXTRACT(DAY FROM NOW() - pcs.last_updated) as days_since_update
      FROM paper_completion_status pcs
      JOIN infants i ON pcs.infant_id = i.id
      JOIN paper_templates pt ON pcs.template_id = pt.id
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
      avg_completion_percentage: 0
    };
  }
}

module.exports = router;
