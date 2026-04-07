process.env.DB_SUPPRESS_POOL_LOGS = 'true';

const express = require('express');
const request = require('supertest');

const mockPoolQuery = jest.fn();
const mockGetAdminMetricsSummary = jest.fn();
const mockResolveUserScopeIds = jest.fn(() => []);

jest.mock('../db', () => ({
  query: (...args) => mockPoolQuery(...args),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = {
      id: 99,
      role: 'SYSTEM_ADMIN',
      role_type: 'SYSTEM_ADMIN',
      runtime_role: 'SYSTEM_ADMIN',
    };
    next();
  },
}));

jest.mock('../middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
}));

jest.mock('../services/adminMetricsService', () => ({
  getAdminMetricsSummary: (...args) => mockGetAdminMetricsSummary(...args),
}));

jest.mock('../services/entityScopeService', () => ({
  resolveUserScopeIds: (...args) => mockResolveUserScopeIds(...args),
}));

const reportsRouter = require('../routes/reports');

describe('GET /api/reports/admin/summary sparse schema regression', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetAdminMetricsSummary.mockResolvedValue({
      vaccination: { total: 11, completed: 7 },
      inventory: { total_items: 4, low_stock: 1, expired_lots: 0 },
      appointments: { total: 3, missed: 0, completed: 2 },
      guardians: { total: 5, active: 4 },
      infants: { total: 6, up_to_date: 5 },
    });

    mockPoolQuery.mockImplementation(async (queryText, params = []) => {
      const sql = String(queryText);

      if (/information_schema\.tables/i.test(sql)) {
        const candidates = Array.isArray(params[0]) ? params[0] : [];
        const rows = [];

        if (candidates.includes('transfer_in_cases')) {
          rows.push({ table_name: 'transfer_in_cases' });
        }

        return { rows };
      }

      if (/information_schema\.columns/i.test(sql)) {
        const [tableName, columnName] = params;

        if (tableName === 'transfer_in_cases' && columnName === 'created_at') {
          return { rows: [{ column_name: 'created_at' }] };
        }

        return { rows: [] };
      }

      if (/FROM transfer_in_cases/i.test(sql)) {
        expect(sql).toContain("'pending'");
        expect(sql).not.toMatch(/\bvalidated_at\b/i);
        expect(sql).not.toMatch(/\bupdated_at\b/i);
        expect(sql).toMatch(/COALESCE\(created_at\)/i);

        return {
          rows: [
            {
              total: 3,
              open_cases: 3,
              avg_turnaround_days: null,
            },
          ],
        };
      }

      if (/FROM reports/i.test(sql)) {
        throw new Error('reports table query should be skipped when the table is absent');
      }

      return { rows: [] };
    });

    app = express();
    app.use(express.json());
    app.use('/api/reports', reportsRouter);
  });

  test('returns defaults instead of a 500 when reports table and transfer columns are sparse', async () => {
    const response = await request(app).get(
      '/api/reports/admin/summary?startDate=2026-03-01&endDate=2026-03-08',
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      vaccination: { total: 11, completed: 7 },
      reports: {
        total_reports: 0,
        total_downloads: 0,
        reports_last_7_days: 0,
        reports_last_30_days: 0,
      },
      transfers: {
        total: 3,
        open_cases: 3,
        avg_turnaround_days: null,
      },
    });
    expect(mockGetAdminMetricsSummary).toHaveBeenCalledWith({
      startDate: '2026-03-01',
      endDate: '2026-03-08',
      facilityId: null,
      scopeIds: [],
    });
    expect(mockResolveUserScopeIds).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 99,
        role_type: 'SYSTEM_ADMIN',
      }),
    );
  });
});
