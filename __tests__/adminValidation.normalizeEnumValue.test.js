const { normalizeEnumValue } = require('../utils/adminValidation');

describe('normalizeEnumValue', () => {
  test('matches uppercase enum values case-insensitively and returns the canonical allowed value', () => {
    expect(
      normalizeEnumValue('RECEIVE', ['RECEIVE', 'ISSUE', 'WASTE'], ''),
    ).toBe('RECEIVE');
    expect(
      normalizeEnumValue('issue', ['RECEIVE', 'ISSUE', 'WASTE'], ''),
    ).toBe('ISSUE');
    expect(
      normalizeEnumValue('Waste', ['RECEIVE', 'ISSUE', 'WASTE'], ''),
    ).toBe('WASTE');
  });

  test('preserves lowercase enum lists and falls back for unsupported values', () => {
    expect(normalizeEnumValue('Published', ['draft', 'published'], '')).toBe(
      'published',
    );
    expect(normalizeEnumValue('unknown', ['draft', 'published'], 'draft')).toBe(
      'draft',
    );
  });
});
