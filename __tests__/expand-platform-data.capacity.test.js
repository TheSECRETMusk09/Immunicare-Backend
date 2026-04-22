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
    const saturdayRolled = rollForwardToWeekday(new Date('2026-04-04T00:00:00.000Z'));
    const sundayRolled = rollForwardToWeekday(new Date('2026-04-05T00:00:00.000Z'));

    expect([1, 2, 3, 4, 5]).toContain(saturdayRolled.getUTCDay());
    expect([1, 2, 3, 4, 5]).toContain(sundayRolled.getUTCDay());
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
