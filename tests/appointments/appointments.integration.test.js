const request = require('supertest');
const { app } = require('../helpers/testApp');
const { loginAdmin, loginGuardian } = require('../helpers/authHelper');

describe('Appointments Module API Integration Tests', () => {
  let adminToken;
  let guardianToken;
  let testGuardianId;
  let testInfantId;
  let testAppointmentId;

  beforeAll(async () => {
    // Get tokens first
    adminToken = await loginAdmin();
    guardianToken = await loginGuardian();

    // Get test guardian ID from guardians list API
    const guardiansResponse = await request(app)
      .get('/api/users/guardians')
      .set('Authorization', `Bearer ${adminToken}`);

    if (guardiansResponse.body?.data?.length > 0) {
      testGuardianId = guardiansResponse.body.data[0].id;
    } else {
      // Create a test guardian if none exists
      const newGuardian = await request(app)
        .post('/api/users/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Test Guardian',
          phone: '+639123456780',
          email: 'testguardian@test.com',
          address: 'Test Address',
          relationship: 'parent',
        });
      testGuardianId = newGuardian.body.data.id;
    }

    // Create a test infant for appointment tests
    const createInfantResponse = await request(app)
      .post('/api/infants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Appointment',
        last_name: 'Test',
        dob: '2023-01-15',
        sex: 'male',
        guardian_id: testGuardianId,
      });

    testInfantId = createInfantResponse.body.data.id;
  });

  describe('GET /api/appointments', () => {
    test('should return all appointments for admin', async () => {
      const response = await request(app)
        .get('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should return guardian appointments for guardian user', async () => {
      const response = await request(app)
        .get('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should return 401 for unauthenticated', async () => {
      const response = await request(app)
        .get('/api/appointments');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/appointments', () => {
    test('should create a new appointment for admin', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const newAppointment = {
        infant_id: testInfantId,
        scheduled_date: tomorrowDate,
        type: 'Vaccination',
        duration_minutes: 30,
        notes: 'Test appointment',
        status: 'scheduled',
        location: 'Main Health Center',
      };

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newAppointment);

      expect(response.status).toBe(201);
      expect(response.body.infant_id).toEqual(testInfantId);
      expect(String(response.body.scheduled_date || '')).toContain(tomorrowDate);
      expect(response.body.type).toEqual(newAppointment.type);

      testAppointmentId = response.body.id;
    });

    test('should create a new appointment for guardian', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const newAppointment = {
        infant_id: testInfantId,
        scheduled_date: tomorrowDate,
        type: 'Check-up',
        duration_minutes: 30,
        notes: 'Guardian created appointment',
        location: 'Main Health Center',
      };

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send(newAppointment);

      expect(response.status).toBe(201);
      expect(response.body.infant_id).toEqual(testInfantId);
      expect(String(response.body.scheduled_date || '')).toContain(tomorrowDate);
    });

    test('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'Incomplete',
        });

      expect(response.status).toBe(400);
    });

    test('should return 403 for guardian creating appointment for other infant', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          infant_id: testInfantId + 1,
          scheduled_date: tomorrowDate,
          type: 'Vaccination',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/appointments/:id', () => {
    test('should return appointment by ID for admin', async () => {
      const response = await request(app)
        .get(`/api/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toEqual(testAppointmentId);
    });

    test('should return 404 for non-existent appointment', async () => {
      const response = await request(app)
        .get('/api/appointments/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/appointments/:id', () => {
    test('should update appointment for admin', async () => {
      const updates = {
        notes: 'Updated appointment notes',
        duration_minutes: 45,
        status: 'confirmed',
      };

      const response = await request(app)
        .put(`/api/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.notes).toEqual(updates.notes);
      expect(response.body.duration_minutes).toEqual(updates.duration_minutes);
    });

    test('should update appointment for guardian', async () => {
      // Create an appointment for the test guardian
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 3);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const createResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          infant_id: testInfantId,
          scheduled_date: tomorrowDate,
          type: 'Check-up',
          duration_minutes: 30,
        });

      expect(createResponse.status).toBe(201);
      const appointmentId = createResponse.body.id;

      const updates = {
        notes: 'Guardian updated notes',
        location: 'Community Health Center',
      };

      const updateResponse = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${guardianToken}`)
        .send(updates);

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.notes).toEqual(updates.notes);
    });

    test('should return 403 for guardian updating other appointment', async () => {
      const response = await request(app)
        .put(`/api/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          notes: 'Unauthorized update',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('PUT /api/appointments/:id/cancel', () => {
    test('should cancel appointment for admin', async () => {
      const response = await request(app)
        .put(`/api/appointments/${testAppointmentId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cancellation_reason: 'Test cancellation',
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toEqual('cancelled');
    });

    test('should cancel appointment for guardian', async () => {
      // Create an appointment to cancel
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 4);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const createResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          infant_id: testInfantId,
          scheduled_date: tomorrowDate,
          type: 'Cancellation Test',
        });

      expect(createResponse.status).toBe(201);
      const appointmentId = createResponse.body.id;

      const cancelResponse = await request(app)
        .put(`/api/appointments/${appointmentId}/cancel`)
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          cancellation_reason: 'Guardian cancellation',
        });

      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body.status).toEqual('cancelled');
    });
  });

  describe('PUT /api/appointments/:id/complete', () => {
    test('should complete appointment for admin', async () => {
      // Create an appointment to complete
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const createResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          infant_id: testInfantId,
          scheduled_date: tomorrowDate,
          type: 'Completion Test',
          duration_minutes: 30,
        });

      expect(createResponse.status).toBe(201);
      const appointmentId = createResponse.body.id;

      const completeResponse = await request(app)
        .put(`/api/appointments/${appointmentId}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          completion_notes: 'Appointment completed successfully',
        });

      expect(completeResponse.status).toBe(200);
      expect(completeResponse.body.status).toEqual('attended');
    });
  });

  describe('GET /api/appointments/availability/check', () => {
    test('should check appointment availability', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 7);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const response = await request(app)
        .get(`/api/appointments/availability/check?scheduled_date=${tomorrowDate}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(typeof response.body.available).toBe('boolean');
    });

    test('should return 400 for missing date', async () => {
      const response = await request(app)
        .get('/api/appointments/availability/check')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/appointments/availability/slots', () => {
    test('should return available time slots', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 7);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const response = await request(app)
        .get(`/api/appointments/availability/slots?scheduled_date=${tomorrowDate}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/appointments/stats/overview', () => {
    test('should return appointment statistics', async () => {
      const response = await request(app)
        .get('/api/appointments/stats/overview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(typeof response.body.today).toBe('number');
      expect(typeof response.body.scheduled).toBe('number');
      expect(typeof response.body.completed).toBe('number');
      expect(typeof response.body.cancelled).toBe('number');
      expect(typeof response.body.thisMonth).toBe('number');
    });
  });

  describe('GET /api/appointments/upcoming', () => {
    test('should return upcoming appointments', async () => {
      const response = await request(app)
        .get('/api/appointments/upcoming')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/appointments/types', () => {
    test('should return appointment types', async () => {
      const response = await request(app)
        .get('/api/appointments/types')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('DELETE /api/appointments/:id', () => {
    test('should delete appointment', async () => {
      // Create an appointment to delete
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 5);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const createResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          infant_id: testInfantId,
          scheduled_date: tomorrowDate,
          type: 'Deletion Test',
        });

      expect(createResponse.status).toBe(201);
      const appointmentId = createResponse.body.id;

      const deleteResponse = await request(app)
        .delete(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.message).toEqual('Appointment deleted successfully');
    });

    test('should return 404 for non-existent appointment', async () => {
      const response = await request(app)
        .delete('/api/appointments/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });
});
