const request = require('supertest');
const pool = require('../../db');
const { app } = require('../helpers/testApp');
const { loginAdmin } = require('../helpers/authHelper');

describe('Digital Papers Compatibility Integration Tests', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await loginAdmin();
  });

  test('document history and monitoring alerts recover from missing digital papers support tables', async () => {
    await pool.query(`
      DROP TABLE IF EXISTS document_shares CASCADE;
      DROP TABLE IF EXISTS document_downloads CASCADE;
      DROP TABLE IF EXISTS paper_completion_status CASCADE;
      ALTER TABLE users DROP COLUMN IF EXISTS first_name;
      ALTER TABLE users DROP COLUMN IF EXISTS last_name;
    `);

    const historyResponse = await request(app)
      .get('/api/documents/history')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.success).toBe(true);
    expect(Array.isArray(historyResponse.body.data)).toBe(true);

    const alertsResponse = await request(app)
      .get('/api/monitoring/alerts?status=PENDING&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(alertsResponse.status).toBe(200);
    expect(alertsResponse.body.success).toBe(true);
    expect(Array.isArray(alertsResponse.body.data)).toBe(true);

    const tableCheckResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('document_shares', 'document_downloads', 'paper_completion_status')
      ORDER BY table_name
    `);

    expect(tableCheckResult.rows.map((row) => row.table_name)).toEqual([
      'document_downloads',
      'document_shares',
      'paper_completion_status',
    ]);

    const userColumnsResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name IN ('first_name', 'last_name')
      ORDER BY column_name
    `);

    expect(userColumnsResult.rows.map((row) => row.column_name)).toEqual([
      'first_name',
      'last_name',
    ]);
  });
});
