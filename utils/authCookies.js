const runtimeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();

const isProductionLikeEnv = runtimeEnv === 'production' || runtimeEnv === 'hostinger';
const DEFAULT_ACCESS_TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const DEFAULT_REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeSameSite = value => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'lax' || normalized === 'none') {
    return normalized;
  }
  return null;
};

const getConfiguredSameSite = () => {
  const explicit = normalizeSameSite(process.env.AUTH_COOKIE_SAMESITE);
  if (explicit) {
    return explicit;
  }

  return isProductionLikeEnv ? 'none' : 'lax';
};

const parseDurationToMs = (value, fallbackMs) => {
  if (value === null || value === undefined || value === '') {
    return fallbackMs;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallbackMs;
  }

  const match = normalized.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) {
    return fallbackMs;
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] || 'ms';

  if (!Number.isFinite(amount) || amount <= 0) {
    return fallbackMs;
  }

  switch (unit) {
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 's':
      return amount * 1000;
    case 'ms':
    default:
      return amount;
  }
};

const getConfiguredAccessTokenMaxAge = () =>
  parseDurationToMs(process.env.JWT_ACCESS_EXPIRATION || '8h', DEFAULT_ACCESS_TOKEN_MAX_AGE_MS);

const getConfiguredRefreshTokenMaxAge = () =>
  parseDurationToMs(process.env.JWT_REFRESH_EXPIRATION || '7d', DEFAULT_REFRESH_TOKEN_MAX_AGE_MS);

const getBaseAuthCookieOptions = () => ({
  httpOnly: true,
  secure: isProductionLikeEnv,
  sameSite: getConfiguredSameSite(),
  path: '/',
});

const getAccessTokenCookieOptions = () => ({
  ...getBaseAuthCookieOptions(),
  maxAge: getConfiguredAccessTokenMaxAge(),
});

const getRefreshTokenCookieOptions = () => ({
  ...getBaseAuthCookieOptions(),
  maxAge: getConfiguredRefreshTokenMaxAge(),
});

module.exports = {
  DEFAULT_ACCESS_TOKEN_MAX_AGE_MS,
  DEFAULT_REFRESH_TOKEN_MAX_AGE_MS,
  getConfiguredAccessTokenMaxAge,
  getConfiguredRefreshTokenMaxAge,
  isProductionLikeEnv,
  getConfiguredSameSite,
  getBaseAuthCookieOptions,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
};
