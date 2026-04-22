const request = require('supertest');
const pool = require('../../db');
const { app } = require('../helpers/testApp');
const { loginAdmin, loginGuardian } = require('../helpers/authHelper');
const { getHolidayInfo } = require('../../config/holidays');

describe('Appointments Module API Integration Tests', () => {
  let adminToken;
  let guardianToken;
  let testGuardianId;
  let testInfantId;
  let guardianInfantId;
  let guardianReadyInfantId;
  let testAppointmentId;
  let guardianScheduleVaccineId;

  const collectionFrom = (body) => (Array.isArray(body) ? body : body?.data || []);
  const toManilaDateKey = (value) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date(value));
  const appointmentDateTime = (date, time = '09:00:00') => `${date}T${time}`;
  const futureBusinessDate = (businessDaysAhead = 1) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    let added = 0;

    while (added < businessDaysAhead) {
      date.setDate(date.getDate() + 1);
      const day = date.getDay();
      const holiday = getHolidayInfo(date);
      if (day !== 0 && day !== 6 && !holiday) {
        added += 1;
      }
    }

    return toManilaDateKey(date);
  };

  const futureHolidayDate = () => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);

    for (let dayOffset = 0; dayOffset < 730; dayOffset += 1) {
      date.setDate(date.getDate() + 1);
      const holiday = getHolidayInfo(date);

      if (holiday && date.getDay() !== 0 && date.getDay() !== 6) {
        return {
          dateKey: toManilaDateKey(date),
          holiday,
        };
      }
    }

    throw new Error('Unable to find a future Philippine holiday for the test suite');
  };

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

    const uniqueSuffix = Date.now();
    const guardianInfantResponse = await request(app)
      .post('/api/infants/guardian')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        first_name: `Guardian${uniqueSuffix}`,
        last_name: 'Appointment',
        dob: '2023-02-18',
        sex: 'female',
        purok: 'Purok 1',
        street_color: 'Son Risa St. - Pink',
      });

    if (![200, 201].includes(guardianInfantResponse.status)) {
      throw new Error(`Failed to create guardian-owned infant: ${JSON.stringify(guardianInfantResponse.body)}`);
    }

    guardianInfantId = guardianInfantResponse.body.data.id;

    const readySuffix = Date.now() + 1;
    const guardianReadyInfantResponse = await request(app)
      .post('/api/infants/guardian')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        first_name: `GuardianReady${readySuffix}`,
        last_name: 'Appointment',
        dob: '2023-02-19',
        sex: 'female',
        purok: 'Purok 1',
        street_color: 'Son Risa St. - Pink',
      });

    if (![200, 201].includes(guardianReadyInfantResponse.status)) {
      throw new Error(`Failed to create guardian-ready infant: ${JSON.stringify(guardianReadyInfantResponse.body)}`);
    }

    guardianReadyInfantId = guardianReadyInfantResponse.body.data.id;

    const vaccineCode = `TEST_GUARD_APPT_${Date.now()}`;
    const vaccineInsertResult = await pool.query(
      `
        INSERT INTO vaccines (code, name, manufacturer, doses_required, is_active)
        VALUES ($1, $2, 'Test Manufacturer', 1, true)
        RETURNING id
      `,
      [vaccineCode, `Guardian Appointment Vaccine ${vaccineCode}`],
    );

    guardianScheduleVaccineId = vaccineInsertResult.rows[0].id;

    await pool.query(
      `
        INSERT INTO vaccination_schedules (
          vaccine_id,
          vaccine_name,
          vaccine_code,
          dose_number,
          total_doses,
          age_in_months,
          minimum_age_days,
          is_active
        )
        VALUES ($1, $2, $3, 1, 1, 0, 0, true)
      `,
      [
        guardianScheduleVaccineId,
        `Guardian Appointment Vaccine ${vaccineCode}`,
        vaccineCode,
      ],
    );
  });

  describe('GET /api/appointments', () => {
    test('should return all appointments for admin', async () => {
      const response = await request(app)
        .get('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(collectionFrom(response.body))).toBe(true);
    });

    test('should return guardian appointments for guardian user', async () => {
      const response = await request(app)
        .get('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(collectionFrom(response.body))).toBe(true);
    });

    test('should return cancelled appointment by infant name, full name, and control number without date/status filters', async () => {
      const christianInfantResponse = await request(app)
        .post('/api/infants/guardian')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          first_name: 'Christian',
          last_name: 'Samorin',
          dob: '2023-03-20',
          sex: 'male',
          purok: 'Purok 1',
          street_color: 'Son Risa St. - Pink',
        });

      expect([200, 201]).toContain(christianInfantResponse.status);
      const christianInfantId = christianInfantResponse.body?.data?.id;
      expect(Number.isInteger(Number.parseInt(christianInfantId, 10))).toBe(true);

      const createdAppointmentResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          infant_id: christianInfantId,
          scheduled_date: appointmentDateTime(futureBusinessDate(2)),
          type: 'Check-up',
          location: 'Main Health Center',
          notes: 'Guardian cancellation regression fixture',
        });

      expect(createdAppointmentResponse.status).toBe(201);
      const cancelledAppointmentId = createdAppointmentResponse.body?.id;
      expect(Number.isInteger(Number.parseInt(cancelledAppointmentId, 10))).toBe(true);

      await pool.query(
        `
          UPDATE appointments
          SET scheduled_date = $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `,
        ['2026-04-20T09:00:00+08:00', cancelledAppointmentId],
      );

      const cancelResponse = await request(app)
        .put(`/api/appointments/${cancelledAppointmentId}/cancel`)
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          cancellation_reason: 'Guardian cancelled from dashboard',
        });

      expect(cancelResponse.status).toBe(200);
      expect(String(cancelResponse.body?.status || '').toLowerCase()).toBe('cancelled');

      const controlNumber =
        cancelResponse.body?.control_number ||
        (
          await pool.query(
            'SELECT control_number FROM patients WHERE id = $1',
            [christianInfantId],
          )
        ).rows?.[0]?.control_number;

      expect(Boolean(controlNumber)).toBe(true);

      const searchTerms = ['christian', 'samorin', 'christian samorin', controlNumber];

      for (const searchTerm of searchTerms) {
        const response = await request(app)
          .get('/api/appointments')
          .query({ search: searchTerm })
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);

        const records = collectionFrom(response.body);
        const matchedAppointment = records.find(
          (appointment) => Number.parseInt(appointment?.id, 10) === Number.parseInt(cancelledAppointmentId, 10),
        );

        expect(matchedAppointment).toBeDefined();
        expect(String(matchedAppointment?.status || '').toLowerCase()).toBe('cancelled');
        expect(toManilaDateKey(matchedAppointment?.scheduled_date)).toBe('2026-04-20');
      }

      const allStatusResponse = await request(app)
        .get('/api/appointments')
        .query({ search: 'christian samorin', status: 'all' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(allStatusResponse.status).toBe(200);

      const allStatusRecords = collectionFrom(allStatusResponse.body);
      const allStatusMatch = allStatusRecords.find(
        (appointment) => Number.parseInt(appointment?.id, 10) === Number.parseInt(cancelledAppointmentId, 10),
      );

      expect(allStatusMatch).toBeDefined();
      expect(String(allStatusMatch?.status || '').toLowerCase()).toBe('cancelled');
    });

    test('should return 401 for unauthenticated', async () => {
      const response = await request(app)
        .get('/api/appointments');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/appointments', () => {
    test('should create a new appointment for admin', async () => {
      const tomorrowDate = futureBusinessDate(1);

      const newAppointment = {
        infant_id: testInfantId,
        scheduled_date: appointmentDateTime(tomorrowDate),
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
      expect(response.body).toEqual(expect.any(Object));
      testAppointmentId = response.body.id;
      expect(response.body.infant_id || response.body.patient_id).toEqual(testInfantId);
      expect(toManilaDateKey(response.body.scheduled_date)).toBe(tomorrowDate);
      expect(response.body.type).toEqual(newAppointment.type);
    });

    test('should create a new appointment for guardian', async () => {
      const tomorrowDate = futureBusinessDate(2);

      const newAppointment = {
        infant_id: guardianInfantId,
        scheduled_date: appointmentDateTime(tomorrowDate),
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
      expect(response.body).toEqual(expect.any(Object));
      expect(response.body.infant_id || response.body.patient_id).toEqual(guardianInfantId);
      expect(toManilaDateKey(response.body.scheduled_date)).toBe(tomorrowDate);
    });

    test('should block guardian vaccination booking while child is pending confirmation', async () => {
      const targetDate = futureBusinessDate(3);

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          infant_id: guardianInfantId,
          scheduled_date: appointmentDateTime(targetDate),
          type: 'Vaccination',
          location: 'Main Health Center',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('PENDING_CONFIRMATION');
    });

    test('should auto-assign an eligible vaccine for guardian vaccination booking', async () => {
      const readinessResponse = await request(app)
        .get(`/api/vaccination-readiness/${guardianReadyInfantId}`)
        .set('Authorization', `Bearer ${guardianToken}`);

      expect(readinessResponse.status).toBe(200);
      const blockedVaccines = readinessResponse.body?.data?.blockedVaccines || [];
      expect(blockedVaccines.length).toBeGreaterThan(0);

      const matchingBlockedVaccine = blockedVaccines.find(
        (entry) => Number.parseInt(entry.vaccineId, 10) === guardianScheduleVaccineId,
      );
      expect(matchingBlockedVaccine).toBeDefined();

      const eligibleVaccineId = Number.parseInt(matchingBlockedVaccine.vaccineId, 10);
      expect(eligibleVaccineId).toBeGreaterThan(0);

      await pool.query(
        `
          INSERT INTO infant_vaccine_readiness (
            infant_id,
            vaccine_id,
            is_ready,
            ready_confirmed_by,
            ready_confirmed_at,
            created_by,
            is_active
          )
          VALUES ($1, $2, TRUE, 1, CURRENT_TIMESTAMP, 1, TRUE)
          ON CONFLICT (infant_id, vaccine_id, is_active)
          DO UPDATE SET
            is_ready = EXCLUDED.is_ready,
            ready_confirmed_by = EXCLUDED.ready_confirmed_by,
            ready_confirmed_at = EXCLUDED.ready_confirmed_at,
            created_by = EXCLUDED.created_by,
            updated_at = CURRENT_TIMESTAMP
        `,
        [guardianReadyInfantId, eligibleVaccineId],
      );

      const clinicResult = await pool.query(
        'SELECT clinic_id FROM patients WHERE id = $1',
        [guardianReadyInfantId],
      );
      const clinicId = Number.parseInt(clinicResult.rows[0]?.clinic_id, 10) || 1;

      await pool.query(
        `
          INSERT INTO vaccine_batches (
            vaccine_id,
            clinic_id,
            facility_id,
            lot_number,
            qty_current,
            status,
            expiry_date
          )
          VALUES ($1, $2, $2, $3, 50, 'active', CURRENT_DATE + INTERVAL '365 days')
        `,
        [eligibleVaccineId, clinicId, `READY-LOT-${Date.now()}`],
      );

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          infant_id: guardianReadyInfantId,
          scheduled_date: appointmentDateTime(futureBusinessDate(4)),
          type: 'Vaccination',
          location: 'Main Health Center',
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(expect.any(Object));
      expect(Number.parseInt(response.body.vaccine_id, 10)).toBe(eligibleVaccineId);
    });

    test('should block appointment creation on a Philippine holiday', async () => {
      const { dateKey: holidayDate, holiday } = futureHolidayDate();

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          infant_id: testInfantId,
          scheduled_date: appointmentDateTime(holidayDate),
          type: 'Vaccination',
          location: 'Main Health Center',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('HOLIDAY_RESTRICTED');
      expect(response.body.availability?.code).toBe('HOLIDAY_RESTRICTED');
      expect(String(response.body.error || '')).toContain(holiday.name);
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
      const tomorrowDate = futureBusinessDate(3);

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          infant_id: testInfantId,
          scheduled_date: appointmentDateTime(tomorrowDate),
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
      const tomorrowDate = futureBusinessDate(4);

      const createResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          infant_id: guardianInfantId,
          scheduled_date: appointmentDateTime(tomorrowDate),
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

    test('should block admin updates to Philippine holidays', async () => {
      const { dateKey: holidayDate } = futureHolidayDate();

      const response = await request(app)
        .put(`/api/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          scheduled_date: appointmentDateTime(holidayDate),
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('HOLIDAY_RESTRICTED');
      expect(response.body.availability?.code).toBe('HOLIDAY_RESTRICTED');
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
      const tomorrowDate = futureBusinessDate(5);

      const createResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          infant_id: guardianInfantId,
          scheduled_date: appointmentDateTime(tomorrowDate),
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
      const tomorrowDate = futureBusinessDate(6);

      const createResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          infant_id: testInfantId,
          scheduled_date: appointmentDateTime(tomorrowDate),
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
      const tomorrowDate = futureBusinessDate(7);

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
      const tomorrowDate = futureBusinessDate(8);

      const response = await request(app)
        .get(`/api/appointments/availability/slots?scheduled_date=${tomorrowDate}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body?.slots)).toBe(true);
    });

    test('should return unavailable time slots for Philippine holidays', async () => {
      const { dateKey: holidayDate } = futureHolidayDate();

      const response = await request(app)
        .get(`/api/appointments/availability/slots?scheduled_date=${holidayDate}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.available).toBe(false);
      expect(response.body.code).toBe('HOLIDAY_RESTRICTED');
      expect(Array.isArray(response.body?.slots)).toBe(true);
      expect(response.body.slots).toHaveLength(0);
    });
  });

  describe('PUT /api/appointments/:id/reschedule', () => {
    test('should block rescheduling to a Philippine holiday', async () => {
      const { dateKey: holidayDate } = futureHolidayDate();

      const response = await request(app)
        .put(`/api/appointments/${testAppointmentId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          scheduled_date: appointmentDateTime(holidayDate),
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('HOLIDAY_RESTRICTED');
      expect(response.body.availability?.code).toBe('HOLIDAY_RESTRICTED');
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
      expect(Array.isArray(collectionFrom(response.body))).toBe(true);
    });
  });

  describe('GET /api/appointments/types', () => {
    test('should return appointment types', async () => {
      const response = await request(app)
        .get('/api/appointments/types')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(collectionFrom(response.body))).toBe(true);
    });
  });

  describe('DELETE /api/appointments/:id', () => {
    test('should delete appointment', async () => {
      // Create an appointment to delete
      const tomorrowDate = futureBusinessDate(9);

      const createResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          infant_id: testInfantId,
          scheduled_date: appointmentDateTime(tomorrowDate),
          type: 'Deletion Test',
        });

      expect(createResponse.status).toBe(201);
      const appointmentId = createResponse.body.id;

      const deleteResponse = await request(app)
        .delete(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.message).toEqual('Appointment archived successfully');
    });

    test('should return 404 for non-existent appointment', async () => {
      const response = await request(app)
        .delete('/api/appointments/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });
});
