/**
 * Approved Vaccines Utility
 *
 * Provides functions to validate and filter vaccines based on the approved list.
 * This is used across the application to enforce vaccine restrictions.
 */

const pool = require('../db');

// Approved vaccine names (normalized for matching)
const APPROVED_VACCINE_NAMES = new Set([
  'bcg',
  'diluent',
  'hepa b',
  'penta valent',
  'opv 20-doses',
  'pcv 13',
  'pcv 10',
  'measles & rubella (mr)',
  'm mr',
  'm',
  'diluent 5ml',
  'ipv multi dose',
]);

// Normalize vaccine name for matching
const normalizeVaccineName = (name) => {
  if (!name) {
    return '';
  }
  return name.toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/&/g, 'and')
    .replace(/[-–—]/g, ' ')
    .replace(/[\(\)]/g, '')
    .replace(/\s*20-doses?\s*/gi, ' 20-doses')
    .replace(/\s*multi\s*dose\s*/gi, ' multi dose')
    .trim();
};

/**
 * Check if a vaccine name is in the approved list
 * @param {string} name - The vaccine name to check
 * @returns {boolean} - True if approved
 */
const isApprovedVaccineName = (name) => {
  const normalized = normalizeVaccineName(name);

  // Direct match
  if (APPROVED_VACCINE_NAMES.has(normalized)) {
    return true;
  }

  // Check for partial matches (e.g., "BCG" should match "bcg")
  for (const approved of APPROVED_VACCINE_NAMES) {
    if (normalized.includes(approved) || approved.includes(normalized)) {
      return true;
    }
  }

  return false;
};

/**
 * Get the approved vaccines list from the database
 * @param {boolean} activeOnly - Only return active vaccines
 * @returns {Promise<Array>} - Array of approved vaccines
 */
const getApprovedVaccines = async (activeOnly = true) => {
  let whereClause = 'WHERE COALESCE(is_approved, false) = true';
  if (activeOnly) {
    whereClause += ' AND is_active = true';
  }

  const result = await pool.query(
    `SELECT id, name, code, description, manufacturer, doses_required, recommended_age, is_active, is_approved, display_order
     FROM vaccines ${whereClause} ORDER BY COALESCE(display_order, 999) ASC, name ASC`,
  );

  return result.rows;
};

/**
 * Validate that a vaccine_id is an approved vaccine
 * @param {number} vaccineId - The vaccine ID to validate
 * @returns {Promise<{valid: boolean, vaccine?: Object, error?: string}>}
 */
const validateApprovedVaccine = async (vaccineId) => {
  if (!vaccineId) {
    return { valid: false, error: 'vaccine_id is required' };
  }

  const result = await pool.query(
    'SELECT id, name, code, is_approved, is_active FROM vaccines WHERE id = $1',
    [vaccineId],
  );

  if (result.rows.length === 0) {
    return { valid: false, error: 'Vaccine not found' };
  }

  const vaccine = result.rows[0];

  if (!vaccine.is_active) {
    return { valid: false, error: 'Vaccine is inactive', vaccine };
  }

  if (!vaccine.is_approved) {
    return {
      valid: false,
      error: `Vaccine "${vaccine.name}" is not in the approved vaccine list. Only official government vaccines are allowed.`,
      vaccine,
    };
  }

  return { valid: true, vaccine };
};

/**
 * Get all vaccines (both approved and unapproved) - for admin use only
 * @returns {Promise<Array>} - Array of all vaccines with approval status
 */
const getAllVaccinesWithApprovalStatus = async () => {
  const result = await pool.query(
    `SELECT id, name, code, description, manufacturer, doses_required, recommended_age, is_active, is_approved, display_order
     FROM vaccines ORDER BY COALESCE(is_approved, false) DESC, COALESCE(display_order, 999) ASC, name ASC`,
  );

  return result.rows;
};

/**
 * Approve a vaccine (admin function)
 * @param {number} vaccineId - The vaccine ID to approve
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const approveVaccine = async (vaccineId) => {
  if (!vaccineId) {
    return { success: false, error: 'vaccine_id is required' };
  }

  const result = await pool.query(
    'UPDATE vaccines SET is_approved = true WHERE id = $1 RETURNING id, name',
    [vaccineId],
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Vaccine not found' };
  }

  return { success: true, vaccine: result.rows[0] };
};

/**
 * Unapprove a vaccine (admin function)
 * @param {number} vaccineId - The vaccine ID to unapprove
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const unapproveVaccine = async (vaccineId) => {
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
  normalizeVaccineName,
  isApprovedVaccineName,
  getApprovedVaccines,
  validateApprovedVaccine,
  getAllVaccinesWithApprovalStatus,
  approveVaccine,
  unapproveVaccine,
};
