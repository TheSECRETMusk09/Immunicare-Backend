/**
 * Guardian Scope Resolution Middleware
 * 
 * Unifies guardian_id resolution across all routes to fix auth scope mismatch.
 * 
 * Issue: Frontend falls back to user.id, but backend only accepts guardian_id
 * - Frontend: AuthContext.jsx:215 uses user.id fallback
 * - Backend: dashboard.js:31 requires req.user.guardian_id
 * - Working reference: users.js:25 accepts both
 * 
 * This middleware standardizes guardian scope resolution across all routes.
 */

const CANONICAL_ROLES = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  GUARDIAN: 'GUARDIAN',
};

/**
 * Resolve guardian ID from user object with fallback support
 * Supports both new tokens (guardian_id) and legacy tokens (id only)
 * 
 * @param {Object} user - User object from JWT token
 * @returns {number|null} - Guardian ID or null
 */
const resolveGuardianId = (user) => {
  if (!user) return null;
  
  // Check if user is a guardian
  const isGuardian = 
    user.role === 'GUARDIAN' || 
    user.role === CANONICAL_ROLES.GUARDIAN ||
    user.role_type === 'GUARDIAN' ||
    user.role_type === CANONICAL_ROLES.GUARDIAN ||
    user.runtime_role === 'GUARDIAN' ||
    user.runtime_role === CANONICAL_ROLES.GUARDIAN;
  
  if (!isGuardian) return null;
  
  // Try guardian_id first (new tokens)
  if (user.guardian_id !== undefined && user.guardian_id !== null) {
    const guardianId = Number.parseInt(user.guardian_id, 10);
    if (Number.isInteger(guardianId) && guardianId > 0) {
      return guardianId;
    }
  }
  
  // Fall back to id for legacy tokens
  if (user.id !== undefined && user.id !== null) {
    const userId = Number.parseInt(user.id, 10);
    if (Number.isInteger(userId) && userId > 0) {
      return userId;
    }
  }
  
  return null;
};

/**
 * Middleware to attach resolved guardian ID to request
 * Use this in routes that need guardian scope
 */
const attachGuardianScope = (req, res, next) => {
  const guardianId = resolveGuardianId(req.user);
  
  if (guardianId) {
    req.guardianId = guardianId;
    req.resolvedGuardianId = guardianId; // Alias for clarity
  }
  
  next();
};

/**
 * Middleware to require guardian scope
 * Returns 403 if guardian ID cannot be resolved
 */
const requireGuardianScope = (req, res, next) => {
  const guardianId = resolveGuardianId(req.user);
  
  if (!guardianId) {
    return res.status(403).json({
      error: 'Guardian access required',
      code: 'GUARDIAN_SCOPE_REQUIRED',
      message: 'This endpoint requires a valid guardian session. Please log in again.',
    });
  }
  
  req.guardianId = guardianId;
  req.resolvedGuardianId = guardianId;
  
  next();
};

/**
 * Get guardian ID from request (after middleware has run)
 * 
 * @param {Object} req - Express request object
 * @returns {number|null} - Guardian ID or null
 */
const getGuardianId = (req) => {
  return req.guardianId || req.resolvedGuardianId || resolveGuardianId(req.user);
};

module.exports = {
  resolveGuardianId,
  attachGuardianScope,
  requireGuardianScope,
  getGuardianId,
  CANONICAL_ROLES,
};
