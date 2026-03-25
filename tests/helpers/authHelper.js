const { TEST_ADMIN, TEST_GUARDIAN } = require('../setup/testDataSeeder');
const request = require('supertest');
const { app } = require('./testApp');

const buildAuthResult = (response) => {
  const token = response.body?.token || response.body?.accessToken || null;
  const refreshToken = response.body?.refreshToken || null;

  if (!token) {
    throw new Error('No access token returned from login response');
  }

  return {
    token,
    accessToken: token,
    refreshToken,
    response,
    toString() {
      return token;
    },
    valueOf() {
      return token;
    },
    [Symbol.toPrimitive]() {
      return token;
    },
  };
};

const loginThrough = async (endpoint, payload, client = null) => {
  const requester = client || request(app);
  const response = await requester.post(endpoint).send(payload);

  if (![200, 201].includes(response.status)) {
    throw new Error(
      `Login failed at ${endpoint} with status ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }

  return buildAuthResult(response);
};

const loginAdmin = async (client = null) => {
  return loginThrough('/api/auth/admin/login', {
    username: TEST_ADMIN.username,
    password: TEST_ADMIN.password,
    expectedRole: 'SYSTEM_ADMIN',
  }, client);
};

const loginGuardian = async (client = null) => {
  return loginThrough('/api/auth/guardian/login', {
    username: TEST_GUARDIAN.username,
    password: TEST_GUARDIAN.password,
    expectedRole: 'GUARDIAN',
  }, client);
};

const loginAsAdmin = loginAdmin;
const loginAsGuardian = loginGuardian;

const withBearer = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = {
  loginAdmin,
  loginGuardian,
  loginAsAdmin,
  loginAsGuardian,
  withBearer,
};
