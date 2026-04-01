/**
 * Philippine Official Government Holidays Configuration
 * 
 * This module provides Philippine holiday definitions for backend services.
 * Centralized configuration to avoid duplication across services.
 */

const PH_FIXED_HOLIDAYS = [
  { month: 1, day: 1, name: 'New Year\'s Day' },
  { month: 4, day: 9, name: 'Araw ng Kagitingan' },
  { month: 5, day: 1, name: 'Labor Day' },
  { month: 6, day: 12, name: 'Independence Day' },
  { month: 8, day: 21, name: 'Ninoy Aquino Day' },
  { month: 8, day: 31, name: 'National Heroes Day' },
  { month: 11, day: 1, name: 'All Saints Day' },
  { month: 11, day: 30, name: 'Bonifacio Day' },
  { month: 12, day: 8, name: 'Feast of the Immaculate Conception' },
  { month: 12, day: 24, name: 'Christmas Eve' },
  { month: 12, day: 25, name: 'Christmas Day' },
  { month: 12, day: 30, name: 'Rizal Day' },
  { month: 12, day: 31, name: 'New Year\'s Eve' },
];

/**
 * Check if a date is a Philippine holiday
 * @param {Date} date - Date object to check
 * @returns {Object|null} Holiday object if found, null otherwise
 */
const getHolidayInfo = (date) => {
  if (!date || !(date instanceof Date)) {
    return null;
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();

  return PH_FIXED_HOLIDAYS.find((holiday) => holiday.month === month && holiday.day === day) || null;
};

/**
 * Check if a date is a weekend (Saturday or Sunday)
 * @param {Date} date - Date object to check
 * @returns {boolean} True if weekend, false otherwise
 */
const isWeekend = (date) => {
  if (!date || !(date instanceof Date)) {
    return false;
  }
  const day = date.getDay();
  return day === 0 || day === 6;
};

module.exports = {
  PH_FIXED_HOLIDAYS,
  getHolidayInfo,
  isWeekend,
};
