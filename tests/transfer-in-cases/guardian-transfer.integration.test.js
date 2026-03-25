const request = require('supertest');
const pool = require('../../db');
const { app } = require('../helpers/testApp');
const { loginAdmin, loginGuardian } = require('../helpers/authHelper');

describe('Guardian Transfer Registration Integration Tests', () => {
  let adminToken;
  let guardianToken;
  let guardianProfileId;

  beforeAll(async () => {
    const adminLogin = await loginAdmin();
    adminToken = adminLogin;
    const guardianLogin = await loginGuardian();
    guardianToken = guardianLogin;
    guardianProfileId = guardianLogin.response.body?.user?.guardian_id;
  });

  test('should register a transfer child atomically and expose the notification to the guardian feed', async () => {
    const uniqueSuffix = Date.now();
    const response = await request(app)
      .post('/api/transfer-in-cases/register-child')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        infant: {
          first_name: `Transfer${uniqueSuffix}`,
          last_name: 'Guardian',
          dob: '2023-03-10',
          sex: 'female',
          purok: 'Purok 1',
          street_color: 'Son Risa St. - Pink',
        },
        source_facility: 'San Nicolas Rural Health Unit',
        submitted_vaccines: [
          {
            vaccine_name: 'BCG',
            dose_number: 1,
            date_administered: '2023-03-11',
          },
        ],
        remarks: 'Transferred from another facility with vaccination card review.',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    const infantId = Number.parseInt(response.body?.data?.infant?.id, 10);
    const caseId = Number.parseInt(response.body?.data?.caseId, 10);

    expect(infantId).toBeGreaterThan(0);
    expect(caseId).toBeGreaterThan(0);

    const transferCaseResult = await pool.query(
      `
        SELECT guardian_id, infant_id, source_facility, validation_status
        FROM transfer_in_cases
        WHERE id = $1
      `,
      [caseId],
    );

    expect(transferCaseResult.rows).toHaveLength(1);
    expect(Number.parseInt(transferCaseResult.rows[0].guardian_id, 10)).toBe(Number(guardianProfileId));
    expect(Number.parseInt(transferCaseResult.rows[0].infant_id, 10)).toBe(infantId);
    expect(transferCaseResult.rows[0].source_facility).toBe('San Nicolas Rural Health Unit');

    const notificationResult = await pool.query(
      `
        SELECT id, guardian_id, title, notification_type
        FROM notifications
        WHERE guardian_id = $1
          AND notification_type = 'transfer_in'
        ORDER BY id DESC
        LIMIT 1
      `,
      [guardianProfileId],
    );

    expect(notificationResult.rows).toHaveLength(1);
    expect(Number.parseInt(notificationResult.rows[0].guardian_id, 10)).toBe(Number(guardianProfileId));
    expect(String(notificationResult.rows[0].title || '')).toMatch(/Transfer Case/i);

    const notificationsResponse = await request(app)
      .get('/api/guardian/notifications?limit=20')
      .set('Authorization', `Bearer ${guardianToken}`);

    expect(notificationsResponse.status).toBe(200);
    const notifications = notificationsResponse.body?.data || [];
    expect(
      notifications.some((notification) => Number.parseInt(notification.id, 10) === Number.parseInt(notificationResult.rows[0].id, 10)),
    ).toBe(true);
  });

  test('should roll back child creation when transfer validation fails after child registration starts', async () => {
    const uniqueSuffix = Date.now() + 1;
    const firstName = `Rollback${uniqueSuffix}`;
    const lastName = 'Guardian';
    const dob = '2023-03-10';

    const response = await request(app)
      .post('/api/transfer-in-cases/register-child')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        infant: {
          first_name: firstName,
          last_name: lastName,
          dob,
          sex: 'female',
          purok: 'Purok 1',
          street_color: 'Son Risa St. - Pink',
        },
        source_facility: '',
        submitted_vaccines: [
          {
            vaccine_name: 'BCG',
            dose_number: 1,
            date_administered: '2023-03-11',
          },
        ],
      });

    expect(response.status).toBe(400);

    const patientResult = await pool.query(
      `
        SELECT COUNT(*) AS count
        FROM patients
        WHERE guardian_id = $1
          AND first_name = $2
          AND last_name = $3
          AND dob = $4
          AND is_active = true
      `,
      [guardianProfileId, firstName, lastName, dob],
    );

    expect(Number.parseInt(patientResult.rows[0].count, 10)).toBe(0);
  });

  test('should auto-import transfer history and unblock readiness when a guardian transfer child is auto-approved', async () => {
    const uniqueSuffix = Date.now() + 2;
    const response = await request(app)
      .post('/api/transfer-in-cases/register-child')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        infant: {
          first_name: `Ready${uniqueSuffix}`,
          last_name: 'Guardian',
          dob: '2023-03-10',
          sex: 'female',
          purok: 'Purok 1',
          street_color: 'Son Risa St. - Pink',
        },
        source_facility: 'San Nicolas Rural Health Unit',
        submitted_vaccines: [
          {
            vaccine_name: 'BCG',
            dose_number: 1,
            date_administered: '2023-03-11',
          },
        ],
        remarks: 'Transferred with verified paper card.',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data?.autoImportSummary?.summary?.success).toBeGreaterThanOrEqual(1);

    const infantId = Number.parseInt(response.body?.data?.infant?.id, 10);
    const caseId = Number.parseInt(response.body?.data?.caseId, 10);

    const transferCaseResult = await pool.query(
      `
        SELECT validation_status, vaccines_imported
        FROM transfer_in_cases
        WHERE id = $1
      `,
      [caseId],
    );

    expect(transferCaseResult.rows).toHaveLength(1);
    expect(transferCaseResult.rows[0].validation_status).toBe('approved');
    expect(transferCaseResult.rows[0].vaccines_imported).toBe(true);

    const readinessRows = await pool.query(
      `
        SELECT vaccine_id, is_ready
        FROM infant_vaccine_readiness
        WHERE infant_id = $1
          AND is_active = true
      `,
      [infantId],
    );

    expect(readinessRows.rows.length).toBeGreaterThan(0);
    expect(readinessRows.rows.every((entry) => entry.is_ready === true)).toBe(true);

    const readinessResponse = await request(app)
      .get(`/api/vaccination-readiness/infant/${infantId}`)
      .set('Authorization', `Bearer ${guardianToken}`);

    expect(readinessResponse.status).toBe(200);

    const eligibleSchedules = (readinessResponse.body?.schedules || []).filter((schedule) => (
      schedule.isNextDueDose &&
      !schedule.isComplete &&
      readinessResponse.body.ageInDays >= schedule.minimumAgeDays
    ));

    expect(eligibleSchedules.length).toBeGreaterThan(0);
    expect(eligibleSchedules.every((schedule) => schedule.isReady === true)).toBe(true);
    expect(eligibleSchedules.some((schedule) => ['ready', 'overdue', 'due_soon'].includes(schedule.status))).toBe(true);
    expect(eligibleSchedules.some((schedule) => schedule.status === 'pending_confirmation')).toBe(false);
  });

  test('should import approved transfer vaccines without crashing the admin import route', async () => {
    const uniqueSuffix = Date.now() + 3;
    const createResponse = await request(app)
      .post('/api/transfer-in-cases/register-child')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        infant: {
          first_name: `Import${uniqueSuffix}`,
          last_name: 'Guardian',
          dob: '2023-03-10',
          sex: 'female',
          purok: 'Purok 1',
          street_color: 'Son Risa St. - Pink',
        },
        source_facility: 'San Nicolas Rural Health Unit',
        submitted_vaccines: [
          {
            vaccine_name: 'BCG',
            dose_number: 1,
            date_administered: '2023-03-11',
          },
        ],
      });

    expect(createResponse.status).toBe(201);
    const infantId = Number.parseInt(createResponse.body?.data?.infant?.id, 10);

    const insertedCase = await pool.query(
      `
        INSERT INTO transfer_in_cases (
          guardian_id,
          infant_id,
          source_facility,
          submitted_vaccines,
          validation_status,
          vaccines_imported
        )
        VALUES ($1, $2, $3, $4::jsonb, 'approved', false)
        RETURNING id
      `,
      [
        guardianProfileId,
        infantId,
        'San Nicolas Rural Health Unit',
        JSON.stringify([
          {
            vaccine_name: 'BCG',
            dose_number: 1,
            date_administered: '2023-03-11',
          },
        ]),
      ],
    );

    const caseId = Number.parseInt(insertedCase.rows[0].id, 10);

    const response = await request(app)
      .put(`/api/transfer-in-cases/${caseId}/approve-vaccines`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        approvedVaccines: [
          {
            vaccine_name: 'BCG',
            dose_number: 1,
            date_administered: '2023-03-11',
          },
        ],
        importToRecords: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data?.summary?.total).toBe(1);

    const updatedCase = await pool.query(
      `
        SELECT vaccines_imported, vaccines_imported_at
        FROM transfer_in_cases
        WHERE id = $1
      `,
      [caseId],
    );

    expect(updatedCase.rows).toHaveLength(1);
    expect(updatedCase.rows[0].vaccines_imported).toBe(true);
    expect(updatedCase.rows[0].vaccines_imported_at).not.toBeNull();
  });
});
