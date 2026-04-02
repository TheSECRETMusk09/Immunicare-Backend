const pool = require('../db');

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const mergeScopeIds = (...values) =>
  [...new Set(values.flat().map(parsePositiveInt).filter(Boolean))];

const resolveUserScopeIds = (user = {}) =>
  mergeScopeIds(user?.facility_id, user?.clinic_id);

const resolvePrimaryUserScopeId = (user = {}) => resolveUserScopeIds(user)[0] || null;

const resolveRequestedScopeIds = (query = {}) =>
  mergeScopeIds(
    query?.facility_id,
    query?.facilityId,
    query?.clinic_id,
    query?.clinicId,
  );

const resolveEffectiveScope = ({
  query = {},
  user = {},
  canonicalRole = null,
  allowSystemOverride = true,
} = {}) => {
  const userScopeIds = resolveUserScopeIds(user);
  const requestedScopeIds = resolveRequestedScopeIds(query);
  const requestedScope = String(query?.scope || '').trim().toLowerCase();
  const allowSystemScope =
    allowSystemOverride &&
    canonicalRole === 'SYSTEM_ADMIN' &&
    requestedScope === 'system';

  if (allowSystemScope) {
    return {
      scopeIds: [],
      useScope: false,
      userScopeIds,
      requestedScopeIds,
      allowSystemScope: true,
    };
  }

  if (requestedScopeIds.length > 0) {
    return {
      scopeIds: requestedScopeIds,
      useScope: true,
      userScopeIds,
      requestedScopeIds,
      allowSystemScope: false,
    };
  }

  if (userScopeIds.length > 0) {
    return {
      scopeIds: userScopeIds,
      useScope: true,
      userScopeIds,
      requestedScopeIds,
      allowSystemScope: false,
    };
  }

  return {
    scopeIds: [],
    useScope: false,
    userScopeIds,
    requestedScopeIds,
    allowSystemScope: false,
  };
};

const isScopeRequestAllowed = ({
  requestedScopeIds = [],
  userScopeIds = [],
  allowSystemScope = false,
} = {}) => {
  if (allowSystemScope || requestedScopeIds.length === 0 || userScopeIds.length === 0) {
    return true;
  }

  return requestedScopeIds.every((scopeId) => userScopeIds.includes(scopeId));
};

const resolveGuardianClinicId = async ({ guardianId, client = pool } = {}) => {
  const normalizedGuardianId = parsePositiveInt(guardianId);
  if (!normalizedGuardianId) {
    return null;
  }

  const result = await client.query(
    `
      SELECT clinic_id
      FROM guardians
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedGuardianId],
  );

  return parsePositiveInt(result.rows?.[0]?.clinic_id);
};

const resolvePatientFacilityId = async ({
  guardianId = null,
  requestedFacilityId = null,
  user = null,
  client = pool,
} = {}) => {
  const explicitFacilityId = parsePositiveInt(requestedFacilityId);
  if (explicitFacilityId) {
    return explicitFacilityId;
  }

  const guardianClinicId = await resolveGuardianClinicId({ guardianId, client });
  if (guardianClinicId) {
    return guardianClinicId;
  }

  return resolvePrimaryUserScopeId(user);
};

module.exports = {
  parsePositiveInt,
  mergeScopeIds,
  resolveUserScopeIds,
  resolvePrimaryUserScopeId,
  resolveRequestedScopeIds,
  resolveEffectiveScope,
  isScopeRequestAllowed,
  resolveGuardianClinicId,
  resolvePatientFacilityId,
};
