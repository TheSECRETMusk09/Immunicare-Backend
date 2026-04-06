jest.mock('../db', () => ({
  query: jest.fn(),
}));

const db = require('../db');
const immunizationScheduleService = require('../services/immunizationScheduleService');

describe('immunizationScheduleService schema compatibility', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    db.query.mockReset();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('uses a derived dose_name alias in the primary schedule query', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await immunizationScheduleService.getAllSchedules();

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain(
      "CONCAT('Dose ', COALESCE(vs.dose_number, 1)) AS dose_name",
    );
  });

  test('uses the same derived dose_name alias in the fallback query', async () => {
    db.query
      .mockRejectedValueOnce(new Error('column vs.is_active does not exist'))
      .mockResolvedValueOnce({ rows: [{ id: 1, dose_name: 'Dose 1' }] });

    const schedules = await immunizationScheduleService.getAllSchedules();

    expect(schedules).toEqual([{ id: 1, dose_name: 'Dose 1' }]);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toContain(
      "CONCAT('Dose ', COALESCE(vs.dose_number, 1)) AS dose_name",
    );
  });
});
