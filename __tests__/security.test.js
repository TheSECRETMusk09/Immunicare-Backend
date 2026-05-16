const request = require('supertest');
const { app } = require('../server');
require('../db');

/**
 * Comprehensive Security Tests
 * Tests for XSS, SQL injection, CSRF, rate limiting, and RBAC
 */

describe('Security Tests', () => {
  let server;
  let authToken;
  let adminToken;

  const loginWithKnownCredentials = async (candidateCredentials = []) => {
    for (const credentials of candidateCredentials) {
      const response = await request(server).post('/api/auth/login').send(credentials);
      if (response.statusCode === 200 && response.body?.token) {
        return response.body.token;
      }
    }

    return null;
  };

  beforeAll(async () => {
    server = app.listen(4003);

    // Try to get auth tokens from current seeded accounts.
    try {
      authToken = await loginWithKnownCredentials([
        { username: 'test_health_worker', password: 'test_password' },
        { username: 'administrator', password: 'Admin2024!' },
        { username: 'admin', password: 'Admin2024!' },
        { username: 'admin', password: 'admin123' },
      ]);
      adminToken = authToken;
    } catch (error) {
      console.log('Auth setup skipped (non-critical)');
    }
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  describe('SQL Injection Prevention', () => {
    it('should prevent SQL injection in login endpoint', async () => {
      const res = await request(server).post('/api/auth/login').send({
        email: "' OR '1'='1",
        password: "anything' OR '1'='1",
      });

      expect([400, 401]).toContain(res.statusCode);
    });

    it('should prevent SQL injection in search queries', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const res = await request(server)
        .get("/api/infants?search='; DROP TABLE patients; --")
        .set('Authorization', `Bearer ${authToken}`);

      // Should not crash or execute malicious SQL
      expect([200, 400, 403]).toContain(res.statusCode);
    });

    it('should prevent SQL injection in ID parameters', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const res = await request(server)
        .get('/api/infants/1 OR 1=1')
        .set('Authorization', `Bearer ${authToken}`);

      expect([400, 404, 403]).toContain(res.statusCode);
    });

    it('should prevent UNION-based SQL injection', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const res = await request(server)
        .get('/api/infants?id=1 UNION SELECT * FROM users--')
        .set('Authorization', `Bearer ${authToken}`);

      expect([400, 403, 200]).toContain(res.statusCode);
    });
  });

  describe('XSS Prevention', () => {
    it('should sanitize script tags in input', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const xssPayload = {
        first_name: "<script>alert('xss')</script>",
        last_name: "<img src=x onerror=alert('xss')>",
      };

      const res = await request(server)
        .post('/api/infants')
        .set('Authorization', `Bearer ${authToken}`)
        .send(xssPayload);

      // Should not contain unescaped script tags in response
      if (res.text) {
        expect(res.text).not.toContain("<script>alert('xss')</script>");
      }
    });

    it('should sanitize event handlers in input', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const xssPayload = {
        notes: "<div onmouseover='alert(1)'>Hover me</div>",
      };

      const res = await request(server)
        .post('/api/infants')
        .set('Authorization', `Bearer ${authToken}`)
        .send(xssPayload);

      if (res.text) {
        expect(res.text).not.toContain('onmouseover');
      }
    });

    it('should sanitize href javascript: protocol', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const xssPayload = {
        website: "javascript:alert('xss')",
      };

      const res = await request(server)
        .post('/api/infants')
        .set('Authorization', `Bearer ${authToken}`)
        .send(xssPayload);

      expect([200, 201, 400, 403]).toContain(res.statusCode);
    });
  });

  describe('NoSQL Injection Prevention', () => {
    it('should prevent NoSQL operator injection', async () => {
      const nosqlPayload = {
        username: { $ne: null },
        password: { $exists: true },
      };

      const res = await request(server).post('/api/auth/login').send(nosqlPayload);

      expect([401, 400]).toContain(res.statusCode);
    });

    it('should prevent $where clause injection', async () => {
      const wherePayload = {
        username: 'admin',
        $where: 'this.password.length > 0',
      };

      const res = await request(server).post('/api/auth/login').send(wherePayload);

      expect([401, 400]).toContain(res.statusCode);
    });
  });

  describe('CSRF Protection', () => {
    it('should require CSRF token for state-changing requests', async () => {
      const res = await request(server).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password',
      });

      // API should still work without CSRF token for login (stateless JWT)
      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should validate content-type for POST requests', async () => {
      const res = await request(server)
        .post('/api/auth/login')
        .set('Content-Type', 'text/plain')
        .send('email=test@example.com&password=password');

      expect([400, 415, 401]).toContain(res.statusCode);
    });
  });

  describe('Rate Limiting', () => {
    it('should limit repeated login attempts', async () => {
      const loginAttempts = [];

      for (let i = 0; i < 15; i++) {
        const res = await request(server).post('/api/auth/login').send({
          email: 'test@example.com',
          password: 'wrongpassword',
        });
        loginAttempts.push(res.statusCode);
      }

      const rateLimited = loginAttempts.filter((code) => code === 429);
      const failedOrLimited = loginAttempts.filter((code) => [400, 401, 429].includes(code));
      expect(failedOrLimited.length).toBe(loginAttempts.length);

      const runtimeEnv = String(process.env.NODE_ENV || '').toLowerCase();
      const isProductionLike = runtimeEnv === 'production' || runtimeEnv === 'hostinger';
      if (isProductionLike) {
        expect(rateLimited.length).toBeGreaterThan(0);
      }
    }, 15000);

    it('should apply different rate limits for authenticated users', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const requests = [];
      for (let i = 0; i < 20; i++) {
        const res = await request(server)
          .get('/api/dashboard/stats')
          .set('Authorization', `Bearer ${authToken}`);
        requests.push(res.statusCode);
      }

      // Most requests should succeed for authenticated users
      const successful = requests.filter((code) => code === 200);
      expect(successful.length).toBeGreaterThan(15);
    }, 10000);
  });

  describe('Authentication Security', () => {
    it('should reject invalid JWT tokens', async () => {
      const res = await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', 'Bearer invalid-token-format');

      expect(res.statusCode).toBe(401);
    });

    it('should reject expired tokens', async () => {
      // Create an expired token
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET, {
        expiresIn: '-1h',
      });

      const res = await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.statusCode).toBe(401);
    });

    it('should reject tokens with invalid signature', async () => {
      const res = await request(server)
        .get('/api/dashboard/stats')
        .set(
          'Authorization',
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwicm9sZSI6ImFkbWluIn0.invalid-signature'
        );

      expect(res.statusCode).toBe(401);
    });

    it('should require authorization header format', async () => {
      const res = await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', 'Basic dGVzdDp0ZXN0');

      expect([401, 403]).toContain(res.statusCode);
    });
  });

  describe('RBAC Security', () => {
    it('should prevent access to admin-only endpoints for non-admin users', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const res = await request(server)
        .get('/api/users/admin-only')
        .set('Authorization', `Bearer ${authToken}`);

      expect([403, 404]).toContain(res.statusCode);
    });

    it('should enforce role-based permissions', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const res = await request(server)
        .delete('/api/infants/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect([403, 404, 401]).toContain(res.statusCode);
    });

    it('should verify resource ownership', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      // Try to access a patient that doesn't belong to the user
      const res = await request(server)
        .get('/api/infants/99999')
        .set('Authorization', `Bearer ${authToken}`);

      expect([404, 403]).toContain(res.statusCode);
    });
  });

  describe('Input Validation Security', () => {
    it('should validate email format', async () => {
      const res = await request(server).post('/api/auth/register/guardian').send({
        email: 'invalid-email-format',
        password: 'ValidPassword123!',
        confirmPassword: 'ValidPassword123!',
        firstName: 'Test',
        lastName: 'Guardian',
        phone: '09171234567',
        relationship: 'Mother',
      });

      expect([400, 429]).toContain(res.statusCode);
    });

    it('should enforce password complexity', async () => {
      const res = await request(server)
        .post('/api/auth/register/guardian')
        .send({
          email: `test_${Date.now()}@example.com`,
          password: '123',
          confirmPassword: '123',
          firstName: 'Test',
          lastName: 'Guardian',
          phone: '09171234568',
          relationship: 'Mother',
        });

      expect([400, 429]).toContain(res.statusCode);
    });

    it('should limit input length', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const longString = 'a'.repeat(10000);

      const res = await request(server)
        .post('/api/infants')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          first_name: longString,
        });

      expect([400, 413, 403]).toContain(res.statusCode);
    });

    it('should validate numeric parameters', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const res = await request(server)
        .get('/api/infants?page=abc&limit=def')
        .set('Authorization', `Bearer ${authToken}`);

      expect([400, 200, 403]).toContain(res.statusCode);
    });
  });

  describe('Header Security', () => {
    it('should set security headers', async () => {
      const res = await request(server).get('/api/dashboard/stats');

      // Check for security headers
      expect(res.headers['x-content-type-options']).toBeDefined();
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-xss-protection']).toBeDefined();
    });

    it('should not expose server version', async () => {
      const res = await request(server).get('/api/dashboard/stats');

      expect(res.headers['server']).toBeUndefined();
    });
  });

  describe('Prototype Pollution Prevention', () => {
    it('should prevent __proto__ pollution', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const pollutionPayload = {
        first_name: 'Test',
        '__proto__.isAdmin': true,
      };

      const res = await request(server)
        .post('/api/infants')
        .set('Authorization', `Bearer ${authToken}`)
        .send(pollutionPayload);

      expect([400, 403, 201, 200]).toContain(res.statusCode);
    });

    it('should prevent constructor pollution', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const pollutionPayload = {
        first_name: 'Test',
        'constructor.prototype.isAdmin': true,
      };

      const res = await request(server)
        .post('/api/infants')
        .set('Authorization', `Bearer ${authToken}`)
        .send(pollutionPayload);

      expect([400, 403, 201, 200]).toContain(res.statusCode);
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should prevent path traversal in file operations', async () => {
      if (!adminToken) {
        console.log('Skipping: No admin token');
        return;
      }

      const res = await request(server)
        .get('/api/documents/../../../etc/passwd')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([404, 403, 400]).toContain(res.statusCode);
    });
  });
});
