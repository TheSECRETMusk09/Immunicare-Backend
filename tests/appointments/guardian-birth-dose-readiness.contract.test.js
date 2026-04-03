jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../services/atBirthVaccinationService', () => ({
  ensureAtBirthVaccinationRecords: jest.fn().mockResolvedValue([]),
  ensureGlobalAtBirthVaccinationBackfillInitialized: jest.fn().mockResolvedValue(true),
}));

const pool = require('../../db');
const {
  ensureAtBirthVaccinationRecords,
  ensureGlobalAtBirthVaccinationBackfillInitialized,
} = require('../../services/atBirthVaccinationService');
const { calculateVaccineReadiness } = require('../../services/vaccineRulesEngine');

describe('calculateVaccineReadiness birth-dose normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not surface birth-dose vaccines as overdue once canonical at-birth records exist', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5001,
            first_name: 'Christian',
            last_name: 'Samorin',
            dob: '2026-03-20',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { vaccine_id: 1, dose_no: 1, admin_date: '2026-03-20' },
          { vaccine_id: 3, dose_no: 1, admin_date: '2026-03-20' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { vaccine_id: 1, dose_number: 1, age_in_months: 0, minimum_age_days: 0, vaccine_name: 'BCG' },
          { vaccine_id: 3, dose_number: 1, age_in_months: 0, minimum_age_days: 0, vaccine_name: 'Hepa B' },
          { vaccine_id: 3, dose_number: 2, age_in_months: 1, minimum_age_days: 28, vaccine_name: 'Hepa B' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const result = await calculateVaccineReadiness(5001);

    expect(ensureGlobalAtBirthVaccinationBackfillInitialized).toHaveBeenCalled();
    expect(ensureAtBirthVaccinationRecords).toHaveBeenCalledWith(5001, {
      patientDob: '2026-03-20',
    });
    expect(result.success).toBe(true);
    expect(result.data.overdueVaccines).toEqual([]);
    expect(result.data.dueVaccines).toEqual([]);
    expect(result.data.readinessStatus).toBe('UPCOMING');
  });

  test('treats completed doses stored under legacy vaccine ids as completed when the canonical vaccine code matches', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5001,
            first_name: 'Christian',
            last_name: 'Samorin',
            dob: '2026-03-20',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { vaccine_id: 101, dose_no: 1, admin_date: '2026-03-20', vaccine_code: 'bcg' },
          { vaccine_id: 103, dose_no: 1, admin_date: '2026-03-20', vaccine_code: 'hep_b' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { vaccine_id: 1, vaccine_code: 'bcg', dose_number: 1, age_in_months: 0, minimum_age_days: 0, vaccine_name: 'BCG' },
          { vaccine_id: 3, vaccine_code: 'hep_b', dose_number: 1, age_in_months: 0, minimum_age_days: 0, vaccine_name: 'Hepa B' },
          { vaccine_id: 3, vaccine_code: 'hep_b', dose_number: 2, age_in_months: 1, minimum_age_days: 28, vaccine_name: 'Hepa B' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const result = await calculateVaccineReadiness(5001);

    expect(result.success).toBe(true);
    expect(result.data.overdueVaccines).toEqual([]);
    expect(result.data.dueVaccines).toEqual([]);
    expect(result.data.readinessStatus).toBe('UPCOMING');
  });
});
