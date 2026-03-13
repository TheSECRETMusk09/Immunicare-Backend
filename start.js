const requestedEnv =
  process.env.IMMUNICARE_RUNTIME_ENV ||
  process.argv[2] ||
  process.env.NODE_ENV ||
  'development';

process.env.NODE_ENV = requestedEnv;

const { startServer } = require('./server');

startServer();
