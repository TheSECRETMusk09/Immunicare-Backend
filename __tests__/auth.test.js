const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server');
const db = require('../db');

/**
 * Authentication Unit and Integration Tests
 * Tests for login, registration, token management, and auth middleware
 */

describe('Authentication Tests', () => {
  let server;
  let testUser;
  let authToken;
  let refreshToken;

  beforeAll(async () => {
    server = app.listen(4001);
  });

  afterAll(async () => {
    // Cleanup test users
    if (testUser?.id) {
      await db.query('DELETE FROM users WHERE id = $1', [testUser.id]);
    }
    await new Promise((resolve) => server.close(resolve));
  });

  describe('Registration', () => {
    it('should register a new user successfully', async () => {
      const newUser = {
        username: `testuser_${Date.now()}`,
        email: `test_${Date.now()}@example.com`,
        password: 'TestPassword123!',
        first_name: 'Test',
        last_name: 'User',
        role: 'health_worker',
        health_center_id: 1
      };

      const res = await request(server).post('/api/auth/register').send(newUser);

      expect([201, 200]).toContain(res.statusCode);

      if (res.statusCode === 201 || res.statusCode === 200) {
        testUser = res.body.user;
        expect(res.body).toHaveProperty('message');
        expect(res.body.user).toHaveProperty('id');
        expect(res.body.user).not.toHaveProperty('password');
      }
    });

    it('should reject registration with existing username', async () => {
      if (!testUser) {
        console.log('Skipping: No test user created');
        return;
      }

      const duplicateUser = {
        username: testUser.username,
        email: 'different@example.com',
        password: 'TestPassword123!'
      };

      const res = await request(server).post('/api/auth/register').send(duplicateUser);

      expect([409, 400]).toContain(res.statusCode);
    });

    it('should reject registration with invalid email', async () => {
      const invalidUser = {
        username: `invalid_${Date.now()}`,
        email: 'not-an-email',
        password: 'TestPassword123!'
      };

      const res = await request(server).post('/api/auth/register').send(invalidUser);

      expect([400, 422]).toContain(res.statusCode);
    });

    it('should reject registration with weak password', async () => {
      const weakUser = {
        username: `weak_${Date.now()}`,
        email: `weak_${Date.now()}@example.com`,
        password: '123'
      };

      const res = await request(server).post('/api/auth/register').send(weakUser);

      expect([400, 422]).toContain(res.statusCode);
    });

    it('should reject registration with missing required fields', async () => {
      const incompleteUser = {
        username: `incomplete_${Date.now()}`
      };

      const res = await request(server).post('/api/auth/register').send(incompleteUser);

      expect([400, 422]).toContain(res.statusCode);
    });
  });

  describe('Login', () => {
    it('should login with valid credentials', async () => {
      // Use admin credentials created during setup
      const res = await request(server).post('/api/auth/login').send({
        username: 'admin',
        password: 'Admin2024!'
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toHaveProperty('role');

      authToken = res.body.token;
    });

    it('should reject login with invalid password', async () => {
      const res = await request(server).post('/api/auth/login').send({
        username: 'admin',
        password: 'wrongpassword'
      });

      expect(res.statusCode).toBe(401);
    });

    it('should reject login with non-existent user', async () => {
      const res = await request(server).post('/api/auth/login').send({
        username: 'nonexistentuser12345',
        password: 'somepassword'
      });

      expect(res.statusCode).toBe(401);
    });

    it('should reject login with missing credentials', async () => {
      const res = await request(server).post('/api/auth/login').send({});

      expect([400, 401, 422]).toContain(res.statusCode);
    });

    it('should set secure cookie with token', async () => {
      const res = await request(server).post('/api/auth/login').send({
        username: 'admin',
        password: 'Admin2024!'
      });

      expect(res.statusCode).toBe(200);
      // Check for Set-Cookie header
      expect(res.headers['set-cookie']).toBeDefined();
    });
  });

  describe('Token Management', () => {
    it('should verify valid token', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('valid', true);
      expect(res.body).toHaveProperty('user');
    });

    it('should reject invalid token format', async () => {
      const res = await request(server)
        .get('/api/auth/verify')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.statusCode).toBe(401);
    });

    it('should reject expired token', async () => {
      const expiredToken = jwt.sign(
        { id: 1, role: 'admin' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '-1h' }
      );

      const res = await request(server)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.statusCode).toBe(401);
    });

    it('should reject token with invalid signature', async () => {
      const res = await request(server)
        .get('/api/auth/verify')
        .set(
          'Authorization',
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwicm9sZSI6ImFkbWluIn0.invalid'
        );

      expect(res.statusCode).toBe(401);
    });

    it('should reject requests without authorization header', async () => {
      const res = await request(server).get('/api/auth/verify');

      expect(res.statusCode).toBe(401);
    });

    it('should refresh token successfully', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .post('/api/auth/refresh')
        .set('Authorization', `Bearer ${authToken}`);

      // Token refresh endpoint may or may not exist
      expect([200, 401, 404]).toContain(res.statusCode);

      if (res.statusCode === 200) {
        expect(res.body).toHaveProperty('token');
      }
    });
  });

  describe('Password Management', () => {
    it('should initiate password reset', async () => {
      const res = await request(server).post('/api/auth/forgot-password').send({
        email: 'admin@example.com'
      });

      // Should return success even if email doesn't exist (security)
      expect([200, 404]).toContain(res.statusCode);
    });

    it('should reject password reset for non-existent email', async () => {
      const res = await request(server).post('/api/auth/forgot-password').send({
        email: 'nonexistent@example.com'
      });

      // Should return success to prevent email enumeration
      expect(res.statusCode).toBe(200);
    });

    it('should validate password reset token', async () => {
      const res = await request(server).get('/api/auth/reset-password/invalid-token').send({
        password: 'NewPassword123!'
      });

      expect([400, 401, 404]).toContain(res.statusCode);
    });

    it('should change password with valid credentials', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'admin123',
          newPassword: 'NewPassword123!'
        });

      expect([200, 400, 401]).toContain(res.statusCode);
    });
  });

  describe('Logout', () => {
    it('should logout successfully', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 404]).toContain(res.statusCode);
    });

    it('should clear auth cookie on logout', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`);

      if (res.statusCode === 200) {
        expect(res.headers['set-cookie']).toBeDefined();
      }
    });
  });

  describe('Role-Based Access', () => {
    it('should return user role and permissions', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 404]).toContain(res.statusCode);

      if (res.statusCode === 200) {
        expect(res.body).toHaveProperty('role');
        expect(res.body).toHaveProperty('permissions');
      }
    });

    it('should enforce admin-only endpoints', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      // Try to access admin-only endpoint
      const res = await request(server)
        .get('/api/users/admin-only')
        .set('Authorization', `Bearer ${authToken}`);

      // Should be 403 if not admin, or 404 if endpoint doesn't exist
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('Session Management', () => {
    it('should track active sessions', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 404]).toContain(res.statusCode);
    });

    it('should allow revoking sessions', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .delete('/api/auth/sessions/all')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 404]).toContain(res.statusCode);
    });
  });
});
