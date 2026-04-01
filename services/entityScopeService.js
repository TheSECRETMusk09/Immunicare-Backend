const pool = require('../db');

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const resolveUserScopeIds = (user = {}) =>
  [...new Set([user?.facility_id, user?.clinic_id].map(parsePositiveInt).filter(Boolean))];

const resolvePrimaryUserScopeId = (user = {}) => resolveUserScopeIds(user)[0] || null;

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
  resolveUserScopeIds,
  resolvePrimaryUserScopeId,
  resolveGuardianClinicId,
  resolvePatientFacilityId,
};
