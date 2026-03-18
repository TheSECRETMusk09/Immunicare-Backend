const pool = require('../db');

// Validation statuses
const VALIDATION_STATUS = {
  APPROVED: 'approved',
  FOR_VALIDATION: 'for_validation',
  NEEDS_CLARIFICATION: 'needs_clarification',
  REJECTED: 'rejected',
};

// Vaccine validation rules
const VACCINE_RULES = {
  // BCG vaccine rules
  bcg: {
    name: 'BCG',
    validAgeRange: { min: 0, max: 12 }, // months
    validDoses: 1,
    minInterval: null, // No booster dose
  },
  // Hepatitis B vaccine rules
  hep_b: {
    name: 'Hepatitis B',
    validAgeRange: { min: 0, max: 24 },
    validDoses: 3,
    minInterval: { 1: null, 2: 28, 3: 84 }, // days between doses
  },
  // Pentavalent vaccine rules
  penta: {
    name: 'Pentavalent',
    validAgeRange: { min: 6, max: 24 }, // weeks
    validDoses: 3,
    minInterval: { 1: null, 2: 28, 3: 84 },
  },
  // Oral Polio Vaccine rules
  opv: {
    name: 'Oral Polio Vaccine',
    validAgeRange: { min: 6, max: 24 },
    validDoses: 3,
    minInterval: { 1: null, 2: 28, 3: 84 },
  },
  // Inactivated Polio Vaccine rules
  ipv: {
    name: 'Inactivated Polio Vaccine',
    validAgeRange: { min: 6, max: 24 },
    validDoses: 2,
    minInterval: { 1: null, 2: 56 },
  },
  // Pneumococcal Conjugate Vaccine rules
  pcv: {
    name: 'Pneumococcal Conjugate Vaccine',
    validAgeRange: { min: 6, max: 24 },
    validDoses: 3,
    minInterval: { 1: null, 2: 28, 3: 84 },
  },
  // Measles Vaccine rules
  mcv: {
    name: 'Measles Vaccine',
    validAgeRange: { min: 9, max: 24 }, // months
    validDoses: 2,
    minInterval: { 1: null, 2: 180 },
  },
};

// Convert age in days to months (approximate)
const daysToMonths = (days) => days / MONTHS_TO_DAYS;

// Convert age in days to weeks
const daysToWeeks = (days) => days / WEEKS_TO_DAYS;

// Constants for age conversion
const WEEKS_TO_DAYS = 7;
const DAYS_TO_WEEKS = 1 / 7;
const MONTHS_TO_DAYS = 30.44;

// Validate a single vaccination record
const validateVaccineRecord = (record, childDob) => {
  const errors = [];
  const warnings = [];

  const vaccineDate = new Date(record.date_administered);
  const childBirthDate = new Date(childDob);
  const ageInDays = Math.floor((vaccineDate - childBirthDate) / (1000 * 60 * 60 * 24));

  // Validate vaccine code exists in rules
  if (!VACCINE_RULES[record.vaccine_code]) {
    errors.push('Invalid vaccine code');
    return { valid: false, errors, warnings };
  }

  const vaccineRules = VACCINE_RULES[record.vaccine_code];

  // Validate age at administration
  const ageUnit = record.vaccine_code === 'bcg' || record.vaccine_code === 'mcv' ? 'months' : 'weeks';
  const age = ageUnit === 'months' ? daysToMonths(ageInDays) : daysToWeeks(ageInDays);

  if (age < vaccineRules.validAgeRange.min || age > vaccineRules.validAgeRange.max) {
    errors.push(`Vaccine administered outside valid age range (${vaccineRules.validAgeRange.min}-${vaccineRules.validAgeRange.max} ${ageUnit})`);
  }

  // Validate dose number
  if (record.dose_number < 1 || record.dose_number > vaccineRules.validDoses) {
    errors.push(`Invalid dose number (valid range: 1-${vaccineRules.validDoses})`);
  }

  // Validate date format
  if (isNaN(vaccineDate.getTime())) {
    errors.push('Invalid date format');
  }

  // Check if date is in future
  if (vaccineDate > new Date()) {
    errors.push('Vaccine date cannot be in the future');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};

// Validate entire vaccination history
const validateVaccinationHistory = async (childProfile, vaccinationHistory, facilityContext) => {
  const validationSummary = {
    validDoses: 0,
    duplicateDoses: 0,
    invalidDates: 0,
    invalidDoses: 0,
    invalidVaccines: 0,
    totalDoses: vaccinationHistory.length,
    errors: [],
    warnings: [],
    vaccineErrors: {},
  };

  const vaccineRecords = [];
  const seenVaccines = {};

  // Facility-specific vaccine availability (example implementation)
  // In a real system, this would come from a database or configuration
  const facilityVaccineAvailability = {
    // Example: facility_id => array of available vaccine codes
    'san_nicolas': ['bcg', 'hep_b', 'penta', 'opv', 'ipv', 'pcv', 'mcv'],
    'rural_health_unit': ['bcg', 'hep_b', 'penta', 'opv'], // Limited vaccines
    // Add more facilities as needed
  };

  // Get available vaccines for this facility (default to all if facility not found)
  const availableVaccines = facilityVaccineAvailability[facilityContext] || Object.keys(VACCINE_RULES);

  // Validate each record
  for (let i = 0; i < vaccinationHistory.length; i++) {
    const record = vaccinationHistory[i];

    // Facility-aware rule: Check if vaccine is available at this facility
    if (!availableVaccines.includes(record.vaccine_code)) {
      const validation = {
        valid: false,
        errors: [`Vaccine ${record.vaccine_code} not available at facility ${facilityContext}`],
        warnings: [],
      };

      validationSummary.errors.push(...validation.errors);
      validationSummary.warnings.push(...validation.warnings);
      vaccineRecords.push({
        ...record,
        validation,
      });

      // Track as invalid vaccine due to facility restriction
      validationSummary.invalidVaccines++;
      continue;
    }

    const validation = validateVaccineRecord(record, childProfile.dob);

    // Check for duplicates
    const vaccineKey = `${record.vaccine_code}_${record.dose_number}`;
    if (seenVaccines[vaccineKey]) {
      validationSummary.duplicateDoses++;
      validation.errors.push('Duplicate dose');
    }
    seenVaccines[vaccineKey] = true;

    // Track validation results
    if (validation.valid) {
      validationSummary.validDoses++;
    } else {
      if (validation.errors.some(error => error.includes('Invalid date') || error.includes('future'))) {
        validationSummary.invalidDates++;
      } else if (validation.errors.some(error => error.includes('Invalid dose'))) {
        validationSummary.invalidDoses++;
      } else if (validation.errors.some(error => error.includes('Invalid vaccine'))) {
        validationSummary.invalidVaccines++;
      }
    }

    validationSummary.errors.push(...validation.errors);
    validationSummary.warnings.push(...validation.warnings);
    vaccineRecords.push({
      ...record,
      validation,
    });
  }

  // Determine overall validation status
  let overallStatus = VALIDATION_STATUS.APPROVED;
  let nextAction = 'Ready for scheduling';

  if (validationSummary.duplicateDoses > 0 || validationSummary.invalidDates > 0 ||
      validationSummary.invalidDoses > 0 || validationSummary.invalidVaccines > 0) {
    overallStatus = VALIDATION_STATUS.FOR_VALIDATION;
    nextAction = 'Needs nurse review';

    if (validationSummary.invalidVaccines > 0 || validationSummary.invalidDoses > 0) {
      overallStatus = VALIDATION_STATUS.NEEDS_CLARIFICATION;
      nextAction = 'Requires additional information';
    }
  }

  return {
    success: true,
    data: {
      validationSummary,
      vaccineRecords,
      status: overallStatus,
      nextAction,
    },
  };
};

// Calculate vaccine readiness and next eligible vaccine
const calculateVaccineReadiness = async (infantId) => {
  try {
    // Get infant details
    const infantResult = await pool.query(
      'SELECT id, first_name, last_name, dob FROM patients WHERE id = $1 AND is_active = true',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      throw new Error('Infant not found');
    }

    const infant = infantResult.rows[0];
    const today = new Date();
    const dob = new Date(infant.dob);
    const ageInDays = Math.floor((today - dob) / (1000 * 60 * 60 * 24));

    // Get completed vaccinations
    const completedResult = await pool.query(
      `SELECT DISTINCT vaccine_id, MAX(dose_no) as dose_no
       FROM immunization_records
       WHERE patient_id = $1 AND is_active = true AND status = 'completed'
       GROUP BY vaccine_id`,
      [infantId],
    );

    const completedVaccines = {};
    completedResult.rows.forEach(record => {
      completedVaccines[record.vaccine_id] = record.dose_no;
    });

    // Get vaccination schedules
    const schedulesResult = await pool.query(
      `SELECT vs.*, v.name as vaccine_name, v.code as vaccine_code
       FROM vaccination_schedules vs
       JOIN vaccines v ON vs.vaccine_id = v.id
       WHERE vs.is_active = true
       ORDER BY vs.age_in_months ASC, vs.vaccine_name ASC`,
    );

    const readinessResult = await pool.query(
      `SELECT ivr.*, v.name as vaccine_name
       FROM infant_vaccine_readiness ivr
       JOIN vaccines v ON ivr.vaccine_id = v.id
       WHERE ivr.infant_id = $1 AND ivr.is_active = true`,
      [infantId],
    );

    const readinessMap = {};
    readinessResult.rows.forEach(record => {
      readinessMap[record.vaccine_id] = {
        isReady: record.is_ready,
        confirmedBy: record.ready_confirmed_by,
        confirmedAt: record.ready_confirmed_at,
        notes: record.notes,
      };
    });

    const dueVaccines = [];
    const overdueVaccines = [];
    const blockedVaccines = [];

    schedulesResult.rows.forEach(schedule => {
      const dosesCompleted = completedVaccines[schedule.vaccine_id] || 0;
      const isComplete = dosesCompleted >= schedule.total_doses;
      const readiness = readinessMap[schedule.vaccine_id] || { isReady: false };

      const dueDate = new Date(dob);
      dueDate.setDate(dueDate.getDate() + (schedule.minimum_age_days || schedule.age_in_months * 30));

      const isOverdue = !isComplete && dueDate < today;
      const ageRequirementMet = ageInDays >= (schedule.minimum_age_days || schedule.age_in_months * 30);

      if (!isComplete) {
        if (ageRequirementMet && readiness.isReady) {
          if (isOverdue) {
            overdueVaccines.push({
              vaccineId: schedule.vaccine_id,
              label: schedule.vaccine_name,
              earliestDate: dueDate.toISOString().split('T')[0],
              recommendedDate: dueDate.toISOString().split('T')[0],
            });
          } else {
            dueVaccines.push({
              vaccineId: schedule.vaccine_id,
              label: schedule.vaccine_name,
              earliestDate: dueDate.toISOString().split('T')[0],
              recommendedDate: dueDate.toISOString().split('T')[0],
            });
          }
        } else if (ageRequirementMet && !readiness.isReady) {
          blockedVaccines.push({
            vaccineId: schedule.vaccine_id,
            label: schedule.vaccine_name,
            reason: 'Pending admin confirmation',
          });
        }
      }
    });

    // Find next eligible vaccine
    let nextEligibleVaccine = null;
    if (dueVaccines.length > 0) {
      nextEligibleVaccine = dueVaccines[0];
    } else if (overdueVaccines.length > 0) {
      nextEligibleVaccine = overdueVaccines[0];
    } else if (blockedVaccines.length > 0) {
      nextEligibleVaccine = blockedVaccines[0];
    }

    let readinessStatus = 'UPCOMING';
    if (overdueVaccines.length > 0) {
      readinessStatus = 'OVERDUE';
    } else if (dueVaccines.length > 0) {
      readinessStatus = 'READY';
    } else if (blockedVaccines.length > 0) {
      readinessStatus = 'PENDING_CONFIRMATION';
    }

    return {
      success: true,
      data: {
        childId: infantId,
        readinessStatus,
        dueVaccines,
        overdueVaccines,
        blockedVaccines,
        nextAppointmentPrediction: nextEligibleVaccine ? {
          date: nextEligibleVaccine.earliestDate,
          reason: 'Earliest safe date for next eligible dose',
        } : null,
      },
    };
  } catch (error) {
    console.error('Error calculating vaccine readiness:', error);
    return {
      success: false,
      error: 'Failed to calculate vaccine readiness',
    };
  }
};

// Export the service
module.exports = {
  validateVaccinationHistory,
  calculateVaccineReadiness,
  VALIDATION_STATUS,
};
