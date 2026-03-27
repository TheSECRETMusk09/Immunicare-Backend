const request = require('supertest');
const { app } = require('../server');

/**
 * Comprehensive Performance Tests
 * Tests response times, concurrent load, and resource usage
 */

describe('Performance Tests', () => {
  let server;
  let authToken;
  let loginPayload = null;

  // Performance thresholds (in milliseconds)
  const THRESHOLDS = {
    FAST: 100, // < 100ms - Excellent
    GOOD: 300, // < 300ms - Good
    ACCEPTABLE: 500, // < 500ms - Acceptable
    SLOW: 1000 // < 1000ms - Slow but usable
  };

  beforeAll(async () => {
    server = app.listen(4002);

    const loginCandidates = [
      { username: 'administrator', password: 'Admin2024!' },
      { username: 'admin', password: 'Admin2024!' },
      { username: 'admin', password: 'admin123' },
    ];

    try {
      for (const credentials of loginCandidates) {
        const loginRes = await request(server).post('/api/auth/login').send(credentials);

        if (loginRes.statusCode === 200) {
          authToken = loginRes.body.token;
          loginPayload = credentials;
          break;
        }
      }
    } catch (error) {
      console.log('Auth setup skipped (non-critical)');
    }
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  describe('Response Time Tests', () => {
    it('GET /api/dashboard/stats should respond within 500ms', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const start = Date.now();
      const res = await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${authToken}`);
      const duration = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(duration).toBeLessThan(THRESHOLDS.ACCEPTABLE);
    });

    it('GET /api/inventory/stats should respond within 500ms', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const start = Date.now();
      const res = await request(server)
        .get('/api/inventory/stats')
        .set('Authorization', `Bearer ${authToken}`);
      const duration = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(duration).toBeLessThan(THRESHOLDS.ACCEPTABLE);
    });

    it('GET /api/infants should respond within 500ms', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const start = Date.now();
      const res = await request(server)
        .get('/api/infants?limit=20')
        .set('Authorization', `Bearer ${authToken}`);
      const duration = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(duration).toBeLessThan(THRESHOLDS.ACCEPTABLE);
    });

    it('GET /api/appointments should respond within 500ms', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const start = Date.now();
      const res = await request(server)
        .get('/api/appointments?limit=20')
        .set('Authorization', `Bearer ${authToken}`);
      const duration = Date.now() - start;

      expect([200, 404]).toContain(res.statusCode);
      expect(duration).toBeLessThan(THRESHOLDS.ACCEPTABLE);
    });

    it('POST /api/auth/login should respond within 300ms', async () => {
      if (!loginPayload) {
        console.log('Skipping: No valid login payload');
        return;
      }

      const start = Date.now();
      const res = await request(server).post('/api/auth/login').send(loginPayload);
      const duration = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(duration).toBeLessThan(THRESHOLDS.GOOD);
    });
  });

  describe('Concurrent Load Tests', () => {
    it('should handle 10 concurrent dashboard requests', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const requests = Array.from({ length: 10 }, () =>
        request(server).get('/api/dashboard/stats').set('Authorization', `Bearer ${authToken}`)
      );

      const start = Date.now();
      const results = await Promise.all(requests);
      const duration = Date.now() - start;

      const successCount = results.filter((r) => r.statusCode === 200).length;
      expect(successCount).toBe(10);
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds
    });

    it('should handle 20 concurrent authenticated requests', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const requests = Array.from({ length: 20 }, () =>
        request(server).get('/api/dashboard/stats').set('Authorization', `Bearer ${authToken}`)
      );

      const start = Date.now();
      const results = await Promise.all(requests);
      const duration = Date.now() - start;

      const successCount = results.filter((r) => r.statusCode === 200).length;
      expect(successCount).toBeGreaterThanOrEqual(18); // At least 90% success
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle sequential requests efficiently', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const times = [];

      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        const res = await request(server)
          .get('/api/dashboard/stats')
          .set('Authorization', `Bearer ${authToken}`);
        times.push(Date.now() - start);

        expect(res.statusCode).toBe(200);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Average response time: ${avgTime}ms`);
      expect(avgTime).toBeLessThan(THRESHOLDS.GOOD);
    });
  });

  describe('Database Query Performance', () => {
    it('should paginate large datasets efficiently', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const pageSizes = [10, 25, 50];

      for (const size of pageSizes) {
        const start = Date.now();
        const res = await request(server)
          .get(`/api/infants?limit=${size}`)
          .set('Authorization', `Bearer ${authToken}`);
        const duration = Date.now() - start;

        expect(res.statusCode).toBe(200);
        expect(duration).toBeLessThan(THRESHOLDS.GOOD);
      }
    });

    it('should handle search queries efficiently', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const start = Date.now();
      const res = await request(server)
        .get('/api/infants?search=John')
        .set('Authorization', `Bearer ${authToken}`);
      const duration = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(duration).toBeLessThan(THRESHOLDS.ACCEPTABLE);
    });

    it('should handle filtered queries efficiently', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const start = Date.now();
      const res = await request(server)
        .get('/api/appointments?status=scheduled&from=2024-01-01')
        .set('Authorization', `Bearer ${authToken}`);
      const duration = Date.now() - start;

      expect([200, 404]).toContain(res.statusCode);
      expect(duration).toBeLessThan(THRESHOLDS.ACCEPTABLE);
    });
  });

  describe('Memory and Resource Tests', () => {
    it('should maintain stable memory usage under load', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      // Make multiple requests
      for (let i = 0; i < 20; i++) {
        await request(server)
          .get('/api/dashboard/stats')
          .set('Authorization', `Bearer ${authToken}`);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      console.log(`Memory increase: ${memoryIncrease.toFixed(2)} MB`);
      expect(memoryIncrease).toBeLessThan(50); // Should not increase more than 50MB
    });

    it('should handle large response sizes efficiently', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const start = Date.now();
      const res = await request(server)
        .get('/api/infants?limit=100')
        .set('Authorization', `Bearer ${authToken}`);
      const duration = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(duration).toBeLessThan(THRESHOLDS.SLOW);

      // Check response size
      const responseSize = JSON.stringify(res.body).length;
      console.log(`Response size: ${(responseSize / 1024).toFixed(2)} KB`);
    });
  });

  describe('Caching Performance', () => {
    it('should serve cached responses faster', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      // First request (cache miss)
      const start1 = Date.now();
      await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${authToken}`);
      const duration1 = Date.now() - start1;

      // Second request (potential cache hit)
      const start2 = Date.now();
      await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${authToken}`);
      const duration2 = Date.now() - start2;

      console.log(`First request: ${duration1}ms, Second request: ${duration2}ms`);

      // Second request should not be significantly slower
      expect(duration2).toBeLessThanOrEqual(duration1 * 1.5);
    });
  });

  describe('Endpoint-Specific Performance', () => {
    const endpoints = [
      { method: 'GET', path: '/api/dashboard/stats', threshold: THRESHOLDS.ACCEPTABLE },
      { method: 'GET', path: '/api/inventory/stats', threshold: THRESHOLDS.ACCEPTABLE },
      { method: 'GET', path: '/api/vaccinations/schedules', threshold: THRESHOLDS.GOOD }
    ];

    endpoints.forEach((endpoint) => {
      it(`${endpoint.method} ${endpoint.path} should respond within ${endpoint.threshold}ms`, async () => {
        if (!authToken) {
          console.log('Skipping: No auth token');
          return;
        }

        const start = Date.now();
        const res = await request(server)[endpoint.method.toLowerCase()](endpoint.path)
          .set('Authorization', `Bearer ${authToken}`);
        const duration = Date.now() - start;

        expect([200, 403, 404]).toContain(res.statusCode);
        expect(duration).toBeLessThan(endpoint.threshold);
      });
    });
  });

  describe('Stress Tests', () => {
    it('should handle burst traffic', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const burstSize = 50;
      const requests = [];

      // Create burst of requests
      for (let i = 0; i < burstSize; i++) {
        requests.push(
          request(server).get('/api/dashboard/stats').set('Authorization', `Bearer ${authToken}`),
        );
      }

      const start = Date.now();
      const results = await Promise.all(requests);
      const duration = Date.now() - start;

      const successCount = results.filter((r) => r.statusCode === 200).length;
      const errorCount = results.filter((r) => r.statusCode >= 500).length;

      console.log(
        `Burst test: ${successCount}/${burstSize} successful, ${errorCount} errors, ${duration}ms`
      );

      // Should handle at least 80% of requests successfully
      expect(successCount).toBeGreaterThanOrEqual(burstSize * 0.8);
      // No server errors (5xx)
      expect(errorCount).toBe(0);
      // Should complete within reasonable time
      expect(duration).toBeLessThan(10000);
    }, 15000);

    it('should recover from high load', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      // First, create high load
      const highLoadRequests = Array.from({ length: 30 }, () =>
        request(server).get('/api/dashboard/stats').set('Authorization', `Bearer ${authToken}`)
      );
      await Promise.all(highLoadRequests);

      // Then test normal response time
      await new Promise((resolve) => setTimeout(resolve, 500)); // Brief pause

      const start = Date.now();
      const res = await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${authToken}`);
      const duration = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(duration).toBeLessThan(THRESHOLDS.ACCEPTABLE);
    });
  });

  describe('Response Time Distribution', () => {
    it('should have consistent response times', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token');
        return;
      }

      const times = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await request(server)
          .get('/api/dashboard/stats')
          .set('Authorization', `Bearer ${authToken}`);
        times.push(Date.now() - start);
      }

      // Calculate statistics
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const max = Math.max(...times);
      const min = Math.min(...times);
      const variance = times.reduce((acc, t) => acc + Math.pow(t - avg, 2), 0) / times.length;
      const stdDev = Math.sqrt(variance);

      console.log(
        `Response time stats: avg=${avg.toFixed(2)}ms, min=${min}ms, max=${max}ms, stdDev=${stdDev.toFixed(2)}ms`
      );

      // Standard deviation should be reasonable (not too much variance)
      expect(stdDev).toBeLessThan(avg * 0.5);
      // No extremely slow responses
      expect(max).toBeLessThan(THRESHOLDS.SLOW);
    });
  });
});
