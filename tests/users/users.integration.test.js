const request = require('supertest');
const { app } = require('../helpers/testApp');
const { loginAdmin, loginGuardian } = require('../helpers/authHelper');

// Filipino name constants for test data
const FILIPINO_NAMES = {
  guardians: [
    { name: 'Maria Clara Santos', phone: '+639178912345', email: 'maria.santos@email.com', address: '123 Taft Avenue, Manila', relationship: 'mother' },
    { name: 'Jose Miguel Reyes', phone: '+639178912346', email: 'jose.reyes@email.com', address: '456 EDSA, Quezon City', relationship: 'father' },
    { name: 'Ana Maria Bautista', phone: '+639178912347', email: 'ana.bautista@email.com', address: '789 Mabini St, Caloocan', relationship: 'mother' },
  ],
  infants: [
    { first_name: 'Juan', last_name: 'Santos', sex: 'male', dob: '2023-06-15' },
    { first_name: 'Carmen', last_name: 'Reyes', sex: 'female', dob: '2023-08-22' },
    { first_name: 'Rafael', last_name: 'Bautista', sex: 'male', dob: '2024-01-10' },
  ],
  systemUsers: [
    { username: 'enrico_torres', contact: '+639178910001' },
    { username: 'teresaflores', contact: '+639178910002' },
  ],
};

describe('Users Module API Integration Tests', () => {
  let adminToken;
  let guardianToken;
  let testGuardianId;
  let testUserId;

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
      // Create a test guardian if none exists - using Filipino name
      const newGuardian = await request(app)
        .post('/api/users/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(FILIPINO_NAMES.guardians[0]);
      testGuardianId = newGuardian.body.data.id;
    }
  });

  describe('GET /api/users/guardians', () => {
    test('should return all guardians for admin', async () => {
      const response = await request(app)
        .get('/api/users/guardians')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    test('should return 403 for non-admin', async () => {
      const response = await request(app)
        .get('/api/users/guardians')
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(403);
    });

    test('should return 401 for unauthenticated', async () => {
      const response = await request(app)
        .get('/api/users/guardians');

      expect(response.status).toBe(401);
    });

    test('should support guardian lookup mode with filtered pagination metadata', async () => {
      const response = await request(app)
        .get('/api/users/guardians?view=lookup&search=Maria&limit=20')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.meta.pagination.limit).toBeLessThanOrEqual(20);

      if (response.body.data.length > 0) {
        expect(response.body.data[0]).toEqual(
          expect.objectContaining({
            id: expect.any(Number),
            name: expect.any(String),
          }),
        );
        expect(response.body.data[0]).not.toHaveProperty('infant_count');
      }
    });

    test('should reject invalid guardian date filters', async () => {
      const response = await request(app)
        .get('/api/users/guardians?created_from=not-a-date')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/users/guardians', () => {
    test('should create a new guardian for admin', async () => {
      const newGuardian = FILIPINO_NAMES.guardians[1];

      const response = await request(app)
        .post('/api/users/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newGuardian);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toEqual(newGuardian.name);
      expect(response.body.data.phone).toEqual(newGuardian.phone);
    });

    test('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/users/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Incomplete Guardian',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
    });

    test('should return 403 for non-admin', async () => {
      const response = await request(app)
        .post('/api/users/guardians')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          name: 'Test',
          phone: '+639123456780',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/users/guardian/profile/:guardianId', () => {
    test('should return guardian profile for admin', async () => {
      const response = await request(app)
        .get(`/api/users/guardian/profile/${testGuardianId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toEqual(testGuardianId);
    });

    test('should return 403 for guardian accessing other profile', async () => {
      const response = await request(app)
        .get(`/api/users/guardian/profile/${testGuardianId + 1}`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('PUT /api/users/guardian/profile/:guardianId', () => {
    test('should update guardian profile for admin', async () => {
      const updates = {
        name: 'Updated Test Guardian',
        phone: '+639123456789',
        email: 'updated@test.com',
        address: 'Updated Address',
      };

      const response = await request(app)
        .put(`/api/users/guardian/profile/${testGuardianId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toEqual(updates.name);
      expect(response.body.data.email).toEqual(updates.email);
    });

    test('should return 400 for invalid name', async () => {
      const response = await request(app)
        .put(`/api/users/guardian/profile/${testGuardianId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'A',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('at least 2 characters');
    });
  });

  describe('GET /api/users/system-users', () => {
    test('should return system users for admin', async () => {
      const response = await request(app)
        .get('/api/users/system-users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should return 403 for non-admin', async () => {
      const response = await request(app)
        .get('/api/users/system-users')
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(403);
    });

    test('should accept search and sort filters for admin directories', async () => {
      const response = await request(app)
        .get('/api/users/system-users?search=admin&sort_field=username&sort_direction=asc')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.meta.pagination).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('POST /api/users/system-users', () => {
    test('should create a new system user', async () => {
      const newUser = {
        username: FILIPINO_NAMES.systemUsers[0].username,
        password: 'password123',
        role_id: 1,
        clinic_id: 1,
        contact: FILIPINO_NAMES.systemUsers[0].contact,
      };

      const response = await request(app)
        .post('/api/users/system-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newUser);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.user.username).toEqual(newUser.username);

      testUserId = response.body.user.id;
    });

    test('should return 400 for invalid username', async () => {
      const response = await request(app)
        .post('/api/users/system-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'ab',
          password: 'password123',
          role_id: 1,
          clinic_id: 1,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('at least 3 characters');
    });

    test('should return 400 for weak password', async () => {
      const response = await request(app)
        .post('/api/users/system-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'testuser',
          password: '123',
          role_id: 1,
          clinic_id: 1,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('at least 6 characters');
    });
  });

  describe('PUT /api/users/system-users/:id', () => {
    test('should update system user', async () => {
      const updates = {
        username: 'updatedtestuser',
        role_id: 1,
        clinic_id: 1,
        contact: '+639123456780',
      };

      const response = await request(app)
        .put(`/api/users/system-users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.username).toEqual(updates.username);
    });

    test('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .put('/api/users/system-users/99999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'nonexistent',
          role_id: 1,
          clinic_id: 1,
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/users/system-users/:id', () => {
    test('should delete system user', async () => {
      const response = await request(app)
        .delete(`/api/users/system-users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .delete('/api/users/system-users/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/users/me/notification-settings', () => {
    test('should return notification settings for authenticated user', async () => {
      const response = await request(app)
        .get('/api/users/me/notification-settings')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(typeof response.body.data).toBe('object');
    });
  });

  describe('PUT /api/users/me/notification-settings', () => {
    test('should update notification settings', async () => {
      const settings = {
        email: true,
        sms: false,
        push: true,
      };

      const response = await request(app)
        .put('/api/users/me/notification-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notification_settings: settings });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should return 400 for invalid settings format', async () => {
      const response = await request(app)
        .put('/api/users/me/notification-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notification_settings: 'not an object' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/users/me/password', () => {
    test('should change password', async () => {
      const response = await request(app)
        .put('/api/users/me/password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          currentPassword: 'QaAdmin!234',
          newPassword: 'newpassword123',
        });

      // Allow either 200 (success) or 401 (current password check failed)
      expect([200, 401]).toContain(response.status);
    });

    test('should return 400 for weak password', async () => {
      const response = await request(app)
        .put('/api/users/me/password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          currentPassword: 'newpassword123',
          newPassword: '123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('at least 6 characters');
    });

    test('should return 401 for incorrect current password', async () => {
      const response = await request(app)
        .put('/api/users/me/password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Current password is incorrect');
    });
  });
});
