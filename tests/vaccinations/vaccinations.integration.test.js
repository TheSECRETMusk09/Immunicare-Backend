const request = require('supertest');
const { app } = require('../helpers/testApp');
const { loginAdmin, loginGuardian } = require('../helpers/authHelper');

const formatVaccinationDateForGuardian = (value) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date(value));

describe('Vaccinations Module API Integration Tests', () => {
  let adminToken;
  let guardianToken;
  let testGuardianId;
  let testInfantId;
  let guardianInfantId;
  let testVaccineId;
  let testVaccinationId;
  let guardianCreatedVaccinationId;

  beforeAll(async () => {
    // Get tokens first
    adminToken = await loginAdmin();
    const guardianLogin = await loginGuardian();
    guardianToken = guardianLogin;

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

    // Create a test infant for vaccination tests
    const createInfantResponse = await request(app)
      .post('/api/infants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Vaccination',
        last_name: 'Test',
        dob: '2023-01-15',
        sex: 'male',
        guardian_id: testGuardianId,
      });

    testInfantId = createInfantResponse.body.data.id;

    const guardianInfantResponse = await request(app)
      .post('/api/infants/guardian')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        first_name: `GuardianVaccination${Date.now()}`,
        last_name: 'Owner',
        dob: '2023-01-15',
        sex: 'female',
        purok: 'Purok 1',
        street_color: 'Son Risa St. - Pink',
      });

    if (![200, 201].includes(guardianInfantResponse.status)) {
      throw new Error(`Failed to create guardian-owned infant: ${JSON.stringify(guardianInfantResponse.body)}`);
    }

    guardianInfantId = guardianInfantResponse.body.data.id;

    // Get a test vaccine from database
    const vaccinesResponse = await request(app)
      .get('/api/vaccinations/vaccines')
      .set('Authorization', `Bearer ${adminToken}`);

    testVaccineId = vaccinesResponse.body[0].id;
  });

  describe('GET /api/vaccinations', () => {
    test('should return API info', async () => {
      const response = await request(app)
        .get('/api/vaccinations')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toEqual('Vaccinations API is running');
      expect(Array.isArray(response.body.availableEndpoints)).toBe(true);
    });
  });

  describe('GET /api/vaccinations/vaccines', () => {
    test('should return all vaccines for admin', async () => {
      const response = await request(app)
        .get('/api/vaccinations/vaccines')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    test('should return vaccines for guardian', async () => {
      const response = await request(app)
        .get('/api/vaccinations/vaccines')
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/vaccinations/schedules', () => {
    test('should return vaccination schedules', async () => {
      const response = await request(app)
        .get('/api/vaccinations/schedules')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/vaccinations/batches', () => {
    test('should return vaccine batches for admin', async () => {
      const response = await request(app)
        .get('/api/vaccinations/batches')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should return 403 for non-admin', async () => {
      const response = await request(app)
        .get('/api/vaccinations/batches')
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/vaccinations/records', () => {
    test('should create a new vaccination record for admin', async () => {
      const newVaccination = {
        patient_id: guardianInfantId,
        vaccine_id: testVaccineId,
        dose_no: 1,
        admin_date: '2023-03-15',
        administered_by: 1,
        site_of_injection: 'Left Arm',
        notes: 'Test vaccination',
      };

      const response = await request(app)
        .post('/api/vaccinations/records')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newVaccination);

      testVaccinationId = response.body.id;

      expect([200, 201]).toContain(response.status);
      expect(response.body.patient_id).toEqual(guardianInfantId);
      expect(response.body.vaccine_id).toEqual(testVaccineId);
      expect(response.body.dose_no).toEqual(1);
    });

    test('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/vaccinations/records')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patient_id: testInfantId,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    test('should return 403 for non-admin', async () => {
      const response = await request(app)
        .post('/api/vaccinations/records')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          patient_id: testInfantId,
          vaccine_id: testVaccineId,
          dose_no: 1,
          admin_date: '2023-03-15',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/vaccinations/records', () => {
    test('should return all vaccination records for admin', async () => {
      const response = await request(app)
        .get('/api/vaccinations/records')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should return 403 for non-admin', async () => {
      const response = await request(app)
        .get('/api/vaccinations/records')
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/vaccinations/records/infant/:infantId', () => {
    test('should return infant vaccination records for admin', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/records/infant/${testInfantId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should return infant vaccination records for guardian', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/records/infant/${guardianInfantId}`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should return 403 for guardian accessing other infant records', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/records/infant/${testInfantId}`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/vaccinations/records/guardian-complete', () => {
    test('should allow guardian to mark an owned vaccine dose as completed', async () => {
      const response = await request(app)
        .post('/api/vaccinations/records/guardian-complete')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          patient_id: guardianInfantId,
          vaccine_id: testVaccineId,
          dose_no: 2,
          admin_date: '2023-05-15',
          source_facility: 'Community Health Center',
          notes: 'Guardian confirmed external administration',
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body.patient_id).toEqual(guardianInfantId);
      expect(response.body.vaccine_id).toEqual(testVaccineId);
      expect(response.body.dose_no).toEqual(2);
      expect(response.body.status).toEqual('completed');

      guardianCreatedVaccinationId = response.body.id;
    });

    test('should return 403 when guardian marks another child vaccine as completed', async () => {
      const response = await request(app)
        .post('/api/vaccinations/records/guardian-complete')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          patient_id: testInfantId,
          vaccine_id: testVaccineId,
          dose_no: 1,
          admin_date: '2023-03-15',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/vaccinations/:id', () => {
    test('should return vaccination by ID for admin', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/${testVaccinationId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toEqual(testVaccinationId);
    });

    test('should return vaccination by ID for guardian (own infant)', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/${testVaccinationId}`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toEqual(testVaccinationId);
    });

    test('should return 404 for non-existent vaccination', async () => {
      const response = await request(app)
        .get('/api/vaccinations/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/vaccinations/records/:id/guardian-date', () => {
    test('should allow guardian to update administered date for owned vaccination', async () => {
      const response = await request(app)
        .put(`/api/vaccinations/records/${guardianCreatedVaccinationId}/guardian-date`)
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          admin_date: '2023-05-20',
          source_facility: 'Updated Community Health Center',
        });

      expect(response.status).toBe(200);
      expect(response.body.id).toEqual(guardianCreatedVaccinationId);
      expect(formatVaccinationDateForGuardian(response.body.admin_date)).toBe('2023-05-20');
    });
  });

  describe('PUT /api/vaccinations/records/:id', () => {
    test('should update vaccination record for admin', async () => {
      const updates = {
        notes: 'Updated vaccination notes',
        site_of_injection: 'Right Arm',
      };

      const response = await request(app)
        .put(`/api/vaccinations/records/${testVaccinationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.notes).toEqual(updates.notes);
      expect(response.body.site_of_injection).toEqual(updates.site_of_injection);
    });

    test('should return 400 for no valid fields', async () => {
      const response = await request(app)
        .put(`/api/vaccinations/records/${testVaccinationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('No valid fields to update');
    });

    test('should return 404 for non-existent vaccination', async () => {
      const response = await request(app)
        .put('/api/vaccinations/records/99999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Invalid update',
        });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/vaccinations/:id', () => {
    test('should delete vaccination record for admin', async () => {
      const deleteInfantResponse = await request(app)
        .post('/api/infants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          first_name: `DeleteVaccination${Date.now()}`,
          last_name: 'Test',
          dob: '2023-01-15',
          sex: 'male',
          guardian_id: testGuardianId,
        });

      expect([200, 201]).toContain(deleteInfantResponse.status);

      const deleteInfantId = deleteInfantResponse.body.data.id;

      const createResponse = await request(app)
        .post('/api/vaccinations/records')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patient_id: deleteInfantId,
          vaccine_id: testVaccineId,
          dose_no: 2,
          admin_date: '2023-06-15',
        });

      expect([200, 201]).toContain(createResponse.status);
      const vaccinationId = createResponse.body.id;

      const deleteResponse = await request(app)
        .delete(`/api/vaccinations/${vaccinationId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.message).toEqual('Vaccination record deleted successfully');
    });

    test('should return 404 for non-existent vaccination', async () => {
      const response = await request(app)
        .delete('/api/vaccinations/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/vaccinations/schedules/infant/:infantId', () => {
    test('should return infant vaccination schedules for admin', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/schedules/infant/${testInfantId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should return infant vaccination schedules for guardian', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/schedules/infant/${guardianInfantId}`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/vaccinations/patient/:patientId', () => {
    test('should return patient vaccinations for admin', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/patient/${testInfantId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should return patient vaccinations for guardian', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/patient/${guardianInfantId}`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/vaccinations/patient/:patientId/history', () => {
    test('should return vaccination history for patient', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/patient/${testInfantId}/history`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.patient).toBeDefined();
      expect(Array.isArray(response.body.vaccinationHistory)).toBe(true);
    });
  });

  describe('GET /api/vaccinations/patient/:patientId/schedule', () => {
    test('should return vaccination schedule for patient', async () => {
      const response = await request(app)
        .get(`/api/vaccinations/patient/${testInfantId}/schedule`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.patientId).toEqual(testInfantId);
      expect(Array.isArray(response.body.vaccinationStatus)).toBe(true);
    });
  });

  describe('GET /api/vaccinations/inventory/valid', () => {
    test('should return valid vaccine inventory for admin', async () => {
      const response = await request(app)
        .get('/api/vaccinations/inventory/valid')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ clinic_id: 1 });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should fall back to the admin clinic scope when clinic_id is omitted', async () => {
      const response = await request(app)
        .get('/api/vaccinations/inventory/valid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });
});
