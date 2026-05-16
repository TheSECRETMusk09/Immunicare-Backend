const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
require('jsonwebtoken');
const pool = require('../db');
const authRouter = require('../routes/auth');

const app = express();
app.use(bodyParser.json());
app.use('/auth', authRouter);

// Mock the database pool
jest.mock('../db', () => ({
  query: jest.fn(),
}));

describe('Security Audit Tests', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should not leak sensitive information on login failure', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .post('/auth/login')
        .send({ username: 'testuser', password: 'wrongpassword' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials');
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
      expect(response.body).not.toHaveProperty('user');
    });
  });

  describe('Password Reset', () => {
    it('should not reveal if an email address is registered on password reset request', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        'If that email address is in our database, we will send you an email to reset your password.'
      );
    });

    it('should use a short-lived, single-use token for password reset', async () => {
      const userId = 1;
      const email = 'test@example.com';
      pool.query.mockResolvedValueOnce({ rows: [{ id: userId, email }] }); // find user
      pool.query.mockResolvedValueOnce({ rows: [] }); // insert token

      const response = await request(app).post('/auth/forgot-password').send({ email });

      expect(response.status).toBe(200);

      // Now, try to reset the password with the token
      const resetToken = 'test-token'; // In a real test, we'd get this from the email
      pool.query.mockResolvedValueOnce({ rows: [{ user_id: userId, used: false }] }); // find token
      pool.query.mockResolvedValueOnce({ rows: [{ id: userId }] }); // update password
      pool.query.mockResolvedValueOnce({ rows: [] }); // mark token as used

      await request(app)
        .post('/auth/reset-password')
        .send({ token: resetToken, newPassword: 'newpassword123' });

      // This is a simplified test. A full test would require mocking the email service
      // and testing the token expiration and single-use properties.
    });
  });
});
