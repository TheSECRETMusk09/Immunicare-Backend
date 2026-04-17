describe('sessionService timeout configuration', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('interprets bare env duration values as minutes for the 8-hour window', () => {
    process.env = {
      ...originalEnv,
      SESSION_TIMEOUT: '480',
      ABSOLUTE_SESSION_TIMEOUT: '480',
    };

    jest.doMock('../db', () => ({
      query: jest.fn(),
    }));

    const sessionService = require('../services/sessionService');

    expect(sessionService.SESSION_TIMEOUT).toBe(480 * 60 * 1000);
    expect(sessionService.ABSOLUTE_TIMEOUT).toBe(480 * 60 * 1000);
  });

  test('slides the session expiry forward when activity is recorded', async () => {
    process.env = {
      ...originalEnv,
      SESSION_TIMEOUT: '480',
      ABSOLUTE_SESSION_TIMEOUT: '480',
    };

    const query = jest.fn().mockResolvedValue({ rowCount: 1 });
    jest.doMock('../db', () => ({
      query,
    }));

    const sessionService = require('../services/sessionService');

    await sessionService.updateSessionActivity('session-token-123');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("expires_at = NOW() + ($2 * INTERVAL '1 second')"),
      ['session-token-123', 8 * 60 * 60],
    );
  });
});
