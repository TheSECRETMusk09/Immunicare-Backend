/**
 * Database credential helpers.
 *
 * pg's SCRAM auth requires password to be a non-empty string during SASL flow.
 * This module centralizes safe normalization so all DB pools pass a stable string.
 */

const normalizeDbSecret = (rawValue, fallback = '') => {
  if (rawValue === undefined || rawValue === null) {
    return fallback;
  }

  // Handle accidentally injected objects (e.g., secrets managers returning wrapped values).
  if (typeof rawValue === 'object') {
    if (typeof rawValue.value === 'string') {
      return rawValue.value;
    }
    if (typeof rawValue.password === 'string') {
      return rawValue.password;
    }
    if (typeof rawValue.secret === 'string') {
      return rawValue.secret;
    }
    return fallback;
  }

  const normalized = String(rawValue);
  return normalized.trim();
};

const getPrimaryDbPassword = () => {
  const rawPrimaryPassword =
    process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : process.env.PGPASSWORD;

  return normalizeDbSecret(rawPrimaryPassword, '');
};

const getPrimaryDbUser = () => {
  const rawPrimaryUser = process.env.DB_USER !== undefined ? process.env.DB_USER : process.env.PGUSER;
  return normalizeDbSecret(rawPrimaryUser, '');
};

const getSecurityDbUser = () => {
  const rawSecurityUser = process.env.SECURITY_DB_USER;
  const normalizedSecurityUser = normalizeDbSecret(rawSecurityUser, '');

  if (normalizedSecurityUser) {
    return normalizedSecurityUser;
  }

  return getPrimaryDbUser();
};

const getSecurityDbPassword = () => {
  const rawSecurityPassword = process.env.SECURITY_DB_PASSWORD;
  const normalizedSecurityPassword = normalizeDbSecret(rawSecurityPassword, '');

  if (normalizedSecurityPassword) {
    return normalizedSecurityPassword;
  }

  return getPrimaryDbPassword();
};

module.exports = {
  normalizeDbSecret,
  getPrimaryDbUser,
  getPrimaryDbPassword,
  getSecurityDbUser,
  getSecurityDbPassword,
};
