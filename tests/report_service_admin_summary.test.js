jest.mock('../services/adminMetricsService', () => ({
  getAdminMetricsSummary: jest.fn(),
}));

const { getAdminMetricsSummary } = require('../services/adminMetricsService');
const ReportService = require('../services/reportService');

describe('ReportService admin summary', () => {
  let service;
  let dbMock;

  beforeEach(() => {
    dbMock = {
      query: jest.fn(),
    };

    getAdminMetricsSummary.mockResolvedValue({
      vaccination: { total_administered: 337755, completed_today: 132 },
      inventory: { total_items: 1062, low_stock: 257, expired_lots: 0 },
      appointments: { total: 234387, missed: 9364, completed: 120671 },
      guardians: { total: 98624, active: 98624 },
      infants: { total: 100001, up_to_date: 99482 },
    });

    service = new ReportService({
      pool: dbMock,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('prefers validated_at when computing transfer turnaround days', async () => {
    dbMock.query.mockImplementation(async (queryText) => {
      if (/information_schema\.tables/i.test(queryText)) {
        return {
          rows: [{ table_name: 'transfer_in_cases' }],
        };
      }

      if (/FROM reports/i.test(queryText)) {
        return {
          rows: [
            {
              total_reports: 15182,
              total_downloads: 91603,
              reports_last_7_days: 7,
              reports_last_30_days: 30,
            },
          ],
        };
      }

      if (/FROM transfer_in_cases/i.test(queryText)) {
        expect(queryText).toMatch(/COALESCE\(validated_at,\s*updated_at,\s*created_at\)/i);
        return {
          rows: [
            {
              total: 10600,
              open_cases: 0,
              avg_turnaround_days: '1.11',
            },
          ],
        };
      }

      return { rows: [] };
    });

    const summary = await service.getAdminSummary();

    expect(getAdminMetricsSummary).toHaveBeenCalledWith({
      startDate: '',
      endDate: '',
      facilityId: null,
      scopeIds: [],
    });
    expect(summary.infants.total).toBe(100001);
    expect(summary.transfers).toMatchObject({
      total: 10600,
      open_cases: 0,
      avg_turnaround_days: '1.11',
    });
  });
});
