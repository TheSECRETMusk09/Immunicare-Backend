jest.mock('../db', () => ({
  query: jest.fn(),
}));

const db = require('../db');
const analyticsRepository = require('../repositories/analyticsRepository');

describe('analytics repository appointment scope handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    analyticsRepository.resetSchemaColumnMappingCache();
  });

  test('matches appointment analytics against either appointment or patient scope columns', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          { table_name: 'appointments', column_name: 'infant_id' },
          { table_name: 'appointments', column_name: 'clinic_id' },
          { table_name: 'patients', column_name: 'facility_id' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total_in_period: 1515,
            today_total: 0,
            attended_in_period: 309,
            pending_in_period: 1045,
            total_pending: 97748,
            cancelled_in_period: 64,
            upcoming_7_days: 0,
            overdue_followups: 0,
            followups_today: 0,
            followups_in_period: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ status: 'scheduled', count: 571 }],
      })
      .mockResolvedValueOnce({
        rows: [{ day: '2026-04-01', count: 312 }],
      });

    await analyticsRepository.getAppointmentSnapshot({
      scopeIds: [1],
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      statuses: null,
      overdueOnly: false,
      guardianId: null,
    });

    await analyticsRepository.getAppointmentStatusBreakdown({
      scopeIds: [1],
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      statuses: null,
      guardianId: null,
    });

    await analyticsRepository.getDailyAppointmentTrend({
      scopeIds: [1],
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      statuses: null,
      guardianId: null,
    });

    const snapshotQuery = db.query.mock.calls[1][0];
    const breakdownQuery = db.query.mock.calls[2][0];
    const trendQuery = db.query.mock.calls[3][0];

    expect(snapshotQuery).toContain('a.clinic_id = ANY($1::int[])');
    expect(snapshotQuery).toContain('p.facility_id = ANY($1::int[])');
    expect(snapshotQuery).not.toContain('COALESCE(p.facility_id, a.clinic_id)');
    expect(snapshotQuery).toContain("AT TIME ZONE 'Asia/Manila'");
    expect(snapshotQuery).toContain("LIKE '%follow%'");
    expect(snapshotQuery).toContain('EXTRACT(DOW FROM');

    expect(breakdownQuery).toContain('a.clinic_id = ANY($1::int[])');
    expect(breakdownQuery).toContain('p.facility_id = ANY($1::int[])');
    expect(breakdownQuery).not.toContain('COALESCE(p.facility_id, a.clinic_id)');
    expect(breakdownQuery).toContain("AT TIME ZONE 'Asia/Manila'");
    expect(breakdownQuery).toContain('EXTRACT(DOW FROM');

    expect(trendQuery).toContain('a.clinic_id = ANY($1::int[])');
    expect(trendQuery).toContain('p.facility_id = ANY($1::int[])');
    expect(trendQuery).not.toContain('COALESCE(p.facility_id, a.clinic_id)');
    expect(trendQuery).toContain("AT TIME ZONE 'Asia/Manila'");
    expect(trendQuery).toContain('EXTRACT(DOW FROM');
  });
});
