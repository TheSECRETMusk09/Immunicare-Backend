const {
  assignBalancedWeekdays,
  enumerateWeekdays,
  mapRecordDates,
  parseArgs,
} = require('../scripts/repair_weekend_vaccination_records');

describe('repair weekend vaccination record utilities', () => {
  test('parses repair mode and marker arguments', () => {
    expect(parseArgs(['--marker=EXP123', '--apply'])).toEqual({
      marker: 'EXP123',
      mode: 'repair',
      apply: true,
    });
  });

  test('enumerates only weekdays across a range', () => {
    expect(enumerateWeekdays('2026-04-03', '2026-04-07')).toEqual([
      '2026-04-03',
      '2026-04-06',
      '2026-04-07',
    ]);
  });

  test('assigns weekend rows into weekday buckets with remaining capacity', () => {
    const bucketMap = new Map([
      ['2026-04-03', 82],
      ['2026-04-06', 80],
      ['2026-04-07', 79],
    ]);
    const assignments = assignBalancedWeekdays(
      [
        { id: 1, patient_id: 10, local_date: '2026-04-04' },
        { id: 2, patient_id: 11, local_date: '2026-04-05' },
      ],
      bucketMap,
    );

    expect(assignments).toHaveLength(2);
    expect(bucketMap.get('2026-04-03')).toBe(82);
    expect(bucketMap.get('2026-04-06')).toBeLessThanOrEqual(83);
    expect(bucketMap.get('2026-04-07')).toBeLessThanOrEqual(83);
  });

  test('maps record dates from appointment assignments and falls back to Monday roll-forward', () => {
    const lookup = new Map([
      ['10|2026-04-04', '2026-04-07'],
    ]);

    expect(
      mapRecordDates(
        [
          { id: 1, patient_id: 10, local_date: '2026-04-04' },
          { id: 2, patient_id: 11, local_date: '2026-04-05' },
        ],
        lookup,
      ),
    ).toEqual([
      { id: 1, new_date: '2026-04-07' },
      { id: 2, new_date: '2026-04-06' },
    ]);
  });
});
