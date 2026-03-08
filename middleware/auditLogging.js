/**
 * Audit Logging Middleware for Access Control
 * Logs all access attempts, authorization failures, and security events
 */

const jwt = require('jsonwebtoken');
const pool = require('../db');
const { getUserPermissions } = require('./role-based-access');

// In-memory audit log buffer (for performance)
const auditBuffer = [];
const BUFFER_FLUSH_INTERVAL = 60000; // Flush every 60 seconds
const MAX_BUFFER_SIZE = 100;

/**
 * Audit event types
 */
const AuditEventTypes = {
  // Authentication events
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',

  // Authorization events
  ACCESS_GRANTED: 'ACCESS_GRANTED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  PERMISSION_CHECK: 'PERMISSION_CHECK',
  ROLE_CHANGE: 'ROLE_CHANGE',

  // Data access events
  DATA_READ: 'DATA_READ',
  DATA_CREATE: 'DATA_CREATE',
  DATA_UPDATE: 'DATA_UPDATE',
  DATA_DELETE: 'DATA_DELETE',
  DATA_EXPORT: 'DATA_EXPORT',

  // Security events
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  BRUTE_FORCE_DETECTED: 'BRUTE_FORCE_DETECTED',
  UNAUTHORIZED_ACCESS_ATTEMPT: 'UNAUTHORIZED_ACCESS_ATTEMPT',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',

  // System events
  SYSTEM_CONFIG_CHANGE: 'SYSTEM_CONFIG_CHANGE',
  USER_CREATED: 'USER_CREATED',
  USER_DELETED: 'USER_DELETED',
  USER_DISABLED: 'USER_DISABLED',
  USER_ENABLED: 'USER_ENABLED'
};

/**
 * Audit severity levels
 */
const AuditSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

/**
 * Create an audit log entry
 */
async function createAuditLog({
  userId,
  username,
  role,
  eventType,
  severity = AuditSeverity.INFO,
  resource,
  resourceId,
  action,
  ipAddress,
  userAgent,
  details,
  success = true,
  errorMessage
}) {
  const entry = {
    id: null, // Will be set after DB insert
    timestamp: new Date().toISOString(),
    userId,
    username,
    role,
    eventType,
    severity,
    resource,
    resourceId,
    action,
    ipAddress,
    userAgent,
    details: details ? JSON.stringify(details) : null,
    success,
    errorMessage
  };

  // Add to buffer
  auditBuffer.push(entry);

  // Flush if buffer is full
  if (auditBuffer.length >= MAX_BUFFER_SIZE) {
    await flushAuditBuffer();
  }

  // Schedule periodic flush
  if (!auditBuffer.flushScheduled) {
    auditBuffer.flushScheduled = true;
    setTimeout(async () => {
      await flushAuditBuffer();
      auditBuffer.flushScheduled = false;
    }, BUFFER_FLUSH_INTERVAL);
  }

  return entry;
}

/**
 * Flush audit buffer to database
 */
async function flushAuditBuffer() {
  if (auditBuffer.length === 0) {
    return;
  }

  const entries = [...auditBuffer];
  auditBuffer.length = 0;

  try {
    const query = `
      INSERT INTO audit_logs (
        user_id, username, role, event_type, severity,
        resource, resource_id, action, ip_address, user_agent,
        details, success, error_message, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING id
    `;

    for (const entry of entries) {
      try {
        const result = await pool.query(query, [
          entry.userId,
          entry.username,
          entry.role,
          entry.eventType,
          entry.severity,
          entry.resource,
          entry.resourceId,
          entry.action,
          entry.ipAddress?.substring(0, 50),
          entry.userAgent?.substring(0, 255),
          entry.details,
          entry.success,
          entry.errorMessage
        ]);
        entry.id = result.rows[0].id;
      } catch (err) {
        console.error('Failed to insert audit log entry:', err.message);
        // Re-add to buffer for retry
        auditBuffer.push(entry);
      }
    }
  } catch (err) {
    console.error('Failed to flush audit buffer:', err.message);
  }
}

/**
 * Middleware to audit all API requests
 */
const auditRequest = (options = {}) => {
  const {
    logBody = false,
    sensitiveFields = ['password', 'password_hash', 'token', 'refresh_token'],
    excludePaths = ['/api/health', '/api/test']
  } = options;

  return async (req, res, next) => {
    const startTime = Date.now();

    // Capture original end function
    const originalEnd = res.end;

    res.end = function (chunk, encoding) {
      // Calculate response time
      const responseTime = Date.now() - startTime;

      // Get user info if authenticated
      const userId = req.user?.id || null;
      const username =
        req.user?.username || req.cookies?.token ? 'authenticated_user' : 'anonymous';
      const role = req.user?.role || null;

      // Determine event type based on method and path
      const eventType = getEventType(req.method, req.path);

      // Determine severity based on status code
      const severity = getSeverity(res.statusCode);

      // Determine success
      const success = res.statusCode >= 200 && res.statusCode < 400;

      // Filter sensitive data from request body
      let requestDetails = null;
      if (req.body && Object.keys(req.body).length > 0) {
        const sanitizedBody = { ...req.body };
        sensitiveFields.forEach((field) => {
          if (sanitizedBody[field]) {
            sanitizedBody[field] = '[REDACTED]';
          }
        });
        requestDetails = sanitizedBody;
      }

      // Log the request
      createAuditLog({
        userId,
        username,
        role,
        eventType,
        severity,
        resource: req.path,
        resourceId: req.params?.id || null,
        action: req.method,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('User-Agent'),
        details: {
          requestDetails: logBody ? requestDetails : undefined,
          statusCode: res.statusCode,
          responseTime
        },
        success
      });

      // Call original end function
      originalEnd.call(this, chunk, encoding);
    };

    next();
  };
};

/**
 * Middleware to audit access control violations
 */
const auditAccessControl = (options = {}) => {
  const { logRequest = true, returnError = true } = options;

  return async (req, res, next) => {
    const userId = req.user?.id || null;
    const username = req.user?.username || 'anonymous';
    const role = req.user?.role || null;

    // Check if user is authenticated
    if (!req.user && !req.cookies?.token && !req.headers.authorization) {
      if (logRequest) {
        await createAuditLog({
          userId: null,
          username: 'anonymous',
          role: null,
          eventType: AuditEventTypes.UNAUTHORIZED_ACCESS_ATTEMPT,
          severity: AuditSeverity.WARNING,
          resource: req.path,
          action: req.method,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          success: false,
          errorMessage: 'No authentication token provided'
        });
      }

      if (returnError) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
      }
    }

    // Check role if specified
    if (req.requiredRoles && role) {
      const hasAccess = req.requiredRoles.includes(role);

      if (!hasAccess) {
        await createAuditLog({
          userId,
          username,
          role,
          eventType: AuditEventTypes.ACCESS_DENIED,
          severity: AuditSeverity.WARNING,
          resource: req.path,
          resourceId: req.params?.id || null,
          action: req.method,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          details: {
            requiredRoles: req.requiredRoles,
            userRole: role,
            path: req.path
          },
          success: false,
          errorMessage: `Role ${role} not in required roles: ${req.requiredRoles.join(', ')}`
        });

        if (returnError) {
          return res.status(403).json({
            error: 'Insufficient permissions',
            code: 'FORBIDDEN',
            requiredRoles: req.requiredRoles,
            currentRole: role
          });
        }
      }
    }

    next();
  };
};

/**
 * Middleware to audit permission checks
 */
const auditPermissionCheck = (requiredPermission) => {
  return async (req, res, next) => {
    const userId = req.user?.id || null;
    const username = req.user?.username || 'anonymous';
    const role = req.user?.role || null;
    const userPermissions = getUserPermissions(role);

    const hasPermission = userPermissions.includes(requiredPermission);

    await createAuditLog({
      userId,
      username,
      role,
      eventType: AuditEventTypes.PERMISSION_CHECK,
      severity: hasPermission ? AuditSeverity.INFO : AuditSeverity.WARNING,
      resource: req.path,
      action: `permission:${requiredPermission}`,
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
      details: {
        requiredPermission,
        userPermissions,
        hasPermission
      },
      success: hasPermission,
      errorMessage: hasPermission ? null : `Missing permission: ${requiredPermission}`
    });

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Permission denied',
        code: 'PERMISSION_DENIED',
        requiredPermission
      });
    }

    next();
  };
};

/**
 * Helper function to get event type based on method and path
 */
function getEventType(method, path) {
  const pathLower = path.toLowerCase();

  // Authentication events
  if (path.includes('/auth/login')) {
    return AuditEventTypes.LOGIN_SUCCESS;
  }
  if (path.includes('/auth/logout')) {
    return AuditEventTypes.LOGOUT;
  }
  if (path.includes('/auth/refresh')) {
    return AuditEventTypes.TOKEN_REFRESH;
  }
  if (path.includes('/auth/change-password')) {
    return AuditEventTypes.PASSWORD_CHANGE;
  }

  // Data access events
  if (method === 'GET') {
    return AuditEventTypes.DATA_READ;
  }
  if (method === 'POST') {
    return AuditEventTypes.DATA_CREATE;
  }
  if (method === 'PUT' || method === 'PATCH') {
    return AuditEventTypes.DATA_UPDATE;
  }
  if (method === 'DELETE') {
    return AuditEventTypes.DATA_DELETE;
  }

  return AuditEventTypes.ACCESS_GRANTED;
}

/**
 * Helper function to get severity based on status code
 */
function getSeverity(statusCode) {
  if (statusCode >= 500) {
    return AuditSeverity.ERROR;
  }
  if (statusCode >= 400) {
    return AuditSeverity.WARNING;
  }
  return AuditSeverity.INFO;
}

/**
 * Middleware to log login attempts
 */
const auditLoginAttempt = async (req, res, next) => {
  const originalJson = res.json;

  res.json = function (data) {
    // Determine if login was successful
    const success = res.statusCode === 200 && data.message?.includes('success');

    createAuditLog({
      userId: data.user?.id || null,
      username: req.body?.username || req.body?.email || 'unknown',
      role: data.user?.role || null,
      eventType: success ? AuditEventTypes.LOGIN_SUCCESS : AuditEventTypes.LOGIN_FAILED,
      severity: success ? AuditSeverity.INFO : AuditSeverity.WARNING,
      resource: '/auth/login',
      action: 'POST',
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
      details: {
        email: req.body?.email,
        rememberMe: req.body?.rememberMe
      },
      success,
      errorMessage: success ? null : data.error || data.message
    });

    return originalJson.call(this, data);
  };

  next();
};

/**
 * Get audit logs with filtering
 */
async function getAuditLogs(options = {}) {
  const {
    userId,
    username,
    role,
    eventType,
    severity,
    startDate,
    endDate,
    limit = 100,
    offset = 0
  } = options;

  let query = `
    SELECT * FROM audit_logs 
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;

  if (userId) {
    query += ` AND user_id = $${paramIndex++}`;
    params.push(userId);
  }

  if (username) {
    query += ` AND username = $${paramIndex++}`;
    params.push(username);
  }

  if (role) {
    query += ` AND role = $${paramIndex++}`;
    params.push(role);
  }

  if (eventType) {
    query += ` AND event_type = $${paramIndex++}`;
    params.push(eventType);
  }

  if (severity) {
    query += ` AND severity = $${paramIndex++}`;
    params.push(severity);
  }

  if (startDate) {
    query += ` AND created_at >= $${paramIndex++}`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND created_at <= $${paramIndex++}`;
    params.push(endDate);
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get audit statistics
 */
async function getAuditStats(startDate, endDate) {
  const query = `
    SELECT 
      event_type,
      severity,
      COUNT(*) as count,
      SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as failed_count
    FROM audit_logs
    WHERE created_at BETWEEN $1 AND $2
    GROUP BY event_type, severity
    ORDER BY count DESC
  `;

  const result = await pool.query(query, [startDate, endDate]);
  return result.rows;
}

/**
 * Clean up old audit logs (for data retention)
 */
async function cleanupOldLogs(daysToKeep = 90) {
  const query = `
    DELETE FROM audit_logs 
    WHERE created_at < NOW() - INTERVAL '${daysToKeep} days'
    RETURNING id
  `;

  const result = await pool.query(query);
  return result.rowCount;
}

module.exports = {
  createAuditLog,
  flushAuditBuffer,
  auditRequest,
  auditAccessControl,
  auditPermissionCheck,
  auditLoginAttempt,
  getAuditLogs,
  getAuditStats,
  cleanupOldLogs,
  AuditEventTypes,
  AuditSeverity
};
