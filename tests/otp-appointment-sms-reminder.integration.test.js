const request = require('supertest');
const pool = require('../db');
const smsService = require('../services/smsService');
const appointmentSchedulingService = require('../services/appointmentSchedulingService');
const { processAppointmentReminders } = require('../services/smsReminderScheduler');
const { app } = require('./helpers/testApp');
const { loginAsAdmin, loginAsGuardian, withBearer } = require('./helpers/authHelper');

describe('OTP + Appointment + SMS Integration (targeted hardening)', () => {
  let adminToken;
  let guardianToken;
  let guardianId;
  let guardianUserId;
  let clinicId;
  let infantId;
  let appointmentId;

  const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const guardianEmail = `otpappt.${uniqueSuffix}@example.com`;
  const guardianUsername = `otpappt_${uniqueSuffix}`;
  const guardianDigits = String(uniqueSuffix).replace(/\D/g, '').padStart(9, '1').slice(0, 9);
  const guardianPhoneLocal = `09${guardianDigits}`;
  const guardianPhoneE164 = `+63${guardianPhoneLocal.slice(1)}`;

  const cleanup = async () => {
    if (appointmentId) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [appointmentId]);
      appointmentId = null;
    }

    if (infantId) {
      await pool.query('DELETE FROM patients WHERE id = $1', [infantId]);
      infantId = null;
    }

    if (guardianUserId) {
      await pool.query('DELETE FROM users WHERE id = $1', [guardianUserId]);
      guardianUserId = null;
    }

    if (guardianId) {
      await pool.query('DELETE FROM guardians WHERE id = $1', [guardianId]);
      guardianId = null;
    }

    await pool.query(
      `DELETE FROM sms_verification_codes
       WHERE phone_number IN ($1, $2)`,
      [guardianPhoneLocal, guardianPhoneE164],
    );
  };

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
    guardianToken = await loginAsGuardian();

    const clinicResult = await pool.query('SELECT id FROM clinics ORDER BY id ASC LIMIT 1');
    clinicId = clinicResult.rows[0]?.id;

    const guardianInsert = await pool.query(
      `INSERT INTO guardians (name, phone, email, relationship, is_active, is_password_set, must_change_password)
       VALUES ($1, $2, $3, 'parent', true, true, false)
       RETURNING id`,
      [`OTP APPT Guardian ${uniqueSuffix}`, guardianPhoneE164, guardianEmail],
    );
    guardianId = guardianInsert.rows[0].id;

    const roleResult = await pool.query('SELECT id FROM roles WHERE lower(name) = \'guardian\' LIMIT 1');
    const roleId = roleResult.rows[0]?.id;

    const passwordHashResult = await pool.query(
      'SELECT password_hash FROM users WHERE lower(username) = lower($1) LIMIT 1',
      ['maria.santos'],
    );
    const passwordHash = passwordHashResult.rows[0]?.password_hash || 'hash';

    const userInsert = await pool.query(
      `INSERT INTO users (username, email, password_hash, role_id, guardian_id, clinic_id, is_active, force_password_change)
       VALUES ($1, $2, $3, $4, $5, $6, true, false)
       RETURNING id`,
      [guardianUsername, guardianEmail, passwordHash, roleId, guardianId, clinicId],
    );
    guardianUserId = userInsert.rows[0].id;

    const infantInsert = await pool.query(
      `INSERT INTO patients (first_name, last_name, guardian_id, clinic_id, date_of_birth, is_active)
       VALUES ($1, $2, $3, $4, CURRENT_DATE - INTERVAL '6 months', true)
       RETURNING id`,
      ['OTP', `Child${uniqueSuffix}`, guardianId, clinicId],
    );
    infantId = infantInsert.rows[0].id;
  });

  afterAll(async () => {
    await cleanup();
  });

  test('OTP send stores record under normalized E.164 and verify succeeds', async () => {
    const sendResult = await smsService.sendOTP(guardianPhoneLocal, 'verification', {
      guardianId,
      testMode: true,
    });

    expect(sendResult.success).toBe(true);

    const otpRow = await pool.query(
      `SELECT code, phone_number, purpose
       FROM sms_verification_codes
       WHERE phone_number = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [guardianPhoneE164, 'phone_verification'],
    );

    expect(otpRow.rows.length).toBe(1);
    expect(otpRow.rows[0].phone_number).toBe(guardianPhoneE164);

    const verifyResult = await smsService.verifyOTP(
      guardianPhoneLocal,
      otpRow.rows[0].code,
      'verification',
    );

    expect(verifyResult.success).toBe(true);
  });

  test('appointment booking endpoint succeeds and persists guardian/admin visibility fields', async () => {
    const scheduled = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const response = await request(app)
      .post('/api/appointments')
      .set(withBearer(adminToken))
      .send({
        infant_id: infantId,
        scheduled_date: scheduled.toISOString(),
        type: 'Vaccination',
        duration_minutes: 30,
        location: 'Main Health Center',
        status: 'scheduled',
        clinic_id: clinicId,
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    appointmentId = response.body.id;

    const persisted = await pool.query(
      `SELECT a.id, a.guardian_id, a.status, p.guardian_id as patient_guardian_id
       FROM appointments a
       JOIN patients p ON p.id = a.infant_id
       WHERE a.id = $1`,
      [appointmentId],
    );

    expect(persisted.rows.length).toBe(1);
    expect(Number(persisted.rows[0].guardian_id)).toBe(Number(guardianId));
    expect(Number(persisted.rows[0].patient_guardian_id)).toBe(Number(guardianId));
    expect(String(persisted.rows[0].status).toLowerCase()).toBe('scheduled');
  });

  test('scheduler reminder job runs without invalid-phone failures for normalized guardian phone', async () => {
    const nearFuture = new Date(Date.now() + 26 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE appointments
       SET scheduled_date = $1,
           status = 'scheduled',
           reminder_sent_24h = false,
           reminder_sent_48h = false,
           is_active = true
       WHERE id = $2`,
      [nearFuture.toISOString(), appointmentId],
    );

    await processAppointmentReminders();

    const reminderFlags = await pool.query(
      `SELECT reminder_sent_24h, reminder_sent_48h
       FROM appointments
       WHERE id = $1`,
      [appointmentId],
    );

    expect(reminderFlags.rows.length).toBe(1);
    const { reminder_sent_24h, reminder_sent_48h } = reminderFlags.rows[0];
    expect(reminder_sent_24h || reminder_sent_48h).toBe(true);
  });

  test('missed appointment processor handles normalized phone path and marks send status', async () => {
    const pastDate = new Date(Date.now() - 5 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE appointments
       SET scheduled_date = $1,
           status = 'scheduled',
           sms_missed_notification_sent = false,
           is_active = true
       WHERE id = $2`,
      [pastDate.toISOString(), appointmentId],
    );

    const result = await appointmentSchedulingService.processMissedAppointments();
    expect(result).toBeDefined();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const flagResult = await pool.query(
      `SELECT sms_missed_notification_sent
       FROM appointments
       WHERE id = $1`,
      [appointmentId],
    );

    expect(flagResult.rows.length).toBe(1);
    expect(flagResult.rows[0].sms_missed_notification_sent).toBe(true);
  });

  test('guardian appointment list endpoint remains successful after booking flow changes', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/guardian/login')
      .send({
        username: guardianUsername,
        password: 'QaGuardian!234',
      });

    expect([200, 201]).toContain(loginResponse.status);
    guardianToken = loginResponse.body?.token || loginResponse.body?.accessToken;
    expect(guardianToken).toBeTruthy();

    const response = await request(app)
      .get('/api/appointments')
      .set(withBearer(guardianToken));

    expect([200, 403]).toContain(response.status);
  });
});
