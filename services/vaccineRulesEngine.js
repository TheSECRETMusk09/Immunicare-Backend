const pool = require('../db');
const {
  ensureAtBirthVaccinationRecords,
  ensureGlobalAtBirthVaccinationBackfillInitialized,
} = require('./atBirthVaccinationService');
const immunizationScheduleService = require('./immunizationScheduleService');

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
const calculateVaccineReadiness = async (infantId, options = {}) => {
  try {
    ensureGlobalAtBirthVaccinationBackfillInitialized().catch(() => {});

    // Get infant details
    const infantResult = await pool.query(
      'SELECT id, first_name, last_name, dob FROM patients WHERE id = $1 AND is_active = true',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      throw new Error('Infant not found');
    }

    const infant = infantResult.rows[0];

    // Normalize legacy child records so built-in birth doses exist in the
    // canonical immunization_records source before schedule readiness is derived.
    await ensureAtBirthVaccinationRecords(infant.id, {
      patientDob: infant.dob,
    });

    const guardianProjection = await immunizationScheduleService.getGuardianScheduleProjection(
      infant.id,
      null,
      {
        referenceDate: options.referenceDate || options.scheduledDate || null,
      },
    );
    if (guardianProjection?.error) {
      throw new Error(guardianProjection.error);
    }

    const readiness = guardianProjection?.readiness || {};

    return {
      success: true,
      data: {
        childId: infantId,
        readinessStatus: readiness.readinessStatus || 'UPCOMING',
        dueVaccines: Array.isArray(readiness.dueVaccines) ? readiness.dueVaccines : [],
        overdueVaccines: Array.isArray(readiness.overdueVaccines) ? readiness.overdueVaccines : [],
        blockedVaccines: Array.isArray(readiness.blockedVaccines) ? readiness.blockedVaccines : [],
        nextAppointmentPrediction: readiness.nextAppointmentPrediction || null,
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
