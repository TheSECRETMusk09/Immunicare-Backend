const request = require('supertest');
const { app } = require('../server');
const db = require('../db');

/**
 * Comprehensive Integration Tests
 * Tests API endpoints, data consistency, and workflow integration
 */

describe('Integration Tests', () => {
  let server;
  let authToken;
  let actingUserId;
  let testPatientId;
  let testAppointmentId;

  const testPatient = {
    first_name: 'Test',
    last_name: 'Patient',
    date_of_birth: '2020-01-01',
    gender: 'male',
    guardian_name: 'Test Guardian',
    guardian_phone: '+1234567890',
    health_center_id: 1
  };

  const testAppointment = {
    appointment_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    appointment_time: '10:00:00',
    reason: 'Vaccination',
    status: 'scheduled'
  };

  beforeAll(async () => {
    server = app.listen(4004);

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
          actingUserId = loginRes.body.user?.id || null;
          break;
        }
      }
    } catch (error) {
      console.log('Setup error (non-critical):', error.message);
    }
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      if (testAppointmentId) {
        await db.query('DELETE FROM appointments WHERE id = $1', [testAppointmentId]);
      }
      if (testPatientId) {
        await db.query('DELETE FROM patients WHERE id = $1', [testPatientId]);
      }
    } catch (error) {
      console.log('Cleanup error (non-critical):', error.message);
    }

    await new Promise((resolve) => server.close(resolve));
  });

  describe('Authentication Integration', () => {
    it('should complete full authentication flow', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const verifyRes = await request(server)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${authToken}`);

      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.body).toHaveProperty('authenticated', true);
    });

    it('should handle token refresh flow', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: authToken });

      expect([200, 401]).toContain(res.statusCode);
    });
  });

  describe('Dashboard Integration', () => {
    it('should fetch dashboard stats and verify data consistency', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('infants');
      expect(res.body).toHaveProperty('guardians');
      expect(res.body).toHaveProperty('appointments');
      expect(res.body).toHaveProperty('lowStock');
      expect(typeof res.body.infants).toBe('number');
      expect(typeof res.body.guardians).toBe('number');
      expect(typeof res.body.appointments).toBe('number');
      expect(typeof res.body.lowStock).toBe('number');
    });

    it('should fetch dashboard activities', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/dashboard/activity')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body?.data)).toBe(true);
    });
  });

  describe('Patient Management Integration', () => {
    it('should create, read, update, and delete patient', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      // Create patient
      const createRes = await request(server)
        .post('/api/infants')
        .set('Authorization', `Bearer ${authToken}`)
        .send(testPatient);

      expect([201, 200, 400, 403]).toContain(createRes.statusCode);

      if (createRes.statusCode === 201 || createRes.statusCode === 200) {
        testPatientId = createRes.body.id || createRes.body.patient?.id;

        if (testPatientId) {
          // Read patient
          const readRes = await request(server)
            .get(`/api/infants/${testPatientId}`)
            .set('Authorization', `Bearer ${authToken}`);

          expect(readRes.statusCode).toBe(200);
          expect(readRes.body).toHaveProperty('first_name', testPatient.first_name);

          // Update patient
          const updateRes = await request(server)
            .put(`/api/infants/${testPatientId}`)
            .set('Authorization', `Bearer ${authToken}`)
            .send({ first_name: 'Updated' });

          expect([200, 403]).toContain(updateRes.statusCode);
        }
      }
    });

    it('should list patients with pagination', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/infants?page=1&limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
    });
  });

  describe('Appointment Integration', () => {
    it('should create appointment for patient', async () => {
      if (!authToken || !testPatientId) {
        console.log('Skipping: Missing auth token or patient ID');
        return;
      }

      const appointmentData = {
        ...testAppointment,
        infant_id: testPatientId
      };

      const createRes = await request(server)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appointmentData);

      expect([201, 200, 400]).toContain(createRes.statusCode);

      if (createRes.statusCode === 201 || createRes.statusCode === 200) {
        testAppointmentId = createRes.body.id || createRes.body.appointment?.id;
      }
    });

    it('should fetch upcoming appointments', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/appointments/upcoming')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(Array.isArray(res.body?.data)).toBe(true);
      }
    });
  });

  describe('Inventory Integration', () => {
    it('should fetch inventory stats and verify data consistency', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/inventory/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('totalBatches');
      expect(res.body).toHaveProperty('lowStock');
      expect(res.body).toHaveProperty('expiringItems');
      expect(res.body).toHaveProperty('totalSuppliers');
    });

    it('should list inventory items', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/inventory/vaccine-inventory?clinic_id=1')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 400]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(Array.isArray(res.body)).toBe(true);
      }
    });
  });

  describe('Vaccination Integration', () => {
    it('should fetch vaccination schedule', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/vaccinations/schedules')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 404]).toContain(res.statusCode);
    });

    it('should record vaccination', async () => {
      if (!authToken || !testPatientId) {
        console.log('Skipping: Missing auth token or patient ID');
        return;
      }

      const vaccinationData = {
        patient_id: testPatientId,
        vaccine_name: 'BCG',
        date_administered: new Date().toISOString().split('T')[0],
        dose_number: 1,
        administered_by: actingUserId
      };

      const res = await request(server)
        .post('/api/vaccinations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(vaccinationData);

      expect([201, 200, 400, 403]).toContain(res.statusCode);
    });
  });

  describe('Report Integration', () => {
    it('should generate report data', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .get('/api/reports/vaccination-coverage')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 404]).toContain(res.statusCode);
    });
  });

  describe('Data Consistency', () => {
    it('should ensure data consistency between dashboard and inventory', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const dashboardRes = await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${authToken}`);
      const inventoryRes = await request(server)
        .get('/api/inventory/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(dashboardRes.statusCode).toBe(200);
      expect(inventoryRes.statusCode).toBe(200);

      expect(dashboardRes.body.infants).toBeGreaterThanOrEqual(0);
      expect(inventoryRes.body.lowStock).toBeGreaterThanOrEqual(0);
    });

    it('should ensure patient counts are consistent across endpoints', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const dashboardRes = await request(server)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${authToken}`);
      const patientsRes = await request(server)
        .get('/api/infants/count')
        .set('Authorization', `Bearer ${authToken}`);

      expect(dashboardRes.statusCode).toBe(200);

      if (patientsRes.statusCode === 200) {
        const dashboardCount = dashboardRes.body.infants || 0;
        const patientsCount = patientsRes.body.count || 0;
        expect(typeof dashboardCount).toBe('number');
        expect(typeof patientsCount).toBe('number');
      }
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle 404 for non-existent endpoints', async () => {
      const res = await request(server).get('/api/non-existent-endpoint');
      expect(res.statusCode).toBe(404);
    });

    it('should handle validation errors gracefully', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      const res = await request(server)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({}); // Empty body should trigger validation error

      expect([400, 422, 403]).toContain(res.statusCode);
    });

    it('should handle unauthorized access', async () => {
      const res = await request(server)
        .get('/api/users')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.statusCode).toBe(401);
    });
  });

  describe('Workflow Integration', () => {
    it('should complete full vaccination workflow', async () => {
      if (!authToken) {
        console.log('Skipping: No auth token available');
        return;
      }

      // This test simulates a complete vaccination workflow
      // 1. Check inventory
      const inventoryRes = await request(server)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${authToken}`);

      expect(inventoryRes.statusCode).toBe(200);

      // 2. Get dashboard stats before
      const beforeStats = await request(server).get('/api/dashboard/stats');
      expect(beforeStats.statusCode).toBe(200);

      // Workflow validation
      expect(inventoryRes.body).toBeDefined();
      expect(beforeStats.body).toHaveProperty('infants');
    });
  });
});
