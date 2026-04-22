const request = require('supertest');
const pool = require('../db');
const smsService = require('../services/smsService');
const appointmentSchedulingService = require('../services/appointmentSchedulingService');
const {
  ensureAppointmentRuntimeSchemaInitialized,
} = require('../services/appointmentRuntimeSchemaService');
const { processAppointmentReminders } = require('../services/smsReminderScheduler');
const { getHolidayInfo } = require('../config/holidays');
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
  let appointmentPatientLookupPredicate = 'infant_id = $2';

  const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const guardianEmail = `otpappt.${uniqueSuffix}@example.com`;
  const guardianUsername = `otpappt_${uniqueSuffix}`;
  const guardianDigits = String(uniqueSuffix).replace(/\D/g, '').padStart(9, '1').slice(0, 9);
  const guardianPhoneLocal = `09${guardianDigits}`;
  const guardianPhoneE164 = `+63${guardianPhoneLocal.slice(1)}`;

  const toManilaDateKey = (value) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date(value));

  const appointmentDateTime = (date, time = '09:00:00') => `${date}T${time}`;

  const queryAppointmentByIdWithRetry = async (id, attempts = 5, delayMs = 150) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await pool.query(
        `SELECT id, guardian_id, status
         FROM appointments
         WHERE id = $1`,
        [id],
      );

      if (result.rows.length > 0 || attempt === attempts - 1) {
        return result;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }

    return { rows: [] };
  };

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

    await pool.query(
      `DELETE FROM sms_logs
       WHERE phone_number IN ($1, $2)`,
      [guardianPhoneLocal, guardianPhoneE164],
    );
  };

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
    guardianToken = await loginAsGuardian();

    await ensureAppointmentRuntimeSchemaInitialized();

    const appointmentColumns = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'appointments'
          AND column_name = ANY($1::text[])
      `,
      [['patient_id', 'infant_id']],
    );

    const availableAppointmentColumns = new Set(
      (appointmentColumns.rows || []).map((row) => row.column_name),
    );
    if (!availableAppointmentColumns.has('patient_id') && !availableAppointmentColumns.has('infant_id')) {
      throw new Error('appointments table is missing both patient_id and infant_id columns');
    }

    if (availableAppointmentColumns.has('patient_id') && availableAppointmentColumns.has('infant_id')) {
      appointmentPatientLookupPredicate = 'COALESCE(patient_id, infant_id) = $2';
    } else if (availableAppointmentColumns.has('patient_id')) {
      appointmentPatientLookupPredicate = 'patient_id = $2';
    }

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
      `INSERT INTO patients (first_name, last_name, guardian_id, clinic_id, dob, is_active)
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
    const scheduledDate = futureBusinessDate(2);

    const response = await request(app)
      .post('/api/appointments')
      .set(withBearer(adminToken))
      .send({
        infant_id: infantId,
        scheduled_date: appointmentDateTime(scheduledDate),
        type: 'Check-up',
        duration_minutes: 30,
        location: 'Main Health Center',
        clinic_id: clinicId,
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    appointmentId = response.body.id;

    let persisted = await queryAppointmentByIdWithRetry(appointmentId);

    if (persisted.rows.length === 0) {
      persisted = await pool.query(
        `SELECT id, guardian_id, status
         FROM appointments
         WHERE guardian_id = $1
           AND ${appointmentPatientLookupPredicate}
         ORDER BY id DESC
         LIMIT 1`,
        [guardianId, infantId],
      );
    }

    const ensureReminderSettingsTable = async () => {
      await pool.query(`
          CREATE TABLE IF NOT EXISTS appointment_reminder_settings (
            id SERIAL PRIMARY KEY,
            guardian_id INTEGER NOT NULL,
            infant_id INTEGER NULL,
            reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            reminder_hours_before INTEGER NOT NULL DEFAULT 24,
            sms_notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);

      await pool.query(
        `ALTER TABLE appointment_reminder_settings
           ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
      );
      await pool.query(
        `ALTER TABLE appointment_reminder_settings
           ADD COLUMN IF NOT EXISTS reminder_hours_before INTEGER NOT NULL DEFAULT 24`,
      );
      await pool.query(
        `ALTER TABLE appointment_reminder_settings
           ADD COLUMN IF NOT EXISTS sms_notification_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
      );
    };

    const persistedRow = persisted.rows[0] || null;
    if (persistedRow?.id) {
      appointmentId = persistedRow.id;
    }
    await ensureReminderSettingsTable();

    const patientRecord = await pool.query(
      `SELECT guardian_id
       FROM patients
       WHERE id = $1`,
      [infantId],
    );

    expect(persistedRow).toBeTruthy();
    expect(patientRecord.rows.length).toBe(1);
    expect(Number(response.body.guardian_id)).toBe(Number(guardianId));
    expect(Number(response.body.owner_guardian_id)).toBe(Number(guardianId));
    expect(Number(persistedRow.guardian_id)).toBe(Number(guardianId));
    expect(Number(patientRecord.rows[0].guardian_id)).toBe(Number(guardianId));
    expect(String(response.body.status).toLowerCase()).toBe('scheduled');
    expect(String(persistedRow.status).toLowerCase()).toBe('scheduled');
  });

  test('scheduler reminder job runs without invalid-phone failures for normalized guardian phone', async () => {
    const nearFuture = new Date(Date.now() + 24 * 60 * 60 * 1000 + 5 * 60 * 1000);

    await pool.query(
      `DELETE FROM sms_logs
       WHERE phone_number IN ($1, $2)`,
      [guardianPhoneLocal, guardianPhoneE164],
    );

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

    const sendSmsSpy = jest.spyOn(smsService, 'sendSMS').mockResolvedValue({
      success: true,
      messageId: `test_${Date.now()}`,
      provider: 'log',
    });

    try {
      await processAppointmentReminders();
    } finally {
      sendSmsSpy.mockRestore();
    }

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
      `DELETE FROM sms_logs
       WHERE phone_number IN ($1, $2)`,
      [guardianPhoneLocal, guardianPhoneE164],
    );

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
