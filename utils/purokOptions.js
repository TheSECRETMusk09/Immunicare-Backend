const PUROK_STREET_COLOR_MAPPING = {
  'Purok 1': [
    'Son Risa St. - Pink',
    'G. Monaco St. - Yellow',
    'Fatalla St. - Violet',
  ],
  'Purok 2': ['M.H Del Pilar - Blue'],
  'Purok 3': ['M.H Del Pilar - Orange'],
  'Purok 4': ['M.H Del Pilar - Green'],
  'Purok 5': ['M.H Del Pilar - Green'],
  'Purok 6': ['Dimanlig St. - White'],
  'Purok 7': ['Bedana / Dimanlig St. - Red'],
};

const getPurokStreetColorValues = (selectedPurok) =>
  PUROK_STREET_COLOR_MAPPING[String(selectedPurok || '').trim()] || [];

const decodeHtmlEntities = (value) =>
  String(value || '')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#x27;/gi, '\'')
    .replace(/&quot;/gi, '"')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&amp;/gi, '&');

const normalizeOptionValue = (value) =>
  decodeHtmlEntities(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isValidPurok = (selectedPurok) =>
  Object.prototype.hasOwnProperty.call(
    PUROK_STREET_COLOR_MAPPING,
    String(selectedPurok || '').trim(),
  );

const isValidStreetColorForPurok = (selectedPurok, selectedStreetColor) =>
  getPurokStreetColorValues(selectedPurok).some(
    (option) => normalizeOptionValue(option) === normalizeOptionValue(selectedStreetColor),
  );

module.exports = {
  PUROK_STREET_COLOR_MAPPING,
  getPurokStreetColorValues,
  isValidPurok,
  isValidStreetColorForPurok,
};
