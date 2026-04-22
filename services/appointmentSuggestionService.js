const pool = require('../db');
const { calculateVaccineReadiness } = require('./vaccineRulesEngine');
const NotificationService = require('./notificationService');
const appointmentSchedulingService = require('./appointmentSchedulingService');
const {
  CLINIC_TODAY_SQL,
  getClinicTodayDateKey,
  shiftClinicDateKey,
  toClinicDateKey,
} = require('../utils/clinicCalendar');

const notificationService = new NotificationService();

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
  const todayKey = getClinicTodayDateKey();
  const today = todayKey ? new Date(`${todayKey}T12:00:00`) : new Date();
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

const findEarliestValidDate = async (startDateStr, clinicId = null) => {
  const startDateKey = toClinicDateKey(startDateStr);
  const maxDaysToCheck = 90; // Look ahead 3 months

  if (!startDateKey) {
    return null;
  }

  for (let i = 0; i < maxDaysToCheck; i++) {
    const candidateDateKey = shiftClinicDateKey(startDateKey, i);
    if (!candidateDateKey) {
      continue;
    }

    const appointmentAvailability = await appointmentSchedulingService.checkBookingAvailability({
      scheduledDate: candidateDateKey,
      clinicId,
    });

    if (appointmentAvailability.available) {
      return candidateDateKey;
    }
  }

  // If no valid date found in the period, return null
  return null;
};

const toDateKey = (value) => {
  return toClinicDateKey(value);
};

const resolveNextVaccineFromReadiness = (readiness = {}) => {
  const prioritizedVaccine =
    readiness?.overdueVaccines?.[0] || readiness?.dueVaccines?.[0] || null;

  if (!prioritizedVaccine) {
    return null;
  }

  const doseMatch = String(prioritizedVaccine.label || '').match(/dose\s+(\d+)/i);

  return {
    vaccineId: prioritizedVaccine.vaccineId || null,
    vaccineCode: prioritizedVaccine.vaccineCode || null,
    label: prioritizedVaccine.label || 'Due vaccine',
    doseNumber:
      Number.isInteger(prioritizedVaccine.doseNumber)
        ? prioritizedVaccine.doseNumber
        : doseMatch
          ? parseInt(doseMatch[1], 10)
          : null,
    earliestDate:
      prioritizedVaccine.earliestDate ||
      readiness?.nextAppointmentPrediction?.date ||
      toDateKey(new Date()),
    recommendedDate:
      prioritizedVaccine.recommendedDate ||
      prioritizedVaccine.earliestDate ||
      readiness?.nextAppointmentPrediction?.date ||
      null,
    reason:
      readiness?.nextAppointmentPrediction?.reason ||
      (readiness?.readinessStatus === 'OVERDUE'
        ? 'Overdue child prioritized for the earliest safe clinic slot'
        : 'Earliest safe clinic slot based on due vaccine rules'),
    isOverdue: readiness?.readinessStatus === 'OVERDUE',
  };
};

const buildSuggestionNotificationKey = ({
  guardianId,
  infantId,
  vaccineId,
  vaccineCode,
  doseNumber,
  suggestedDate,
}) => {
  return [
    'appointment_suggested',
    guardianId || 'guardian',
    infantId || 'infant',
    vaccineId || vaccineCode || 'vaccine',
    doseNumber || 'dose',
    toDateKey(suggestedDate) || suggestedDate || 'date',
  ].join(':');
};

const findFirstSchedulableSlotWindow = async ({
  startDate,
  vaccineId,
  clinicId = null,
  maxDaysToCheck = 90,
}) => {
  const appointmentSchedulingService = require('./appointmentSchedulingService');
  const normalizedStartDate = toDateKey(startDate) || getClinicTodayDateKey();

  if (!normalizedStartDate) {
    return null;
  }

  for (let dayOffset = 0; dayOffset < maxDaysToCheck; dayOffset += 1) {
    const candidateDateKey = shiftClinicDateKey(normalizedStartDate, dayOffset);
    if (!candidateDateKey) {
      continue;
    }

    const slotWindow = await appointmentSchedulingService.getAvailableTimeSlots({
      scheduledDate: candidateDateKey,
      vaccineId,
      clinicId,
    });

    if (slotWindow?.available && Array.isArray(slotWindow.slots) && slotWindow.slots.length > 0) {
      return {
        date: candidateDateKey,
        slotWindow,
      };
    }
  }

  return null;
};

const generateAppointmentSuggestions = async ({ infantId, guardianId, clinicId = null }) => {
  const client = pool;

  try {
    const normalizedInfantId = parseInt(infantId, 10);
    const normalizedGuardianId = guardianId ? parseInt(guardianId, 10) : null;
    const normalizedClinicId = clinicId ? parseInt(clinicId, 10) : null;

    const infantResult = await client.query(
      'SELECT id, first_name, last_name, dob, guardian_id FROM patients WHERE id = $1',
      [normalizedInfantId],
    );

    if (infantResult.rows.length === 0) {
      throw new Error('Infant not found');
    }

    const infant = infantResult.rows[0];

    if (normalizedGuardianId && infant.guardian_id !== normalizedGuardianId) {
      throw new Error('Access denied: Infant does not belong to this guardian');
    }

    const readinessResult = await calculateVaccineReadiness(normalizedInfantId);
    const readiness = readinessResult?.success ? readinessResult.data || {} : {};
    const nextDoseInfo = resolveNextVaccineFromReadiness(readiness);

    if (!nextDoseInfo) {
      return {
        suggestions: [],
        message:
          readiness?.readinessStatus === 'PENDING_CONFIRMATION'
            ? 'Child still requires admin confirmation before a vaccine appointment can be booked.'
            : 'No upcoming vaccines due for this child',
        infant: {
          id: infant.id,
          name: `${infant.first_name} ${infant.last_name}`,
          dob: infant.dob,
        },
        readinessStatus: readiness?.readinessStatus || 'UPCOMING',
      };
    }

    const earliestSlotWindow = await findFirstSchedulableSlotWindow({
      startDate: nextDoseInfo.earliestDate || new Date(),
      vaccineId: nextDoseInfo.vaccineId,
      clinicId: normalizedClinicId,
    });

    if (!earliestSlotWindow) {
      return {
        suggestions: [],
        message: `No valid appointment dates with available stock were found for ${nextDoseInfo.label} in the next 3 months`,
        infant: {
          id: infant.id,
          name: `${infant.first_name} ${infant.last_name}`,
          dob: infant.dob,
        },
        readinessStatus: readiness?.readinessStatus || 'UPCOMING',
        nextDoseInfo,
      };
    }

    const suggestions = earliestSlotWindow.slotWindow.slots.slice(0, 5).map((time) => ({
      infant_id: infant.id,
      infant_name: `${infant.first_name} ${infant.last_name}`.trim(),
      suggestedDate: earliestSlotWindow.date,
      suggestedTime: time,
      date: earliestSlotWindow.date,
      time,
      vaccineId: nextDoseInfo.vaccineId,
      vaccine: nextDoseInfo.label,
      doseNumber: nextDoseInfo.doseNumber,
      recommendedDate: nextDoseInfo.recommendedDate,
      reason: nextDoseInfo.reason,
      priority: nextDoseInfo.isOverdue ? 'high' : 'normal',
      isOverdue: nextDoseInfo.isOverdue,
      bookedSlots: Array.isArray(earliestSlotWindow.slotWindow.bookedSlots)
        ? earliestSlotWindow.slotWindow.bookedSlots.length
        : 0,
    }));

    if (normalizedGuardianId && suggestions.length > 0) {
      try {
        const primarySuggestion = suggestions[0];
        const suggestionDedupeKey = buildSuggestionNotificationKey({
          guardianId: normalizedGuardianId,
          infantId: infant.id,
          vaccineId: nextDoseInfo.vaccineId,
          vaccineCode: nextDoseInfo.vaccineCode,
          doseNumber: nextDoseInfo.doseNumber,
          suggestedDate: primarySuggestion.date,
        });

        await notificationService.sendNotification({
          notification_type: 'appointment_suggested',
          target_type: 'guardian',
          target_id: normalizedGuardianId,
          guardian_id: normalizedGuardianId,
          channel: 'push',
          priority: 'normal',
          subject: 'Suggested appointment available',
          title: 'Suggested appointment available',
          message: `A suggested appointment is available for ${infant.first_name} ${infant.last_name}: ${nextDoseInfo.label} on ${primarySuggestion.date} at ${primarySuggestion.time}.`,
          idempotency_key: suggestionDedupeKey,
          target_role: 'guardian',
          category: 'appointment',
          metadata: {
            infant_id: infant.id,
            vaccine_id: nextDoseInfo.vaccineId,
            vaccine_code: nextDoseInfo.vaccineCode || null,
            dose_number: nextDoseInfo.doseNumber || null,
            suggested_date: primarySuggestion.date,
            suggested_time: primarySuggestion.time,
            clinic_id: normalizedClinicId || null,
            dedupe_key: suggestionDedupeKey,
          },
        });
      } catch (notificationError) {
        console.error('Error sending appointment suggested notification:', notificationError.message);
      }
    }

    return {
      suggestions,
      message: suggestions.length > 0
        ? `Found ${suggestions.length} suggested appointment slots for ${nextDoseInfo.label}`
        : `No time slots available on the earliest valid date for ${nextDoseInfo.label}`,
      infant: {
        id: infant.id,
        name: `${infant.first_name} ${infant.last_name}`,
        dob: infant.dob,
      },
      readinessStatus: readiness?.readinessStatus || 'UPCOMING',
      nextDoseInfo,
      earliestValidDate: earliestSlotWindow.date,
      totalSlotsAvailable: earliestSlotWindow.slotWindow.slots.length,
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
    const earliestValidDate = await findEarliestValidDate(
      nextVaccine.date || getClinicTodayDateKey(),
      facilityId,
    );

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
         AND expiry_date > ${CLINIC_TODAY_SQL}
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
