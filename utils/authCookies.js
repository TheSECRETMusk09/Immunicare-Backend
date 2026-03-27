const runtimeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();

const isProductionLikeEnv = runtimeEnv === 'production' || runtimeEnv === 'hostinger';

const getBaseAuthCookieOptions = () => ({
  httpOnly: true,
  secure: isProductionLikeEnv,
  sameSite: isProductionLikeEnv ? 'strict' : 'lax',
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
  getBaseAuthCookieOptions,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
};
