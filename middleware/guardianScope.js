const CANONICAL_ROLES = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  GUARDIAN: 'GUARDIAN',
};

const resolveGuardianId = (user) => {
  if (!user) {
    return null;
  }
  
  const isGuardian = 
    user.role === 'GUARDIAN' || 
    user.role === CANONICAL_ROLES.GUARDIAN ||
    user.role_type === 'GUARDIAN' ||
    user.role_type === CANONICAL_ROLES.GUARDIAN ||
    user.runtime_role === 'GUARDIAN' ||
    user.runtime_role === CANONICAL_ROLES.GUARDIAN;
  
  if (!isGuardian) {
    return null;
  }
  
  if (user.guardian_id !== undefined && user.guardian_id !== null) {
    const guardianId = Number.parseInt(user.guardian_id, 10);
    if (Number.isInteger(guardianId) && guardianId > 0) {
      return guardianId;
    }
  }
  
  if (user.id !== undefined && user.id !== null) {
    const userId = Number.parseInt(user.id, 10);
    if (Number.isInteger(userId) && userId > 0) {
      return userId;
    }
  }
  
  return null;
};

const attachGuardianScope = (req, res, next) => {
  const guardianId = resolveGuardianId(req.user);
  
  if (guardianId) {
    req.guardianId = guardianId;
    req.resolvedGuardianId = guardianId;
  }
  
  next();
};

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
