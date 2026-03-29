const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
  requireSystemAdmin,
} = require('../middleware/rbac');
const securityEventService = require('../services/securityEventService');
const socketService = require('../services/socketService');
const { writeAuditLog } = require('../services/auditLogService');
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
const MAX_GUARDIAN_USERNAME_SUFFIX = 10000;
const GUARDIAN_USERNAME_FORMAT_REGEX = /^[a-z0-9]+(?:\.[a-z0-9]+)+$/;
const GUARDIAN_PORTAL_CLINIC_NAME = 'Guardian Portal';
let ensureGuardianProfileColumnsPromise = null;

const ensureGuardianProfileColumnsExist = async () => {
  if (!ensureGuardianProfileColumnsPromise) {
    ensureGuardianProfileColumnsPromise = (async () => {
      await pool.query('ALTER TABLE guardians ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(255)');
      await pool.query('ALTER TABLE guardians ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(50)');
    })().catch((error) => {
      ensureGuardianProfileColumnsPromise = null;
      throw error;
    });
  }

  return ensureGuardianProfileColumnsPromise;
};

const normalizeGuardianEmail = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  return normalized || null;
};

const normalizeGuardianUsernamePart = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');
};

const splitGuardianFullName = (fullName) => {
  const normalizedName = String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!normalizedName) {
    return {
      firstName: 'guardian',
      lastName: 'user',
    };
  }

  const parts = normalizedName.split(' ').filter(Boolean);
  const firstName = parts[0] || 'guardian';
  const lastName = parts.slice(1).join(' ') || firstName;

  return {
    firstName,
    lastName,
  };
};

const buildGuardianUsernameBase = (fullName) => {
  const { firstName, lastName } = splitGuardianFullName(fullName);

  const normalizedFirst = normalizeGuardianUsernamePart(firstName);
  const normalizedLast = normalizeGuardianUsernamePart(lastName);

  const safeFirst = normalizedFirst || 'guardian';
  const safeLast = normalizedLast || safeFirst || 'user';

  const baseUsername = `${safeFirst}.${safeLast}`
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');

  return baseUsername || 'guardian.user';
};

const resolveUniqueGuardianUsername = async (
  client,
  { fullName, excludeUserId = null } = {},
) => {
  const baseUsername = buildGuardianUsernameBase(fullName);

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [baseUsername]);

  let query = `
    SELECT username
    FROM users
    WHERE (lower(username) = lower($1) OR lower(username) LIKE lower($2))
  `;
  const params = [baseUsername, `${baseUsername}%`];

  if (excludeUserId) {
    query += ' AND id <> $3';
    params.push(excludeUserId);
  }

  const existingUsernamesResult = await client.query(query, params);
  const takenUsernames = new Set(
    existingUsernamesResult.rows
      .map((row) => String(row.username || '').trim().toLowerCase())
      .filter(Boolean),
  );

  if (!takenUsernames.has(baseUsername.toLowerCase())) {
    return baseUsername;
  }

  for (let suffix = 2; suffix <= MAX_GUARDIAN_USERNAME_SUFFIX; suffix += 1) {
    const candidate = `${baseUsername}${suffix}`;
    if (!GUARDIAN_USERNAME_FORMAT_REGEX.test(candidate)) {
      continue;
    }

    if (!takenUsernames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  throw new Error('Unable to allocate unique guardian username');
};

const ensureGuardianRoleId = async (client) => {
  const roleResult = await client.query(
    `SELECT id
     FROM roles
     WHERE lower(name) = 'guardian'
     ORDER BY id ASC
     LIMIT 1`,
  );

  if (roleResult.rows.length === 0) {
    throw new Error('Guardian role is not configured in roles table');
  }

  return roleResult.rows[0].id;
};

const ensureGuardianPortalClinicId = async (client) => {
  const existingClinicResult = await client.query(
    `SELECT id
     FROM clinics
     WHERE lower(name) = lower($1)
     ORDER BY id ASC
     LIMIT 1`,
    [GUARDIAN_PORTAL_CLINIC_NAME],
  );

  if (existingClinicResult.rows.length > 0) {
    return existingClinicResult.rows[0].id;
  }

  const createdClinicResult = await client.query(
    `INSERT INTO clinics (name, region, address, contact)
     VALUES ($1, 'Virtual', 'Online', 'N/A')
     RETURNING id`,
    [GUARDIAN_PORTAL_CLINIC_NAME],
  );

  return createdClinicResult.rows[0].id;
};

const resolveGuardianUserEmail = async (client, email, { excludeUserId = null } = {}) => {
  const normalizedEmail = normalizeGuardianEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  let query = 'SELECT id FROM users WHERE lower(email) = lower($1)';
  const params = [normalizedEmail];

  if (excludeUserId) {
    query += ' AND id <> $2';
    params.push(excludeUserId);
  }

  query += ' LIMIT 1';

  const existingEmailResult = await client.query(query, params);
  return existingEmailResult.rows.length === 0 ? normalizedEmail : null;
};

const buildProvisionedGuardianPassword = () => {
  return `Guardian-${crypto.randomBytes(8).toString('hex')}`;
};

const ensureGuardianUserAccount = async (client, guardianRecord = {}) => {
  const guardianId = parseInt(guardianRecord.id, 10);
  if (!guardianId || guardianId <= 0) {
    throw new Error('Guardian id is required to ensure linked user account');
  }

  await client.query('SELECT id FROM guardians WHERE id = $1 FOR UPDATE', [guardianId]);

  const guardianName = String(guardianRecord.name || '').trim() || 'guardian user';

  const linkedUserResult = await client.query(
    `SELECT id, username, email
     FROM users
     WHERE guardian_id = $1
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [guardianId],
  );

  const existingUser = linkedUserResult.rows[0] || null;

  if (existingUser) {
    const generatedUsername = await resolveUniqueGuardianUsername(client, {
      fullName: guardianName,
      excludeUserId: existingUser.id,
    });

    if (String(existingUser.username || '').trim().toLowerCase() !== generatedUsername.toLowerCase()) {
      const updatedUserResult = await client.query(
        `UPDATE users
         SET username = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, username`,
        [generatedUsername, existingUser.id],
      );

      return updatedUserResult.rows[0] || { id: existingUser.id, username: generatedUsername };
    }

    return {
      id: existingUser.id,
      username: generatedUsername,
    };
  }

  const guardianRoleId = await ensureGuardianRoleId(client);
  const guardianPortalClinicId = await ensureGuardianPortalClinicId(client);
  const generatedUsername = await resolveUniqueGuardianUsername(client, {
    fullName: guardianName,
  });
  const generatedPasswordHash = await bcrypt.hash(buildProvisionedGuardianPassword(), 10);
  const availableEmail = await resolveGuardianUserEmail(client, guardianRecord.email);

  const createdUserResult = await client.query(
    `INSERT INTO users (
       username,
       email,
       password_hash,
       role_id,
       guardian_id,
       clinic_id,
       is_active,
       force_password_change
     )
     VALUES ($1, $2, $3, $4, $5, $6, true, true)
     RETURNING id, username`,
    [
      generatedUsername,
      availableEmail,
      generatedPasswordHash,
      guardianRoleId,
      guardianId,
      guardianPortalClinicId,
    ],
  );

  await client.query(
    `UPDATE guardians
     SET is_password_set = false,
         must_change_password = true,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [guardianId],
  );

  return createdUserResult.rows[0];
};

const synchronizeGuardianUserAccounts = async (client) => {
  const guardiansResult = await client.query(
    `SELECT id, name, email
     FROM guardians
     ORDER BY id ASC`,
  );

  for (const guardian of guardiansResult.rows) {
    await ensureGuardianUserAccount(client, guardian);
  }
};

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

const parseDateBoundary = (value, boundary = 'start') => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  if (boundary === 'end') {
    parsedDate.setHours(23, 59, 59, 999);
  } else {
    parsedDate.setHours(0, 0, 0, 0);
  }

  return parsedDate.toISOString();
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
  is_password_set: Boolean(row.is_password_set),
  guardian_id: row.guardian_id || null,
  is_guardian_account:
    Boolean(row.guardian_id) || String(row.role_name || '').toLowerCase() === 'guardian',
  role_id: row.role_id || null,
  role_name: row.role_name || null,
  display_name: row.display_name || null,
  clinic_id: row.clinic_id || null,
  facility_id: row.clinic_id || null,
  clinic_name: row.clinic_name || null,
  facility_name: row.clinic_name || null,
  user_type: 'system',
});

const getRoleNameById = async (roleId) => {
  const result = await pool.query('SELECT lower(name) AS role_name FROM roles WHERE id = $1 LIMIT 1', [
    roleId,
  ]);

  return result.rows[0]?.role_name || null;
};

const isGuardianAccountRow = (row = {}) => {
  return Boolean(row?.guardian_id) || String(row?.role_name || '').toLowerCase() === 'guardian';
};

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
       (u.password_hash IS NOT NULL) AS is_password_set,
       u.guardian_id,
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

const recordUserAuditEvent = async ({
  req,
  eventType,
  entityType,
  entityId,
  oldValues = null,
  newValues = null,
  metadata = null,
  severity = 'INFO',
}) => {
  await writeAuditLog({
    req,
    eventType,
    entityType,
    entityId,
    oldValues,
    newValues,
    metadata,
    severity,
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
router.get('/all-users', requirePermission('user:view'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get system users
    const systemUsersResult = await client.query(`
      SELECT
        u.id,
        u.username,
        u.contact,
        u.last_login,
        u.created_at,
        u.is_active,
        u.guardian_id,
        r.name as role_name,
        r.display_name,
        c.name as clinic_name,
        'system' as user_type
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN clinics c ON u.clinic_id = c.id
    `);

    // Get guardians
    const guardiansResult = await client.query(`
      SELECT
        g.id,
        COALESCE(linked_user.username, '') as username,
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
      LEFT JOIN LATERAL (
        SELECT u.username
        FROM users u
        WHERE u.guardian_id = g.id
        ORDER BY u.id DESC
        LIMIT 1
      ) linked_user ON true
    `);

    await client.query('COMMIT');

    // Combine and return both
    const allUsers = [...systemUsersResult.rows, ...guardiansResult.rows].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    res.json({ data: allUsers });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback error while fetching all users:', rollbackError);
    }
    console.error('Error fetching all users:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Get all users (basic list)
router.get('/', requireSystemAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, contact, created_at FROM users ORDER BY created_at DESC LIMIT 100',
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all guardians (including infant count)
// NOTE: Removed synchronizeGuardianUserAccounts() call as it was causing timeouts
// The synchronization should be done asynchronously via background job, not on every request
router.get('/guardians', requirePermission('user:view'), async (req, res) => {
  const client = await pool.connect();
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const requestedLimit = Math.max(1, parseInt(req.query.limit, 10) || 50);
    const view = String(req.query.view || '').trim().toLowerCase();
    const limit = view === 'lookup'
      ? Math.min(20, requestedLimit)
      : Math.min(100, requestedLimit);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const createdFrom = parseDateBoundary(req.query.created_from, 'start');
    const createdTo = parseDateBoundary(req.query.created_to, 'end');

    if (createdFrom === undefined || createdTo === undefined) {
      return res.status(400).json({
        success: false,
        error: 'created_from and created_to must be valid dates',
        data: [],
      });
    }

    const queryParams = [];
    const filterClauses = [];
    let paramIndex = 1;

    if (search) {
      filterClauses.push(`(
        bg.username ILIKE $${paramIndex}
        OR bg.name ILIKE $${paramIndex}
        OR bg.email ILIKE $${paramIndex}
        OR bg.phone ILIKE $${paramIndex}
        OR bg.address ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${search}%`);
      paramIndex += 1;
    }

    if (createdFrom) {
      filterClauses.push(`bg.created_at >= $${paramIndex}`);
      queryParams.push(createdFrom);
      paramIndex += 1;
    }

    if (createdTo) {
      filterClauses.push(`bg.created_at <= $${paramIndex}`);
      queryParams.push(createdTo);
      paramIndex += 1;
    }

    const whereClause = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';
    queryParams.push(limit, offset);

    const selectColumns = view === 'lookup'
      ? `
          bg.id,
          bg.username,
          bg.name,
          bg.phone,
          COUNT(*) OVER()::int AS filtered_total
        `
      : `
          bg.id,
          bg.username,
          bg.name,
          bg.phone,
          bg.email,
          bg.address,
          bg.relationship,
          bg.is_password_set,
          bg.must_change_password,
          bg.last_login,
          bg.is_active,
          bg.created_at,
          bg.updated_at,
          COALESCE(gic.infant_count, 0)::int AS infant_count,
          COUNT(*) OVER()::int AS filtered_total
        `;

    const joinClause = view === 'lookup'
      ? ''
      : 'LEFT JOIN guardian_infant_counts gic ON gic.guardian_id = bg.id';

    const result = await client.query(
      `
        WITH latest_linked_users AS (
          SELECT DISTINCT ON (u.guardian_id)
            u.guardian_id,
            u.username
          FROM users u
          WHERE u.guardian_id IS NOT NULL
          ORDER BY u.guardian_id, u.id DESC
        ),
        base_guardians AS (
          SELECT
            g.id,
            COALESCE(llu.username, '') AS username,
            g.name,
            g.phone,
            g.email,
            g.address,
            g.relationship,
            g.is_password_set,
            g.must_change_password,
            g.last_login,
            g.is_active,
            g.created_at,
            g.updated_at
          FROM guardians g
          LEFT JOIN latest_linked_users llu ON llu.guardian_id = g.id
        ),
        guardian_infant_counts AS (
          SELECT
            p.guardian_id,
            COUNT(*)::int AS infant_count
          FROM patients p
          WHERE p.is_active = true
          GROUP BY p.guardian_id
        )
        SELECT
          ${selectColumns}
        FROM base_guardians bg
        ${joinClause}
        ${whereClause}
        ORDER BY bg.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      queryParams,
    );

    const total = result.rows[0]?.filtered_total || 0;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: result.rows.map(({ filtered_total, ...row }) => row),
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching guardians:', error);
    res.status(500).json({ success: false, error: error.message, data: [] });
  } finally {
    client.release();
  }
});

// Create new guardian
router.post('/guardians', requirePermission('user:create'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, phone, email, address, relationship } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Name and phone are required',
      });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO guardians (
         name,
         phone,
         email,
         address,
         relationship,
         is_active,
         is_password_set,
         must_change_password
       )
       VALUES ($1, $2, $3, $4, $5, true, false, true)
       RETURNING *`,
      [name, phone, email, address, relationship],
    );

    const guardian = result.rows[0];
    const guardianUser = await ensureGuardianUserAccount(client, guardian);

    await client.query('COMMIT');

    const responsePayload = {
      ...guardian,
      username: guardianUser?.username || null,
    };

    socketService.broadcast('guardian_created', responsePayload);
    res.status(201).json({ success: true, data: responsePayload });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback error while creating guardian:', rollbackError);
    }
    console.error('Error creating guardian:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// Update guardian
router.put('/guardians/:id', requirePermission('user:update'), async (req, res) => {
  const client = await pool.connect();
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

    await client.query('BEGIN');

    const expectedUpdatedAt = parseExpectedUpdatedAt(expectedUpdatedAtRaw);
    if (expectedUpdatedAtRaw !== undefined && expectedUpdatedAt === null) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Invalid expected_updated_at timestamp',
      });
    }

    const existingResult = await client.query(
      'SELECT * FROM guardians WHERE id = $1 FOR UPDATE',
      [id],
    );

    if (existingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Guardian not found' });
    }

    const existingGuardian = existingResult.rows[0];
    const existingUpdatedAt = normalizeTimestampForCompare(existingGuardian.updated_at);

    if (expectedUpdatedAt && existingUpdatedAt && expectedUpdatedAt !== existingUpdatedAt) {
      await client.query('ROLLBACK');
      return res.status(409).json(
        buildStaleWriteConflict({
          currentRow: existingGuardian,
          expectedUpdatedAt,
        }),
      );
    }

    const result = await client.query(
      'UPDATE guardians SET name = $1, phone = $2, email = $3, address = $4, relationship = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *',
      [name, phone, email, address, relationship, id],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Guardian not found' });
    }

    const ensuredGuardianUser = await ensureGuardianUserAccount(client, result.rows[0]);

    await client.query('COMMIT');

    const responsePayload = {
      ...result.rows[0],
      username: ensuredGuardianUser?.username || null,
    };

    socketService.broadcast('guardian_updated', responsePayload);
    res.json({ success: true, data: responsePayload });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback error while updating guardian:', rollbackError);
    }
    console.error('Error updating guardian:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// Delete guardian
router.delete('/guardians/:id', requirePermission('user:delete'), async (req, res) => {
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
router.get('/guardians/:id/password', requirePermission('admin:override'), async (req, res) => {
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
router.put('/guardians/:id/password', requirePermission('admin:override'), async (req, res) => {
  const client = await pool.connect();
  let transactionCompleted = false;

  try {
    const guardianId = requireValidIdParam(res, req.params?.id, 'id');
    if (!guardianId) {
      return;
    }

    const { password, isPasswordSet, mustChangePassword } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long',
        code: 'INVALID_PASSWORD',
        field: 'password',
      });
    }

    await client.query('BEGIN');

    const existingGuardianResult = await client.query(
      `SELECT id, name, email
       FROM guardians
       WHERE id = $1
       FOR UPDATE`,
      [guardianId],
    );

    if (existingGuardianResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionCompleted = true;
      return res.status(404).json({
        success: false,
        error: 'Guardian not found',
        code: 'GUARDIAN_NOT_FOUND',
      });
    }

    const existingGuardian = existingGuardianResult.rows[0];
    const linkedGuardianUser = await ensureGuardianUserAccount(client, existingGuardian);
    const linkedUserId = parseInt(linkedGuardianUser?.id, 10);

    if (!linkedUserId || linkedUserId <= 0) {
      await client.query('ROLLBACK');
      transactionCompleted = true;
      return res.status(500).json({
        success: false,
        error: 'Guardian password reset failed because no linked guardian account could be resolved',
        code: 'GUARDIAN_LINKED_USER_NOT_FOUND',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const passwordVisibilityPayload = encryptPasswordForVisibility(password);
    const normalizedIsPasswordSet = isPasswordSet !== undefined ? Boolean(isPasswordSet) : true;
    const normalizedMustChangePassword =
      mustChangePassword !== undefined ? Boolean(mustChangePassword) : false;

    const guardianUpdateResult = await client.query(
      `UPDATE guardians
       SET password_hash = $1,
           is_password_set = $2,
           must_change_password = $3,
           password_visibility_payload = $4,
           password_visibility_updated_at = CURRENT_TIMESTAMP,
           password_visibility_updated_by = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, name, email, is_password_set, must_change_password, password_visibility_updated_at`,
      [
        hashedPassword,
        normalizedIsPasswordSet,
        normalizedMustChangePassword,
        passwordVisibilityPayload,
        req.user?.id || null,
        guardianId,
      ],
    );

    await client.query(
      `UPDATE users
       SET password_hash = $1,
           force_password_change = $2,
           password_changed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [hashedPassword, normalizedMustChangePassword, linkedUserId],
    );

    await client.query('COMMIT');
    transactionCompleted = true;

    const updatedUser = await ensureSystemUserExists(linkedUserId);
    const normalizedUser = updatedUser ? buildSystemUserResponse(updatedUser) : null;

    await logSystemUserSecurityEvent({
      req,
      eventType: securityEventService.EVENT_TYPES.PASSWORD_CHANGED,
      severity: securityEventService.SEVERITY.CRITICAL,
      targetUserId: linkedUserId,
      details: {
        action: 'guardian_password_reset',
        guardian_id: guardianId,
        target_username: linkedGuardianUser?.username || updatedUser?.username || null,
        source_context: getRequestSourceContext(req),
      },
    });

    socketService.broadcast('guardian_updated', guardianUpdateResult.rows[0]);
    if (normalizedUser) {
      socketService.broadcast('system_user_updated', normalizedUser);
    }

    return res.json({
      success: true,
      message: 'Guardian password reset successfully',
      code: 'GUARDIAN_PASSWORD_RESET',
      guardian: guardianUpdateResult.rows[0],
      user: normalizedUser,
    });
  } catch (error) {
    if (!transactionCompleted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback error while resetting guardian password:', rollbackError);
      }
    }

    console.error('Error resetting guardian password:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to reset guardian password',
      code: 'GUARDIAN_PASSWORD_RESET_FAILED',
      details: process.env.NODE_ENV === 'development' ? { message: error.message } : undefined,
    });
  } finally {
    client.release();
  }
});



// Get all system users (admin, doctor, nurse, staff)
// NOTE: Removed synchronizeGuardianUserAccounts() call as it was causing timeouts
router.get('/system-users', requirePermission('user:view'), async (req, res) => {
  const client = await pool.connect();
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const requestedRoles = String(req.query.roles || req.query.role || '')
      .split(',')
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean);
    const includeGuardians = String(req.query.include_guardians || '').trim().toLowerCase() === 'true';
    const search = String(req.query.search || '').trim();
    const clinicId = req.query.clinic_id || req.query.facility_id;
    const isActive = req.query.is_active;
    const createdFrom = parseDateBoundary(req.query.created_from, 'start');
    const createdTo = parseDateBoundary(req.query.created_to, 'end');

    if (createdFrom === undefined || createdTo === undefined) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'created_from and created_to must be valid dates',
        code: 'SYSTEM_USERS_INVALID_DATE_FILTER',
      });
    }

    const sortableColumns = {
      created_at: 'u.created_at',
      username: 'u.username',
      role_name: 'r.name',
      clinic_name: 'c.name',
      contact: 'u.contact',
      is_active: 'u.is_active',
    };
    const requestedSortField = String(req.query.sort_field || 'created_at').trim().toLowerCase();
    const sortColumn = sortableColumns[requestedSortField] || sortableColumns.created_at;
    const sortDirection = String(req.query.sort_direction || 'desc').trim().toLowerCase() === 'asc'
      ? 'ASC'
      : 'DESC';

    const queryParams = [];
    let paramIndex = 1;
    const filterClauses = [];

    if (!includeGuardians) {
      filterClauses.push(`COALESCE(u.guardian_id, 0) = 0`);
      filterClauses.push(`lower(r.name) <> 'guardian'`);
    }

    if (requestedRoles.length > 0) {
      filterClauses.push(`lower(r.name) = ANY($${paramIndex}::text[])`);
      queryParams.push(requestedRoles);
      paramIndex += 1;
    }

    if (clinicId) {
      filterClauses.push(`u.clinic_id = $${paramIndex}`);
      queryParams.push(parseInt(clinicId, 10));
      paramIndex += 1;
    }

    if (isActive !== undefined && isActive !== '') {
      filterClauses.push(`u.is_active = $${paramIndex}`);
      queryParams.push(isActive === 'true');
      paramIndex += 1;
    }

    if (search) {
      filterClauses.push(`(
        u.username ILIKE $${paramIndex}
        OR COALESCE(u.contact, '') ILIKE $${paramIndex}
        OR COALESCE(r.name, '') ILIKE $${paramIndex}
        OR COALESCE(r.display_name, '') ILIKE $${paramIndex}
        OR COALESCE(c.name, '') ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${search}%`);
      paramIndex += 1;
    }

    if (createdFrom) {
      filterClauses.push(`u.created_at >= $${paramIndex}`);
      queryParams.push(createdFrom);
      paramIndex += 1;
    }

    if (createdTo) {
      filterClauses.push(`u.created_at <= $${paramIndex}`);
      queryParams.push(createdTo);
      paramIndex += 1;
    }

    const whereClause = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';
    queryParams.push(limit, offset);

    const result = await client.query(
      `
        SELECT u.id, u.username, u.contact, u.last_login, u.created_at, u.updated_at, u.is_active,
               (u.password_hash IS NOT NULL) AS is_password_set,
               u.guardian_id,
               u.role_id, r.name as role_name, r.display_name, u.clinic_id, c.name as clinic_name,
               COUNT(*) OVER()::int as filtered_total
        FROM users u
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN clinics c ON u.clinic_id = c.id
        ${whereClause}
        ORDER BY ${sortColumn} ${sortDirection}, u.created_at DESC, u.id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      queryParams,
    );

    const total = parseInt(result.rows[0]?.filtered_total || 0, 10);
    const totalPages = Math.ceil(total / limit);

    return res.json({
      success: true,
      data: result.rows.map(({ filtered_total, ...row }) => buildSystemUserResponse(row)),
      meta: {
        count: result.rows.length,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching system users:', error);
    return respondSystemUserError(res, {
      statusCode: 500,
      error: 'Failed to fetch system users',
      code: 'SYSTEM_USERS_FETCH_FAILED',
      details: process.env.NODE_ENV === 'development' ? { message: error.message } : undefined,
    });
  } finally {
    client.release();
  }
});

// Create system user
router.post('/system-users', requirePermission('user:create'), async (req, res) => {
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

    const targetRoleName = await getRoleNameById(validation.data.role_id);
    if (!targetRoleName) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'role_id does not map to an existing role',
        code: 'INVALID_ROLE_ID',
        field: 'role_id',
      });
    }

    if (targetRoleName === 'guardian') {
      return respondSystemUserError(res, {
        statusCode: 400,
        error:
          'Guardian accounts must be created from the Guardians tab to preserve firstname.lastname username rules.',
        code: 'GUARDIAN_ACCOUNT_MANAGED_BY_GUARDIANS_MODULE',
        field: 'role_id',
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
router.put('/system-users/:id', requirePermission('user:update'), async (req, res) => {
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

    if (isGuardianAccountRow(existingUser)) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error:
          'Guardian accounts are managed from the Guardians tab. Username format is enforced automatically as firstname.lastname.',
        code: 'GUARDIAN_ACCOUNT_MANAGED_BY_GUARDIANS_MODULE',
      });
    }

    const targetRoleName = await getRoleNameById(validation.data.role_id);
    if (!targetRoleName) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'role_id does not map to an existing role',
        code: 'INVALID_ROLE_ID',
        field: 'role_id',
      });
    }

    if (targetRoleName === 'guardian') {
      return respondSystemUserError(res, {
        statusCode: 400,
        error:
          'Guardian accounts must be managed from the Guardians tab to preserve firstname.lastname username rules.',
        code: 'GUARDIAN_ACCOUNT_MANAGED_BY_GUARDIANS_MODULE',
        field: 'role_id',
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
router.delete('/system-users/:id', requirePermission('user:delete'), async (req, res) => {
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

    if (isGuardianAccountRow(existingUser)) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'Guardian account lifecycle is managed from the Guardians module',
        code: 'GUARDIAN_ACCOUNT_MANAGED_BY_GUARDIANS_MODULE',
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
router.put('/system-users/:id/toggle-active', requirePermission('admin:override'), async (req, res) => {
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

    if (isGuardianAccountRow(existingUser)) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'Guardian account activation state is managed from the Guardians module',
        code: 'GUARDIAN_ACCOUNT_MANAGED_BY_GUARDIANS_MODULE',
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
router.get('/clinics', requirePermission('system:settings'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clinics ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create clinic
router.post('/clinics', requirePermission('system:settings'), async (req, res) => {
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
router.put('/clinics/:id', requirePermission('system:settings'), async (req, res) => {
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
router.get('/roles', requirePermission('user:manage_roles'), async (req, res) => {
  try {
    const { exclude } = req.query;
    let query = 'SELECT * FROM roles';
    const params = [];

    if (exclude) {
      const excludeRoles = exclude.split(',').map(r => r.trim().toLowerCase());
      query += ' WHERE LOWER(name) != ALL($1::text[])';
      params.push(excludeRoles);
    }

    query += ' ORDER BY hierarchy_level DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create role
router.post('/roles', requirePermission('user:manage_roles'), async (req, res) => {
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
router.put('/roles/:id', requirePermission('user:manage_roles'), async (req, res) => {
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
router.get('/system-users/:id/password', requirePermission('admin:override'), async (req, res) => {
  try {
    const userId = requireValidIdParam(res, req.params?.id, 'id');
    if (!userId) {
      return;
    }

    const existingUser = await ensureSystemUserExists(userId);
    if (!existingUser) {
      return respondSystemUserError(res, {
        statusCode: 404,
        error: 'User not found',
        code: 'SYSTEM_USER_NOT_FOUND',
      });
    }

    if (isGuardianAccountRow(existingUser)) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'Guardian account password lifecycle is managed from the Guardians module',
        code: 'GUARDIAN_ACCOUNT_MANAGED_BY_GUARDIANS_MODULE',
      });
    }

    // Get user from database (without password hash)
    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);

    // For security reasons, we won't return the actual password
    // Instead, we'll return a message indicating the user exists and can be reset
    res.json({
      message: 'Password reset available for this user',
      user_id: userId,
      can_reset: true,
    });
  } catch (error) {
    return respondSystemUserError(res, {
      statusCode: 500,
      error: 'Failed to fetch system user password status',
      code: 'SYSTEM_USER_PASSWORD_STATUS_FAILED',
      details: process.env.NODE_ENV === 'development' ? { message: error.message } : undefined,
    });
  }
});

// Reset system user password (Admin only)
router.put('/system-users/:id/password', requirePermission('admin:override'), async (req, res) => {
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

    if (isGuardianAccountRow(existingUser)) {
      return respondSystemUserError(res, {
        statusCode: 400,
        error: 'Guardian account password lifecycle is managed from the Guardians module',
        code: 'GUARDIAN_ACCOUNT_MANAGED_BY_GUARDIANS_MODULE',
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
    await ensureGuardianProfileColumnsExist();
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
  const client = await pool.connect();
  try {
    await ensureGuardianProfileColumnsExist();
    const { guardianId } = req.params;
    const { name, phone, email, address, emergency_contact, emergency_phone } = req.body;

    // Validate input
    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        error: 'Name must be at least 2 characters long',
      });
    }

    await client.query('BEGIN');

    const existingGuardianResult = await client.query(
      'SELECT id FROM guardians WHERE id = $1 FOR UPDATE',
      [guardianId],
    );

    if (existingGuardianResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Guardian not found' });
    }

    const result = await client.query(
      `UPDATE guardians
       SET name = $1, phone = $2, email = $3, address = $4,
           emergency_contact = $5, emergency_phone = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, name, phone, email, address, emergency_contact, emergency_phone`,
      [name, phone, email, address, emergency_contact, emergency_phone, guardianId],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Guardian not found' });
    }

    const ensuredGuardianUser = await ensureGuardianUserAccount(client, result.rows[0]);

    await client.query('COMMIT');

    const responsePayload = {
      ...result.rows[0],
      username: ensuredGuardianUser?.username || null,
    };

    socketService.broadcast('guardian_updated', responsePayload);
    res.json({ success: true, data: responsePayload });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback error while updating guardian profile:', rollbackError);
    }
    console.error('Error updating guardian profile:', error);
    res.status(500).json({
      error: 'Profile update failed',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  } finally {
    client.release();
  }
});

// Update guardian self profile (GUARDIAN own)
router.put('/guardian/self/profile/:guardianId', async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureGuardianProfileColumnsExist();
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

    await client.query('BEGIN');

    const duplicateEmailResult = profile.email
      ? await client.query(
        'SELECT id FROM guardians WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1',
        [profile.email, requestedGuardianId],
      )
      : { rows: [] };

    if (duplicateEmailResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return respondGuardianProfileValidationError(res, {
        email: 'This email is already in use by another guardian account',
      });
    }

    const existingGuardianResult = await client.query(
      'SELECT id FROM guardians WHERE id = $1 FOR UPDATE',
      [requestedGuardianId],
    );

    if (existingGuardianResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Guardian not found',
      });
    }

    const result = await client.query(
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
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Guardian not found',
      });
    }

    const ensuredGuardianUser = await ensureGuardianUserAccount(client, result.rows[0]);

    await client.query('COMMIT');

    const responsePayload = {
      ...result.rows[0],
      username: ensuredGuardianUser?.username || null,
    };

    socketService.broadcast('guardian_updated', responsePayload);
    return res.json({
      success: true,
      data: responsePayload,
      message: 'Profile updated successfully',
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback error while updating guardian self profile:', rollbackError);
    }
    console.error('Error updating guardian self profile:', error);
    return res.status(500).json({
      success: false,
      error: 'Profile update failed',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  } finally {
    client.release();
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

    const userAccountResult = await pool.query(
      `SELECT u.id, u.username, u.guardian_id, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [userId],
    );

    if (userAccountResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingAccount = userAccountResult.rows[0];
    const isGuardianManagedUsername =
      String(existingAccount.role_name || '').toLowerCase() === 'guardian' ||
      Boolean(existingAccount.guardian_id);

    if (
      isGuardianManagedUsername &&
      typeof username === 'string' &&
      username.trim() &&
      username.trim().toLowerCase() !== String(existingAccount.username || '').trim().toLowerCase()
    ) {
      return res.status(400).json({
        error: 'Guardian usernames are system-managed and follow firstname.lastname format',
        code: 'GUARDIAN_USERNAME_MANAGED',
      });
    }

    const resolvedUsername = isGuardianManagedUsername
      ? String(existingAccount.username || '').trim()
      : String(username || '').trim();

    // Validate input
    if (!resolvedUsername || resolvedUsername.length < 3) {
      return res.status(400).json({
        error: 'Username must be at least 3 characters long',
      });
    }

    // Build update query
    const setParts = ['username = $1', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [resolvedUsername];
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
    await ensureGuardianProfileColumnsExist();
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
