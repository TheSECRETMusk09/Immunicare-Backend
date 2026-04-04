const runtimeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();

const isProductionLikeEnv = runtimeEnv === 'production' || runtimeEnv === 'hostinger';

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

  // Production deployments often use a separate frontend origin and backend API origin.
  // "none" keeps auth cookies available for those cross-site refresh/logout flows.
  return isProductionLikeEnv ? 'none' : 'lax';
};

const getBaseAuthCookieOptions = () => ({
  httpOnly: true,
  secure: isProductionLikeEnv,
  sameSite: getConfiguredSameSite(),
  path: '/',
});

const getAccessTokenCookieOptions = () => ({
  ...getBaseAuthCookieOptions(),
  maxAge: 15 * 60 * 1000,
});

const getRefreshTokenCookieOptions = () => ({
  ...getBaseAuthCookieOptions(),
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

module.exports = {
  isProductionLikeEnv,
  getConfiguredSameSite,
  getBaseAuthCookieOptions,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
};
