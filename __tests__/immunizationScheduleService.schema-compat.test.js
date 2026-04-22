jest.mock('../db', () => ({
  query: jest.fn(),
}));

describe('immunizationScheduleService schema compatibility', () => {
  let db;
  let immunizationScheduleService;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetModules();
    db = require('../db');
    immunizationScheduleService = require('../services/immunizationScheduleService');
    db.query.mockReset();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('uses a derived dose_name alias in the primary schedule query', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          { column_name: 'is_active' },
          { column_name: 'age_in_months' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await immunizationScheduleService.getAllSchedules();

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toContain(
      "CONCAT('Dose ', COALESCE(vs.dose_number, 1)) AS dose_name",
    );
  });

  test('returns empty schedules when the schedule query fails after schema resolution', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          { column_name: 'is_active' },
          { column_name: 'age_in_months' },
        ],
      })
      .mockRejectedValueOnce(new Error('column vs.is_active does not exist'));

    const schedules = await immunizationScheduleService.getAllSchedules();

    expect(schedules).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toContain(
      "CONCAT('Dose ', COALESCE(vs.dose_number, 1)) AS dose_name",
    );
  });
});
