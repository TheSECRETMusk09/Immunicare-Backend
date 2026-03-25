const { isValidStreetColorForPurok } = require('../../utils/purokOptions');

describe('purokOptions', () => {
  test('accepts sanitized street color values for the selected purok', () => {
    expect(
      isValidStreetColorForPurok('Purok 7', 'Bedana &#x2F; Dimanlig St. - Red'),
    ).toBe(true);
  });
});
