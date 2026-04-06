const { getRefreshTokenFromRequest } = require("../middleware/auth");

describe("auth middleware refresh token precedence", () => {
  test("prefers the refresh token cookie over a stale request body token", () => {
    const request = {
      cookies: {
        refreshToken: "cookie-refresh-token",
      },
      body: {
        refreshToken: "stale-body-refresh-token",
      },
      headers: {},
    };

    expect(getRefreshTokenFromRequest(request)).toBe("cookie-refresh-token");
  });

  test("falls back to the request body token when no cookie is available", () => {
    const request = {
      cookies: {},
      body: {
        refreshToken: "body-refresh-token",
      },
      headers: {},
    };

    expect(getRefreshTokenFromRequest(request)).toBe("body-refresh-token");
  });
});
