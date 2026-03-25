const { createApiAgent } = require('../helpers/testApp');
const { loginAsAdmin, loginAsGuardian, withBearer } = require('../helpers/authHelper');
const { TEST_ADMIN } = require('../setup/testDataSeeder');
const {
  expectStatus,
  expectErrorCode,
  expectJsonContentType,
  expectAuthPayload,
} = require('../helpers/assertions');
const { countRows } = require('../helpers/dbAssertions');

describe('Auth contract baseline', () => {
  let adminAgent;
  let guardianAgent;

  beforeEach(() => {
    adminAgent = createApiAgent();
    guardianAgent = createApiAgent();
  });

  test('SYSTEM_ADMIN login issues token pair and user payload', async () => {
    const { response } = await loginAsAdmin(adminAgent);

    expectStatus(response, 200);
    expectJsonContentType(response);
    expectAuthPayload(response);
    expect(response.body.user.role).toBe('SYSTEM_ADMIN');
  });

  test('GUARDIAN login issues token pair and user payload', async () => {
    const { response } = await loginAsGuardian(guardianAgent);

    expectStatus(response, 200);
    expectJsonContentType(response);
    expectAuthPayload(response);
    expect(response.body.user.role).toBe('GUARDIAN');
  });

  test('invalid credentials return INVALID_CREDENTIALS', async () => {
    const response = await createApiAgent().post('/api/auth/login').send({
      username: 'qa_admin',
      password: 'wrong-password',
    });

    expectStatus(response, 401);
    expectErrorCode(response, 'INVALID_CREDENTIALS');
  });

  test('verify endpoint rejects missing token with NO_TOKEN', async () => {
    const response = await createApiAgent().get('/api/auth/verify');

    expectStatus(response, 401);
    expectErrorCode(response, 'NO_TOKEN');
  });

  test('refresh endpoint rotates and preserves authenticated session', async () => {
    const { token: oldAccessToken } = await loginAsAdmin(adminAgent);

    const refreshResponse = await adminAgent.post('/api/auth/refresh').send({});
    expectStatus(refreshResponse, 200);
    expect(refreshResponse.body.token || refreshResponse.body.accessToken).toBeTruthy();

    const newAccessToken = refreshResponse.body.token || refreshResponse.body.accessToken;
    expect(newAccessToken).not.toEqual(oldAccessToken);

    const verifyResponse = await adminAgent
      .get('/api/auth/verify')
      .set(withBearer(newAccessToken));

    expectStatus(verifyResponse, 200);
    expect(verifyResponse.body.authenticated).toBe(true);
    expect(verifyResponse.body.user.role).toBe('SYSTEM_ADMIN');
  });

  test('admin route blocks guardian bearer token', async () => {
    const { token } = await loginAsGuardian(guardianAgent);

    const response = await guardianAgent.get('/api/users/system-users').set(withBearer(token));

    expectStatus(response, 403);
  });

  test('login stores refresh token record in database', async () => {
    await loginAsAdmin(adminAgent);

    const rows = await countRows({
      table: 'refresh_tokens',
      whereSql:
        'user_id = (SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1) AND is_revoked = false',
      params: [TEST_ADMIN.username],
    });

    expect(rows).toBeGreaterThan(0);
  });
});
