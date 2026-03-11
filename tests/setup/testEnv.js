const path = require('path');
const loadBackendEnv = require('../../config/loadEnv');

process.env.NODE_ENV = 'test';

process.env.CACHE_DISABLED = process.env.CACHE_DISABLED || 'true';
process.env.CSRF_DISABLED = process.env.CSRF_DISABLED || 'true';
process.env.DB_SUPPRESS_POOL_LOGS = process.env.DB_SUPPRESS_POOL_LOGS || 'true';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.SECURITY_DB_ENABLED = process.env.SECURITY_DB_ENABLED || 'false';

loadBackendEnv({ baseDir: path.resolve(__dirname, '../../') });

const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
const unsafeOverride = process.env.IMMUNICARE_ALLOW_UNSAFE_TEST_DB === 'true';

if (!unsafeOverride && !dbName.includes('test')) {
  throw new Error(
    'Unsafe test database configuration detected. Set DB_NAME in backend/.env.test to an isolated test DB (must include "test"), or explicitly bypass with IMMUNICARE_ALLOW_UNSAFE_TEST_DB=true.',
  );
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret';
}

if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
}
