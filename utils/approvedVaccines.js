/**
 * Strict approved vaccine whitelist and vaccine-brand validation helpers.
 *
 * Vaccine names must exactly match one of the approved values below.
 * No trimming, case-folding, aliasing, abbreviation expansion, or fuzzy matching
 * is allowed for validation.
 */

const pool = require('../db');

let vaccineCatalogColumnsPromise = null;

const APPROVED_VACCINE_NAMES = Object.freeze([
  'BCG',
  'Diluent',
  'Hepa B',
  'Penta Valent',
  'OPV 20-doses',
  'PCV 13',
  'PCV 10',
  'Measles & Rubella (MR)',
  'MMR',
  'Diluent 5ml',
  'IPV multi dose',
]);

const APPROVED_VACCINE_NAME_SET = new Set(APPROVED_VACCINE_NAMES);

const APPROVED_VACCINE_BRANDS = Object.freeze(
  APPROVED_VACCINE_NAMES.reduce((accumulator, vaccineName) => {
    accumulator[vaccineName] = Object.freeze([]);
    return accumulator;
  }, {}),
);

const APPROVED_VACCINE_LIST_TEXT = APPROVED_VACCINE_NAMES.join(', ');
const EXACT_MATCH_REQUIREMENT_TEXT =
  `Vaccine name must exactly match one of the approved values: ${APPROVED_VACCINE_LIST_TEXT}.`;

const withAllowedBrands = (row = {}) => ({
  ...row,
  allowed_brands: Object.prototype.hasOwnProperty.call(APPROVED_VACCINE_BRANDS, row.name)
    ? [...APPROVED_VACCINE_BRANDS[row.name]]
    : [],
});

const getApprovedVaccineNames = () => [...APPROVED_VACCINE_NAMES];

const getApprovedBrandsForVaccine = (vaccineName) =>
  Object.prototype.hasOwnProperty.call(APPROVED_VACCINE_BRANDS, vaccineName)
    ? [...APPROVED_VACCINE_BRANDS[vaccineName]]
    : [];

const ensureVaccineCatalogColumns = async () => {
  if (!vaccineCatalogColumnsPromise) {
    vaccineCatalogColumnsPromise = pool
      .query(`
        ALTER TABLE vaccines
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS recommended_age VARCHAR(255),
        ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS display_order INTEGER
      `)
      .catch((error) => {
        vaccineCatalogColumnsPromise = null;
        throw error;
      });
  }

  return vaccineCatalogColumnsPromise;
};

const normalizeVaccineName = (name) => (typeof name === 'string' ? name : '');

const isApprovedVaccineName = (name) =>
  typeof name === 'string' && APPROVED_VACCINE_NAME_SET.has(name);

const buildApprovedVaccineNameError = (value, fieldName = 'vaccine_name') => {
  const receivedValue = value === undefined || value === null ? '' : String(value);
  return `Invalid ${fieldName}. Vaccine name "${receivedValue}" is not approved. ${EXACT_MATCH_REQUIREMENT_TEXT}`;
};

const validateApprovedVaccineName = (
  value,
  { fieldName = 'vaccine_name', required = true } = {},
) => {
  if (value === undefined || value === null || value === '') {
    if (!required) {
      return { valid: true, vaccineName: null };
    }

    return {
      valid: false,
      error: `${fieldName} is required. ${EXACT_MATCH_REQUIREMENT_TEXT}`,
    };
  }

  if (typeof value !== 'string') {
    return {
      valid: false,
      error: `${fieldName} must be a string. ${EXACT_MATCH_REQUIREMENT_TEXT}`,
    };
  }

  if (!isApprovedVaccineName(value)) {
    return {
      valid: false,
      error: buildApprovedVaccineNameError(value, fieldName),
    };
  }

  return {
    valid: true,
    vaccineName: value,
  };
};

const validateApprovedVaccineBrand = (
  brandValue,
  vaccineName,
  { fieldName = 'vaccine_brand', allowBlank = true } = {},
) => {
  if (brandValue === undefined || brandValue === null || brandValue === '') {
    if (allowBlank) {
      return { valid: true, brand: null };
    }

    return {
      valid: false,
      error: `${fieldName} is required for vaccine "${vaccineName}".`,
    };
  }

  if (typeof brandValue !== 'string') {
    return {
      valid: false,
      error: `${fieldName} must be a string when provided.`,
    };
  }

  if (!isApprovedVaccineName(vaccineName)) {
    return {
      valid: false,
      error: `Cannot validate ${fieldName} because vaccine_name is invalid. ${EXACT_MATCH_REQUIREMENT_TEXT}`,
    };
  }

  const approvedBrands = getApprovedBrandsForVaccine(vaccineName);

  if (!approvedBrands.includes(brandValue)) {
    if (approvedBrands.length === 0) {
      return {
        valid: false,
        error: `Invalid ${fieldName}. No approved brands are configured for vaccine "${vaccineName}". Leave ${fieldName} blank or register an approved brand before storing this record.`,
      };
    }

    return {
      valid: false,
      error: `Invalid ${fieldName}. Brand "${brandValue}" is not approved for vaccine "${vaccineName}". Allowed exact brand values: ${approvedBrands.join(', ')}.`,
    };
  }

  return {
    valid: true,
    brand: brandValue,
  };
};

const getApprovedVaccines = async (activeOnly = true) => {
  await ensureVaccineCatalogColumns();

  let whereClause = 'WHERE v.name = ANY($1::text[])';
  const params = [APPROVED_VACCINE_NAMES];

  if (activeOnly) {
    whereClause += ' AND v.is_active = true';
  }

  const result = await pool.query(
    `SELECT v.id, v.name, v.code, v.description, v.manufacturer, v.doses_required,
            v.recommended_age, v.is_active, v.is_approved, v.display_order,
            v.created_at, v.updated_at
     FROM vaccines v
     ${whereClause}
     ORDER BY COALESCE(v.display_order, 999) ASC,
              array_position($1::text[], v.name) ASC,
              v.name ASC`,
    params,
  );

  return result.rows.map(withAllowedBrands);
};

const validateApprovedVaccine = async (
  vaccineIdOrName,
  { brand = null, fieldName = 'vaccine_id' } = {},
) => {
  await ensureVaccineCatalogColumns();

  if (vaccineIdOrName === undefined || vaccineIdOrName === null || vaccineIdOrName === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  const isNumericId =
    typeof vaccineIdOrName === 'number' ||
    (typeof vaccineIdOrName === 'string' && /^\d+$/.test(vaccineIdOrName));

  let result;
  if (isNumericId) {
    result = await pool.query(
      `SELECT id, name, code, description, manufacturer, doses_required,
              recommended_age, is_active, is_approved, display_order,
              created_at, updated_at
       FROM vaccines
       WHERE id = $1
       LIMIT 1`,
      [parseInt(vaccineIdOrName, 10)],
    );
  } else {
    const vaccineNameValidation = validateApprovedVaccineName(vaccineIdOrName, { fieldName });
    if (!vaccineNameValidation.valid) {
      return { valid: false, error: vaccineNameValidation.error };
    }

    result = await pool.query(
      `SELECT id, name, code, description, manufacturer, doses_required,
              recommended_age, is_active, is_approved, display_order,
              created_at, updated_at
       FROM vaccines
       WHERE name = $1
       LIMIT 1`,
      [vaccineNameValidation.vaccineName],
    );
  }

  if (result.rows.length === 0) {
    return {
      valid: false,
      error: 'Approved vaccine not found in the database. Please synchronize the vaccine master list before retrying.',
    };
  }

  const vaccine = result.rows[0];

  if (!isApprovedVaccineName(vaccine.name)) {
    return {
      valid: false,
      error: buildApprovedVaccineNameError(vaccine.name, fieldName),
      vaccine,
    };
  }

  if (!vaccine.is_active) {
    return { valid: false, error: `Vaccine "${vaccine.name}" is inactive`, vaccine };
  }

  const brandValidation = validateApprovedVaccineBrand(brand, vaccine.name, {
    fieldName: 'vaccine_brand',
  });

  if (!brandValidation.valid) {
    return {
      valid: false,
      error: brandValidation.error,
      vaccine: withAllowedBrands(vaccine),
    };
  }

  return {
    valid: true,
    vaccine: withAllowedBrands(vaccine),
    brand: brandValidation.brand,
  };
};

const getAllVaccinesWithApprovalStatus = async () => {
  await ensureVaccineCatalogColumns();

  const result = await pool.query(
    `SELECT id, name, code, description, manufacturer, doses_required, recommended_age,
            is_active, is_approved, display_order, created_at, updated_at
     FROM vaccines
     ORDER BY COALESCE(is_approved, false) DESC,
              COALESCE(display_order, 999) ASC,
              name ASC`,
  );

  return result.rows.map((row) => ({
    ...withAllowedBrands(row),
    is_name_whitelisted: isApprovedVaccineName(row.name),
  }));
};

const approveVaccine = async (vaccineId) => {
  await ensureVaccineCatalogColumns();

  if (!vaccineId) {
    return { success: false, error: 'vaccine_id is required' };
  }

  const result = await pool.query(
    'SELECT id, name FROM vaccines WHERE id = $1 LIMIT 1',
    [vaccineId],
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Vaccine not found' };
  }

  if (!isApprovedVaccineName(result.rows[0].name)) {
    return {
      success: false,
      error: buildApprovedVaccineNameError(result.rows[0].name),
    };
  }

  const updateResult = await pool.query(
    'UPDATE vaccines SET is_approved = true WHERE id = $1 RETURNING id, name',
    [vaccineId],
  );

  return { success: true, vaccine: updateResult.rows[0] };
};

const unapproveVaccine = async (vaccineId) => {
  await ensureVaccineCatalogColumns();

  if (!vaccineId) {
    return { success: false, error: 'vaccine_id is required' };
  }

  const result = await pool.query(
    'UPDATE vaccines SET is_approved = false WHERE id = $1 RETURNING id, name',
    [vaccineId],
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Vaccine not found' };
  }

  return { success: true, vaccine: result.rows[0] };
};

module.exports = {
  APPROVED_VACCINE_NAMES,
  APPROVED_VACCINE_NAME_SET,
  APPROVED_VACCINE_BRANDS,
  APPROVED_VACCINE_LIST_TEXT,
  normalizeVaccineName,
  isApprovedVaccineName,
  getApprovedVaccineNames,
  getApprovedBrandsForVaccine,
  validateApprovedVaccineName,
  validateApprovedVaccineBrand,
  buildApprovedVaccineNameError,
  getApprovedVaccines,
  validateApprovedVaccine,
  getAllVaccinesWithApprovalStatus,
  approveVaccine,
  unapproveVaccine,
};
