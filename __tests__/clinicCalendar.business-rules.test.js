const {
  MAX_VACCINATION_APPOINTMENTS_PER_DAY,
  resolveClinicDateRange,
  rollForwardWeekendDateKey,
  toClinicDateKey,
} = require('../utils/clinicCalendar');

describe('clinic calendar business rules', () => {
  test('uses Asia/Manila for date-key conversion', () => {
    expect(toClinicDateKey('2026-04-04T18:30:00.000Z')).toBe('2026-04-05');
  });

  test('rolls weekend vaccination dates forward to Monday', () => {
    expect(rollForwardWeekendDateKey('2026-04-04')).toBe('2026-04-06');
    expect(rollForwardWeekendDateKey('2026-04-05')).toBe('2026-04-06');
    expect(rollForwardWeekendDateKey('2026-04-06')).toBe('2026-04-06');
  });

  test('resolves monthly ranges using Manila-local today', () => {
    const result = resolveClinicDateRange({
      period: 'month',
      now: new Date('2026-04-05T09:00:00.000Z'),
    });

    expect(result).toEqual({
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      errors: [],
    });
  });

  test('keeps the vaccination daily capacity fixed at 83', () => {
    expect(MAX_VACCINATION_APPOINTMENTS_PER_DAY).toBe(83);
  });
});
