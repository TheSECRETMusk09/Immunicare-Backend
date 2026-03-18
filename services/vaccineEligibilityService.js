/**
 * Vaccine Eligibility Service
 *
 * Determines which vaccines/doses are eligible for an infant based on:
 * - Vaccination history (already administered vaccines)
 * - Minimum intervals between doses
 * - Age-based eligibility
 * - Contraindications (allergies)
 */

const pool = require('../db');

// Minimum intervals in days between doses
const MIN_INTERVAL_DAYS = {
  SAME_VACCINE: 28, // 4 weeks between doses of the same vaccine
  BIRTH_TO_SECOND: 28, // 4 weeks minimum from birth dose to 2nd dose
};

// Weeks to days conversion
const WEEKS_TO_DAYS = 7;
const MONTHS_TO_DAYS = 30;

/**
 * Get all vaccination records for an infant
 */
const getInfantVaccinationRecords = async (infantId) => {
  const result = await pool.query(
    `
      SELECT
        ir.id,
        ir.patient_id,
        ir.vaccine_id,
        ir.dose_no,
        ir.admin_date,
        ir.status,
        v.name as vaccine_name,
        v.code as vaccine_code
      FROM immunization_records ir
      JOIN vaccines v ON ir.vaccine_id = v.id
      WHERE ir.patient_id = $1
        AND ir.is_active = true
      ORDER BY ir.admin_date ASC
    `,
    [infantId],
  );
  return result.rows;
};

/**
 * Get infant details (DOB)
 */
const getInfantDetails = async (infantId) => {
  const result = await pool.query(
    `
      SELECT id, first_name, last_name, dob, guardian_id
      FROM patients
      WHERE id = $1 AND is_active = true
      LIMIT 1
    `,
    [infantId],
  );
  return result.rows[0] || null;
};

/**
 * Get infant allergies
 */
const getInfantAllergies = async (infantId) => {
  const result = await pool.query(
    `
      SELECT id, infant_id, allergy_type, severity, description, allergen, reaction, is_active
      FROM infant_allergies
      WHERE infant_id = $1 AND is_active = true
    `,
    [infantId],
  );
  return result.rows;
};

/**
 * Get all vaccination schedules
 */
const getVaccinationSchedules = async () => {
  const result = await pool.query(
    `
      SELECT
        vs.id,
        vs.vaccine_id,
        vs.vaccine_name,
        vs.dose_number,
        vs.total_doses,
        vs.age_months,
        vs.age_description,
        vs.description,
        vs.minimum_age_days,
        vs.grace_period_days,
        vs.contraindications,
        v.name as vaccine_name,
        v.code as vaccine_code
      FROM vaccination_schedules vs
      JOIN vaccines v ON vs.vaccine_id = v.id
      WHERE vs.is_active = true
      ORDER BY vs.age_months ASC, vs.vaccine_name ASC
    `,
  );
  return result.rows;
};

/**
 * Get next dose number for a specific vaccine
 */
const getNextDoseNumber = async (infantId, vaccineId) => {
  const result = await pool.query(
    `
      SELECT MAX(dose_no) as max_dose
      FROM immunization_records
      WHERE patient_id = $1
        AND vaccine_id = $2
        AND is_active = true
        AND status = 'completed'
    `,
    [infantId, vaccineId],
  );

  const maxDose = result.rows[0]?.max_dose;
  return maxDose ? parseInt(maxDose, 10) + 1 : 1;
};

/**
 * Get the last dose date for a specific vaccine
 */
const getLastDoseDate = async (infantId, vaccineId) => {
  const result = await pool.query(
    `
      SELECT MAX(admin_date) as last_dose_date
      FROM immunization_records
      WHERE patient_id = $1
        AND vaccine_id = $2
        AND is_active = true
    `,
    [infantId, vaccineId],
  );
  return result.rows[0]?.last_dose_date || null;
};

/**
 * Check if minimum interval has passed since last dose
 */
const checkMinimumInterval = async (infantId, vaccineId) => {
  const lastDoseDate = await getLastDoseDate(infantId, vaccineId);

  if (!lastDoseDate) {
    // No previous dose, check if birth dose interval has passed for 2nd dose
    return { passed: true, daysSinceLastDose: null, reason: null };
  }

  const lastDate = new Date(lastDoseDate);
  const today = new Date();
  const daysSinceLastDose = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));

  const hasPassed = daysSinceLastDose >= MIN_INTERVAL_DAYS.SAME_VACCINE;

  return {
    passed: hasPassed,
    daysSinceLastDose,
    lastDoseDate: lastDoseDate.toISOString().split('T')[0],
    reason: hasPassed ? null : `Must wait ${MIN_INTERVAL_DAYS.SAME_VACCINE - daysSinceLastDose} more days before next dose`,
  };
};

/**
 * Check contraindications for a vaccine
 */
const checkContraindications = async (infantId, vaccineId) => {
  // Get infant allergies
  const allergies = await getInfantAllergies(infantId);

  // Get vaccine details to check contraindications
  const vaccineResult = await pool.query(
    `
      SELECT v.id, v.name, v.code, vs.contraindications
      FROM vaccines v
      LEFT JOIN vaccination_schedules vs ON vs.vaccine_id = v.id
      WHERE v.id = $1
      LIMIT 1
    `,
    [vaccineId],
  );

  const vaccine = vaccineResult.rows[0];
  if (!vaccine) {
    return { contraindicated: false, reasons: [] };
  }

  const reasons = [];

  // Check if infant has any allergies that contraindicate this vaccine
  // Common contraindication patterns
  const contraindicationPatterns = {
    'bcg': ['tuberculosis', 'tb', 'bcg'],
    'hepatitis b': ['hepatitis b', 'hep b', 'hbv'],
    'pentavalent': ['dpt', 'diphtheria', 'pertussis', 'tetanus', 'hep b', 'hib'],
    'polio': ['polio', 'opv', 'ipv'],
    'pcv': ['pneumococcal', 'pcv'],
    'measles': ['measles', 'mumps', 'rubella', 'mmr'],
    'mcv': ['measles', 'mumps', 'rubella', 'mmr'],
    'rotavirus': ['rotavirus'],
    'influenza': ['influenza', 'flu'],
  };

  const vaccineCode = (vaccine.code || '').toLowerCase();
  const patterns = contraindicationPatterns[vaccineCode] || [vaccineCode];

  for (const allergy of allergies) {
    const allergyType = (allergy.allergy_type || '').toLowerCase();
    const allergen = (allergy.allergen || '').toLowerCase();
    const description = (allergy.description || '').toLowerCase();

    // Check if any pattern matches
    for (const pattern of patterns) {
      if (allergyType.includes(pattern) || allergen.includes(pattern) || description.includes(pattern)) {
        reasons.push({
          type: allergy.allergy_type,
          severity: allergy.severity,
          description: allergy.description,
          reaction: allergy.reaction,
        });
        break;
      }
    }
  }

  // Check schedule-based contraindications
  if (vaccine.contraindications) {
    reasons.push({
      type: 'schedule_contraindication',
      description: vaccine.contraindications,
    });
  }

  return {
    contraindicated: reasons.length > 0,
    reasons,
  };
};

/**
 * Calculate infant's age in days
 */
const getInfantAgeInDays = (dob) => {
  const birthDate = new Date(dob);
  const today = new Date();
  return Math.floor((today - birthDate) / (1000 * 60 * 60 * 24));
};

/**
 * Get next dose info for a specific vaccine
 */
const getNextDoseInfo = async (infantId, vaccineId) => {
  const infant = await getInfantDetails(infantId);
  if (!infant) {
    return { error: 'Infant not found' };
  }

  // Get next dose number
  const nextDoseNumber = await getNextDoseNumber(infantId, vaccineId);

  // Get vaccine schedule
  const scheduleResult = await pool.query(
    `
      SELECT *
      FROM vaccination_schedules
      WHERE vaccine_id = $1
        AND dose_number = $2
        AND is_active = true
      LIMIT 1
    `,
    [vaccineId, nextDoseNumber],
  );

  const schedule = scheduleResult.rows[0];

  // Check minimum interval
  const intervalCheck = await checkMinimumInterval(infantId, vaccineId);

  // Check contraindications
  const contraindicationCheck = await checkContraindications(infantId, vaccineId);

  // Calculate age eligibility
  const ageInDays = getInfantAgeInDays(infant.dob);
  const minAgeDays = schedule?.minimum_age_days || (schedule?.age_months * MONTHS_TO_DAYS) || 0;
  const ageEligible = ageInDays >= minAgeDays;

  // Calculate when vaccine will be due
  const dueDate = new Date(infant.dob);
  dueDate.setDate(dueDate.getDate() + minAgeDays);

  // Determine eligibility status
  let status = 'eligible';
  let reason = null;

  if (contraindicationCheck.contraindicated) {
    status = 'contraindicated';
    reason = contraindicationCheck.reasons.map(r => r.description || r.type).join(', ');
  } else if (!ageEligible) {
    status = 'too_early';
    const daysUntilEligible = minAgeDays - ageInDays;
    reason = `Infant must be at least ${minAgeDays} days old (${Math.floor(minAgeDays / 7)} weeks). Eligible in ${daysUntilEligible} days.`;
  } else if (!intervalCheck.passed) {
    status = 'interval_not_met';
    reason = intervalCheck.reason;
  }

  return {
    infantId,
    vaccineId,
    nextDoseNumber,
    schedule: schedule || null,
    status,
    reason,
    ageInDays,
    minAgeDays,
    ageEligible,
    intervalCheck,
    contraindicationCheck,
    dueDate: dueDate.toISOString().split('T')[0],
  };
};

/**
 * Get all eligible vaccines for an infant
 */
const getEligibleVaccines = async (infantId) => {
  const infant = await getInfantDetails(infantId);
  if (!infant) {
    return { error: 'Infant not found', eligibleVaccines: [] };
  }

  // Get all vaccination records
  const records = await getInfantVaccinationRecords(infantId);

  // Get all vaccination schedules
  const schedules = await getVaccinationSchedules();

  // Get infant allergies
  const allergies = await getInfantAllergies(infantId);

  // Calculate age in days
  const ageInDays = getInfantAgeInDays(infant.dob);

  // Group records by vaccine to get max dose for each
  const completedDosesByVaccine = {};
  records.forEach(record => {
    if (!completedDosesByVaccine[record.vaccine_id] || record.dose_no > completedDosesByVaccine[record.vaccine_id]) {
      completedDosesByVaccine[record.vaccine_id] = {
        doseNo: record.dose_no,
        adminDate: record.admin_date,
        vaccineName: record.vaccine_name,
      };
    }
  });

  // Build list of eligible vaccines
  const eligibleVaccines = [];
  const upcomingVaccines = [];
  const notEligibleVaccines = [];
  const completedVaccines = [];

  // Group schedules by vaccine_id
  const schedulesByVaccine = {};
  schedules.forEach(schedule => {
    if (!schedulesByVaccine[schedule.vaccine_id]) {
      schedulesByVaccine[schedule.vaccine_id] = [];
    }
    schedulesByVaccine[schedule.vaccine_id].push(schedule);
  });

  // Check each vaccine
  for (const vaccineId of Object.keys(schedulesByVaccine)) {
    const vaccineSchedules = schedulesByVaccine[vaccineId];
    const completedDose = completedDosesByVaccine[vaccineId];
    const completedCount = completedDose ? completedDose.doseNo : 0;
    const totalDoses = Math.max(...vaccineSchedules.map(s => s.total_doses || s.dose_number));

    // Check if vaccine is fully completed
    if (completedCount >= totalDoses) {
      completedVaccines.push({
        vaccineId: parseInt(vaccineId),
        vaccineName: vaccineSchedules[0].vaccine_name,
        vaccineCode: vaccineSchedules[0].vaccine_code,
        dosesCompleted: completedCount,
        totalDoses,
        lastDoseDate: completedDose?.adminDate,
        status: 'completed',
        reason: 'All doses completed',
      });
      continue;
    }

    // Get next dose number
    const nextDoseNumber = completedCount + 1;

    // Get the next schedule for this dose
    const nextSchedule = vaccineSchedules.find(s => s.dose_number === nextDoseNumber);

    if (!nextSchedule) {
      continue;
    }

    // Check age eligibility
    const minAgeDays = nextSchedule.minimum_age_days || (nextSchedule.age_months * MONTHS_TO_DAYS);
    const ageEligible = ageInDays >= minAgeDays;

    // Check interval since last dose
    let intervalCheck = { passed: true, daysSinceLastDose: 0, reason: null };
    if (completedDose) {
      const lastDate = new Date(completedDose.adminDate);
      const today = new Date();
      const daysSinceLastDose = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
      intervalCheck = {
        passed: daysSinceLastDose >= MIN_INTERVAL_DAYS.SAME_VACCINE,
        daysSinceLastDose,
        lastDoseDate: completedDose.adminDate,
        reason: daysSinceLastDose >= MIN_INTERVAL_DAYS.SAME_VACCINE ? null :
          `Must wait ${MIN_INTERVAL_DAYS.SAME_VACCINE - daysSinceLastDose} more days`,
      };
    }

    // Check contraindications
    const contraindicationCheck = await checkContraindications(infantId, parseInt(vaccineId));

    // Calculate due date
    const dueDate = new Date(infant.dob);
    dueDate.setDate(dueDate.getDate() + minAgeDays);

    // Determine eligibility
    const isContraindicated = contraindicationCheck.contraindicated;
    const isReady = ageEligible && intervalCheck.passed && !isContraindicated;

    // Check if upcoming (within 2 weeks)
    const twoWeeksInDays = 14;
    const daysUntilDue = Math.floor((dueDate - new Date()) / (1000 * 60 * 60 * 24));
    const isUpcoming = daysUntilDue > 0 && daysUntilDue <= twoWeeksInDays && ageEligible;

    const vaccineData = {
      vaccineId: parseInt(vaccineId),
      vaccineName: nextSchedule.vaccine_name,
      vaccineCode: nextSchedule.vaccine_code,
      nextDoseNumber,
      totalDoses,
      dosesCompleted: completedCount,
      minAgeDays,
      ageInDays,
      ageEligible,
      intervalCheck,
      contraindicationCheck,
      dueDate: dueDate.toISOString().split('T')[0],
      daysUntilDue,
      isReady,
      isUpcoming,
      isContraindicated,
      schedule: nextSchedule,
    };

    if (isContraindicated) {
      notEligibleVaccines.push({
        ...vaccineData,
        status: 'contraindicated',
        reason: contraindicationCheck.reasons.map(r => r.description || r.type).join(', '),
      });
    } else if (isReady) {
      eligibleVaccines.push({
        ...vaccineData,
        status: 'ready',
      });
    } else if (isUpcoming) {
      upcomingVaccines.push({
        ...vaccineData,
        status: 'upcoming',
        reason: `Due in ${daysUntilDue} days`,
      });
    } else if (!ageEligible) {
      notEligibleVaccines.push({
        ...vaccineData,
        status: 'too_early',
        reason: `Must be at least ${Math.floor(minAgeDays / 7)} weeks old (${minAgeDays - ageInDays} days to go)`,
      });
    } else if (!intervalCheck.passed) {
      notEligibleVaccines.push({
        ...vaccineData,
        status: 'interval_not_met',
        reason: intervalCheck.reason,
      });
    } else {
      notEligibleVaccines.push({
        ...vaccineData,
        status: 'not_ready',
        reason: 'Not ready for administration',
      });
    }
  }

  // Sort eligible vaccines by due date
  eligibleVaccines.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  upcomingVaccines.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  return {
    infantId,
    infantName: `${infant.first_name} ${infant.last_name}`,
    dateOfBirth: infant.dob,
    ageInDays,
    ageInWeeks: Math.floor(ageInDays / 7),
    ageInMonths: Math.floor(ageInDays / 30),
    eligibleVaccines,
    upcomingVaccines,
    notEligibleVaccines,
    completedVaccines,
    allergyCount: allergies.length,
    hasAllergies: allergies.length > 0,
    allergies,
  };
};

/**
 * Get vaccine readiness for a specific vaccine
 */
const getVaccineReadiness = async (infantId, vaccineId) => {
  const infant = await getInfantDetails(infantId);
  if (!infant) {
    return { error: 'Infant not found', isReady: false };
  }

  const nextDoseInfo = await getNextDoseInfo(infantId, vaccineId);

  return {
    infantId,
    vaccineId,
    isReady: nextDoseInfo.status === 'eligible',
    status: nextDoseInfo.status,
    reason: nextDoseInfo.reason,
    nextDoseNumber: nextDoseInfo.nextDoseNumber,
    dueDate: nextDoseInfo.dueDate,
    ageInDays: nextDoseInfo.ageInDays,
    minAgeDays: nextDoseInfo.minAgeDays,
    intervalCheck: nextDoseInfo.intervalCheck,
    contraindicationCheck: nextDoseInfo.contraindicationCheck,
  };
};

/**
 * Recalculate eligibility after a new vaccination is recorded
 */
const recalculateEligibility = async (infantId) => {
  // Simply call getEligibleVaccines which will rebuild the entire eligibility status
  return await getEligibleVaccines(infantId);
};

module.exports = {
  getEligibleVaccines,
  getNextDoseInfo,
  getVaccineReadiness,
  checkContraindications,
  checkMinimumInterval,
  recalculateEligibility,
  getInfantVaccinationRecords,
  getInfantAllergies,
  MIN_INTERVAL_DAYS,
};
