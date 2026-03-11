const expectStatus = (response, expectedStatus) => {
  expect(response.status).toBe(expectedStatus);
};

const expectErrorCode = (response, expectedCode) => {
  const code = response.body?.code || response.body?.error?.code || null;
  expect(code).toBe(expectedCode);
};

const expectJsonContentType = (response) => {
  expect(String(response.headers['content-type'] || '')).toContain('application/json');
};

const expectAuthPayload = (response) => {
  expect(response.body).toHaveProperty('token');
  expect(response.body).toHaveProperty('refreshToken');
  expect(response.body).toHaveProperty('user');
  expect(response.body.user).toHaveProperty('role');
};

module.exports = {
  expectStatus,
  expectErrorCode,
  expectJsonContentType,
  expectAuthPayload,
};
