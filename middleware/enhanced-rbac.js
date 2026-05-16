require('jsonwebtoken');
const db = require('../db');

const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard:view',
  DASHBOARD_ANALYTICS: 'dashboard:analytics',

  PATIENT_VIEW: 'patient:view',
  PATIENT_CREATE: 'patient:create',
  PATIENT_UPDATE: 'patient:update',
  PATIENT_DELETE: 'patient:delete',
  PATIENT_VIEW_OWN: 'patient:view:own',

  APPOINTMENT_VIEW: 'appointment:view',
  APPOINTMENT_CREATE: 'appointment:create',
  APPOINTMENT_UPDATE: 'appointment:update',
  APPOINTMENT_DELETE: 'appointment:delete',
  APPOINTMENT_VIEW_OWN: 'appointment:view:own',

  VACCINATION_VIEW: 'vaccination:view',
  VACCINATION_CREATE: 'vaccination:create',
  VACCINATION_UPDATE: 'vaccination:update',
  VACCINATION_DELETE: 'vaccination:delete',
  VACCINATION_VIEW_OWN: 'vaccination:view:own',

  INVENTORY_VIEW: 'inventory:view',
  INVENTORY_CREATE: 'inventory:create',
  INVENTORY_UPDATE: 'inventory:update',
  INVENTORY_DELETE: 'inventory:delete',

  REPORT_VIEW: 'report:view',
  REPORT_CREATE: 'report:create',
  REPORT_EXPORT: 'report:export',

  USER_VIEW: 'user:view',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_MANAGE_ROLES: 'user:manage:roles',

  SYSTEM_SETTINGS: 'system:settings',
  SYSTEM_AUDIT: 'system:audit',
  SYSTEM_BACKUP: 'system:backup',
};

const STAFF_PERMISSIONS = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.DASHBOARD_ANALYTICS,
  PERMISSIONS.PATIENT_VIEW,
  PERMISSIONS.PATIENT_CREATE,
  PERMISSIONS.PATIENT_UPDATE,
  PERMISSIONS.APPOINTMENT_VIEW,
  PERMISSIONS.APPOINTMENT_CREATE,
  PERMISSIONS.APPOINTMENT_UPDATE,
  PERMISSIONS.VACCINATION_VIEW,
  PERMISSIONS.VACCINATION_CREATE,
  PERMISSIONS.VACCINATION_UPDATE,
  PERMISSIONS.INVENTORY_VIEW,
  PERMISSIONS.INVENTORY_CREATE,
  PERMISSIONS.INVENTORY_UPDATE,
  PERMISSIONS.REPORT_VIEW,
  PERMISSIONS.REPORT_CREATE,
  PERMISSIONS.REPORT_EXPORT,
  PERMISSIONS.USER_VIEW,
  PERMISSIONS.USER_CREATE,
  PERMISSIONS.USER_UPDATE,
  PERMISSIONS.SYSTEM_AUDIT,
];

const SELF_SERVICE_PERMISSIONS = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.PATIENT_VIEW_OWN,
  PERMISSIONS.APPOINTMENT_VIEW_OWN,
  PERMISSIONS.VACCINATION_VIEW_OWN,
];

const ROLES = {
  SYSTEM_ADMINISTRATOR: {
    permissions: Object.values(PERMISSIONS),
    description: 'System Administrator (Canonical)',
    level: 100,
  },
  SYSTEM_ADMIN: {
    permissions: Object.values(PERMISSIONS),
    description: 'System Administrator (Canonical)',
    level: 100,
  },
  super_admin: {
    permissions: Object.values(PERMISSIONS),
    description: 'Full system access',
    level: 100,
  },
  admin: {
    permissions: [...STAFF_PERMISSIONS],
    description: 'Healthcare Worker Administrator',
    level: 80,
  },
  healthcare_worker: {
    permissions: [...STAFF_PERMISSIONS],
    description: 'Health Care Worker',
    level: 60,
  },
  nurse: {
    permissions: [...STAFF_PERMISSIONS, PERMISSIONS.INVENTORY_DELETE],
    description: 'Nurse',
    level: 40,
  },
  guardian: {
    permissions: [...SELF_SERVICE_PERMISSIONS],
    description: 'Patient guardian',
    level: 20,
  },
  user: {
    permissions: [...SELF_SERVICE_PERMISSIONS],
    description: 'Regular user',
    level: 10,
  },
};

const isGlobalAdminRole = (role) => role === 'SYSTEM_ADMIN' || role === 'super_admin';

const canSkipOwnershipCheck = (role) =>
  role === 'SYSTEM_ADMIN' || role === 'super_admin' || role === 'admin';

const resolveUserRole = (user) => {
  if (!user) {
    return null;
  }
  if (user.role_type === 'SYSTEM_ADMIN' || user.role === 'SYSTEM_ADMIN') {
    return 'SYSTEM_ADMIN';
  }
  if (user.role_type === 'GUARDIAN' || user.role === 'GUARDIAN') {
    return 'guardian';
  }
  return user.role;
};

const hasPermission = (userRole, requiredPermission) => {
  const role = ROLES[userRole];
  if (!role) {
    if (isGlobalAdminRole(userRole)) {
      return true;
    }
    return false;
  }

  return role.permissions.includes(requiredPermission);
};

const hasAnyPermission = (userRole, requiredPermissions) => {
  return requiredPermissions.some((perm) => hasPermission(userRole, perm));
};

const hasAllPermissions = (userRole, requiredPermissions) => {
  return requiredPermissions.every((perm) => hasPermission(userRole, perm));
};

const getRoleLevel = (role) => {
  return ROLES[role]?.level || 0;
};

const hasRoleLevel = (userRole, minRole) => {
  return getRoleLevel(userRole) >= getRoleLevel(minRole);
};

const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      const userRole = resolveUserRole(req.user);

      if (!hasPermission(userRole, permission)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS',
          requiredPermission: permission,
          userRole: userRole,
        });
      }

      await logAccess(req, permission);

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        error: 'Permission check failed',
        code: 'PERMISSION_CHECK_ERROR',
      });
    }
  };
};

const requireAnyPermission = (...permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      const userRole = resolveUserRole(req.user);

      if (!hasAnyPermission(userRole, permissions)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS',
          requiredPermissions: permissions,
          userRole: userRole,
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        error: 'Permission check failed',
        code: 'PERMISSION_CHECK_ERROR',
      });
    }
  };
};

const requireOwnership = (resourceType, resourceIdParam = 'id') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      const userRole = resolveUserRole(req.user);
      if (canSkipOwnershipCheck(userRole)) {
        return next();
      }

      const resourceId = req.params[resourceIdParam] || req.body[resourceIdParam];
      const userId = req.user.id;
      const healthCenterId = req.user.health_center_id;

      let query;
      let params;

      switch (resourceType) {
        case 'patient':
          query = `
            SELECT id FROM patients
            WHERE id = $1 AND (created_by = $2 OR health_center_id = $3)
          `;
          params = [resourceId, userId, healthCenterId];
          break;
        case 'appointment':
          query = `
            SELECT id FROM appointments
            WHERE id = $1 AND (created_by = $2 OR health_center_id = $3)
          `;
          params = [resourceId, userId, healthCenterId];
          break;
        case 'vaccination':
          query = `
            SELECT id FROM vaccinations
            WHERE id = $1 AND (administered_by = $2 OR health_center_id = $3)
          `;
          params = [resourceId, userId, healthCenterId];
          break;
        default:
          return res.status(400).json({
            error: 'Invalid resource type',
            code: 'INVALID_RESOURCE_TYPE',
          });
      }

      const result = await db.query(query, params);

      if (result.rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied: Resource not found or no permission',
          code: 'RESOURCE_ACCESS_DENIED',
        });
      }

      next();
    } catch (error) {
      console.error('Ownership check error:', error);
      res.status(500).json({
        error: 'Ownership check failed',
        code: 'OWNERSHIP_CHECK_ERROR',
      });
    }
  };
};

const requireHealthCenterAccess = () => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      const userRole = resolveUserRole(req.user);
      if (isGlobalAdminRole(userRole)) {
        return next();
      }

      if (!req.user.health_center_id) {
        return res.status(403).json({
          error: 'Health center access required',
          code: 'HEALTH_CENTER_REQUIRED',
        });
      }

      req.healthCenterFilter = {
        health_center_id: req.user.health_center_id,
      };

      next();
    } catch (error) {
      console.error('Health center access check error:', error);
      res.status(500).json({
        error: 'Health center access check failed',
        code: 'HEALTH_CENTER_CHECK_ERROR',
      });
    }
  };
};

const requireRoleHierarchy = (minRole) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      const userRole = resolveUserRole(req.user);
      if (!hasRoleLevel(userRole, minRole)) {
        return res.status(403).json({
          error: 'Insufficient role level',
          code: 'INSUFFICIENT_ROLE_LEVEL',
          requiredRole: minRole,
          userRole: userRole,
        });
      }

      next();
    } catch (error) {
      console.error('Role hierarchy check error:', error);
      res.status(500).json({
        error: 'Role hierarchy check failed',
        code: 'ROLE_HIERARCHY_CHECK_ERROR',
      });
    }
  };
};

const logAccess = async (req, permission) => {
  try {
    const query = `
      INSERT INTO access_logs (
        user_id, username, role, permission, path, method,
        ip_address, user_agent, accessed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `;

    await db.query(query, [
      req.user.id,
      req.user.username,
      req.user.role,
      permission,
      req.path,
      req.method,
      req.ip || req.connection.remoteAddress,
      req.get('User-Agent'),
    ]);
  } catch (error) {
    console.error('Access logging error:', error);
  }
};

const getUserPermissions = (role) => {
  return ROLES[role]?.permissions || [];
};

const getAllRoles = () => {
  return Object.entries(ROLES).map(([key, value]) => ({
    name: key,
    ...value,
  }));
};

const roleExists = (role) => {
  return !!ROLES[role];
};

module.exports = {
  PERMISSIONS,
  ROLES,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  hasRoleLevel,
  requirePermission,
  requireAnyPermission,
  requireOwnership,
  requireHealthCenterAccess,
  requireRoleHierarchy,
  getUserPermissions,
  getAllRoles,
  roleExists,
  logAccess,
};
