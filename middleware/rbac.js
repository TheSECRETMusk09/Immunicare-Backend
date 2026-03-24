/**
 * Canonical Two-Role RBAC Middleware
 * Runtime roles:
 *  - SYSTEM_ADMIN
 *  - GUARDIAN
 */

const db = require('../db');
const { AuthorizationError, AuthenticationError } = require('./errorHandler');

const CANONICAL_ROLES = Object.freeze({
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  CLINIC_MANAGER: 'CLINIC_MANAGER',
  GUARDIAN: 'GUARDIAN',
});

const LEGACY_SYSTEM_ADMIN_ROLES = new Set([
  'system_admin',
  'super_admin',
  'superadmin',
  'superadministrator',
  'admin',
  'administrator',
  'public_health_nurse',
  'inventory_manager',
  'physician',
  'doctor',
  'health_worker',
  'healthcare_worker',
  'nurse',
  'midwife',
  'nutritionist',
  'dentist',
  'staff',
]);

const LEGACY_CLINIC_MANAGER_ROLES = new Set(['clinic_manager']);

const LEGACY_GUARDIAN_ROLES = new Set(['guardian', 'user', 'parent']);

/**
 * Permission definitions in canonical roles.
 * Unknown permissions default to SYSTEM_ADMIN-only access.
 */
const PERMISSIONS = {
  // Dashboard
  'dashboard:view': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER, CANONICAL_ROLES.GUARDIAN],
  'dashboard:analytics': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER, CANONICAL_ROLES.GUARDIAN],

  // Infants / Patients
  'patient:view': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'patient:view:own': [CANONICAL_ROLES.GUARDIAN],
  'patient:create': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'patient:create:own': [CANONICAL_ROLES.GUARDIAN],
  'patient:update': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'patient:update:own': [CANONICAL_ROLES.GUARDIAN],
  'patient:delete': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'patient:delete:own': [CANONICAL_ROLES.GUARDIAN],

  // Appointments (policy C)
  'appointment:view': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'appointment:view:own': [CANONICAL_ROLES.GUARDIAN],
  'appointment:create': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'appointment:create:own': [CANONICAL_ROLES.GUARDIAN],
  'appointment:update': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'appointment:cancel': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'appointment:cancel:own': [CANONICAL_ROLES.GUARDIAN],
  'appointment:delete': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],

  // Vaccinations
  'vaccination:view': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'vaccination:view:own': [CANONICAL_ROLES.GUARDIAN],
  'vaccination:create': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'vaccination:update': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'vaccination:delete': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],

  // Inventory
  'inventory:view': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'inventory:create': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'inventory:update': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'inventory:correct': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'inventory:delete': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],

  // Transfer workflow
  'transfer:view': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'transfer:validate': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'transfer:approve': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],

  // Reports
  'report:view': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'report:create': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'report:export': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],

  // Users / Roles
  'user:view': [CANONICAL_ROLES.SYSTEM_ADMIN],
  'user:create': [CANONICAL_ROLES.SYSTEM_ADMIN],
  'user:update': [CANONICAL_ROLES.SYSTEM_ADMIN],
  'user:delete': [CANONICAL_ROLES.SYSTEM_ADMIN],
  'user:manage_roles': [CANONICAL_ROLES.SYSTEM_ADMIN],

  // System
  'system:settings': [CANONICAL_ROLES.SYSTEM_ADMIN],
  'system:audit': [CANONICAL_ROLES.SYSTEM_ADMIN],
  'system:sms_config': [CANONICAL_ROLES.SYSTEM_ADMIN],
  'admin:override': [CANONICAL_ROLES.SYSTEM_ADMIN],

  // Notifications
  'notification:view': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER, CANONICAL_ROLES.GUARDIAN],
  'notification:send': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],

  // Documents
  'document:view': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER, CANONICAL_ROLES.GUARDIAN],
  'document:export': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER, CANONICAL_ROLES.GUARDIAN],
  'document:create': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
  'document:delete': [CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER],
};

const ROLE_HIERARCHY = {
  [CANONICAL_ROLES.SYSTEM_ADMIN]: 100,
  [CANONICAL_ROLES.CLINIC_MANAGER]: 50,
  [CANONICAL_ROLES.GUARDIAN]: 10,
};

const normalizeRole = (role) => {
  if (!role) {
    return null;
  }

  const normalized = String(role).trim();

  if (normalized === CANONICAL_ROLES.SYSTEM_ADMIN || normalized === CANONICAL_ROLES.CLINIC_MANAGER || normalized === CANONICAL_ROLES.GUARDIAN) {
    return normalized;
  }

  const lower = normalized.toLowerCase();

  if (LEGACY_SYSTEM_ADMIN_ROLES.has(lower)) {
    return CANONICAL_ROLES.SYSTEM_ADMIN;
  }

  if (LEGACY_CLINIC_MANAGER_ROLES.has(lower)) {
    return CANONICAL_ROLES.CLINIC_MANAGER;
  }

  if (LEGACY_GUARDIAN_ROLES.has(lower)) {
    return CANONICAL_ROLES.GUARDIAN;
  }

  return null;
};

const getCanonicalRole = (req) => {
  const byRuntime = normalizeRole(req?.user?.runtime_role);
  if (byRuntime) {
    return byRuntime;
  }

  const byType = normalizeRole(req?.user?.role_type);
  if (byType) {
    return byType;
  }

  return normalizeRole(req?.user?.role);
};

const getRoleLevel = (role) => ROLE_HIERARCHY[normalizeRole(role)] || 0;

const hasRoleLevel = (userRole, minRole) => getRoleLevel(userRole) >= getRoleLevel(minRole);

const hasPermission = (userRole, permission) => {
  const canonicalRole = normalizeRole(userRole);
  if (!canonicalRole) {
    return false;
  }

  const allowedRoles = PERMISSIONS[permission] || [CANONICAL_ROLES.SYSTEM_ADMIN];
  return allowedRoles.includes(canonicalRole);
};

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return next(new AuthenticationError('Authentication required'));
  }
  next();
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    const canonicalRole = getCanonicalRole(req);
    if (!hasPermission(canonicalRole, permission)) {
      return next(new AuthorizationError(`Permission denied: ${permission} required`));
    }

    req.user.runtime_role = canonicalRole;
    req.user.permissions = getRolePermissions(canonicalRole);
    next();
  };
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    const canonicalRole = getCanonicalRole(req);
    req.user.runtime_role = canonicalRole;
    req.user.permissions = getRolePermissions(canonicalRole);

    const requiredCanonical = roles
      .flat()
      .map((role) => normalizeRole(role))
      .filter(Boolean);

    if (requiredCanonical.length === 0) {
      return next(new AuthorizationError('Access denied. Invalid role requirement.'));
    }

    if (!requiredCanonical.includes(canonicalRole)) {
      return next(new AuthorizationError(`Access denied. Required role: ${requiredCanonical.join(' or ')}`));
    }

    next();
  };
};

const requireMinRole = (minRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    const canonicalRole = getCanonicalRole(req);
    req.user.runtime_role = canonicalRole;
    req.user.permissions = getRolePermissions(canonicalRole);

    if (!hasRoleLevel(canonicalRole, minRole)) {
      return next(new AuthorizationError(`Access denied. Minimum role level: ${minRole}`));
    }

    next();
  };
};

const requireSystemAdmin = (req, res, next) => {
  return requireRole(CANONICAL_ROLES.SYSTEM_ADMIN)(req, res, next);
};

const requireGuardian = (req, res, next) => {
  return requireRole(CANONICAL_ROLES.GUARDIAN)(req, res, next);
};

const requireAdmin = requireSystemAdmin;
const requireSuperAdmin = requireSystemAdmin;

const requireHealthWorker = (req, res, next) => {
  return requireRole(CANONICAL_ROLES.SYSTEM_ADMIN, CANONICAL_ROLES.CLINIC_MANAGER)(req, res, next);
};

const requireOwnershipOrRole = (
  resourceType,
  resourceIdParam = 'id',
  minRole = CANONICAL_ROLES.SYSTEM_ADMIN,
) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new AuthenticationError('Authentication required'));
      }

      const canonicalRole = getCanonicalRole(req);
      req.user.runtime_role = canonicalRole;

      if (hasRoleLevel(canonicalRole, minRole)) {
        return next();
      }

      if (canonicalRole !== CANONICAL_ROLES.GUARDIAN) {
        return next(new AuthorizationError('Access denied'));
      }

      const resourceId = req.params[resourceIdParam] || req.body[resourceIdParam];
      const guardianId = parseInt(req.user.guardian_id, 10);

      if (!guardianId || !resourceId) {
        return next(new AuthorizationError('Guardian ownership validation failed'));
      }

      let query;
      switch (resourceType) {
      case 'patient':
      case 'infant':
        query = `
          SELECT 1
          FROM patients p
          WHERE p.id = $1 AND p.guardian_id = $2 AND p.is_active = true
          LIMIT 1
        `;
        break;
      case 'appointment':
        query = `
          SELECT 1
          FROM appointments a
          LEFT JOIN patients p ON p.id = a.infant_id
          WHERE a.id = $1
            AND p.guardian_id = $2
          LIMIT 1
        `;
        break;
      case 'vaccination':
        query = `
          SELECT 1
          FROM immunization_records ir
          LEFT JOIN patients p ON p.id = ir.patient_id
          WHERE ir.id = $1
            AND p.guardian_id = $2
          LIMIT 1
        `;
        break;
      case 'guardian':
        if (parseInt(resourceId, 10) !== guardianId) {
          return next(new AuthorizationError('Access denied: You do not own this resource'));
        }
        return next();
      default:
        return next(new AuthorizationError('Unknown resource type'));
      }

      const result = await db.query(query, [resourceId, guardianId]);
      if (result.rows.length === 0) {
        return next(new AuthorizationError('Access denied: You do not own this resource'));
      }

      next();
    } catch (error) {
      console.error('Ownership check error:', error);
      next(error);
    }
  };
};

const BARANGAY_SCOPE = Object.freeze({
  barangay_code: 'SAN_NICOLAS_PASIG',
  barangay_name: 'Barangay San Nicolas, Pasig City',
});

const requireHealthCenterAccess = () => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new AuthenticationError('Authentication required'));
      }

      const canonicalRole = getCanonicalRole(req);
      req.user.runtime_role = canonicalRole;
      req.user.permissions = getRolePermissions(canonicalRole);

      const healthCenterId = req.user.health_center_id || req.user.clinic_id || null;
      req.healthCenterFilter = {
        health_center_id: healthCenterId,
        clinic_id: healthCenterId,
        ...BARANGAY_SCOPE,
      };

      next();
    } catch (error) {
      console.error('Health center access check error:', error);
      next(error);
    }
  };
};

const combineMiddleware = (...middlewares) => middlewares;

const getRolePermissions = (role) => {
  const canonicalRole = normalizeRole(role);
  if (!canonicalRole) {
    return [];
  }

  return Object.entries(PERMISSIONS)
    .filter(([, allowedRoles]) => allowedRoles.includes(canonicalRole))
    .map(([permission]) => permission);
};

const isValidRole = (role) => Boolean(normalizeRole(role));

module.exports = {
  CANONICAL_ROLES,
  ROLE_HIERARCHY,
  PERMISSIONS,
  BARANGAY_SCOPE,

  // Normalization
  normalizeRole,
  getCanonicalRole,
  getNormalizedRole: normalizeRole,

  // Checks
  hasPermission,
  hasRoleLevel,
  getRoleLevel,
  getRolePermissions,
  isValidRole,

  // Middleware
  requireAuth,
  requirePermission,
  requireRole,
  requireMinRole,
  requireSystemAdmin,
  requireAdmin,
  requireSuperAdmin,
  requireHealthWorker,
  requireGuardian,
  requireOwnershipOrRole,
  requireHealthCenterAccess,

  // Utility
  combineMiddleware,
};
