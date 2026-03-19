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

const isValidPurok = (selectedPurok) =>
  Object.prototype.hasOwnProperty.call(
    PUROK_STREET_COLOR_MAPPING,
    String(selectedPurok || '').trim(),
  );

const isValidStreetColorForPurok = (selectedPurok, selectedStreetColor) =>
  getPurokStreetColorValues(selectedPurok).includes(
    String(selectedStreetColor || '').trim(),
  );

module.exports = {
  PUROK_STREET_COLOR_MAPPING,
  getPurokStreetColorValues,
  isValidPurok,
  isValidStreetColorForPurok,
};
