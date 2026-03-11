require('./testEnv');

const redacted = (value) => {
  if (!value) {
    return '(missing)';
  }

  if (String(value).length <= 4) {
    return '****';
  }

  const suffix = String(value).slice(-4);
  return `****${suffix}`;
};

const report = {
  NODE_ENV: process.env.NODE_ENV,
  DB_HOST: process.env.DB_HOST || '(missing)',
  DB_PORT: process.env.DB_PORT || '(missing)',
  DB_NAME: process.env.DB_NAME || '(missing)',
  DB_USER: process.env.DB_USER || '(missing)',
  DB_PASSWORD: redacted(process.env.DB_PASSWORD),
  JWT_SECRET: redacted(process.env.JWT_SECRET),
  JWT_REFRESH_SECRET: redacted(process.env.JWT_REFRESH_SECRET),
  CACHE_DISABLED: process.env.CACHE_DISABLED,
  CSRF_DISABLED: process.env.CSRF_DISABLED,
};

console.log('[test-env-check] Effective test environment:');
console.log(JSON.stringify(report, null, 2));
