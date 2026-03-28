const { decodeHtmlEntities } = require('../utils/htmlEntities');

describe('decodeHtmlEntities', () => {
  test('decodes named, decimal, and hexadecimal HTML entities', () => {
    expect(
      decodeHtmlEntities('&lt;Batch &#35;42&#x2F;A&gt; &amp; ready'),
    ).toBe('<Batch #42/A> & ready');
  });

  test('decodes repeated entity passes so double-encoded values become readable text', () => {
    expect(decodeHtmlEntities('&amp;#x2F;PO-42&amp;#x2F;')).toBe('/PO-42/');
  });

  test('returns an empty string for nullish values', () => {
    expect(decodeHtmlEntities(null)).toBe('');
    expect(decodeHtmlEntities(undefined)).toBe('');
  });
});
