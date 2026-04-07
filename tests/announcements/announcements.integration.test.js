const request = require('supertest');
const pool = require('../../db');
const { app } = require('../helpers/testApp');
const { loginAdmin, loginGuardian } = require('../helpers/authHelper');

describe('Announcements integration tests', () => {
  let adminToken;
  let guardianToken;
  const createdAnnouncementIds = [];

  beforeAll(async () => {
    adminToken = await loginAdmin();
    guardianToken = await loginGuardian();
  });

  afterAll(async () => {
    if (createdAnnouncementIds.length === 0) {
      return;
    }

    await pool.query(
      'DELETE FROM announcement_recipient_deliveries WHERE announcement_id = ANY($1::int[])',
      [createdAnnouncementIds],
    );
    await pool.query('DELETE FROM announcements WHERE id = ANY($1::int[])', [createdAnnouncementIds]);
  });

  test('should bootstrap the announcement schema and complete create-read-update-publish-delete flows', async () => {
    const validationResponse = await request(app)
      .post('/api/announcements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Validation Check',
        content: 'short',
      });

    expect(validationResponse.status).toBe(400);
    expect(validationResponse.body.success).toBe(false);
    expect(validationResponse.body.fields).toMatchObject({
      content: expect.stringMatching(/at least 10 characters/i),
    });

    const createPayload = {
      title: `Audit Announcement ${Date.now()}`,
      content: 'This announcement verifies admin CRUD, delivery tracking, and guardian visibility.',
      target_audience: 'all',
      priority: 'high',
      status: 'draft',
    };

    const createResponse = await request(app)
      .post('/api/announcements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload);

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.title).toBe(createPayload.title);

    const announcementId = Number.parseInt(createResponse.body.id, 10);
    expect(announcementId).toBeGreaterThan(0);
    createdAnnouncementIds.push(announcementId);

    const schemaCheck = await pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN ('announcements', 'announcement_recipient_deliveries')
        ORDER BY table_name
      `,
    );

    expect(schemaCheck.rows.map((row) => row.table_name)).toEqual([
      'announcement_recipient_deliveries',
      'announcements',
    ]);

    const listResponse = await request(app)
      .get('/api/announcements?status=draft')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listResponse.status).toBe(200);
    expect(
      listResponse.body.some((announcement) => Number.parseInt(announcement.id, 10) === announcementId),
    ).toBe(true);

    const updateResponse = await request(app)
      .put(`/api/announcements/${announcementId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...createPayload,
        title: `${createPayload.title} Updated`,
        content: `${createPayload.content} Updated for integration coverage.`,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.title).toMatch(/Updated$/);

    const publishResponse = await request(app)
      .put(`/api/announcements/${announcementId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.status).toBe('published');
    expect(Number.parseInt(publishResponse.body.recipient_count, 10)).toBeGreaterThan(0);
    expect(publishResponse.body.delivery_summary).toBeDefined();

    const deliverySummaryResponse = await request(app)
      .get(`/api/announcements/${announcementId}/delivery-summary`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deliverySummaryResponse.status).toBe(200);
    expect(Number.parseInt(deliverySummaryResponse.body.summary.announcement_id, 10)).toBe(announcementId);
    expect(Number.parseInt(deliverySummaryResponse.body.summary.total_recipients, 10)).toBeGreaterThan(0);

    const guardianFeedResponse = await request(app)
      .get('/api/announcements/my')
      .set('Authorization', `Bearer ${guardianToken}`);

    expect(guardianFeedResponse.status).toBe(200);
    expect(
      guardianFeedResponse.body.some((announcement) => Number.parseInt(announcement.id, 10) === announcementId),
    ).toBe(true);

    const deleteResponse = await request(app)
      .delete(`/api/announcements/${announcementId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({
      message: 'Announcement deleted successfully',
    });

    const fetchDeletedResponse = await request(app)
      .get(`/api/announcements/${announcementId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(fetchDeletedResponse.status).toBe(404);
  });
});
