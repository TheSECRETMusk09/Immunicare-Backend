const request = require('supertest');
const { app } = require('../helpers/testApp');
const { loginAdmin, loginGuardian } = require('../helpers/authHelper');

describe('Infants Module API Integration Tests', () => {
  let adminToken;
  let guardianToken;
  let testGuardianId;
  let guardianProfileId;
  let testInfantId;

  beforeAll(async () => {
    // Get tokens first
    adminToken = await loginAdmin();
    const guardianLogin = await loginGuardian();
    guardianToken = guardianLogin;
    guardianProfileId = guardianLogin.response.body?.user?.guardian_id;

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
  });

  describe('GET /api/infants', () => {
    test('should return all infants for admin', async () => {
      const response = await request(app)
        .get('/api/infants')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should return 403 for non-admin', async () => {
      const response = await request(app)
        .get('/api/infants')
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(403);
    });

    test('should return 401 for unauthenticated', async () => {
      const response = await request(app)
        .get('/api/infants');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/infants/guardian/:guardianId', () => {
    test('should return guardian infants for admin', async () => {
      const response = await request(app)
        .get(`/api/infants/guardian/${testGuardianId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should return guardian infants for own guardian', async () => {
      const response = await request(app)
        .get(`/api/infants/guardian/${guardianProfileId}`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should return 403 for guardian accessing other infants', async () => {
      const otherGuardianId = testGuardianId === guardianProfileId
        ? guardianProfileId + 999
        : testGuardianId;
      const response = await request(app)
        .get(`/api/infants/guardian/${otherGuardianId}`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/infants', () => {
    test('should create a new infant for admin', async () => {
      const newInfant = {
        first_name: 'Test',
        last_name: 'Infant',
        dob: '2023-01-15',
        sex: 'male',
        guardian_id: testGuardianId,
        birth_weight: 3.5,
        birth_height: 50,
        place_of_birth: 'Test Hospital',
      };

      const response = await request(app)
        .post('/api/infants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newInfant);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.first_name).toEqual(newInfant.first_name);
      expect(response.body.data.last_name).toEqual(newInfant.last_name);

      testInfantId = response.body.data.id;
    });

    test('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/infants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          first_name: 'Incomplete',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should return 400 for invalid date of birth', async () => {
      const response = await request(app)
        .post('/api/infants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          first_name: 'Invalid',
          last_name: 'Infant',
          dob: 'invalid-date',
          sex: 'male',
          guardian_id: testGuardianId,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/infants/guardian', () => {
    test('should create a new infant for guardian', async () => {
      const newInfant = {
        first_name: 'Guardian',
        last_name: 'Infant',
        dob: '2023-02-20',
        sex: 'female',
        birth_weight: 3.2,
        birth_height: 48,
        place_of_birth: 'Community Health Center',
        purok: 'Purok 1',
        street_color: 'Son Risa St. - Pink',
      };

      const response = await request(app)
        .post('/api/infants/guardian')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send(newInfant);

      expect([200, 201]).toContain(response.status);
      expect(response.body.success).toBe(true);
      expect(response.body.data.first_name).toEqual(newInfant.first_name);
      expect(response.body.data.purok).toEqual(newInfant.purok);
      expect(response.body.data.street_color).toEqual(newInfant.street_color);
    });

    test('should reject mismatched purok and street color selections', async () => {
      const response = await request(app)
        .post('/api/infants/guardian')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          first_name: 'Invalid',
          last_name: 'Mapping',
          dob: '2023-02-21',
          sex: 'female',
          purok: 'Purok 2',
          street_color: 'Son Risa St. - Pink',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.fields.street_color).toMatch(/does not match/i);
    });

    test('should return 403 for non-guardian role', async () => {
      const newInfant = {
        first_name: 'Test',
        last_name: 'Child',
        dob: '2023-01-15',
        sex: 'male',
      };

      const response = await request(app)
        .post('/api/infants/guardian')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newInfant);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/infants/:id', () => {
    test('should return infant by ID for admin', async () => {
      const response = await request(app)
        .get(`/api/infants/${testInfantId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toEqual(testInfantId);
    });

    test('should return 404 for non-existent infant', async () => {
      const response = await request(app)
        .get('/api/infants/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/infants/:id', () => {
    test('should update infant for admin', async () => {
      const updates = {
        first_name: 'Updated',
        last_name: 'Infant',
        birth_weight: 3.8,
        birth_height: 52,
      };

      const response = await request(app)
        .put(`/api/infants/${testInfantId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.first_name).toEqual(updates.first_name);
    });

    test('should ignore control_number in payload and preserve stored value', async () => {
      const baselineResponse = await request(app)
        .get(`/api/infants/${testInfantId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(baselineResponse.status).toBe(200);
      const originalControlNumber = baselineResponse.body?.data?.control_number || null;

      const response = await request(app)
        .put(`/api/infants/${testInfantId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          first_name: 'Control',
          last_name: 'Number',
          dob: '2023-01-15',
          sex: 'male',
          control_number: 'INVALID-123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.first_name).toBe('Control');
      expect(response.body.data.control_number).toBe(originalControlNumber);

      const afterResponse = await request(app)
        .get(`/api/infants/${testInfantId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(afterResponse.status).toBe(200);
      expect(afterResponse.body.data.control_number).toBe(originalControlNumber);
    });
  });

  describe('PUT /api/infants/:id/guardian', () => {
    test('should update infant for guardian', async () => {
      // First, create an infant for the test guardian
      const createResponse = await request(app)
        .post('/api/infants/guardian')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          first_name: 'Gamma',
          last_name: 'Test',
          dob: '2023-03-10',
          sex: 'male',
          purok: 'Purok 3',
          street_color: 'M.H Del Pilar - Orange',
        });

      expect([200, 201]).toContain(createResponse.status);
      const infantId = createResponse.body.data.id;

      const updates = {
        first_name: 'Updated',
        last_name: 'Test',
        dob: '2023-03-10',
        sex: 'male',
        birth_weight: 3.6,
        birth_height: 51,
        purok: 'Purok 4',
        street_color: 'M.H Del Pilar - Green',
      };

      const updateResponse = await request(app)
        .put(`/api/infants/${infantId}/guardian`)
        .set('Authorization', `Bearer ${guardianToken}`)
        .send(updates);

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.success).toBe(true);
      expect(updateResponse.body.data.first_name).toEqual(updates.first_name);
      expect(updateResponse.body.data.purok).toEqual(updates.purok);
      expect(updateResponse.body.data.street_color).toEqual(updates.street_color);
    });

    test('should return 403 for guardian updating other infant', async () => {
      const response = await request(app)
        .put(`/api/infants/${testInfantId}/guardian`)
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          first_name: 'Unauthorized',
        });

      expect(response.status).toBe(403);
    });

    test('should ignore control_number updates for guardian-owned child', async () => {
      const uniqueSuffix = Date.now();
      const createResponse = await request(app)
        .post('/api/infants/guardian')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          first_name: `Immutable${uniqueSuffix}`,
          last_name: 'Check',
          dob: '2023-07-01',
          sex: 'female',
          purok: 'Purok 6',
          street_color: 'Dimanlig St. - White',
        });

      expect([200, 201]).toContain(createResponse.status);
      const infantId = createResponse.body.data.id;
      const originalControlNumber = createResponse.body?.data?.control_number || null;

      const updateResponse = await request(app)
        .put(`/api/infants/${infantId}/guardian`)
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          first_name: 'ImmutableUpdated',
          last_name: 'Check',
          dob: '2023-07-01',
          sex: 'female',
          control_number: 'FORCE-CHANGE-001',
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.success).toBe(true);
      expect(updateResponse.body.data.first_name).toBe('ImmutableUpdated');
      expect(updateResponse.body.data.control_number).toBe(originalControlNumber);
    });
  });

  describe('DELETE /api/infants/:id', () => {
    test('should delete infant for admin', async () => {
      // Create a test infant to delete
      const createResponse = await request(app)
        .post('/api/infants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          first_name: 'Omega',
          last_name: 'Test',
          dob: '2023-04-15',
          sex: 'female',
          guardian_id: testGuardianId,
        });

      expect(createResponse.status).toBe(201);
      const infantId = createResponse.body.data.id;

      const deleteResponse = await request(app)
        .delete(`/api/infants/${infantId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);
    });
  });

  describe('DELETE /api/infants/:id/guardian', () => {
    test('should delete infant for guardian', async () => {
      const uniqueSuffix = Date.now();
      // Create an infant for the test guardian
      const createResponse = await request(app)
        .post('/api/infants/guardian')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          first_name: `Guardian${uniqueSuffix}`,
          last_name: 'Remove',
          dob: '2023-05-20',
          sex: 'male',
          purok: 'Purok 7',
          street_color: 'Bedana / Dimanlig St. - Red',
        });

      expect([200, 201]).toContain(createResponse.status);
      const infantId = createResponse.body.data.id;

      const deleteResponse = await request(app)
        .delete(`/api/infants/${infantId}/guardian`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);
    });
  });

  describe('GET /api/infants/stats/overview', () => {
    test('should return infant statistics for admin', async () => {
      const response = await request(app)
        .get('/api/infants/stats/overview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(typeof response.body.data.totalInfants).toBe('number');
      expect(typeof response.body.data.thisMonth).toBe('number');
      expect(typeof response.body.data.bySex).toBe('object');
    });
  });

  describe('GET /api/infants/upcoming-vaccinations', () => {
    test('should return infants with upcoming vaccinations', async () => {
      const response = await request(app)
        .get('/api/infants/upcoming-vaccinations')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /api/infants/search/:query', () => {
    test('should search infants by query', async () => {
      const response = await request(app)
        .get('/api/infants/search/Test')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });
});
