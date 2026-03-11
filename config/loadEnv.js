const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_BOOTSTRAP_MARKER = 'IMMUNICARE_ENV_BOOTSTRAPPED';

const loadBackendEnv = ({ baseDir = path.resolve(__dirname, '..') } = {}) => {
  if (process.env[ENV_BOOTSTRAP_MARKER] === 'true') {
    return;
  }

  const envFiles = process.env.NODE_ENV === 'test' ? ['.env.test', '.env'] : ['.env'];

  for (const envFile of envFiles) {
    const absolutePath = path.join(baseDir, envFile);
    if (fs.existsSync(absolutePath)) {
      dotenv.config({ path: absolutePath, override: false });
    }
  }

  process.env[ENV_BOOTSTRAP_MARKER] = 'true';
};

module.exports = loadBackendEnv;
