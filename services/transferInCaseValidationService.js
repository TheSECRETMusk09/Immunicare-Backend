const pool = require('../db');
const { validateApprovedVaccineName } = require('../utils/approvedVaccines');

const resolveClient = (client) => client || pool;

const normalizeDateOnly = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().split('T')[0];
};

const parsePositiveDoseNumber = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const loadExistingCompletedDoseMap = async (client, patientId) => {
  const result = await resolveClient(client).query(
    `
      SELECT vaccine_id, dose_no, admin_date, status
      FROM immunization_records
      WHERE patient_id = $1
        AND COALESCE(is_active, true) = true
        AND (
          LOWER(COALESCE(status, '')) = 'completed'
          OR admin_date IS NOT NULL
        )
      ORDER BY admin_date ASC NULLS LAST, created_at ASC NULLS LAST
    `,
    [patientId],
  );

  const existingDoseMap = new Map();

  result.rows.forEach((row) => {
    const doseKey = `${row.vaccine_id}:${Number(row.dose_no || 1)}`;

    if (!existingDoseMap.has(doseKey)) {
      existingDoseMap.set(doseKey, row);
    }
  });

  return existingDoseMap;
};

const loadVaccineScheduleBundle = async (client, vaccineName) => {
  const result = await resolveClient(client).query(
    `
      SELECT
        v.id AS vaccine_id,
        v.name AS vaccine_name,
        vs.id AS schedule_id,
        COALESCE(vs.dose_number, 1) AS dose_number,
        COALESCE(
          vs.minimum_age_days,
          CASE
            WHEN vs.age_months IS NOT NULL THEN ROUND(vs.age_months * 30.44)::INT
            ELSE NULL
          END
        ) AS minimum_age_days,
        vs.age_months,
        vs.age_description
      FROM vaccines v
      LEFT JOIN vaccination_schedules vs
        ON vs.vaccine_id = v.id
       AND COALESCE(vs.is_active, true) = true
      WHERE v.name = $1
        AND COALESCE(v.is_active, true) = true
      ORDER BY COALESCE(vs.dose_number, 1) ASC
    `,
    [vaccineName],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const [firstRow] = result.rows;
  const schedulesByDose = new Map();

  result.rows.forEach((row) => {
    schedulesByDose.set(Number(row.dose_number || 1), row);
  });

  return {
    vaccineId: firstRow.vaccine_id,
    vaccineName: firstRow.vaccine_name,
    schedulesByDose,
    maxDoseNumber: Math.max(...result.rows.map((row) => Number(row.dose_number || 1))),
  };
};

const validateTransferSubmission = async (
  { patientId, childDob, submittedVaccines = [] },
  { client = null } = {},
) => {
  const dbClient = resolveClient(client);
  const validationSummary = {
    validDoses: 0,
    duplicateDoses: 0,
    invalidDates: 0,
    invalidDoses: 0,
    invalidVaccines: 0,
    totalDoses: Array.isArray(submittedVaccines) ? submittedVaccines.length : 0,
    errors: [],
    warnings: [],
  };

  const todayDateOnly = normalizeDateOnly(new Date());
  const today = todayDateOnly ? new Date(todayDateOnly) : new Date();
  const childDobDateOnly = normalizeDateOnly(childDob);
  const childDobDate = childDobDateOnly ? new Date(childDobDateOnly) : null;

  const vaccineScheduleCache = new Map();
  const existingCompletedDoseMap = await loadExistingCompletedDoseMap(dbClient, patientId);
  const submissionDoseMap = new Map();
  const normalizedRecords = [];
  const diagnostics = [];

  for (let index = 0; index < submittedVaccines.length; index += 1) {
    const record = submittedVaccines[index] || {};
    let canonicalVaccineName = String(record.vaccine_name || '').trim();
    const doseNumber = parsePositiveDoseNumber(record.dose_number);
    const normalizedAdminDate = normalizeDateOnly(record.date_administered);
    let vaccineId = null;
    let scheduleBundle = null;
    let recordHasErrors = false;

    const vaccineNameValidation = validateApprovedVaccineName(record.vaccine_name, {
      fieldName: `submitted_vaccines[${index}].vaccine_name`,
    });

    if (!vaccineNameValidation.valid) {
      validationSummary.invalidVaccines += 1;
      validationSummary.errors.push(vaccineNameValidation.error);
      recordHasErrors = true;
    } else {
      canonicalVaccineName = vaccineNameValidation.vaccineName;

      if (!vaccineScheduleCache.has(canonicalVaccineName)) {
        const scheduleBundleResult = await loadVaccineScheduleBundle(
          dbClient,
          canonicalVaccineName,
        );
        vaccineScheduleCache.set(canonicalVaccineName, scheduleBundleResult);
      }

      scheduleBundle = vaccineScheduleCache.get(canonicalVaccineName);
      vaccineId = scheduleBundle?.vaccineId || null;
    }

    if (!doseNumber) {
      validationSummary.invalidDoses += 1;
      validationSummary.errors.push(
        `submitted_vaccines[${index}].dose_number must be a positive integer.`,
      );
      recordHasErrors = true;
    }

    if (!record.date_administered || !String(record.date_administered).trim()) {
      validationSummary.invalidDates += 1;
      validationSummary.errors.push(
        `Administration date is required for ${canonicalVaccineName || 'the selected vaccine'} dose ${doseNumber || '?'}.`,
      );
      recordHasErrors = true;
    } else if (!normalizedAdminDate) {
      validationSummary.invalidDates += 1;
      validationSummary.errors.push(
        `Invalid administration date for ${canonicalVaccineName || 'the selected vaccine'} dose ${doseNumber || '?'}.`,
      );
      recordHasErrors = true;
    }

    const normalizedRecord = {
      vaccine_name: canonicalVaccineName,
      dose_number: doseNumber || record.dose_number,
      date_administered: normalizedAdminDate,
      batch_number: record.batch_number || null,
      facility_name: record.facility_name || null,
    };

    normalizedRecords.push(normalizedRecord);

    diagnostics.push({
      index,
      canonicalVaccineName,
      doseNumber,
      normalizedAdminDate,
      vaccineId,
      recordHasErrors,
    });

    if (!scheduleBundle || !doseNumber) {
      continue;
    }

    const matchingSchedule = scheduleBundle.schedulesByDose.get(doseNumber);
    if (!matchingSchedule) {
      validationSummary.invalidDoses += 1;
      validationSummary.errors.push(
        `Dose ${doseNumber} is not part of the active schedule for ${canonicalVaccineName}.`,
      );
      diagnostics[index].recordHasErrors = true;
      continue;
    }

    const submissionKey = `${scheduleBundle.vaccineId}:${doseNumber}`;
    if (submissionDoseMap.has(submissionKey)) {
      validationSummary.duplicateDoses += 1;
      validationSummary.errors.push(
        `Duplicate dose detected for ${canonicalVaccineName} dose ${doseNumber}.`,
      );
      diagnostics[index].recordHasErrors = true;
    } else {
      submissionDoseMap.set(submissionKey, {
        index,
        normalizedAdminDate,
      });
    }

    if (existingCompletedDoseMap.has(submissionKey)) {
      validationSummary.duplicateDoses += 1;
      validationSummary.errors.push(
        `${canonicalVaccineName} dose ${doseNumber} is already recorded for this child.`,
      );
      diagnostics[index].recordHasErrors = true;
    }

    if (!normalizedAdminDate || !childDobDate) {
      continue;
    }

    const administeredDate = new Date(normalizedAdminDate);

    if (administeredDate > today) {
      validationSummary.invalidDates += 1;
      validationSummary.errors.push(
        `Administration date for ${canonicalVaccineName} dose ${doseNumber} cannot be in the future.`,
      );
      diagnostics[index].recordHasErrors = true;
    }

    if (administeredDate < childDobDate) {
      validationSummary.invalidDates += 1;
      validationSummary.errors.push(
        `Administration date for ${canonicalVaccineName} dose ${doseNumber} cannot be earlier than the child's date of birth.`,
      );
      diagnostics[index].recordHasErrors = true;
    }

    const minimumAgeDays = Number(matchingSchedule.minimum_age_days);
    if (Number.isFinite(minimumAgeDays) && administeredDate >= childDobDate) {
      const ageInDays = Math.floor(
        (administeredDate.getTime() - childDobDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (ageInDays < minimumAgeDays) {
        validationSummary.invalidDates += 1;
        validationSummary.errors.push(
          `${canonicalVaccineName} dose ${doseNumber} cannot be administered before ${matchingSchedule.age_description || `${minimumAgeDays} days of age`}.`,
        );
        diagnostics[index].recordHasErrors = true;
      }
    }
  }

  diagnostics.forEach((diagnostic) => {
    if (!diagnostic.vaccineId || !diagnostic.doseNumber || diagnostic.doseNumber <= 1) {
      return;
    }

    const previousDoseKey = `${diagnostic.vaccineId}:${diagnostic.doseNumber - 1}`;
    const previousExistingRecord = existingCompletedDoseMap.get(previousDoseKey);
    const previousSubmittedRecord = submissionDoseMap.get(previousDoseKey);

    if (!previousExistingRecord && !previousSubmittedRecord) {
      validationSummary.invalidDoses += 1;
      validationSummary.errors.push(
        `${diagnostic.canonicalVaccineName} dose ${diagnostic.doseNumber} cannot be submitted without dose ${diagnostic.doseNumber - 1}.`,
      );
      diagnostic.recordHasErrors = true;
      return;
    }

    const previousDate = normalizeDateOnly(
      previousExistingRecord?.admin_date || previousSubmittedRecord?.normalizedAdminDate,
    );

    if (previousDate && diagnostic.normalizedAdminDate && previousDate > diagnostic.normalizedAdminDate) {
      validationSummary.invalidDates += 1;
      validationSummary.errors.push(
        `Administration date for ${diagnostic.canonicalVaccineName} dose ${diagnostic.doseNumber} must be on or after dose ${diagnostic.doseNumber - 1}.`,
      );
      diagnostic.recordHasErrors = true;
    }
  });

  validationSummary.validDoses = diagnostics.filter(
    (diagnostic) => !diagnostic.recordHasErrors,
  ).length;

  return {
    normalizedRecords,
    validationSummary,
    hasBlockingErrors:
      validationSummary.duplicateDoses > 0 ||
      validationSummary.invalidDates > 0 ||
      validationSummary.invalidDoses > 0 ||
      validationSummary.invalidVaccines > 0,
  };
};

module.exports = {
  normalizeDateOnly,
  parsePositiveDoseNumber,
  validateTransferSubmission,
};
