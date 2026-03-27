/**
 * Deprecated production migration entrypoint.
 * Delegates to the manifest-driven runner so production and local deployments
 * apply the same deterministic migration set.
 */

const requestedEnv =
  process.env.IMMUNICARE_RUNTIME_ENV ||
  process.argv[2] ||
  process.env.NODE_ENV ||
  'production';

process.env.NODE_ENV = requestedEnv;

console.warn(
  '[migrations] run-migrations-production.js is deprecated; delegating to run_migrations_manifest.js',
);

require('./run_migrations_manifest');
