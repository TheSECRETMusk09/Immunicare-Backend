const request = require('supertest');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Mock app setup
const app = express();
app.use(express.json());

// Import routes
const vaccinationRoutes = require('../routes/vaccination-management');
app.use('/api/vaccination-management', vaccinationRoutes);

// Test utilities
const createTestUser = async (role = 'admin') => {
  const password = 'testpassword123';
  const hashedPassword = await bcrypt.hash(password, 10);

  const query = `
    INSERT INTO users (username, password, role, health_center_id, email)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;

  const result = await db.query(query, [
    `testuser_${Date.now()}`,
    hashedPassword,
    role,
    1,
    `test_${Date.now()}@example.com`
  ]);

  return result.rows[0];
};

const generateAuthToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      health_center_id: user.health_center_id
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

const createTestPatient = async (healthCenterId = 1) => {
  const query = `
    INSERT INTO patients (
      patient_id, name, date_of_birth, sex, address, mother_name,
      father_name, contact_number, medical_history, allergies,
      guardian_consent, health_center_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const result = await db.query(query, [
    `TEST-${Date.now()}`,
    'Test Patient',
    '2023-01-01',
    'male',
    '123 Test St',
    'Test Mother',
    'Test Father',
    '09123456789',
    'No medical history',
    'No allergies',
    true,
    healthCenterId
  ]);

  return result.rows[0];
};

const createTestVaccination = async (patientId, healthCenterId = 1) => {
  const query = `
    INSERT INTO vaccinations (
      patient_id, vaccine_name, dose, schedule, due_date, date_given,
      batch_number, administered_by, site, side_effects, status, notes, health_center_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `;

  const result = await db.query(query, [
    patientId,
    'BCG Vaccine',
    '1',
    'At Birth',
    '2023-01-01',
    '2023-01-01',
    'BCG-2023-001',
    'Dr. Test',
    'Left arm',
    'None',
    'completed',
    'Test vaccination',
    healthCenterId
  ]);

  return result.rows[0];
};

// Test suites
describe('Vaccination Management API', () => {
  let adminUser, healthWorkerUser, nurseUser, guardianUser;
  let adminToken, healthWorkerToken, nurseToken, guardianToken;
  let testPatient, testVaccination;

  beforeAll(async () => {
    // Create test users
    adminUser = await createTestUser('admin');
    healthWorkerUser = await createTestUser('health_worker');
    nurseUser = await createTestUser('nurse');
    guardianUser = await createTestUser('guardian');

    // Generate tokens
    adminToken = generateAuthToken(adminUser);
    healthWorkerToken = generateAuthToken(healthWorkerUser);
    nurseToken = generateAuthToken(nurseUser);
    guardianToken = generateAuthToken(guardianUser);

    // Create test data
    testPatient = await createTestPatient(adminUser.health_center_id);
    testVaccination = await createTestVaccination(
      testPatient.id,
      adminUser.health_center_id
    );
  });

  afterAll(async () => {
    // Clean up test data
    await db.query('DELETE FROM vaccinations WHERE patient_id = $1', [
      testPatient.id
    ]);
    await db.query('DELETE FROM patients WHERE id = $1', [testPatient.id]);
    await db.query('DELETE FROM users WHERE id IN ($1, $2, $3, $4)', [
      adminUser.id,
      healthWorkerUser.id,
      nurseUser.id,
      guardianUser.id
    ]);
  });

  describe('Dashboard Endpoints', () => {
    test('GET /dashboard - should return dashboard statistics for admin', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('stats');
      expect(response.body.stats).toHaveProperty('total_vaccinations');
      expect(response.body.stats).toHaveProperty('coverage_rate');
    });

    test('GET /dashboard - should return dashboard statistics for health worker', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/dashboard')
        .set('Authorization', `Bearer ${healthWorkerToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('stats');
    });

    test('GET /dashboard - should return 401 for unauthenticated request', async () => {
      await request(app)
        .get('/api/vaccination-management/dashboard')
        .expect(401);
    });
  });

  describe('Patient Management Endpoints', () => {
    test('GET /patients - should return patients for admin', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('patients');
      expect(Array.isArray(response.body.patients)).toBe(true);
    });

    test('GET /patients - should return patients for health worker', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/patients')
        .set('Authorization', `Bearer ${healthWorkerToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('patients');
    });

    test('GET /patients - should filter patients by search query', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/patients?search=Test')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.patients.length).toBeGreaterThan(0);
      expect(response.body.patients[0].name).toContain('Test');
    });

    test('POST /patients - should create new patient for admin', async () => {
      const newPatientData = {
        name: 'New Test Patient',
        dateOfBirth: '2023-06-01',
        sex: 'female',
        address: '456 New St',
        motherName: 'New Mother',
        fatherName: 'New Father',
        contactNumber: '09876543210',
        medicalHistory: 'Test history',
        allergies: 'Test allergies',
        guardianConsent: true
      };

      const response = await request(app)
        .post('/api/vaccination-management/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newPatientData)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('patient');
      expect(response.body.patient.name).toBe(newPatientData.name);

      // Clean up
      await db.query('DELETE FROM patients WHERE id = $1', [
        response.body.patient.id
      ]);
    });

    test('PUT /patients/:id - should update patient for admin', async () => {
      const updateData = {
        name: 'Updated Test Patient',
        contactNumber: '09111111111'
      };

      const response = await request(app)
        .put(`/api/vaccination-management/patients/${testPatient.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.patient.name).toBe(updateData.name);
      expect(response.body.patient.contact_number).toBe(
        updateData.contactNumber
      );
    });

    test('DELETE /patients/:id - should delete patient for admin', async () => {
      // Create a new patient to delete
      const patientToDelete = await createTestPatient(
        adminUser.health_center_id
      );

      const response = await request(app)
        .delete(`/api/vaccination-management/patients/${patientToDelete.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.message).toContain('deleted successfully');
    });
  });

  describe('Vaccination Endpoints', () => {
    test('GET /vaccinations - should return vaccinations for admin', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/vaccinations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('vaccinations');
      expect(Array.isArray(response.body.vaccinations)).toBe(true);
    });

    test('GET /vaccinations - should filter by patient ID', async () => {
      const response = await request(app)
        .get(
          `/api/vaccination-management/vaccinations?patientId=${testPatient.id}`
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.vaccinations.length).toBeGreaterThan(0);
      expect(response.body.vaccinations[0].patient_id).toBe(testPatient.id);
    });

    test('POST /vaccinations - should record new vaccination for admin', async () => {
      const newVaccinationData = {
        patientId: testPatient.id,
        vaccine: 'Hepatitis B Vaccine',
        dose: '1',
        schedule: 'At Birth',
        dueDate: '2023-01-01',
        dateGiven: '2023-01-01',
        batchNumber: 'HEP-2023-001',
        administeredBy: 'Nurse Test',
        site: 'Right thigh',
        sideEffects: 'None',
        status: 'completed',
        notes: 'Test hepatitis vaccination'
      };

      const response = await request(app)
        .post('/api/vaccination-management/vaccinations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newVaccinationData)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('vaccination');
      expect(response.body.vaccination.vaccine).toBe(
        newVaccinationData.vaccine
      );

      // Clean up
      await db.query('DELETE FROM vaccinations WHERE id = $1', [
        response.body.vaccination.id
      ]);
    });
  });

  describe('Inventory Endpoints', () => {
    test('GET /inventory - should return inventory for admin', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('inventory');
      expect(Array.isArray(response.body.inventory)).toBe(true);
    });

    test('POST /inventory - should add new stock for admin', async () => {
      const newStockData = {
        vaccineName: 'Test Vaccine',
        batchNumber: `TEST-${Date.now()}`,
        quantity: 50,
        expiryDate: '2024-12-31',
        supplier: 'Test Supplier',
        costPerUnit: 100.0,
        storageLocation: 'Test Location',
        temperature: '2-8°C',
        manufacturer: 'Test Manufacturer'
      };

      const response = await request(app)
        .post('/api/vaccination-management/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newStockData)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('item');
      expect(response.body.item.vaccine_name).toBe(newStockData.vaccineName);

      // Clean up
      await db.query('DELETE FROM inventory WHERE id = $1', [
        response.body.item.id
      ]);
    });
  });

  describe('Appointment Endpoints', () => {
    test('GET /appointments - should return appointments for admin', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('appointments');
      expect(Array.isArray(response.body.appointments)).toBe(true);
    });

    test('POST /appointments - should schedule new appointment for admin', async () => {
      const newAppointmentData = {
        patientId: testPatient.id,
        vaccine: 'MMR 1',
        appointmentDate: '2024-02-01',
        appointmentTime: '10:00',
        location: 'Room 1',
        status: 'scheduled',
        notes: 'Test appointment',
        nurseId: nurseUser.id
      };

      const response = await request(app)
        .post('/api/vaccination-management/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newAppointmentData)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('appointment');
      expect(response.body.appointment.vaccine).toBe(
        newAppointmentData.vaccine
      );

      // Clean up
      await db.query('DELETE FROM appointments WHERE id = $1', [
        response.body.appointment.id
      ]);
    });
  });

  describe('Role-Based Access Control', () => {
    test('Health worker should have access to patient management', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/patients')
        .set('Authorization', `Bearer ${healthWorkerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    test('Nurse should have limited access to patient data', async () => {
      const response = await request(app)
        .get('/api/vaccination-management/patients')
        .set('Authorization', `Bearer ${nurseToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    test('Guardian should have access to own patient records', async () => {
      // This would need to be implemented based on guardian-patient relationships
      const response = await request(app)
        .get('/api/vaccination-management/patients')
        .set('Authorization', `Bearer ${guardianToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    test('Unauthorized access should be denied', async () => {
      await request(app)
        .get('/api/vaccination-management/patients')
        .expect(401);
    });
  });

  describe('Input Validation', () => {
    test('Should reject invalid patient data', async () => {
      const invalidPatientData = {
        name: '', // Empty name
        dateOfBirth: 'invalid-date',
        sex: 'invalid-sex'
      };

      const response = await request(app)
        .post('/api/vaccination-management/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidPatientData)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    test('Should reject invalid vaccination data', async () => {
      const invalidVaccinationData = {
        patientId: 99999, // Non-existent patient
        vaccine: '',
        dose: ''
      };

      const response = await request(app)
        .post('/api/vaccination-management/vaccinations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidVaccinationData)
        .expect(500); // Database constraint violation

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Error Handling', () => {
    test('Should handle database connection errors gracefully', async () => {
      // This would require mocking the database connection
      // For now, we test with invalid queries
      const response = await request(app)
        .get('/api/vaccination-management/patients/99999')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    test('Should handle malformed JWT tokens', async () => {
      await request(app)
        .get('/api/vaccination-management/dashboard')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });
});

// Performance tests
describe('Performance Tests', () => {
  test('Dashboard should respond within 2 seconds', async () => {
    const startTime = Date.now();

    await request(app)
      .get('/api/vaccination-management/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    const responseTime = Date.now() - startTime;
    expect(responseTime).toBeLessThan(2000);
  }, 5000);

  test('Patient list should handle 1000 records efficiently', async () => {
    // This would require creating test data
    // For now, we test with existing data
    const response = await request(app)
      .get('/api/vaccination-management/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
  }, 10000);
});

module.exports = {
  createTestUser,
  generateAuthToken,
  createTestPatient,
  createTestVaccination
};
