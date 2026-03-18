const pool = require('../db');
const { calculateVaccineReadiness } = require('./vaccineRulesEngine');

// Simplified vaccine schedule - in production this would come from a shared utility or backend
const VACCINE_SCHEDULE = {
  hepatitis_b: {
    name: 'Hepatitis B',
    doses: [
      { number: 1, ageInMonths: 0, vaccine: 'hep_b' },
      { number: 2, ageInMonths: 1, vaccine: 'hep_b' },
      { number: 3, ageInMonths: 6, vaccine: 'hep_b' },
    ],
  },
  bcg: {
    name: 'BCG',
    doses: [
      { number: 1, ageInMonths: 0, vaccine: 'bcg' },
    ],
  },
  pentavalent: {
    name: 'Pentavalent',
    doses: [
      { number: 1, ageInMonths: 1.5, vaccine: 'penta' },
      { number: 2, ageInMonths: 2.5, vaccine: 'penta' },
      { number: 3, ageInMonths: 3.5, vaccine: 'penta' },
    ],
  },
  opv: {
    name: 'Oral Polio Vaccine',
    doses: [
      { number: 1, ageInMonths: 1.5, vaccine: 'opv' },
      { number: 2, ageInMonths: 2.5, vaccine: 'opv' },
      { number: 3, ageInMonths: 3.5, vaccine: 'opv' },
    ],
  },
  ipv: {
    name: 'Inactivated Polio Vaccine',
    doses: [
      { number: 1, ageInMonths: 1.5, vaccine: 'ipv' },
      { number: 2, ageInMonths: 3.5, vaccine: 'ipv' },
    ],
  },
  pcv: {
    name: 'Pneumococcal Conjugate Vaccine',
    doses: [
      { number: 1, ageInMonths: 1.5, vaccine: 'pcv' },
      { number: 2, ageInMonths: 2.5, vaccine: 'pcv' },
      { number: 3, ageInMonths: 3.5, vaccine: 'pcv' },
    ],
  },
  measles: {
    name: 'Measles Vaccine',
    doses: [
      { number: 1, ageInMonths: 9, vaccine: 'mcv' },
      { number: 2, ageInMonths: 15, vaccine: 'mcv' },
    ],
  },
};

const calculateAgeInMonths = (dobString) => {
  if (!dobString) {
    return 0;
  }
  const birthDate = new Date(dobString);
  const today = new Date();
  return (today - birthDate) / (1000 * 60 * 60 * 24 * 30.44); // Approximate months
};

const calculateCompletedDoses = (vaccinationHistory = []) => {
  const completed = {};
  vaccinationHistory.forEach(record => {
    const vaccineName = record.vaccine || record.vaccine_id;
    const doseNumber = record.dose_no || 1;

    if (!completed[vaccineName]) {
      completed[vaccineName] = {
        count: 0,
        doses: [],
      };
    }

    completed[vaccineName].count++;
    completed[vaccineName].doses.push(doseNumber);
  });

  return completed;
};

const detectMissingDoses = (completedDoses = {}, schedule = {}) => {
  const missing = {};

  Object.keys(schedule).forEach(vaccineKey => {
    const vaccine = schedule[vaccineKey];
    const completedForVaccine = completedDoses[vaccine.name] || { count: 0, doses: [] };
    const completedDoseNumbers = new Set(completedForVaccine.doses);

    const missingDoses = vaccine.doses.filter(dose =>
      !completedDoseNumbers.has(dose.number),
    );

    if (missingDoses.length > 0) {
      missing[vaccine.name] = {
        vaccine: vaccineKey,
        missingDoses: missingDoses.map(dose => dose.number),
        nextDose: missingDoses[0], // First missing dose
      };
    }
  });

  return missing;
};

const calculateNextValidDose = (dobString, vaccinationHistory = [], schedule = VACCINE_SCHEDULE) => {
  if (!dobString) {
    return null;
  }

  const ageInMonths = calculateAgeInMonths(dobString);

  const completedDoses = calculateCompletedDoses(vaccinationHistory);
  const missingDoses = detectMissingDoses(completedDoses, schedule);

  let nextDoseInfo = null;
  let minAgeDiff = Infinity;

  // Find the earliest age-appropriate missing dose
  Object.keys(missingDoses).forEach(vaccineName => {
    const missing = missingDoses[vaccineName];
    const vaccineSchedule = schedule[missing.vaccine];

    missing.missingDoses.forEach(doseNumber => {
      const doseInfo = vaccineSchedule.doses.find(d => d.number === doseNumber);
      if (doseInfo && doseInfo.ageInMonths <= ageInMonths) {
        const ageDiff = ageInMonths - doseInfo.ageInMonths;
        if (ageDiff < minAgeDiff) {
          minAgeDiff = ageDiff;
          nextDoseInfo = {
            vaccine: vaccineName,
            vaccineKey: missing.vaccine,
            doseNumber: doseNumber,
            ageInMonths: doseInfo.ageInMonths,
            daysOverdue: ageDiff * 30.44, // Convert to days
            isOverdue: ageDiff > 0,
          };
        }
      }
    });
  });

  // If no age-appropriate dose found, find the next upcoming dose
  if (!nextDoseInfo) {
    Object.keys(schedule).forEach(vaccineKey => {
      const vaccine = schedule[vaccineKey];
      const completedForVaccine = completedDoses[vaccine.name] || { count: 0, doses: [] };
      const completedDoseNumbers = new Set(completedForVaccine.doses);

      vaccine.doses.forEach(dose => {
        if (!completedDoseNumbers.has(dose.number) && dose.ageInMonths > ageInMonths) {
          const ageDiff = dose.ageInMonths - ageInMonths;
          if (ageDiff < minAgeDiff) {
            minAgeDiff = ageDiff;
            nextDoseInfo = {
              vaccine: vaccine.name,
              vaccineKey: vaccineKey,
              doseNumber: dose.number,
              ageInMonths: dose.ageInMonths,
              daysUntil: ageDiff * 30.44, // Convert to days
              isOverdue: false,
            };
          }
        }
      });
    });
  }

  return nextDoseInfo;
};

const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

const getHolidayInfo = (date) => {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const holidays = [
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

  return holidays.find(h => h.month === month && h.day === day) || null;
};

const findEarliestValidDate = (startDateStr, clinicId = null) => {
  const startDate = new Date(startDateStr);
  const maxDaysToCheck = 90; // Look ahead 3 months

  for (let i = 0; i < maxDaysToCheck; i++) {
    const checkDate = new Date(startDate);
    checkDate.setDate(checkDate.getDate() + i);

    // Skip weekends
    if (isWeekend(checkDate)) {
      continue;
    }

    // Skip holidays
    const holiday = getHolidayInfo(checkDate);
    if (holiday) {
      continue;
    }

    // Return the first valid date found
    return checkDate.toISOString().split('T')[0];
  }

  // If no valid date found in the period, return null
  return null;
};

const generateAppointmentSuggestions = async ({ infantId, guardianId, clinicId = null }) => {
  const client = pool;

  try {
    // Get infant details
    const infantResult = await client.query(
      'SELECT id, first_name, last_name, dob, guardian_id FROM patients WHERE id = $1',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      throw new Error('Infant not found');
    }

    const infant = infantResult.rows[0];

    // Verify ownership if guardianId provided
    if (guardianId && infant.guardian_id !== parseInt(guardianId, 10)) {
      throw new Error('Access denied: Infant does not belong to this guardian');
    }

    // Get vaccination history
    const vaccinationsResult = await client.query(
      `SELECT vr.vaccine_id, vr.dose_no, vr.administered_at, v.name as vaccine_name
       FROM vaccination_records vr
       JOIN vaccines v ON vr.vaccine_id = v.id
       WHERE vr.infant_id = $1
       ORDER BY vr.administered_at`,
      [infantId],
    );

    const vaccinationHistory = vaccinationsResult.rows.map(record => ({
      vaccine: record.vaccine_name, // Use vaccine name for consistency with our schedule
      dose_no: record.dose_no,
      date_administered: record.administered_at,
    }));

    // Calculate next valid dose
    const nextDoseInfo = calculateNextValidDose(infant.dob, vaccinationHistory);

    if (!nextDoseInfo) {
      return {
        suggestions: [],
        message: 'No upcoming vaccines due for this child',
        infant: {
          id: infant.id,
          name: `${infant.first_name} ${infant.last_name}`,
          dob: infant.dob,
        },
      };
    }

    // Find earliest valid date for the vaccine
    const earliestValidDate = findEarliestValidDate(new Date().toISOString().split('T')[0], clinicId);

    if (!earliestValidDate) {
      return {
        suggestions: [],
        message: 'No valid appointment dates available in the next 3 months',
        infant: {
          id: infant.id,
          name: `${infant.first_name} ${infant.last_name}`,
          dob: infant.dob,
        },
        nextDoseInfo,
      };
    }

    // Get available time slots for that date with stock-aware checking
    const appointmentService = require('./appointmentSchedulingService');
    // Map vaccine name to ID (simplified mapping - in production this would come from database)
    const vaccineNameToIdMap = {
      'hep_b': 1, // Hepatitis B
      'bcg': 2,   // BCG
      'penta': 3, // Pentavalent
      'opv': 4,   // Oral Polio Vaccine
      'ipv': 5,   // Inactivated Polio Vaccine
      'pcv': 6,   // Pneumococcal Conjugate Vaccine
      'mcv': 7,   // Measles Vaccine
    };
    const vaccineId = vaccineNameToIdMap[nextDoseInfo.vaccineKey] || null;

    const availabilityResult = await appointmentService.getAvailableTimeSlots({
      scheduled_date: earliestValidDate,
      vaccine_id: vaccineId,
      clinic_id: clinicId,
    });

    // Format suggestions
    const suggestions = availabilityResult.available && availabilityResult.slots && availabilityResult.slots.length > 0
      ? availabilityResult.slots.slice(0, 5).map(time => ({
        date: earliestValidDate,
        time,
        vaccine: nextDoseInfo.vaccine,
        doseNumber: nextDoseInfo.doseNumber,
        daysUntil: nextDoseInfo.daysUntil || 0,
        isOverdue: nextDoseInfo.isOverdue || false,
      }))
      : [];

    return {
      suggestions,
      message: suggestions.length > 0
        ? `Found ${suggestions.length} suggested appointment slots for ${nextDoseInfo.vaccine} dose ${nextDoseInfo.doseNumber}`
        : `No time slots available on the earliest valid date (${earliestValidDate}) for ${nextDoseInfo.vaccine} dose ${nextDoseInfo.doseNumber}`,
      infant: {
        id: infant.id,
        name: `${infant.first_name} ${infant.last_name}`,
        dob: infant.dob,
      },
      nextDoseInfo,
      earliestValidDate,
      totalSlotsAvailable: availabilityResult.slots ? availabilityResult.slots.length : 0,
    };
  } catch (error) {
    console.error('Error generating appointment suggestions:', error);
    throw error;
  }
};

// Get suggested appointments with readiness and stock integration
const getSuggestedAppointments = async ({ childId, facilityId = 'san_nicolas' }) => {
  try {
    // Step 1: Get vaccine readiness from vaccine rules engine
    const readinessResult = await calculateVaccineReadiness(childId);

    if (!readinessResult.success) {
      return {
        success: false,
        error: readinessResult.error,
      };
    }

    const readiness = readinessResult.data;

    // Step 2: Check if child is ready for vaccination
    if (readiness.readinessStatus === 'PENDING_CONFIRMATION') {
      return {
        success: false,
        error: 'Child is pending admin confirmation. Cannot book appointment yet.',
        readinessStatus: readiness.readinessStatus,
      };
    }

    if (readiness.readinessStatus === 'UPCOMING') {
      return {
        success: false,
        error: 'No vaccines are currently due. Please check back later.',
        readinessStatus: readiness.readinessStatus,
      };
    }

    // Step 3: Get next eligible vaccine
    const nextVaccine = readiness.nextAppointmentPrediction;

    if (!nextVaccine) {
      return {
        success: false,
        error: 'No upcoming vaccines found for this child.',
        readinessStatus: readiness.readinessStatus,
      };
    }

    // Step 4: Check vaccine stock availability
    const stockCheck = await checkVaccineStock(nextVaccine.vaccineId, facilityId);

    if (!stockCheck.available) {
      return {
        success: false,
        error: stockCheck.message || 'Vaccine stock is currently unavailable.',
        readinessStatus: readiness.readinessStatus,
        stockStatus: 'unavailable',
        nextAvailableDate: stockCheck.nextAvailableDate,
      };
    }

    // Step 5: Find available slots
    const earliestValidDate = findEarliestValidDate(nextVaccine.date || new Date().toISOString().split('T')[0], facilityId);

    if (!earliestValidDate) {
      return {
        success: false,
        error: 'No available appointment slots found in the next 3 months.',
        readinessStatus: readiness.readinessStatus,
        stockStatus: 'available',
      };
    }

    // Step 6: Get time slots
    const appointmentService = require('./appointmentSchedulingService');
    const availabilityResult = await appointmentService.getAvailableTimeSlots({
      scheduled_date: earliestValidDate,
      clinic_id: facilityId,
    });

    // Step 7: Format suggestions
    const suggestions = availabilityResult.available && availabilityResult.slots && availabilityResult.slots.length > 0
      ? availabilityResult.slots.slice(0, 5).map(time => ({
        date: earliestValidDate,
        time,
        vaccineId: nextVaccine.vaccineId,
        vaccine: nextVaccine.label,
        recommendedDate: nextVaccine.recommendedDate,
        isOverdue: readiness.readinessStatus === 'OVERDUE',
      }))
      : [];

    return {
      success: true,
      data: {
        readinessStatus: readiness.readinessStatus,
        nextVaccine: {
          ...nextVaccine,
          stockAvailable: stockCheck.available,
        },
        suggestions,
        earliestValidDate,
        totalSlotsAvailable: availabilityResult.slots ? availabilityResult.slots.length : 0,
      },
    };
  } catch (error) {
    console.error('Error getting suggested appointments:', error);
    return {
      success: false,
      error: 'Failed to generate appointment suggestions',
    };
  }
};

// Check vaccine stock availability
const checkVaccineStock = async (vaccineId, facilityId) => {
  try {
    // Get stock for the vaccine at the facility
    const stockResult = await pool.query(
      `SELECT
        SUM(quantity) as total_quantity,
        MIN(expiry_date) as earliest_expiry
       FROM vaccine_inventory
       WHERE vaccine_id = $1
         AND facility_id = $2
         AND quantity > 0
         AND expiry_date > CURRENT_DATE
       GROUP BY vaccine_id`,
      [vaccineId, facilityId],
    );

    if (stockResult.rows.length === 0 || parseInt(stockResult.rows[0].total_quantity, 10) <= 0) {
      return {
        available: false,
        message: 'Vaccine is out of stock',
        nextAvailableDate: null,
      };
    }

    return {
      available: true,
      quantity: parseInt(stockResult.rows[0].total_quantity, 10),
      earliestExpiry: stockResult.rows[0].earliest_expiry,
    };
  } catch (error) {
    console.error('Error checking vaccine stock:', error);
    return {
      available: false,
      message: 'Unable to verify stock availability',
      nextAvailableDate: null,
    };
  }
};

module.exports = {
  generateAppointmentSuggestions,
  calculateNextValidDose,
  findEarliestValidDate,
  getSuggestedAppointments,
  checkVaccineStock,
};
