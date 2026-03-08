/**
 * Admin Activity Monitoring Service
 * Tracks and monitors administrator actions for security
 */

const pool = require('../db');
const emailService = require('./emailService');

// Admin roles - includes all roles that should have admin dashboard access
const ADMIN_ROLES = ['super_admin', 'admin', 'clinic_manager', 'physician', 'nurse'];

/**
 * Log admin activity
 * @param {number} adminId - Admin user ID
 * @param {string} action - Action performed
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - Browser user agent
 * @param {Object} details - Additional details
 */
const logActivity = async (adminId, action, ipAddress, userAgent, details = {}) => {
  try {
    await pool.query(
      `INSERT INTO admin_activity_log 
       (admin_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, action, ipAddress, userAgent, JSON.stringify(details)]
    );

    return true;
  } catch (error) {
    console.error('Error logging admin activity:', error);
    return false;
  }
};

/**
 * Log admin login
 * @param {Object} admin - Admin user data
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - Browser user agent
 */
const logLogin = async (admin, ipAddress, userAgent) => {
  try {
    // Log to activity log
    await logActivity(admin.id, 'LOGIN', ipAddress, userAgent, {
      username: admin.username,
      role: admin.role_name
    });

    // Send notification for admin login
    if (process.env.ADMIN_LOGIN_NOTIFICATION === 'true') {
      try {
        await emailService.sendAdminLoginNotification(
          admin.email,
          admin.username,
          ipAddress,
          userAgent
        );
      } catch (emailError) {
        console.error('Failed to send admin login notification:', emailError);
      }
    }

    // Log security event
    const securityEventService = require('./securityEventService');
    await securityEventService.logEvent({
      userId: admin.id,
      eventType: 'ADMIN_LOGIN',
      severity: 'INFO',
      ipAddress,
      userAgent,
      details: {
        username: admin.username,
        role: admin.role_name
      }
    });

    return true;
  } catch (error) {
    console.error('Error logging admin login:', error);
    return false;
  }
};

/**
 * Log sensitive admin action
 * @param {number} adminId - Admin user ID
 * @param {string} action - Action performed
 * @param {string} resourceType - Type of resource affected
 * @param {number} resourceId - ID of affected resource
 * @param {Object} oldValues - Old values (for updates)
 * @param {Object} newValues - New values
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - Browser user agent
 */
const logSensitiveAction = async (
  adminId,
  action,
  resourceType,
  resourceId,
  oldValues,
  newValues,
  ipAddress,
  userAgent
) => {
  try {
    await logActivity(adminId, action, ipAddress, userAgent, {
      resourceType,
      resourceId,
      oldValues: oldValues ? JSON.stringify(oldValues) : null,
      newValues: newValues ? JSON.stringify(newValues) : null
    });

    // Log security event for sensitive actions
    const securityEventService = require('./securityEventService');
    await securityEventService.logEvent({
      userId: adminId,
      eventType: 'ADMIN_ACTION',
      severity: 'WARNING',
      ipAddress,
      userAgent,
      resourceType,
      resourceId,
      details: {
        action,
        changes: {
          old: oldValues ? '[REDACTED]' : null,
          new: newValues ? '[REDACTED]' : null
        }
      }
    });

    return true;
  } catch (error) {
    console.error('Error logging sensitive admin action:', error);
    return false;
  }
};

/**
 * Get admin activity log
 * @param {number} adminId - Admin user ID
 * @param {number} limit - Maximum number of entries
 * @returns {Promise<Array>}
 */
const getActivityLog = async (adminId, limit = 100) => {
  try {
    const result = await pool.query(
      `SELECT * FROM admin_activity_log 
       WHERE admin_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [adminId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting admin activity log:', error);
    return [];
  }
};

/**
 * Get all admin activities (super admin only)
 * @param {Object} options - Query options
 * @returns {Promise<Array>}
 */
const getAllActivities = async (options = {}) => {
  const { limit = 100, offset = 0, adminId, action, startDate, endDate } = options;

  try {
    let query = `
      SELECT aal.*, u.username, r.name as role_name
      FROM admin_activity_log aal
      JOIN users u ON aal.admin_id = u.id
      JOIN roles r ON u.role_id = r.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (adminId) {
      query += ` AND aal.admin_id = $${paramIndex++}`;
      params.push(adminId);
    }

    if (action) {
      query += ` AND aal.action = $${paramIndex++}`;
      params.push(action);
    }

    if (startDate) {
      query += ` AND aal.created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND aal.created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ` ORDER BY aal.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error getting all admin activities:', error);
    return [];
  }
};

/**
 * Get admin activity summary
 * @param {number} adminId - Admin user ID
 * @param {number} days - Number of days to analyze
 * @returns {Promise<Object>}
 */
const getActivitySummary = async (adminId, days = 7) => {
  try {
    const result = await pool.query(
      `SELECT 
         action,
         COUNT(*) as count,
         MIN(created_at) as first_activity,
         MAX(created_at) as last_activity
       FROM admin_activity_log 
       WHERE admin_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY action
       ORDER BY count DESC`,
      [adminId]
    );

    const totalActions = result.rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    return {
      adminId,
      period: `${days} days`,
      totalActions,
      actionBreakdown: result.rows
    };
  } catch (error) {
    console.error('Error getting admin activity summary:', error);
    return null;
  }
};

/**
 * Check if user is admin
 * @param {Object} user - User object
 * @returns {boolean}
 */
const isAdmin = (user) => {
  if (!user || !user.role) {
    return false;
  }
  return ADMIN_ROLES.includes(user.role);
};

/**
 * Check if user is super admin
 * @param {Object} user - User object
 * @returns {boolean}
 */
const isSuperAdmin = (user) => {
  if (!user || !user.role) {
    return false;
  }
  return user.role === 'super_admin';
};

/**
 * Get recent suspicious admin activity
 * @param {number} limit - Maximum number of entries
 * @returns {Promise<Array>}
 */
const getSuspiciousActivity = async (limit = 50) => {
  try {
    const sensitiveActions = [
      'DELETE_USER',
      'DELETE_CLINIC',
      'DELETE_VACCINE',
      'DELETE_INVENTORY',
      'CHANGE_PERMISSIONS',
      'EXPORT_DATA',
      'BULK_DELETE'
    ];

    const result = await pool.query(
      `SELECT aal.*, u.username, r.name as role_name
       FROM admin_activity_log aal
       JOIN users u ON aal.admin_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE aal.action = ANY($1)
       ORDER BY aal.created_at DESC
       LIMIT $2`,
      [sensitiveActions, limit]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting suspicious admin activity:', error);
    return [];
  }
};

/**
 * Create admin activity log table
 */
const createTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_activity_log (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action VARCHAR(100) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_admin_activity_log_admin_id ON admin_activity_log(admin_id);
      CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action ON admin_activity_log(action);
      CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created_at ON admin_activity_log(created_at);
    `);

    console.log('Admin activity log table created/verified');
    return true;
  } catch (error) {
    console.error('Error creating admin activity log table:', error);
    throw error;
  }
};

/**
 * Clean up old admin activity logs
 * @param {number} daysToKeep - Number of days to retain logs
 */
const cleanupOldLogs = async (daysToKeep = 90) => {
  try {
    const result = await pool.query(
      `DELETE FROM admin_activity_log 
       WHERE created_at < NOW() - INTERVAL '${daysToKeep} days'`
    );
    console.log(`Cleaned up ${result.rowCount} old admin activity log entries`);
    return result.rowCount;
  } catch (error) {
    console.error('Error cleaning up old admin activity logs:', error);
    return 0;
  }
};

module.exports = {
  ADMIN_ROLES,
  logActivity,
  logLogin,
  logSensitiveAction,
  getActivityLog,
  getAllActivities,
  getActivitySummary,
  isAdmin,
  isSuperAdmin,
  getSuspiciousActivity,
  createTable,
  cleanupOldLogs
};
