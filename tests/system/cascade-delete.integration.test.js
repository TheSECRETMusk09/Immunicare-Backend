const request = require('supertest');
const { app } = require('../helpers/testApp');
const { loginAdmin, loginGuardian } = require('../helpers/authHelper');

describe('System-level Cascading Deletion Logic', () => {
  let adminToken;
  let guardianToken;
  let testGuardianId;

  beforeAll(async () => {
    adminToken = await loginAdmin();
    // Use a specific guardian for this test to avoid conflicts.
    const guardianResponse = await request(app)
      .post('/api/users/guardians')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Cascade Delete Test Guardian',
        phone: '+639998887777',
        email: 'cascade@test.com',
      });
    
    if (guardianResponse.body.data) {
        testGuardianId = guardianResponse.body.data.id;
    } else {
        // Fallback to getting any guardian if creation fails
        const guardians = await request(app).get('/api/users/guardians').set('Authorization', `Bearer ${adminToken}`);
        testGuardianId = guardians.body.data[0].id;
    }

    // Log in as the specific guardian for this test
    // Note: This assumes loginGuardian can handle different guardian credentials or is adapted.
    // For this test, we'll use the guardian's token to perform guardian-specific actions.
    guardianToken = await loginGuardian({ phone: '+639998887777' }); // Assuming login helper can take credentials
    if (!guardianToken && guardianResponse.body?.token) {
        guardianToken = guardianResponse.body.token;
    }
  });

  test('appointments for a deleted infant should not be returned by the guardian appointments endpoint', async () => {
    // 1. Create a new infant for our test guardian
    const infantResponse = await request(app)
      .post('/api/infants/guardian')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        first_name: 'Cascade',
        last_name: 'Delete Test',
        dob: '2024-01-01',
        sex: 'female',
        purok: 'Purok 1',
        street_color: 'Son Risa St. - Pink',
      });
    
    expect(infantResponse.status).toBe(201);
    const infantId = infantResponse.body.data.id;

    // 2. Create an appointment for this new infant
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 5);
    const appointmentDate = tomorrow.toISOString().split('T')[0];

    const appointmentResponse = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        infant_id: infantId,
        scheduled_date: appointmentDate,
        type: 'Test Appointment for Deletion',
      });
    
    expect(appointmentResponse.status).toBe(201);
    const appointmentId = appointmentResponse.body.id;

    // 3. Verify the appointment exists before deletion
    const appointmentsBeforeDelete = await request(app)
      .get(`/dashboard/guardian/${testGuardianId}/appointments`)
      .set('Authorization', `Bearer ${guardianToken}`);

    expect(appointmentsBeforeDelete.status).toBe(200);
    expect(appointmentsBeforeDelete.body.data.some(apt => apt.id === appointmentId)).toBe(true);

    // 4. Delete the infant
    const deleteInfantResponse = await request(app)
      .delete(`/api/infants/${infantId}/guardian`)
      .set('Authorization', `Bearer ${guardianToken}`);

    expect(deleteInfantResponse.status).toBe(200);
    expect(deleteInfantResponse.body.success).toBe(true);
    
    // 5. Fetch appointments again for the guardian
    const appointmentsAfterDelete = await request(app)
      .get(`/dashboard/guardian/${testGuardianId}/appointments`)
      .set('Authorization', `Bearer ${guardianToken}`);

    expect(appointmentsAfterDelete.status).toBe(200);

    // 6. Assert that the appointment for the deleted infant is NOT present
    const deletedAppointment = appointmentsAfterDelete.body.data.find(apt => apt.id === appointmentId);
    expect(deletedAppointment).toBeUndefined();

    // 7. Also assert that the infant's name from the deleted record is not present
    const foundDeletedInfantName = appointmentsAfterDelete.body.data.some(apt => apt.first_name === 'Cascade');
    expect(foundDeletedInfantName).toBe(false);
  });
});
