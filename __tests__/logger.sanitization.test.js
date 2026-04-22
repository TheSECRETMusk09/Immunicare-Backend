const logger = require('../config/logger');

const { redactString, sanitizeMetadata } = logger.__testUtils;

describe('logger sanitization guards', () => {
  test('redacts sensitive token values in plain strings', () => {
    const raw = 'Authorization: Bearer abc.def.ghi password=superSecret123';
    const redacted = redactString(raw);

    expect(redacted).toContain('Bearer [REDACTED]');
    expect(redacted).toContain('password=[REDACTED]');
    expect(redacted).not.toContain('superSecret123');
  });

  test('handles circular metadata objects without recursion overflow', () => {
    const payload = { id: 101, token: 'abc123' };
    payload.self = payload;

    const result = sanitizeMetadata(payload);

    expect(result.id).toBe(101);
    expect(result.token).toBe('[REDACTED]');
    expect(result.self).toBe('[Circular]');
  });

  test('sanitizes error objects with response payload safely', () => {
    const err = new Error('Request failed with status code 400');
    err.code = 'ERR_BAD_REQUEST';
    err.response = {
      status: 400,
      data: {
        error: 'Invalid API key',
        token: 'should-not-leak',
      },
    };
    err.response.self = err.response;
    err.config = {
      url: 'https://api.textbee.dev/api/v1/gateway/devices/123/sendSMS',
      method: 'post',
      timeout: 15000,
    };

    const result = sanitizeMetadata(err);

    expect(result.name).toBe('Error');
    expect(result.code).toBe('ERR_BAD_REQUEST');
    expect(result.responseStatus).toBe(400);
    expect(result.responseData.error).toBe('Invalid API key');
    expect(result.responseData.token).toBe('[REDACTED]');
    expect(result.requestConfig.url).toContain('textbee.dev');
  });

  test('caps deeply nested structures', () => {
    const root = {};
    let cursor = root;

    for (let index = 0; index < 20; index += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const result = sanitizeMetadata(root);

    expect(JSON.stringify(result)).toContain('[MaxDepthReached]');
  });
});
