/**
 * Age Calculation Utility for Infant Records
 *
 * This utility provides functions to calculate and manage infant age
 * in months based on their date of birth.
 */

const pool = require('../db');

/**
 * Calculate age in months from date of birth
 * @param {Date|string} dob - Date of birth
 * @returns {number} Age in completed months
 */
function calculateAgeInMonths(dob) {
  const birthDate = new Date(dob);
  const today = new Date();

  if (isNaN(birthDate.getTime())) {
    return null;
  }

  let months = (today.getFullYear() - birthDate.getFullYear()) * 12;
  months -= birthDate.getMonth();
  months += today.getMonth();

  // If the day of the month hasn't occurred yet, subtract one month
  if (today.getDate() < birthDate.getDate()) {
    months--;
  }

  // Return 0 for future dates or negative values
  return months < 0 ? 0 : months;
}

/**
 * Calculate age in a human-readable format
 * @param {Date|string} dob - Date of birth
 * @returns {object} Age breakdown with years, months, and days
 */
function calculateAge(dob) {
  const birthDate = new Date(dob);
  const today = new Date();

  if (isNaN(birthDate.getTime())) {
    return { years: 0, months: 0, days: 0, display: 'Invalid date' };
  }

  let years = today.getFullYear() - birthDate.getFullYear();
  let months = today.getMonth() - birthDate.getMonth();
  let days = today.getDate() - birthDate.getDate();

  if (days < 0) {
    months--;
    const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += prevMonth.getDate();
  }

  if (months < 0) {
    years--;
    months += 12;
  }

  const totalMonths = years * 12 + months;
  const display = years > 0
    ? `${years} year${years > 1 ? 's' : ''}, ${months} month${months !== 1 ? 's' : ''}`
    : `${months} month${months !== 1 ? 's' : ''}, ${days} day${days !== 1 ? 's' : ''}`;

  return {
    years,
    months,
    days,
    totalMonths,
    display,
  };
}

/**
 * Update age_months for all active patients in the database
 * @returns {Promise<{success: boolean, updated: number, errors: Array}>}
 */
async function updateAllInfantAges() {
  const client = await pool.connect();

  try {
    // First, ensure the age_months column exists
    await client.query(`
      ALTER TABLE public.patients
      ADD COLUMN IF NOT EXISTS age_months INTEGER
    `);

    // Get all active patients with valid dob
    const patientsResult = await client.query(`
      SELECT id, dob
      FROM public.patients
      WHERE is_active = true
        AND dob IS NOT NULL
    `);

    let updatedCount = 0;
    const errors = [];

    // Update each patient's age in months
    for (const patient of patientsResult.rows) {
      try {
        const ageMonths = calculateAgeInMonths(patient.dob);

        await client.query(`
          UPDATE public.patients
          SET age_months = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [ageMonths, patient.id]);

        updatedCount++;
      } catch (err) {
        errors.push({ patientId: patient.id, error: err.message });
      }
    }

    return {
      success: true,
      updated: updatedCount,
      total: patientsResult.rows.length,
      errors,
    };
  } catch (error) {
    console.error('Error updating infant ages:', error);
    return {
      success: false,
      updated: 0,
      errors: [{ error: error.message }],
    };
  } finally {
    client.release();
  }
}

/**
 * Update age_months for a single patient by ID
 * @param {number} patientId - Patient ID
 * @returns {Promise<{success: boolean, ageMonths: number|null}>}
 */
async function updatePatientAge(patientId) {
  try {
    const result = await pool.query(`
      SELECT dob FROM public.patients WHERE id = $1 AND is_active = true
    `, [patientId]);

    if (result.rows.length === 0) {
      return { success: false, ageMonths: null, error: 'Patient not found' };
    }

    const { dob } = result.rows[0];
    const ageMonths = calculateAgeInMonths(dob);

    // Ensure column exists
    await pool.query(`
      ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS age_months INTEGER
    `);

    await pool.query(`
      UPDATE public.patients SET age_months = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
    `, [ageMonths, patientId]);

    return { success: true, ageMonths };
  } catch (error) {
    console.error('Error updating patient age:', error);
    return { success: false, ageMonths: null, error: error.message };
  }
}

/**
 * Get infant age information with calculated fields
 * @param {number} patientId - Patient ID
 * @returns {Promise<object>} Patient info with calculated age
 */
async function getInfantAgeInfo(patientId) {
  try {
    const result = await pool.query(`
      SELECT
        id, first_name, last_name, dob,
        age_months, created_at, updated_at
      FROM public.patients
      WHERE id = $1 AND is_active = true
    `, [patientId]);

    if (result.rows.length === 0) {
      return null;
    }

    const patient = result.rows[0];
    const ageInfo = calculateAge(patient.dob);

    return {
      ...patient,
      age_years: ageInfo.years,
      age_months_calculated: ageInfo.months,
      age_days: ageInfo.days,
      age_total_months: ageInfo.totalMonths,
      age_display: ageInfo.display,
      age_months_stored: patient.age_months,
    };
  } catch (error) {
    console.error('Error getting infant age info:', error);
    return null;
  }
}

/**
 * Get all infants with their calculated ages
 * @param {number} limit - Max records to return
 * @param {number} offset - Records to skip
 * @returns {Promise<Array>} Array of infants with age info
 */
async function getAllInfantsWithAges(limit = 100, offset = 0) {
  try {
    // First ensure column exists
    await pool.query(`
      ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS age_months INTEGER
    `);

    const result = await pool.query(`
      SELECT
        id, first_name, last_name, dob,
        age_months, sex, guardian_id,
        created_at, updated_at
      FROM public.patients
      WHERE is_active = true
      ORDER BY created_at DESC
      LIMIT $1::bigint OFFSET $2::bigint
    `, [limit, offset]);

    return result.rows.map(patient => {
      const ageInfo = calculateAge(patient.dob);
      return {
        ...patient,
        age_years: ageInfo.years,
        age_months_calculated: ageInfo.months,
        age_days: ageInfo.days,
        age_total_months: ageInfo.totalMonths,
        age_display: ageInfo.display,
      };
    });
  } catch (error) {
    console.error('Error getting infants with ages:', error);
    return [];
  }
}

/**
 * Get age statistics for all infants
 * @returns {Promise<object>} Age statistics
 */
async function getAgeStatistics() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_infants,
        COUNT(age_months) as with_age_record,
        AVG(age_months) as average_age_months,
        MIN(age_months) as youngest_months,
        MAX(age_months) as oldest_months,
        COUNT(CASE WHEN age_months < 12 THEN 1 END) as under_1_year,
        COUNT(CASE WHEN age_months >= 12 AND age_months < 24 THEN 1 END) as age_1_to_2,
        COUNT(CASE WHEN age_months >= 24 THEN 1 END) as age_2_plus
      FROM public.patients
      WHERE is_active = true
    `);

    return result.rows[0];
  } catch (error) {
    console.error('Error getting age statistics:', error);
    return null;
  }
}

module.exports = {
  calculateAgeInMonths,
  calculateAge,
  updateAllInfantAges,
  updatePatientAge,
  getInfantAgeInfo,
  getAllInfantsWithAges,
  getAgeStatistics,
};
