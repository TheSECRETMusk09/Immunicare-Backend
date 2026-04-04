const os = require('os');
const path = require('path');

const isReadOnlyRuntime = () =>
  Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.FUNCTION_TARGET ||
      process.env.K_SERVICE,
  );

const resolveStorageRoot = (...segments) => {
  if (isReadOnlyRuntime()) {
    return path.join(os.tmpdir(), 'immunicare', ...segments);
  }

  return path.join(__dirname, '..', ...segments);
};

module.exports = {
  isReadOnlyRuntime,
  resolveStorageRoot,
};
