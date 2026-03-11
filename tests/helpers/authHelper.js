const { TEST_ADMIN, TEST_GUARDIAN } = require('../setup/testDataSeeder');
const request = require('supertest');
const { app } = require('./testApp');

const loginThrough = async (endpoint, payload) => {
  const response = await request(app).post(endpoint).send(payload);

  if (![200, 201].includes(response.status)) {
    throw new Error(
      `Login failed at ${endpoint} with status ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }

  const token = response.body?.token || response.body?.accessToken || null;
  if (!token) {
    throw new Error(`No access token returned from ${endpoint}`);
  }

  return token;
};

const loginAdmin = async () => {
  return loginThrough('/api/auth/admin/login', {
    username: TEST_ADMIN.username,
    password: TEST_ADMIN.password,
    expectedRole: 'SYSTEM_ADMIN',
  });
};

const loginGuardian = async () => {
  return loginThrough('/api/auth/guardian/login', {
    username: TEST_GUARDIAN.username,
    password: TEST_GUARDIAN.password,
    expectedRole: 'GUARDIAN',
  });
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
