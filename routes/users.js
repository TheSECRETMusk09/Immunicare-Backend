const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { CANONICAL_ROLES, getCanonicalRole, requireSystemAdmin } = require('../middleware/rbac');
const securityEventService = require('../services/securityEventService');
const socketService = require('../services/socketService');
const {
  encryptPasswordForVisibility,
  decryptPasswordVisibilityPayload,
} = require('../utils/passwordVisibilityCrypto');

const router = express.Router();

// Middleware to authenticate all user routes
router.use(authenticateToken);

const canAccessGuardianScope = (req, guardianId) => {
  const role = getCanonicalRole(req);
  if (role === CANONICAL_ROLES.SYSTEM_ADMIN) {
    return true;
  }

  // Guardians can access their own profile/scope
  if (role === CANONICAL_ROLES.GUARDIAN) {
    const requestedGuardianId = parseInt(guardianId, 10);

    // Check guardian_id if available (preferred method)
    if (req.user.guardian_id) {
      return parseInt(req.user.guardian_id, 10) === requestedGuardianId;
    }

    // Fallback: check if user.id matches the guardianId (legacy token support)
    // This handles cases where guardian_id isn't in the JWT token
    if (req.user.id) {
      return parseInt(req.user.id, 10) === requestedGuardianId;
    }

    // If neither guardian_id nor id matches, deny access
    return false;
  }

  return false;
};

const canAccessUserScope = (req, userId) => {
  const role = getCanonicalRole(req);
  if (role === CANONICAL_ROLES.SYSTEM_ADMIN) {
    return true;
  }

  return parseInt(req.user.id, 10) === parseInt(userId, 10);
};

const GUARDIAN_PHONE_REGEX = /^(\+63|0)\d{10}$/;

const normalizeGuardianProfileValidationErrors = (errors = {}) => {
  return Object.entries(errors).reduce((acc, [field, message]) => {
    if (typeof message === 'string' && message.trim()) {
      acc[field] = message;
    } else if (Array.isArray(message) && message.length > 0) {
      acc[field] = String(message[0]);
    } else {
      acc[field] = 'Invalid value';
    }
    return acc;
  }, {});
};

const validateGuardianProfilePayload = (payload = {}) => {
  const errors = {};

  const sanitizeText = (value) => {
    if (value === undefined || value === null) {
      return null;
    }
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  };

  const normalized = {
    name: sanitizeText(payload.name),
    phone: sanitizeText(payload.phone),
    email: sanitizeText(payload.email),
    address: sanitizeText(payload.address),
    emergency_contact: sanitizeText(payload.emergency_contact),
    emergency_phone: sanitizeText(payload.emergency_phone),
  };

  if (!normalized.name) {
    errors.name = 'Name is required';
  } else if (normalized.name.length < 2) {
    errors.name = 'Name must be at least 2 characters long';
  } else if (normalized.name.length > 120) {
    errors.name = 'Name must not exceed 120 characters';
  }

  if (normalized.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalized.email)) {
      errors.email = 'Please enter a valid email address';
    }
  }

  if (normalized.phone) {
    const compactPhone = normalized.phone.replace(/[\s\-()]/g, '');
    if (!GUARDIAN_PHONE_REGEX.test(compactPhone)) {
      errors.phone = 'Phone must use 09XXXXXXXXX or +63XXXXXXXXXX format';
    } else {
      normalized.phone = compactPhone;
    }
  }

  if (normalized.emergency_phone) {
    const compactEmergencyPhone = normalized.emergency_phone.replace(/[\s\-()]/g, '');
    if (!GUARDIAN_PHONE_REGEX.test(compactEmergencyPhone)) {
      errors.emergency_phone =
        'Emergency phone must use 09XXXXXXXXX or +63XXXXXXXXXX format';
    } else {
      normalized.emergency_phone = compactEmergencyPhone;
    }
  }

  if (normalized.address && normalized.address.length > 500) {
    errors.address = 'Address must not exceed 500 characters';
  }

  if (normalized.emergency_contact && normalized.emergency_contact.length > 120) {
    errors.emergency_contact = 'Emergency contact name must not exceed 120 characters';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    data: normalized,
  };
};

const respondGuardianProfileValidationError = (
  res,
  errors = {},
  message = 'Please correct the highlighted profile fields.',
) => {
  const fields = normalizeGuardianProfileValidationErrors(errors);
  return res.status(400).json({
    success: false,
    error: message,
    code: 'VALIDATION_ERROR',
    fields,
  });
};

const getRequestSourceContext = (req) => {
  const fromQuery = req.query?.source;
  const fromBody = req.body?.sourceContext;
  return fromBody || fromQuery || 'user-management/system-users';
};

const getActorAuditMeta = (req) => ({
  actorUserId: req.user?.id || null,
  actorUsername: req.user?.username || 'unknown',
  actorRole: getCanonicalRole(req) || req.user?.role || null,
});

const toIntegerId = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const requireValidIdParam = (res, value, fieldName = 'id') => {
  const parsedId = toIntegerId(value);
  if (!parsedId || parsedId <= 0) {
    res.status(400).json({
      success: false,
      error: `${fieldName} must be a valid positive integer`,
      code: 'INVALID_ID',
      field: fieldName,
    });
    return null;
  }

  return parsedId;
};

const buildSystemUserResponse = (row = {}) => ({
  id: row.id,
  username: row.username,
  contact: row.contact || null,
  last_login: row.last_login || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  is_active: Boolean(row.is_active),
  role_id: row.role_id || null,
  role_name: row.role_name || null,
  display_name: row.display_name || null,
  clinic_id: row.clinic_id || null,
  clinic_name: row.clinic_name || null,
  user_type: 'system',
});

const respondSystemUserSuccess = (res, {
  statusCode = 200,
  message,
  user,
  code,
} = {}) => {
  return res.status(statusCode).json({
    success: true,
    message,
    code,
    user,
  });
};

const respondSystemUserError = (res, {
  statusCode = 500,
  error,
  code,
  field,
  details,
} = {}) => {
  return res.status(statusCode).json({
    success: false,
    error,
    code,
    field: field || null,
    details: details || null,
  });
};

const ensureSystemUserExists = async (userId) => {
  const result = await pool.query(
    `SELECT
       u.id,
       u.username,
       u.contact,
       u.last_login,
       u.created_at,
       u.updated_at,
       u.is_active,
       u.role_id,
       r.name as role_name,
       r.display_name,
       u.clinic_id,
       c.name as clinic_name
     FROM users u
     JOIN roles r ON u.role_id = r.id
     LEFT JOIN clinics c ON u.clinic_id = c.id
     WHERE u.id = $1`,
    [userId],
  );

  return result.rows[0] || null;
};

const validateSystemUserPayload = ({
  username,
  role_id,
  clinic_id,
  password,
  isCreate = false,
}) => {
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (!normalizedUsername || normalizedUsername.length < 3) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Username must be at least 3 characters long',
      code: 'INVALID_USERNAME',
      field: 'username',
    };
  }

  const normalizedRoleId = toIntegerId(role_id);
  if (!normalizedRoleId || normalizedRoleId <= 0) {
    return {
      valid: false,
      statusCode: 400,
      error: 'role_id must be a valid positive integer',
      code: 'INVALID_ROLE_ID',
      field: 'role_id',
    };
  }

  const normalizedClinicId = toIntegerId(clinic_id);
  if (!normalizedClinicId || normalizedClinicId <= 0) {
    return {
      valid: false,
      statusCode: 400,
      error: 'clinic_id must be a valid positive integer',
      code: 'INVALID_CLINIC_ID',
      field: 'clinic_id',
    };
  }

  if (isCreate) {
    if (!password || String(password).length < 6) {
      return {
        valid: false,
        statusCode: 400,
        error: 'Password must be at least 6 characters long',
        code: 'INVALID_PASSWORD',
        field: 'password',
      };
    }
  }

  if (!isCreate && password && String(password).length < 6) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Password must be at least 6 characters long',
      code: 'INVALID_PASSWORD',
      field: 'password',
    };
  }

  return {
    valid: true,
    data: {
      username: normalizedUsername,
      role_id: normalizedRoleId,
      clinic_id: normalizedClinicId,
    },
  };
};

const logSystemUserSecurityEvent = async ({
  req,
  eventType,
  severity,
  targetUserId,
  details,
}) => {
  await securityEventService.logEvent({
    userId: req.user?.id || null,
    eventType,
    severity,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    resourceType: 'system_user',
    resourceId: targetUserId || null,
    details: {
      actor_user_id: req.user?.id || null,
      actor_username: req.user?.username || 'unknown',
      actor_role: getCanonicalRole(req) || req.user?.role || null,
      target_user_id: targetUserId || null,
      occurred_at: new Date().toISOString(),
      ...details,
    },
  });
};

const canRevealGuardianPasswords = (req) => {
  // Check canonical role (primary method)
  const canonicalRole = getCanonicalRole(req);
  if (canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN) {
    return true;
  }

  // Check legacy role (fallback for older users)
  const legacyRole = String(req.user?.legacy_role || '').toLowerCase();
  if (legacyRole === 'admin' || legacyRole === 'super_admin') {
    return true;
  }

  // Check role from JWT token
  const tokenRole = String(req.user?.role || '').toLowerCase();
  if (tokenRole === 'admin' || tokenRole === 'super_admin') {
    return true;
  }

  return false;
};

const logGuardianPasswordVisibilityEvent = async ({
  req,
  guardianId,
  action,
  sourceContext,
  success = true,
  details = {},
}) => {
  const actor = getActorAuditMeta(req);
  const actionName = String(action || 'access').toLowerCase();
  const parsedGuardianId = parseInt(guardianId, 10);
  const normalizedGuardianId = Number.isNaN(parsedGuardianId) ? null : parsedGuardianId;

  await securityEventService.logEvent({
    userId: actor.actorUserId,
    eventType: securityEventService.EVENT_TYPES.SENSITIVE_DATA_ACCESSED,
    severity: success ? securityEventService.SEVERITY.WARNING : securityEventService.SEVERITY.ERROR,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    resourceType: 'guardian_password_visibility',
    resourceId: normalizedGuardianId,
    details: {
      action: actionName,
      source_context: sourceContext,
      actor_user_id: actor.actorUserId,
      actor_username: actor.actorUsername,
      actor_role: actor.actorRole,
      target_guardian_id: normalizedGuardianId,
      occurred_at: new Date().toISOString(),
      success,
      ...details,
    },
  });

  await pool.query(
    `INSERT INTO access_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, status, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actor.actorUserId,
      `guardian_password_${actionName}`,
      'guardian_password_visibility',
      normalizedGuardianId,
      req.ip || null,
      req.get('User-Agent') || null,
      success ? 'success' : 'failed',
      JSON.stringify({
        source_context: sourceContext,
        actor_username: actor.actorUsername,
        actor_role: actor.actorRole,
        target_guardian_id: normalizedGuardianId,
        occurred_at: new Date().toISOString(),
        ...details,
      }),
    ],
  );
};

const requirePasswordVisibilityRole = async (req, res, next) => {
  if (!canRevealGuardianPasswords(req)) {
    try {
      await logGuardianPasswordVisibilityEvent({
        req,
        guardianId: req.params?.id,
        action: 'access',
        sourceContext: getRequestSourceContext(req),
        success: false,
        details: {
          reason: 'forbidden_role',
          required_roles: ['admin', 'super_admin'],
        },
      });
    } catch (auditError) {
      console.error('Failed to log forbidden guardian password visibility access:', auditError);
    }

    return res.status(403).json({
      success: false,
      error: 'Guardian password visibility is restricted to admin and super_admin accounts',
    });
  }

  return next();
};

const normalizeTimestampForCompare = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

const buildStaleWriteConflict = ({ currentRow, expectedUpdatedAt }) => {
  const actualUpdatedAt = normalizeTimestampForCompare(currentRow?.updated_at);
  return {
    success: false,
    code: 'CONFLICT_STALE_WRITE',
    message:
      'This guardian record was changed by another session. Reload the latest data and retry your update.',
    current: currentRow,
    expected_updated_at: expectedUpdatedAt || null,
    actual_updated_at: actualUpdatedAt,
  };
};

const parseExpectedUpdatedAt = (input) => {
  if (input === undefined || input === null || input === '') {
    return null;
  }
  const normalized = normalizeTimestampForCompare(input);
  return normalized;
};

// Get all users (including guardians) - unified view
router.get('/all-users', requireSystemAdmin, async (req, res) => {
  try {
    // Get system users
    const systemUsersResult = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.contact,
        u.last_login,
        u.created_at,
        u.is_active,
        r.name as role_name,
        r.display_name,
        c.name as clinic_name,
        'system' as user_type
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN clinics c ON u.clinic_id = c.id
    `);

    // Get guardians
    const guardiansResult = await pool.query(`
      SELECT
        g.id,
        g.name as username,
        g.phone as contact,
        g.last_login,
        g.created_at,
        g.is_active,
        g.is_password_set,
        CASE WHEN g.password_visibility_payload IS NOT NULL THEN true ELSE false END as password_visibility_available,
        'guardian' as role_name,
        'Guardian' as display_name,
        NULL as clinic_name,
        'guardian' as user_type
      FROM guardians g
    `);

    // Combine and return both
    const allUsers = [...systemUsersResult.rows, ...guardiansResult.rows].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    res.json(allUsers);
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all users (basic list)
router.get('/', requireSystemAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, contact, created_at FROM users ORDER BY created_at DESC LIMIT 100',
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all guardians (including infant count)
router.get('/guardians', requireSystemAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        g.id, g.name, g.phone, g.email, g.address, g.relationship,
        g.is_password_set, g.must_change_password, g.last_login,
        g.is_active, g.created_at, g.updated_at,
        COUNT(i.id) as infant_count
      FROM guardians g
      LEFT JOIN patients i ON g.id = i.guardian_id AND i.is_active = true
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching guardians:', error);
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

// Create new guardian
router.post('/guardians', requireSystemAdmin, async (req, res) => {
  try {
    const { name, phone, email, address, relationship } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Name and phone are required',
      });
    }

    const result = await pool.query(
      'INSERT INTO guardians (name, phone, email, address, relationship) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, phone, email, address, relationship],
    );

    socketService.broadcast('guardian_created', result.rows[0]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating guardian:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update guardian
router.put('/guardians/:id', requireSystemAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      phone,
      email,
      address,
      relationship,
      expected_updated_at: expectedUpdatedAtRaw,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Name and phone are required',
      });
    }

    const expectedUpdatedAt = parseExpectedUpdatedAt(expectedUpdatedAtRaw);
    if (expectedUpdatedAtRaw !== undefined && expectedUpdatedAt === null) {
      return res.status(400).json({
        success: false,
        error: 'Invalid expected_updated_at timestamp',
      });
    }

    const existingResult = await pool.query(
      'SELECT * FROM guardians WHERE id = $1',
      [id],
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Guardian not found' });
    }

    const existingGuardian = existingResult.rows[0];
    const existingUpdatedAt = normalizeTimestampForCompare(existingGuardian.updated_at);

    if (expectedUpdatedAt && existingUpdatedAt && expectedUpdatedAt !== existingUpdatedAt) {
      return res.status(409).json(
        buildStaleWriteConflict({
          currentRow: existingGuardian,
          expectedUpdatedAt,
        }),
      );
    }

    const result = await pool.query(
      'UPDATE guardians SET name = $1, phone = $2, email = $3, address = $4, relationship = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *',
      [name, phone, email, address, relationship, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Guardian not found' });
    }

    socketService.broadcast('guardian_updated', result.rows[0]);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating guardian:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete guardian
router.delete('/guardians/:id', requireSystemAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const expectedUpdatedAt = parseExpectedUpdatedAt(
      req.query?.expected_updated_at || req.body?.expected_updated_at,
    );

    if (
      (req.query?.expected_updated_at !== undefined || req.body?.expected_updated_at !== undefined) &&
      expectedUpdatedAt === null
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid expected_updated_at timestamp',
      });
    }

    const existingResult = await pool.query('SELECT * FROM guardians WHERE id = $1', [id]);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Guardian not found' });
    }

    const existingGuardian = existingResult.rows[0];
    const existingUpdatedAt = normalizeTimestampForCompare(existingGuardian.updated_at);

    if (expectedUpdatedAt && existingUpdatedAt && expectedUpdatedAt !== existingUpdatedAt) {
      return res.status(409).json(
        buildStaleWriteConflict({
          currentRow: existingGuardian,
          expectedUpdatedAt,
        }),
      );
    }

    const result = await pool.query('DELETE FROM guardians WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Guardian not found' });
    }

    socketService.broadcast('guardian_deleted', { id });
    res.json({ success: true, message: 'Guardian deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get guardian password status (Admin only)
router.get('/guardians/:id/password', requireSystemAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Get guardian from database
    const result = await pool.query(
      'SELECT id, name, email, is_password_set, must_change_password FROM guardians WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    res.json({
      guardian: result.rows[0],
      can_reset: true,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset guardian password (Admin only)
router.put('/guardians/:id/password', requireSystemAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password, isPasswordSet, mustChangePassword } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const passwordVisibilityPayload = encryptPasswordForVisibility(password);

    const result = await pool.query(
      `UPDATE guardians
       SET password_hash = $1,
           is_password_set = COALESCE($2, true),
           must_change_password = COALESCE($3, false),
           password_visibility_payload = $4,
           password_visibility_updated_at = CURRENT_TIMESTAMP,
           password_visibility_updated_by = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, name, email, is_password_set, must_change_password, password_visibility_updated_at`,
      [
        hashedPassword,
        isPasswordSet !== undefined ? isPasswordSet : true,
        mustChangePassword,
        passwordVisibilityPayload,
        req.user?.id || null,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    socketService.broadcast('guardian_updated', result.rows[0]);
    res.json({
      message: 'Guardian password reset successfully',
      guardian: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reveal guardian password for system admins (admin/super_admin canonical role)
router.get(
  '/guardians/:id/password-visibility',
  requireSystemAdmin,
  requirePasswordVisibilityRole,
  async (req, res) => {
    const { id } = req.params;
    const sourceContext = getRequestSourceContext(req);

    try {
      const result = await pool.query(
        `SELECT id, name, password_visibility_payload, password_visibility_updated_at
       FROM guardians
       WHERE id = $1`,
        [id],
      );

      if (result.rows.length === 0) {
        await logGuardianPasswordVisibilityEvent({
          req,
          guardianId: id,
          action: 'access',
          sourceContext,
          success: false,
          details: { reason: 'guardian_not_found' },
        });
        return res.status(404).json({ success: false, error: 'Guardian not found' });
      }

      const guardian = result.rows[0];
      let visiblePassword = null;
      let decryptError = null;

      if (guardian.password_visibility_payload) {
        try {
          visiblePassword = decryptPasswordVisibilityPayload(guardian.password_visibility_payload);
        } catch (error) {
          decryptError = error.message;
        }
      }

      await logGuardianPasswordVisibilityEvent({
        req,
        guardianId: guardian.id,
        action: 'access',
        sourceContext,
        success: true,
        details: {
          password_available: Boolean(visiblePassword),
          decrypt_error: decryptError,
          target_guardian_name: guardian.name,
        },
      });

      res.json({
        success: true,
        data: {
          guardian_id: guardian.id,
          guardian_name: guardian.name,
          password: visiblePassword,
          available: Boolean(visiblePassword),
          masked: '••••••••',
          source_context: sourceContext,
          revealed_at: new Date().toISOString(),
          updated_at: guardian.password_visibility_updated_at,
        },
      });
    } catch (error) {
      await logGuardianPasswordVisibilityEvent({
        req,
        guardianId: id,
        action: 'access',
        sourceContext,
        success: false,
        details: { reason: 'server_error', message: error.message },
      });
      res.status(500).json({ success: false, error: error.message });
    }
  },
);

// Audit show/hide actions from UI for guardian password visibility
router.post(
  '/guardians/:id/password-visibility/audit',
  requireSystemAdmin,
  requirePasswordVisibilityRole,
  async (req, res) => {
    const { id } = req.params;
    const sourceContext = getRequestSourceContext(req);
    const action = String(req.body?.action || '').toLowerCase();

    if (!['show', 'hide', 'access'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Allowed values: show, hide, access',
      });
    }

    try {
      await logGuardianPasswordVisibilityEvent({
        req,
        guardianId: id,
        action,
        sourceContext,
        success: true,
        details: {
          ui_event: true,
        },
      });

      res.json({
        success: true,
        message: `Guardian password visibility ${action} event logged`,
        data: {
          action,
          source_context: sourceContext,
          target_guardian_id: parseInt(id, 10),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },
);

// Get all system users (admin, doctor, nurse, staff)
router.get('/system-users', requireSystemAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.contact, u.last_login, u.created_at, u.updated_at, u.is_active,
             u.role_id, r.name as role_name, r.display_name, u.clinic_id, c.name as clinic_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN clinics c ON u.clinic_id = c.id
      ORDER BY u.created_at DESC
    `);

    return res.json({
      success: true,
      data: result.rows.map(buildSystemUserResponse),
      meta: {
        count: result.rows.length,
      },
    });
  } catch (error) {
    return respondSystemUserError(res, {
      statusCode: 500,
      error: 'Failed to fetch system users',
      code: 'SYSTEM_USERS_FETCH_FAILED',
      details: process.env.NODE_ENV === 'development' ? { message: error.message } : undefined,
    });
  }
});

// Create system user
router.post('/system-users', requireSystemAdmin, async (req, res) => {
  try {
    const { username, password, role_id, clinic_id, contact } = req.body;
    const validation = validateSystemUserPayload({
      username,
      role_id,
      clinic_id,
      password,
      isCreate: true,
    });

    if (!validation.valid) {
      return respondSystemUserError(res, {
        statusCode: validation.statusCode,
        error: validation.error,
        code: validation.code,
        field: validation.field,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role_id, clinic_id, contact)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        validation.data.username,
        hashedPassword,
        validation.data.role_id,
        validation.data.clinic_id,
        contact || null,
      ],
    );

    const createdId = result.rows[0]?.id;
    const createdUser = await ensureSystemUserExists(createdId);

    if (!createdUser) {
      return respondSystemUserError(res, {
        statusCode: 500,
        error: 'System user created but failed to load normalized user response',
        code: 'SYSTEM_USER_CREATE_FETCH_FAILED',
      });
    }

    await logSystemUserSecurityEvent({
      req,
      eventType: securityEventService.EVENT_TYPES.SYSTEM_CONFIG_CHANGED,
      severity: securityEventService.SEVERITY.INFO,
      targetUserId: createdUser.id,
      details: {
        action: 'system_user_created',
        username: createdUser.username,
        role_id: createdUser.role_id,
      },
    });

    const normalizedUser = buildSystemUserResponse(createdUser);
    socketService.broadcast('system_user_created', normalizedUser);

    return respondSystemUserSuccess(res, {
      statusCode: 201,
      message: 'System user created successfully',
      code: 'SYSTEM_USER_CREATED',
      user: normalizedUser,
    });
  } catch (error) {
    if (error?.code === '23505') {
      return respondSystemUserError(res, {
        statusCode: 409,
        error: 'Username already exists',
        code: 'USERNAME_ALREADY_EXISTS',
        field: 'username',
      });
    }

    return respondSystemUserError(res, {
      statusCode: 500,
      error: 'Failed to create system user',
      code: 'SYSTEM_USER_CREATE_FAILED',
      details: process.env.NODE_ENV === 'development' ? { message: error.message } : undefined,
    });
  }
});

// Update system user
router.put('/system-users/:id', requireSystemAdmin, async (req, res) => {
  try {
    const userId = requireValidIdParam(res, req.params?.id, 'id');
    if (!userId) {
      return;
    }

    const { username, role_id, clinic_id, contact, password } = req.body;

    const validation = validateSystemUserPayload({
      username,
      role_id,
      clinic_id,
      password,
      isCreate: false,
    });

    if (!validation.valid) {
      return respondSystemUserError(res, {
        statusCode: validation.statusCode,
        error: validation.error,
        code: validation.code,
        field: validation.field,
      });
    }

    const existingUser = await ensureSystemUserExists(userId);
    if (!existingUser) {
      return respondSystemUserError(res, {
        statusCode: 404,
        error: 'User not found',
        code: 'SYSTEM_USER_NOT_FOUND',
      });
    }

    if (userId === req.user.id && !existingUser.is_active) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'Cannot modify your own inactive account',
        code: 'SELF_MODIFY_INACTIVE_ACCOUNT_FORBIDDEN',
      });
    }

    // Build update query safely
    const setParts = ['username = $1', 'role_id = $2', 'clinic_id = $3', 'contact = $4'];
    const values = [
      validation.data.username,
      validation.data.role_id,
      validation.data.clinic_id,
      contact || null,
    ];
    let paramIndex = 4;

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      setParts.push('password_hash = $' + (paramIndex + 1));
      values.push(hashedPassword);
      paramIndex++;
    }

    setParts.push('updated_at = CURRENT_TIMESTAMP');

    const query = `
      UPDATE users
      SET ${setParts.join(', ')}
      WHERE id = $${paramIndex + 1}
      RETURNING id
    `;

    values.push(userId);

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return respondSystemUserError(res, {
        statusCode: 404,
        error: 'User not found',
        code: 'SYSTEM_USER_NOT_FOUND',
      });
    }

    const updatedUser = await ensureSystemUserExists(userId);
    if (!updatedUser) {
      return respondSystemUserError(res, {
        statusCode: 500,
        error: 'User updated but failed to load normalized response',
        code: 'SYSTEM_USER_UPDATE_FETCH_FAILED',
      });
    }

    await logSystemUserSecurityEvent({
      req,
      eventType: securityEventService.EVENT_TYPES.SYSTEM_CONFIG_CHANGED,
      severity: securityEventService.SEVERITY.WARNING,
      targetUserId: userId,
      details: {
        action: 'system_user_updated',
        previous_username: existingUser.username,
        username: updatedUser.username,
        role_id: updatedUser.role_id,
      },
    });

    const normalizedUser = buildSystemUserResponse(updatedUser);
    socketService.broadcast('system_user_updated', normalizedUser);

    return respondSystemUserSuccess(res, {
      message: 'System user updated successfully',
      code: 'SYSTEM_USER_UPDATED',
      user: normalizedUser,
    });
  } catch (error) {
    if (error?.code === '23505') {
      return respondSystemUserError(res, {
        statusCode: 409,
        error: 'Username already exists',
        code: 'USERNAME_ALREADY_EXISTS',
        field: 'username',
      });
    }

    return respondSystemUserError(res, {
      statusCode: 500,
      error: 'Failed to update system user',
      code: 'SYSTEM_USER_UPDATE_FAILED',
      details: process.env.NODE_ENV === 'development' ? { message: error.message } : undefined,
    });
  }
});

// Delete system user
router.delete('/system-users/:id', requireSystemAdmin, async (req, res) => {
  try {
    const userId = requireValidIdParam(res, req.params?.id, 'id');
    if (!userId) {
      return;
    }

    if (userId === req.user.id) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'Cannot delete your own account',
        code: 'SELF_DELETE_FORBIDDEN',
      });
    }

    const existingUser = await ensureSystemUserExists(userId);
    if (!existingUser) {
      return respondSystemUserError(res, {
        statusCode: 404,
        error: 'User not found',
        code: 'SYSTEM_USER_NOT_FOUND',
      });
    }

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, username', [userId]);

    if (result.rows.length === 0) {
      return respondSystemUserError(res, {
        statusCode: 404,
        error: 'User not found',
        code: 'SYSTEM_USER_NOT_FOUND',
      });
    }

    await logSystemUserSecurityEvent({
      req,
      eventType: securityEventService.EVENT_TYPES.SYSTEM_CONFIG_CHANGED,
      severity: securityEventService.SEVERITY.WARNING,
      targetUserId: userId,
      details: {
        action: 'system_user_deleted',
        username: existingUser.username,
      },
    });

    socketService.broadcast('system_user_deleted', { id: userId });
    return res.json({
      success: true,
      message: 'User deleted successfully',
      code: 'SYSTEM_USER_DELETED',
      user: {
        id: userId,
        username: existingUser.username,
      },
    });
  } catch (error) {
    return respondSystemUserError(res, {
      statusCode: 500,
      error: 'Failed to delete system user',
      code: 'SYSTEM_USER_DELETE_FAILED',
      details: process.env.NODE_ENV === 'development' ? { message: error.message } : undefined,
    });
  }
});

// Toggle system user active status (enable/disable)
router.put('/system-users/:id/toggle-active', requireSystemAdmin, async (req, res) => {
  try {
    const userId = requireValidIdParam(res, req.params?.id, 'id');
    if (!userId) {
      return;
    }

    const { is_active } = req.body;
    const normalizedIsActive = typeof is_active === 'boolean' ? is_active : null;

    if (normalizedIsActive === null) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'is_active must be a boolean',
        code: 'INVALID_IS_ACTIVE',
        field: 'is_active',
      });
    }

    // Prevent self-deactivation
    if (userId === req.user.id && normalizedIsActive === false) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'Cannot disable your own account',
        code: 'SELF_DISABLE_FORBIDDEN',
      });
    }

    const existingUser = await ensureSystemUserExists(userId);
    if (!existingUser) {
      return respondSystemUserError(res, {
        statusCode: 404,
        error: 'User not found',
        code: 'SYSTEM_USER_NOT_FOUND',
      });
    }

    const result = await pool.query(
      'UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
      [normalizedIsActive, userId],
    );

    if (result.rows.length === 0) {
      return respondSystemUserError(res, {
        statusCode: 404,
        error: 'User not found',
        code: 'SYSTEM_USER_NOT_FOUND',
      });
    }

    const updatedUser = await ensureSystemUserExists(userId);
    if (!updatedUser) {
      return respondSystemUserError(res, {
        statusCode: 500,
        error: 'User status updated but failed to load normalized response',
        code: 'SYSTEM_USER_TOGGLE_FETCH_FAILED',
      });
    }

    await logSystemUserSecurityEvent({
      req,
      eventType: securityEventService.EVENT_TYPES.SYSTEM_CONFIG_CHANGED,
      severity: securityEventService.SEVERITY.WARNING,
      targetUserId: userId,
      details: {
        action: normalizedIsActive ? 'system_user_enabled' : 'system_user_disabled',
        username: updatedUser.username,
        previous_is_active: existingUser.is_active,
        is_active: updatedUser.is_active,
      },
    });

    const normalizedUser = buildSystemUserResponse(updatedUser);
    socketService.broadcast('system_user_updated', normalizedUser);

    return respondSystemUserSuccess(res, {
      message: normalizedIsActive ? 'User enabled successfully' : 'User disabled successfully',
      code: normalizedIsActive ? 'SYSTEM_USER_ENABLED' : 'SYSTEM_USER_DISABLED',
      user: normalizedUser,
    });
  } catch (error) {
    return respondSystemUserError(res, {
      statusCode: 500,
      error: 'Failed to update user active status',
      code: 'SYSTEM_USER_TOGGLE_FAILED',
      details: process.env.NODE_ENV === 'development' ? { message: error.message } : undefined,
    });
  }
});

// Get all clinics
router.get('/clinics', requireSystemAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clinics ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create clinic
router.post('/clinics', requireSystemAdmin, async (req, res) => {
  try {
    const { name, region, address, contact } = req.body;

    const result = await pool.query(
      'INSERT INTO clinics (name, region, address, contact) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, region, address, contact],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update clinic
router.put('/clinics/:id', requireSystemAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, region, address, contact } = req.body;

    const result = await pool.query(
      'UPDATE clinics SET name = $1, region = $2, address = $3, contact = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
      [name, region, address, contact, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all roles
router.get('/roles', requireSystemAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM roles ORDER BY hierarchy_level DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create role
router.post('/roles', requireSystemAdmin, async (req, res) => {
  try {
    const { name, permissions, display_name, hierarchy_level } = req.body;

    const result = await pool.query(
      'INSERT INTO roles (name, permissions, display_name, hierarchy_level) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, permissions, display_name, hierarchy_level],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update role
router.put('/roles/:id', requireSystemAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, permissions, display_name, hierarchy_level, is_active } = req.body;

    const result = await pool.query(
      'UPDATE roles SET name = $1, permissions = $2, display_name = $3, hierarchy_level = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *',
      [name, permissions, display_name, hierarchy_level, is_active, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get system user password (Admin only)
router.get('/system-users/:id/password', requireSystemAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Get user from database (without password hash)
    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [id]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // For security reasons, we won't return the actual password
    // Instead, we'll return a message indicating the user exists and can be reset
    res.json({
      message: 'Password reset available for this user',
      user_id: id,
      can_reset: true,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset system user password (Admin only)
router.put('/system-users/:id/password', requireSystemAdmin, async (req, res) => {
  try {
    const userId = requireValidIdParam(res, req.params?.id, 'id');
    if (!userId) {
      return;
    }

    const { password } = req.body;

    if (!password || password.length < 6) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'Password must be at least 6 characters long',
        code: 'INVALID_PASSWORD',
        field: 'password',
      });
    }

    const existingUser = await ensureSystemUserExists(userId);
    if (!existingUser) {
      return respondSystemUserError(res, {
        statusCode: 404,
        error: 'User not found',
        code: 'SYSTEM_USER_NOT_FOUND',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
      [hashedPassword, userId],
    );

    if (result.rows.length === 0) {
      return respondSystemUserError(res, {
        statusCode: 404,
        error: 'User not found',
        code: 'SYSTEM_USER_NOT_FOUND',
      });
    }

    const updatedUser = await ensureSystemUserExists(userId);
    if (!updatedUser) {
      return respondSystemUserError(res, {
        statusCode: 500,
        error: 'Password reset completed but failed to load normalized response',
        code: 'SYSTEM_USER_PASSWORD_RESET_FETCH_FAILED',
      });
    }

    await logSystemUserSecurityEvent({
      req,
      eventType: securityEventService.EVENT_TYPES.PASSWORD_CHANGED,
      severity: securityEventService.SEVERITY.CRITICAL,
      targetUserId: userId,
      details: {
        action: 'system_user_password_reset',
        target_username: existingUser.username,
        source_context: getRequestSourceContext(req),
      },
    });

    const normalizedUser = buildSystemUserResponse(updatedUser);
    socketService.broadcast('system_user_updated', normalizedUser);

    return respondSystemUserSuccess(res, {
      message: 'Password reset successfully',
      code: 'SYSTEM_USER_PASSWORD_RESET',
      user: normalizedUser,
    });
  } catch (error) {
    return respondSystemUserError(res, {
      statusCode: 500,
      error: 'Failed to reset password',
      code: 'SYSTEM_USER_PASSWORD_RESET_FAILED',
      details: process.env.NODE_ENV === 'development' ? { message: error.message } : undefined,
    });
  }
});

// Get user statistics
router.get('/stats', requireSystemAdmin, async (req, res) => {
  try {
    const [totalUsers, totalGuardians, totalClinics, totalRoles] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM users'),
      pool.query('SELECT COUNT(*) as count FROM guardians'),
      pool.query('SELECT COUNT(*) as count FROM clinics'),
      pool.query('SELECT COUNT(*) as count FROM roles WHERE is_active = true'),
    ]);

    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count),
      totalGuardians: parseInt(totalGuardians.rows[0].count),
      totalClinics: parseInt(totalClinics.rows[0].count),
      totalRoles: parseInt(totalRoles.rows[0].count),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get guardian profile
router.get('/guardian/profile/:guardianId', async (req, res) => {
  try {
    const { guardianId } = req.params;

    if (!canAccessGuardianScope(req, guardianId)) {
      return res.status(403).json({ error: 'Access denied to guardian profile' });
    }

    // Get guardian from database
    const result = await pool.query(
      `SELECT id, name, phone, email, address, relationship,
              emergency_contact, emergency_phone,
              is_password_set, must_change_password,
              last_login, is_active, created_at, updated_at
       FROM guardians
       WHERE id = $1`,
      [guardianId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    const guardian = result.rows[0];

    res.json({ success: true, data: guardian });
  } catch (error) {
    console.error('Error fetching guardian profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update guardian profile
router.put('/guardian/profile/:guardianId', requireSystemAdmin, async (req, res) => {
  try {
    const { guardianId } = req.params;
    const { name, phone, email, address, emergency_contact, emergency_phone } = req.body;

    // Validate input
    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        error: 'Name must be at least 2 characters long',
      });
    }

    const result = await pool.query(
      `UPDATE guardians
       SET name = $1, phone = $2, email = $3, address = $4,
           emergency_contact = $5, emergency_phone = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, name, phone, email, address, emergency_contact, emergency_phone`,
      [name, phone, email, address, emergency_contact, emergency_phone, guardianId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    socketService.broadcast('guardian_updated', result.rows[0]);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating guardian profile:', error);
    res.status(500).json({
      error: 'Profile update failed',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Update guardian self profile (GUARDIAN own)
router.put('/guardian/self/profile/:guardianId', async (req, res) => {
  try {
    const { guardianId } = req.params;
    const requestedGuardianId = parseInt(guardianId, 10);

    if (Number.isNaN(requestedGuardianId) || requestedGuardianId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'guardianId must be a valid positive integer',
        code: 'INVALID_GUARDIAN_ID',
        field: 'guardianId',
      });
    }

    const role = getCanonicalRole(req);
    if (role !== CANONICAL_ROLES.GUARDIAN) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Guardian role required for self profile updates.',
      });
    }

    if (!canAccessGuardianScope(req, requestedGuardianId)) {
      return res.status(403).json({
        success: false,
        error: 'You can only update your own guardian profile.',
      });
    }

    const validationResult = validateGuardianProfilePayload(req.body || {});
    if (!validationResult.isValid) {
      return respondGuardianProfileValidationError(res, validationResult.errors);
    }

    const profile = validationResult.data;

    const duplicateEmailResult = profile.email
      ? await pool.query(
        'SELECT id FROM guardians WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1',
        [profile.email, requestedGuardianId],
      )
      : { rows: [] };

    if (duplicateEmailResult.rows.length > 0) {
      return respondGuardianProfileValidationError(res, {
        email: 'This email is already in use by another guardian account',
      });
    }

    const result = await pool.query(
      `UPDATE guardians
       SET name = $1,
           phone = $2,
           email = $3,
           address = $4,
           emergency_contact = $5,
           emergency_phone = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, name, phone, email, address, emergency_contact, emergency_phone, updated_at`,
      [
        profile.name,
        profile.phone,
        profile.email,
        profile.address,
        profile.emergency_contact,
        profile.emergency_phone,
        requestedGuardianId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Guardian not found',
      });
    }

    socketService.broadcast('guardian_updated', result.rows[0]);
    return res.json({
      success: true,
      data: result.rows[0],
      message: 'Profile updated successfully',
    });
  } catch (error) {
    console.error('Error updating guardian self profile:', error);
    return res.status(500).json({
      success: false,
      error: 'Profile update failed',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Get user profile
router.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!canAccessUserScope(req, userId)) {
      return res.status(403).json({ error: 'Access denied to user profile' });
    }

    // Get user from database
    const result = await pool.query(
      `SELECT u.*, r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Remove password hash from response for security

    const { password_hash: _password_hash, ...userWithoutPassword } = user;

    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user profile
router.put('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, contact, email } = req.body;

    if (!canAccessUserScope(req, userId)) {
      return res.status(403).json({ error: 'Access denied to update user profile' });
    }

    // Validate input
    if (!username || username.trim().length < 3) {
      return res.status(400).json({
        error: 'Username must be at least 3 characters long',
      });
    }

    // Build update query
    const setParts = ['username = $1', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [username];
    let paramIndex = 1;

    if (contact) {
      setParts.push(`contact = $${++paramIndex}`);
      values.push(contact);
    }

    if (email) {
      setParts.push(`email = $${++paramIndex}`);
      values.push(email);
    }

    values.push(userId);

    const query = `
      UPDATE users
      SET ${setParts.join(', ')}
      WHERE id = $${++paramIndex}
      RETURNING id, username, email, contact, role_id, clinic_id
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    socketService.broadcast('system_user_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      error: 'Profile update failed',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// ==================== NOTIFICATION SETTINGS ====================

// Get notification settings for current user
router.get('/me/notification-settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT notification_settings FROM users WHERE id = $1', [
      req.user.id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const notificationSettings = result.rows[0].notification_settings || {};

    res.json({
      success: true,
      data: notificationSettings,
    });
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification settings',
    });
  }
});

// Save notification settings for current user
router.put('/me/notification-settings', async (req, res) => {
  try {
    const { notification_settings } = req.body;

    // Validate that notification_settings is an object
    if (notification_settings && typeof notification_settings !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Notification settings must be a valid JSON object',
      });
    }

    const result = await pool.query(
      `UPDATE users
       SET notification_settings = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING notification_settings`,
      [JSON.stringify(notification_settings || {}), req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Notification settings saved successfully',
      data: result.rows[0].notification_settings,
    });
  } catch (error) {
    console.error('Error saving notification settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save notification settings',
    });
  }
});

// ==================== GUARDIAN DATA EXPORT ====================

// Export guardian data (profile, children, appointments, vaccinations)
router.get('/guardian/export/:guardianId', async (req, res) => {
  try {
    const { guardianId } = req.params;

    if (!canAccessGuardianScope(req, guardianId)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only export your own data.',
      });
    }

    // Get guardian profile
    const guardianResult = await pool.query(
      `SELECT id, name, phone, email, address, relationship,
              emergency_contact, emergency_phone, created_at
       FROM guardians WHERE id = $1`,
      [guardianId],
    );

    if (guardianResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Guardian not found',
      });
    }

    // Get children/infants
    const infantsResult = await pool.query(
      `SELECT id, first_name, last_name, dob, sex, birth_weight, birth_height,
              place_of_birth as birth_place, mother_name, father_name, created_at, control_number
       FROM patients
       WHERE guardian_id = $1
         AND is_active = true`,
      [guardianId],
    );

    // Get appointments for guardian's children
    const infantsIds = infantsResult.rows.map((i) => i.id);
    let appointmentsResult = { rows: [] };

    if (infantsIds.length > 0) {
      appointmentsResult = await pool.query(
        `SELECT a.id,
                a.infant_id,
                a.scheduled_date as appointment_date,
                a.scheduled_date as appointment_time,
                a.status, a.notes, a.created_at
         FROM appointments a
         WHERE a.infant_id = ANY($1)
           AND a.is_active = true
         ORDER BY a.scheduled_date DESC`,
        [infantsIds],
      );
    }

    // Get vaccination records for guardian's children
    let vaccinationsResult = { rows: [] };

    if (infantsIds.length > 0) {
      vaccinationsResult = await pool.query(
        `SELECT ir.id,
                ir.patient_id as infant_id,
                ir.vaccine_id,
                ir.admin_date as vaccination_date,
                ir.site_of_injection as vaccination_site,
                ir.batch_id,
                ir.administered_by,
                ir.notes,
                ir.created_at,
                v.name as vaccine_name,
                v.manufacturer
         FROM immunization_records ir
         LEFT JOIN vaccines v ON ir.vaccine_id = v.id
         WHERE ir.patient_id = ANY($1)
           AND ir.is_active = true
         ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC`,
        [infantsIds],
      );
    }

    // Compile export data
    const exportData = {
      exportedAt: new Date().toISOString(),
      guardian: guardianResult.rows[0],
      children: infantsResult.rows,
      appointments: appointmentsResult.rows,
      vaccinations: vaccinationsResult.rows,
      summary: {
        totalChildren: infantsResult.rows.length,
        totalAppointments: appointmentsResult.rows.length,
        totalVaccinations: vaccinationsResult.rows.length,
      },
    };

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=immunicare_data_${guardianId}_${Date.now()}.json`,
    );

    res.json({
      success: true,
      data: exportData,
    });
  } catch (error) {
    console.error('Error exporting guardian data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export guardian data',
    });
  }
});

// Change current user's password
router.put('/me/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and new password are required',
        code: 'MISSING_FIELDS',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'New password must be at least 6 characters long',
        code: 'WEAK_PASSWORD',
      });
    }

    // Get current user from database
    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [
      req.user.id,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Current password is incorrect',
        code: 'INVALID_CURRENT_PASSWORD',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and reset force_password_change flag
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           updated_at = CURRENT_TIMESTAMP,
           force_password_change = false,
           password_changed_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [hashedPassword, req.user.id],
    );

    res.json({
      message: 'Password changed successfully',
      success: true,
    });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      error: 'Password change failed',
      code: 'PASSWORD_CHANGE_ERROR',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;
