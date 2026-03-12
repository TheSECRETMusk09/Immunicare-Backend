const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_BOOTSTRAP_MARKER = 'IMMUNICARE_ENV_BOOTSTRAPPED';

const getEnvFilesByPriority = (runtimeEnv) => {
  const normalizedEnv = runtimeEnv || 'development';
  const files = [
    `.env.${normalizedEnv}.local`,
    `.env.${normalizedEnv}`,
  ];

  // Keep parity with common dotenv conventions: .env.local is ignored for test.
  if (normalizedEnv !== 'test') {
    files.push('.env.local');
  }

  files.push('.env');
  return Array.from(new Set(files));
};

const loadBackendEnv = ({ baseDir = path.resolve(__dirname, '..') } = {}) => {
  if (process.env[ENV_BOOTSTRAP_MARKER] === 'true') {
    return;
  }

  const runtimeEnv = process.env.NODE_ENV || 'development';
  const envFiles = getEnvFilesByPriority(runtimeEnv);

  for (const envFile of envFiles) {
    const absolutePath = path.join(baseDir, envFile);
    if (fs.existsSync(absolutePath)) {
      dotenv.config({ path: absolutePath, override: false });
    }
  }

  process.env[ENV_BOOTSTRAP_MARKER] = 'true';
};

module.exports = loadBackendEnv;
