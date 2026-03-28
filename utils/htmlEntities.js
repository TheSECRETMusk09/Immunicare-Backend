const NAMED_HTML_ENTITIES = Object.freeze({
  amp: '&',
  apos: '\'',
  gt: '>',
  lt: '<',
  quot: '"',
});

const decodeCodePoint = (rawValue, radix, fallbackMatch) => {
  const parsedValue = Number.parseInt(rawValue, radix);
  if (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 0x10ffff) {
    return fallbackMatch;
  }

  try {
    return String.fromCodePoint(parsedValue);
  } catch (_error) {
    return fallbackMatch;
  }
};

const decodeHtmlEntities = (value, maxPasses = 3) => {
  if (value === undefined || value === null) {
    return '';
  }

  let decodedValue = String(value);
  const safeMaxPasses = Number.isInteger(maxPasses) && maxPasses > 0 ? maxPasses : 1;

  for (let passIndex = 0; passIndex < safeMaxPasses; passIndex += 1) {
    const previousValue = decodedValue;

    decodedValue = decodedValue
      .replace(/&#(\d+);/g, (match, numericValue) =>
        decodeCodePoint(numericValue, 10, match),
      )
      .replace(/&#x([0-9a-f]+);/gi, (match, numericValue) =>
        decodeCodePoint(numericValue, 16, match),
      )
      .replace(/&([a-z]+);/gi, (match, entityName) => {
        const replacement = NAMED_HTML_ENTITIES[entityName.toLowerCase()];
        return replacement === undefined ? match : replacement;
      });

    if (decodedValue === previousValue) {
      break;
    }
  }

  return decodedValue;
};

module.exports = {
  decodeHtmlEntities,
};
