const pool = require('../db');

/**
 * Get all blocked dates for a given date range
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @param {number} clinicId - Optional clinic ID for filtering
 * @returns {Array} Array of blocked date records
 */
const getBlockedDates = async ({ startDate, endDate, clinicId = null }) => {
  try {
    let query = `
      SELECT id, blocked_date, is_blocked, reason, blocked_by, clinic_id, created_at, updated_at
      FROM blocked_dates
      WHERE blocked_date BETWEEN $1 AND $2
    `;
    const params = [startDate, endDate];

    if (clinicId) {
      query += ' AND (clinic_id = $3 OR clinic_id IS NULL)';
      params.push(clinicId);
    }

    query += ' ORDER BY blocked_date ASC';

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error in getBlockedDates:', error);
    return [];
  }
};

/**
 * Check if a specific date is blocked
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} clinicId - Optional clinic ID
 * @returns {Object|null} Blocked date record or null if not blocked
 */
const isDateBlocked = async ({ date, clinicId = null }) => {
  try {
    let query = `
      SELECT id, blocked_date, is_blocked, reason, blocked_by, clinic_id
      FROM blocked_dates
      WHERE blocked_date = $1 AND is_blocked = true
    `;
    const params = [date];

    if (clinicId) {
      query += ' AND (clinic_id = $2 OR clinic_id IS NULL)';
      params.push(clinicId);
    }

    query += ' LIMIT 1';

    const result = await pool.query(query, params);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error in isDateBlocked:', error);
    return null;
  }
};

/**
 * Block or unblock a specific date
 * @param {Object} options - Options object
 * @param {string} options.date - Date in YYYY-MM-DD format
 * @param {boolean} options.isBlocked - Whether to block (true) or unblock (false) the date
 * @param {string} options.reason - Optional reason for blocking/unblocking
 * @param {number} options.blockedBy - User ID of admin performing the action
 * @param {number} options.clinicId - Optional clinic ID
 * @returns {Object} The created or updated blocked date record
 */
const setDateBlocked = async ({ date, isBlocked, reason = null, blockedBy, clinicId = null }) => {
  try {
    // First try to update existing record
    const updateResult = await pool.query(
      `
        UPDATE blocked_dates
        SET is_blocked = $1,
            reason = $2,
            blocked_by = $3,
            clinic_id = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE blocked_date = $5
        RETURNING id, blocked_date, is_blocked, reason, blocked_by, clinic_id, created_at, updated_at
      `,
      [isBlocked, reason, blockedBy, clinicId, date],
    );

    if (updateResult.rows.length > 0) {
      return {
        success: true,
        action: 'updated',
        blockedDate: updateResult.rows[0],
      };
    }

    // If no existing record, insert new one
    const insertResult = await pool.query(
      `
        INSERT INTO blocked_dates (blocked_date, is_blocked, reason, blocked_by, clinic_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, blocked_date, is_blocked, reason, blocked_by, clinic_id, created_at, updated_at
      `,
      [date, isBlocked, reason, blockedBy, clinicId],
    );

    return {
      success: true,
      action: 'created',
      blockedDate: insertResult.rows[0],
    };
  } catch (error) {
    console.error('Error in setDateBlocked:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Toggle the blocked status of a specific date
 * @param {Object} options - Options object
 * @param {string} options.date - Date in YYYY-MM-DD format
 * @param {string} options.reason - Optional reason for toggling
 * @param {number} options.blockedBy - User ID of admin performing the action
 * @param {number} options.clinicId - Optional clinic ID
 * @returns {Object} Result with new blocked status
 */
const toggleDateBlocked = async ({ date, reason = null, blockedBy, clinicId = null }) => {
  try {
    // Get current status
    const current = await isDateBlocked({ date, clinicId });
    const newStatus = !current; // Toggle: if blocked, unblock; if not blocked, block

    const result = await setDateBlocked({
      date,
      isBlocked: newStatus,
      reason,
      blockedBy,
      clinicId,
    });

    return result;
  } catch (error) {
    console.error('Error in toggleDateBlocked:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete a blocked date record
 * @param {number} id - ID of the blocked date record to delete
 * @returns {boolean} Success status
 */
const deleteBlockedDate = async (id) => {
  try {
    await pool.query('DELETE FROM blocked_dates WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error('Error in deleteBlockedDate:', error);
    return false;
  }
};

/**
 * Get all blocked dates for calendar display
 * @param {string} month - Month in YYYY-MM format
 * @param {number} clinicId - Optional clinic ID
 * @returns {Object} Object with blocked dates mapped by date key
 */
const getBlockedDatesForCalendar = async ({ month, clinicId = null }) => {
  try {
    // Parse month to get start and end dates
    const [year, monthNum] = month.split('-');
    const startDate = new Date(parseInt(year), parseInt(monthNum) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(monthNum), 0);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    const blockedDates = await getBlockedDates({
      startDate: startDateStr,
      endDate: endDateStr,
      clinicId,
    });

    // Convert to map for easy lookup
    const blockedDatesMap = {};
    blockedDates.forEach(record => {
      blockedDatesMap[record.blocked_date] = record;
    });

    return blockedDatesMap;
  } catch (error) {
    console.error('Error in getBlockedDatesForCalendar:', error);
    return {};
  }
};

module.exports = {
  getBlockedDates,
  isDateBlocked,
  setDateBlocked,
  toggleDateBlocked,
  deleteBlockedDate,
  getBlockedDatesForCalendar,
};
