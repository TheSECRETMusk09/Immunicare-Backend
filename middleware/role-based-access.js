const db = require('../db');

// Role-based access control middleware
const checkPermission = (requiredRoles) => {
  return async (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          success: false,
        });
      }

      const user = req.user;
      const userRole = user.role;

      // Map database role names to middleware role names for permission checking
      const roleMapping = {
        physician: 'doctor',
        healthcare_worker: 'health_worker',
        midwife: 'staff',
        nutritionist: 'staff',
        dentist: 'doctor',
      };

      // Use mapped role if the exact role doesn't exist in requiredRoles
      const mappedRole = roleMapping[userRole] || userRole;
      const healthCenterId = user.health_center_id || user.clinic_id;

      // Check if user has required role (check both original and mapped role)
      const rolesToCheck = [...requiredRoles, mappedRole];
      if (!rolesToCheck.includes(userRole) && !rolesToCheck.includes(mappedRole)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          success: false,
          requiredRoles: requiredRoles,
          userRole: userRole,
          mappedRole: mappedRole,
        });
      }

      // Add user context to request
      req.userContext = {
        id: user.id,
        username: user.username,
        role: mappedRole,
        originalRole: userRole,
        healthCenterId: healthCenterId,
        permissions: getUserPermissions(mappedRole),
      };

      // Log access for audit trail
      console.log(`Access granted to ${user.username} (${mappedRole || userRole}) for ${req.path}`);

      next();
    } catch (error) {
      console.error('Role-based access control error:', error);
      res.status(500).json({
        error: 'Access control validation failed',
        success: false,
      });
    }
  };
};

// Multi-factor authentication middleware
const requireMFA = async (req, res, next) => {
  try {
    const user = req.user;

    // Check if user has MFA enabled
    if (!user.mfa_enabled) {
      return res.status(403).json({
        error: 'Multi-factor authentication required for this action',
        success: false,
        mfa_required: true,
      });
    }

    // Check if MFA was verified in this session
    if (!req.session.mfa_verified) {
      return res.status(403).json({
        error: 'Multi-factor authentication verification required',
        success: false,
        mfa_verification_required: true,
      });
    }

    next();
  } catch (error) {
    console.error('MFA verification error:', error);
    res.status(500).json({
      error: 'MFA verification failed',
      success: false,
    });
  }
};

// Enhanced RBAC with permission checking
const checkPermissionEnhanced = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          success: false,
        });
      }

      const user = req.user;
      const userPermissions = getUserPermissions(user.role);

      // Check if user has the required permission
      if (!userPermissions.includes(requiredPermission)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          success: false,
          requiredPermission: requiredPermission,
          userPermissions: userPermissions,
        });
      }

      next();
    } catch (error) {
      console.error('Enhanced permission check error:', error);
      res.status(500).json({
        error: 'Permission validation failed',
        success: false,
      });
    }
  };
};

// Get user permissions based on role
const getUserPermissions = (role) => {
  // Map database role names to middleware role names
  const roleMapping = {
    physician: 'doctor',
    healthcare_worker: 'health_worker',
    midwife: 'staff',
    nutritionist: 'staff',
    dentist: 'doctor',
  };

  // Use mapped role if the exact role doesn't exist in permissions
  const mappedRole = roleMapping[role] || role;

  const permissions = {
    super_admin: [
      'read:dashboard',
      'read:patients',
      'create:patients',
      'update:patients',
      'delete:patients',
      'read:inventory',
      'create:inventory',
      'update:inventory',
      'delete:inventory',
      'read:appointments',
      'create:appointments',
      'update:appointments',
      'delete:appointments',
      'read:vaccinations',
      'create:vaccinations',
      'update:vaccinations',
      'read:certificates',
      'create:certificates',
      'read:reports',
      'manage:users',
      'manage:health_centers',
      'manage:system_settings',
    ],
    admin: [
      'read:dashboard',
      'read:patients',
      'create:patients',
      'update:patients',
      'delete:patients',
      'read:inventory',
      'create:inventory',
      'update:inventory',
      'delete:inventory',
      'read:appointments',
      'create:appointments',
      'update:appointments',
      'delete:appointments',
      'read:vaccinations',
      'create:vaccinations',
      'update:vaccinations',
      'read:certificates',
      'create:certificates',
      'read:reports',
      'manage:users',
      'manage:health_centers',
      'manage:system_settings',
    ],
    doctor: [
      'read:dashboard',
      'read:patients',
      'create:patients',
      'update:patients',
      'read:inventory',
      'read:appointments',
      'create:appointments',
      'update:appointments',
      'read:vaccinations',
      'create:vaccinations',
      'update:vaccinations',
      'read:certificates',
      'create:certificates',
      'read:reports',
    ],
    health_worker: [
      'read:dashboard',
      'read:patients',
      'create:patients',
      'update:patients',
      'read:inventory',
      'create:inventory',
      'update:inventory',
      'read:appointments',
      'create:appointments',
      'update:appointments',
      'read:vaccinations',
      'create:vaccinations',
      'update:vaccinations',
      'read:certificates',
      'create:certificates',
      'read:reports',
    ],
    staff: [
      'read:dashboard',
      'read:patients',
      'create:patients',
      'update:patients',
      'read:appointments',
      'create:appointments',
      'update:appointments',
      'read:vaccinations',
      'read:certificates',
      'create:certificates',
      'update:certificates',
      'delete:certificates',
      'read:reports',
      'create:reports',
      'update:reports',
      'delete:reports',
    ],
    nurse: [
      'read:dashboard',
      'read:patients',
      'create:patients',
      'update:patients',
      'read:inventory',
      'create:inventory',
      'update:inventory',
      'read:appointments',
      'create:appointments',
      'update:appointments',
      'read:vaccinations',
      'create:vaccinations',
      'update:vaccinations',
      'read:certificates',
      'create:certificates',
      'update:certificates',
      'delete:certificates',
      'read:reports',
      'create:reports',
      'update:reports',
      'delete:reports',
    ],
    guardian: [
      'read:patients:own',
      'read:appointments:own',
      'read:vaccinations:own',
      'read:certificates:own',
    ],
  };

  return permissions[mappedRole] || permissions[role] || [];
};

// Check if user can access specific patient data
const checkPatientAccess = async (req, res, next) => {
  try {
    const user = req.user;
    const patientId = req.params.id || req.body.patientId;

    if (!patientId) {
      return next();
    }

    // Map database role names to middleware role names
    const roleMapping = {
      physician: 'doctor',
      healthcare_worker: 'health_worker',
      midwife: 'staff',
      nutritionist: 'staff',
      dentist: 'doctor',
    };

    const userRole = roleMapping[user.role] || user.role;

    // Admin and health workers can access all patients in their health center
    if (
      userRole === 'admin' ||
      userRole === 'health_worker' ||
      user.role === 'admin' ||
      user.role === 'health_worker' ||
      user.role === 'super_admin'
    ) {
      const query = `
        SELECT health_center_id FROM patients WHERE id = $1
      `;
      const result = await db.query(query, [patientId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Patient not found',
          success: false,
        });
      }

      if (
        result.rows[0].health_center_id !== user.health_center_id &&
        result.rows[0].health_center_id !== user.clinic_id
      ) {
        return res.status(403).json({
          error: 'Access denied: Patient not in your health center',
          success: false,
        });
      }

      return next();
    }

    // Guardians can only access their own family members
    if (userRole === 'guardian' || user.role === 'guardian') {
      const query = `
        SELECT id FROM patients
        WHERE id = $1 AND health_center_id = $2
      `;
      const result = await db.query(query, [patientId, user.health_center_id || user.clinic_id]);

      if (result.rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied: Cannot access this patient record',
          success: false,
        });
      }

      return next();
    }

    // Nurses and doctors have limited access
    if (
      userRole === 'nurse' ||
      userRole === 'doctor' ||
      user.role === 'nurse' ||
      user.role === 'physician'
    ) {
      const query = `
        SELECT health_center_id FROM patients WHERE id = $1
      `;
      const result = await db.query(query, [patientId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Patient not found',
          success: false,
        });
      }

      if (
        result.rows[0].health_center_id !== user.health_center_id &&
        result.rows[0].health_center_id !== user.clinic_id
      ) {
        return res.status(403).json({
          error: 'Access denied: Patient not in your health center',
          success: false,
        });
      }

      return next();
    }

    next();
  } catch (error) {
    console.error('Patient access check error:', error);
    res.status(500).json({
      error: 'Patient access validation failed',
      success: false,
    });
  }
};

// Check if user can access specific inventory data
const checkInventoryAccess = async (req, res, next) => {
  try {
    const user = req.user;
    const itemId = req.params.id;

    if (!itemId) {
      return next();
    }

    // Map database role names to middleware role names
    const roleMapping = {
      physician: 'doctor',
      healthcare_worker: 'health_worker',
      midwife: 'staff',
      nutritionist: 'staff',
      dentist: 'doctor',
    };

    const userRole = roleMapping[user.role] || user.role;

    // Only admin, health_worker, doctor, nurse can access inventory
    const allowedRoles = [
      'admin',
      'health_worker',
      'doctor',
      'nurse',
      'super_admin',
      'physician',
      'healthcare_worker',
    ];
    if (!allowedRoles.includes(userRole) && !allowedRoles.includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied: Insufficient permissions for inventory management',
        success: false,
      });
    }

    const query = `
      SELECT health_center_id FROM inventory WHERE id = $1
    `;
    const result = await db.query(query, [itemId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Inventory item not found',
        success: false,
      });
    }

    if (
      result.rows[0].health_center_id !== user.health_center_id &&
      result.rows[0].health_center_id !== user.clinic_id
    ) {
      return res.status(403).json({
        error: 'Access denied: Item not in your health center',
        success: false,
      });
    }

    next();
  } catch (error) {
    console.error('Inventory access check error:', error);
    res.status(500).json({
      error: 'Inventory access validation failed',
      success: false,
    });
  }
};

// Audit log middleware
const auditLog = async (req, res, next) => {
  try {
    const user = req.user;
    const action = req.method;
    const resource = req.path;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    // Log sensitive operations
    const sensitiveOperations = ['POST', 'PUT', 'DELETE'];
    const sensitivePaths = ['/patients', '/inventory', '/vaccinations', '/appointments'];

    if (
      sensitiveOperations.includes(action) &&
      sensitivePaths.some((path) => resource.includes(path))
    ) {
      const auditQuery = `
        INSERT INTO vaccination_audit_log (
          table_name, record_id, action, old_values, new_values,
          changed_by, health_center_id, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;

      // For now, we'll log the operation without detailed values
      // In production, you'd want to capture the actual data changes
      await db.query(auditQuery, [
        resource.replace('/', ''),
        req.params.id || null,
        action,
        null, // old_values
        JSON.stringify(req.body), // new_values
        user.id,
        user.health_center_id,
        ipAddress,
        userAgent,
      ]);
    }

    next();
  } catch (error) {
    console.error('Audit log error:', error);
    // Don't fail the request if audit logging fails
    next();
  }
};

// Rate limiting middleware
const rateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    if (requests.has(ip)) {
      const userRequests = requests.get(ip);
      const validRequests = userRequests.filter((time) => time > windowStart);
      requests.set(ip, validRequests);
    }

    // Check current request count
    const userRequests = requests.get(ip) || [];

    if (userRequests.length >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        success: false,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    }

    // Add current request
    userRequests.push(now);
    requests.set(ip, userRequests);

    next();
  };
};

// Data validation middleware
const validateInput = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Invalid input data',
        details: error.details.map((detail) => detail.message),
        success: false,
      });
    }
    next();
  };
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', 'default-src \'self\'');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  next();
};

module.exports = {
  checkPermission,
  checkPermissionEnhanced,
  requireMFA,
  checkPatientAccess,
  checkInventoryAccess,
  auditLog,
  rateLimit,
  validateInput,
  securityHeaders,
  getUserPermissions,
};
