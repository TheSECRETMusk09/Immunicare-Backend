jest.mock('../db', () => ({
  query: jest.fn(),
}));

const db = require('../db');
const analyticsRepository = require('../repositories/analyticsRepository');

describe('analytics repository vaccination business rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    analyticsRepository.resetSchemaColumnMappingCache();
  });

  test('uses Manila-local dates, weekend exclusion, and weekday-adjusted due dates', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          { table_name: 'immunization_records', column_name: 'status' },
          { table_name: 'patients', column_name: 'facility_id' },
          { table_name: 'guardians', column_name: 'clinic_id' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            completed_today: 0,
            administered_in_period: 12,
            due_in_period: 4,
            overdue_count: 2,
            unique_infants_served: 8,
            due_soon_7_days: 3,
          },
        ],
      });

    await analyticsRepository.getVaccinationSnapshot({
      scopeIds: [1],
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      vaccineIds: null,
      statuses: null,
      overdueOnly: false,
      guardianId: null,
    });

    const snapshotQuery = db.query.mock.calls[1][0];

    expect(snapshotQuery).toContain("CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'");
    expect(snapshotQuery).toContain('EXTRACT(DOW FROM');
    expect(snapshotQuery).toContain("INTERVAL '2 days'");
    expect(snapshotQuery).toContain("INTERVAL '1 day'");
    expect(snapshotQuery).toContain("IN ('completed', 'attended')");
  });
});
