jest.mock('../db', () => ({
  connect: jest.fn(),
  end: jest.fn(),
}));

const {
  MAX_VACCINATION_APPOINTMENTS_PER_DAY,
} = require('../utils/clinicCalendar');
const {
  distributeByWeekdayCapacity,
  rollForwardToWeekday,
  weekdaySeries,
  WINDOW_END,
  WINDOW_START,
} = require('../expand_immunicare_platform_data');

describe('expand_immunicare_platform_data weekday capacity rules', () => {
  test('rolls weekend seeded completion dates onto weekdays', () => {
    expect(rollForwardToWeekday(new Date('2026-04-04T00:00:00.000Z')).getUTCDay()).toBe(1);
    expect(rollForwardToWeekday(new Date('2026-04-05T00:00:00.000Z')).getUTCDay()).toBe(1);
  });

  test('distributes weekday-only vaccination appointments without exceeding 83 per day', () => {
    const days = weekdaySeries(WINDOW_START, WINDOW_END);
    const requestedTotal = Math.min(days.length * 10, 5000);
    const distribution = distributeByWeekdayCapacity(requestedTotal, days, {
      category: 'test appointments',
    });

    expect(distribution.days.every((day) => ![0, 6].includes(day.getUTCDay()))).toBe(true);
    expect(distribution.counts.reduce((sum, count) => sum + count, 0)).toBe(requestedTotal);
    expect(Math.max(...distribution.counts)).toBeLessThanOrEqual(MAX_VACCINATION_APPOINTMENTS_PER_DAY);
  });
});
