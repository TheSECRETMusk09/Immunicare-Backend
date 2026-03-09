/**
 * Appointment Control Number Service
 *
 * Generates unique control numbers for appointments in format: "001 - MM/DD/YYYY"
 * Resets daily and uses date-based sequencing for atomic generation.
 */

const pool = require('../db');

const APPOINTMENT_CONTROL_NUMBER_FORMAT = {
  PADDING: 3, // e.g., "001"
  SEPARATOR: ' - ',
};

/**
 * Get today's date string in MM/DD/YYYY format
 * @returns {string} Date in MM/DD/YYYY format
 */
const getTodayDateString = () => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const year = today.getFullYear();
  return `${month}/${day}/${year}`;
};

/**
 * Get today's date for database operations
 * @returns {Date} Today's date at midnight
 */
const getTodayDate = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

/**
 * Generate a new appointment control number
 * Format: "001 - MM/DD/YYYY"
 *
 * Uses PostgreSQL's atomic operation to ensure unique sequential numbers per day.
 *
 * @returns {Promise<string>} Control number in format "001 - MM/DD/YYYY"
 */
const generateControlNumber = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const today = getTodayDate();
    const todayString = getTodayDateString();

    // Try to get existing sequence for today
    const existingSeq = await client.query(
      `SELECT sequence_number
       FROM appointment_control_numbers
       WHERE control_date = $1`,
      [today]
    );

    let nextSequence;

    if (existingSeq.rows.length > 0) {
      // Increment existing sequence
      const result = await client.query(
        `UPDATE appointment_control_numbers
         SET sequence_number = sequence_number + 1, updated_at = CURRENT_TIMESTAMP
         WHERE control_date = $1
         RETURNING sequence_number`,
        [today]
      );
      nextSequence = result.rows[0].sequence_number;
    } else {
      // Create new sequence for today starting at 1
      await client.query(
        `INSERT INTO appointment_control_numbers (control_date, sequence_number)
         VALUES ($1, 1)`,
        [today]
      );
      nextSequence = 1;
    }

    await client.query('COMMIT');

    // Format the control number
    const paddedSequence = String(nextSequence).padStart(APPOINTMENT_CONTROL_NUMBER_FORMAT.PADDING, '0');
    const controlNumber = `${paddedSequence}${APPOINTMENT_CONTROL_NUMBER_FORMAT.SEPARATOR}${todayString}`;

    return controlNumber;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error generating control number:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get the current sequence number for today
 * @returns {Promise<number|null>} Current sequence number or null if no appointments today
 */
const getTodaySequence = async () => {
  const today = getTodayDate();

  const result = await pool.query(
    `SELECT sequence_number FROM appointment_control_numbers WHERE control_date = $1`,
    [today]
  );

  return result.rows.length > 0 ? result.rows[0].sequence_number : null;
};

/**
 * Validate a control number format
 * @param {string} controlNumber - Control number to validate
 * @returns {boolean} True if valid format
 */
const validateControlNumberFormat = (controlNumber) => {
  // Format: "001 - MM/DD/YYYY"
  const regex = /^\d{3} - \d{2}\/\d{2}\/\d{4}$/;
  return regex.test(controlNumber);
};

/**
 * Parse control number to extract components
 * @param {string} controlNumber - Control number to parse
 * @returns {object|null} Parsed components or null if invalid
 */
const parseControlNumber = (controlNumber) => {
  if (!validateControlNumberFormat(controlNumber)) {
    return null;
  }

  const parts = controlNumber.split(APPOINTMENT_CONTROL_NUMBER_FORMAT.SEPARATOR);
  return {
    sequenceNumber: parseInt(parts[0], 10),
    dateString: parts[1],
  };
};

module.exports = {
  generateControlNumber,
  getTodaySequence,
  validateControlNumberFormat,
  parseControlNumber,
  getTodayDateString,
};
