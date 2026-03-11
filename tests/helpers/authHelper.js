const { TEST_ADMIN, TEST_GUARDIAN } = require('../setup/testDataSeeder');

const loginThrough = async (agent, endpoint, payload) => {
  const response = await agent.post(endpoint).send(payload);

  if (![200, 201].includes(response.status)) {
    throw new Error(
      `Login failed at ${endpoint} with status ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }

  const token = response.body?.token || response.body?.accessToken || null;
  if (!token) {
    throw new Error(`No access token returned from ${endpoint}`);
  }

  return {
    response,
    token,
    user: response.body?.user || null,
  };
};

const loginAsAdmin = async (agent) => {
  return loginThrough(agent, '/api/auth/admin/login', {
    username: TEST_ADMIN.username,
    password: TEST_ADMIN.password,
    expectedRole: 'SYSTEM_ADMIN',
  });
};

const loginAsGuardian = async (agent) => {
  return loginThrough(agent, '/api/auth/guardian/login', {
    username: TEST_GUARDIAN.username,
    password: TEST_GUARDIAN.password,
    expectedRole: 'GUARDIAN',
  });
};

const withBearer = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = {
  loginAsAdmin,
  loginAsGuardian,
  withBearer,
};
