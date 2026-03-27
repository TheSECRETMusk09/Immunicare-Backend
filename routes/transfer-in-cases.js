const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');
const socketService = require('../services/socketService');
const { VALIDATION_STATUS } = require('../services/vaccineRulesEngine');
const { validateApprovedVaccineName } = require('../utils/approvedVaccines');
const {
  ensureAtBirthVaccinationRecords,
  importVaccinationRecord,
} = require('../services/atBirthVaccinationService');
const {
  validateTransferSubmission,
} = require('../services/transferInCaseValidationService');
const NotificationService = require('../services/notificationService');
const {
  createGuardianChildRecord,
} = require('../services/guardianChildRegistrationService');

const router = express.Router();

router.use(authenticateToken);

const notificationService = new NotificationService();
let ensureTransferCaseSchemaPromise = null;
let ensurePatientTransferSchemaPromise = null;

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

// Priority levels
const PRIORITY = {
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
};

const normalizeTransferVaccines = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeSubmittedVaccinesInput = (submittedVaccines = []) =>
  (submittedVaccines || []).map((vaccine) => {
    if (typeof vaccine === 'string') {
      const parts = vaccine.split('_');
      const dose = parseInt(parts[parts.length - 1], 10);
      return {
        vaccine_name: Number.isNaN(dose) ? vaccine : parts.slice(0, -1).join('_'),
        dose_number: Number.isNaN(dose) ? 1 : dose,
        date_administered: null,
      };
    }

    return vaccine;
  });

const sendGuardianTransferNotification = async ({
  guardianId,
  title,
  message,
  transferCaseId = null,
  metadata = null,
}) => {
  try {
    await notificationService.sendNotification({
      notification_type: 'transfer_in',
      target_type: 'guardian',
      target_id: guardianId,
      channel: 'push',
      skipImmediateProcessing: true,
      guardian_id: guardianId,
      target_role: 'guardian',
      title,
      subject: title,
      message,
      type: 'info',
      category: 'transfer',
      is_read: false,
      metadata: {
        transfer_case_id: transferCaseId,
        ...(metadata || {}),
      },
    });
  } catch (notificationError) {
    console.error('Failed to send guardian transfer notification:', notificationError);
  }
};

const ensureTransferCaseSchemaColumnsExist = async (client = pool) => {
  const runner = async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS transfer_in_cases (
        id SERIAL PRIMARY KEY,
        guardian_id INTEGER REFERENCES guardians(id) ON DELETE SET NULL,
        infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        source_facility VARCHAR(255),
        submitted_vaccines JSONB,
        vaccination_card_url TEXT,
        remarks TEXT,
        validation_status VARCHAR(50),
        validation_priority VARCHAR(50),
        triage_category VARCHAR(100),
        auto_approved BOOLEAN NOT NULL DEFAULT FALSE,
        validation_summary JSONB,
        approved_vaccines JSONB,
        vaccines_imported BOOLEAN NOT NULL DEFAULT FALSE,
        vaccines_imported_at TIMESTAMP,
        validation_notes TEXT,
        next_recommended_vaccine VARCHAR(255),
        auto_computed_next_vaccine VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS guardian_id INTEGER REFERENCES guardians(id) ON DELETE SET NULL');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS submitted_vaccines JSONB');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS vaccination_card_url TEXT');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS remarks TEXT');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS validation_priority VARCHAR(50)');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS triage_category VARCHAR(100)');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS validation_summary JSONB');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS approved_vaccines JSONB');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS vaccines_imported BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS vaccines_imported_at TIMESTAMP');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS validation_notes TEXT');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS next_recommended_vaccine VARCHAR(255)');
    await client.query('ALTER TABLE transfer_in_cases ADD COLUMN IF NOT EXISTS auto_computed_next_vaccine VARCHAR(255)');
  };

  if (client === pool) {
    if (!ensureTransferCaseSchemaPromise) {
      ensureTransferCaseSchemaPromise = runner().catch((error) => {
        ensureTransferCaseSchemaPromise = null;
        throw error;
      });
    }

    return ensureTransferCaseSchemaPromise;
  }

  return runner();
};

const ensurePatientTransferColumnsExist = async (client = pool) => {
  const runner = async () => {
    await client.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS transfer_in_source VARCHAR(255)');
    await client.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS validation_status VARCHAR(50)');
    await client.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS auto_computed_next_vaccine VARCHAR(255)');
  };

  if (client === pool) {
    if (!ensurePatientTransferSchemaPromise) {
      ensurePatientTransferSchemaPromise = runner().catch((error) => {
        ensurePatientTransferSchemaPromise = null;
        throw error;
      });
    }

    return ensurePatientTransferSchemaPromise;
  }

  return runner();
};

const resolveActorUserId = (req) => {
  const parsedUserId = Number.parseInt(req?.user?.id, 10);
  return Number.isInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : null;
};

const getScheduleMinimumAgeDays = (schedule = {}) => {
  const minimumAgeDays = Number(schedule.minimum_age_days);
  if (Number.isFinite(minimumAgeDays) && minimumAgeDays > 0) {
    return minimumAgeDays;
  }

  const ageInMonths = Number(schedule.age_in_months);
  if (Number.isFinite(ageInMonths) && ageInMonths >= 0) {
    return ageInMonths * 30;
  }

  return 0;
};

const projectTransferBookingReadiness = async ({ client, infantId }) => {
  const infantResult = await client.query(
    `
      SELECT id, dob
      FROM patients
      WHERE id = $1
        AND is_active = true
      LIMIT 1
    `,
    [infantId],
  );

  if (infantResult.rows.length === 0) {
    return {
      eligibleVaccineIds: [],
      nextRecommendedVaccineLabel: null,
      readinessStatus: 'UPCOMING',
    };
  }

  const infantDob = new Date(infantResult.rows[0].dob);
  const today = new Date();
  const ageInDays = Math.floor(
    (today.getTime() - infantDob.getTime()) / (1000 * 60 * 60 * 24),
  );

  const completedResult = await client.query(
    `
      SELECT vaccine_id, dose_no
      FROM immunization_records
      WHERE patient_id = $1
        AND COALESCE(is_active, true) = true
        AND (
          LOWER(COALESCE(status, '')) = 'completed'
          OR admin_date IS NOT NULL
        )
    `,
    [infantId],
  );

  const completedVaccines = {};
  const completedDoseMap = new Set();

  completedResult.rows.forEach((record) => {
    const vaccineId = Number.parseInt(record.vaccine_id, 10);
    const doseNumber = Number.parseInt(record.dose_no, 10);

    if (!Number.isInteger(vaccineId) || vaccineId <= 0 || !Number.isInteger(doseNumber) || doseNumber <= 0) {
      return;
    }

    completedVaccines[vaccineId] = Math.max(completedVaccines[vaccineId] || 0, doseNumber);
    completedDoseMap.add(`${vaccineId}:${doseNumber}`);
  });

  const schedulesResult = await client.query(
    `
      SELECT
        vs.vaccine_id,
        COALESCE(vs.dose_number, 1) AS dose_number,
        vs.age_in_months,
        vs.minimum_age_days,
        v.name AS vaccine_name
      FROM vaccination_schedules vs
      JOIN vaccines v ON v.id = vs.vaccine_id
      WHERE COALESCE(vs.is_active, true) = true
        AND COALESCE(v.is_active, true) = true
      ORDER BY
        COALESCE(vs.minimum_age_days, vs.age_in_months * 30) ASC,
        vs.vaccine_id ASC,
        COALESCE(vs.dose_number, 1) ASC
    `,
  );

  const eligibleVaccineIds = new Set();
  const dueVaccines = [];
  const overdueVaccines = [];

  schedulesResult.rows.forEach((schedule) => {
    const vaccineId = Number.parseInt(schedule.vaccine_id, 10);
    const doseNumber = Number.parseInt(schedule.dose_number, 10);

    if (!Number.isInteger(vaccineId) || vaccineId <= 0 || !Number.isInteger(doseNumber) || doseNumber <= 0) {
      return;
    }

    const isDoseCompleted = completedDoseMap.has(`${vaccineId}:${doseNumber}`);
    const isNextDueDose = doseNumber === (completedVaccines[vaccineId] || 0) + 1;

    if (isDoseCompleted || !isNextDueDose) {
      return;
    }

    const minimumAgeDays = getScheduleMinimumAgeDays(schedule);
    if (ageInDays < minimumAgeDays) {
      return;
    }

    const dueDate = new Date(infantDob);
    dueDate.setDate(dueDate.getDate() + minimumAgeDays);

    const entry = {
      vaccineId,
      label: `${schedule.vaccine_name} (Dose ${doseNumber})`,
      dueDate,
    };

    eligibleVaccineIds.add(vaccineId);

    if (dueDate < today) {
      overdueVaccines.push(entry);
    } else {
      dueVaccines.push(entry);
    }
  });

  const nextEligibleVaccine =
    overdueVaccines[0] ||
    dueVaccines[0] ||
    null;

  let readinessStatus = 'UPCOMING';
  if (overdueVaccines.length > 0) {
    readinessStatus = 'OVERDUE';
  } else if (dueVaccines.length > 0) {
    readinessStatus = 'READY';
  }

  return {
    eligibleVaccineIds: [...eligibleVaccineIds],
    nextRecommendedVaccineLabel: nextEligibleVaccine?.label || null,
    readinessStatus,
  };
};

const syncTransferReadinessState = async ({
  client,
  infantId,
  actorUserId = null,
  notes = null,
}) => {
  const readinessProjection = await projectTransferBookingReadiness({
    client,
    infantId,
  });

  for (const vaccineId of readinessProjection.eligibleVaccineIds) {
    await client.query(
      `
        INSERT INTO infant_vaccine_readiness (
          infant_id,
          vaccine_id,
          is_ready,
          ready_confirmed_by,
          ready_confirmed_at,
          notes,
          created_by,
          is_active
        )
        VALUES ($1, $2, TRUE, $3, CURRENT_TIMESTAMP, $4, $3, TRUE)
        ON CONFLICT (infant_id, vaccine_id, is_active)
        DO UPDATE SET
          is_ready = EXCLUDED.is_ready,
          ready_confirmed_by = EXCLUDED.ready_confirmed_by,
          ready_confirmed_at = EXCLUDED.ready_confirmed_at,
          notes = EXCLUDED.notes,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        infantId,
        vaccineId,
        actorUserId,
        notes || null,
      ],
    );
  }

  return readinessProjection;
};

const describeTransferOutcome = ({
  autoApproved = false,
  readinessProjection = null,
}) => {
  if (!autoApproved) {
    return {
      readyForScheduling: false,
      nextAction: 'Needs nurse review',
      message: 'Transfer case submitted successfully for review.',
    };
  }

  if (
    readinessProjection?.readinessStatus === 'READY' ||
    readinessProjection?.readinessStatus === 'OVERDUE'
  ) {
    return {
      readyForScheduling: true,
      nextAction: 'Ready for scheduling',
      message: 'Transfer case automatically approved. Child is ready for scheduling.',
    };
  }

  if (readinessProjection?.nextRecommendedVaccineLabel) {
    return {
      readyForScheduling: false,
      nextAction: 'Not yet due',
      message: `Transfer case automatically approved. Records were verified and the next tracked vaccine is ${readinessProjection.nextRecommendedVaccineLabel}.`,
    };
  }

  return {
    readyForScheduling: false,
    nextAction: 'Approved',
    message: 'Transfer case automatically approved and records were verified.',
  };
};

const buildGuardianTransferStatusMessage = ({
  sourceFacility,
  autoApproved = false,
  readyForScheduling = false,
  nextRecommendedVaccineLabel = null,
}) => {
  const facilityLabel = sourceFacility || 'the previous health center';

  if (!autoApproved) {
    return `Your child's vaccination records from ${facilityLabel} have been submitted for review. You will be notified once verified.`;
  }

  if (readyForScheduling) {
    return `Your child's vaccination records from ${facilityLabel} have been verified. Your child is now ready for scheduling.`;
  }

  if (nextRecommendedVaccineLabel) {
    return `Your child's vaccination records from ${facilityLabel} have been verified. The next tracked vaccine is ${nextRecommendedVaccineLabel}.`;
  }

  return `Your child's vaccination records from ${facilityLabel} have been verified successfully.`;
};

const buildTransferApprovalMessage = ({
  sourceFacility,
  readyForScheduling = false,
  nextRecommendedVaccineLabel = null,
  importedDoseCount = 0,
}) => {
  const facilityLabel = sourceFacility || 'the previous health center';
  let message = '';

  if (readyForScheduling) {
    message = `Your child's vaccination records from ${facilityLabel} have been verified. Your child is now ready for scheduling.`;
  } else if (nextRecommendedVaccineLabel) {
    message = `Your child's vaccination records from ${facilityLabel} have been verified. The next tracked vaccine is ${nextRecommendedVaccineLabel}.`;
  } else {
    message = `Your child's vaccination records from ${facilityLabel} have been verified successfully.`;
  }

  if (importedDoseCount > 0) {
    message += ` ${importedDoseCount} dose(s) were imported into the official vaccination record.`;
  }

  return message;
};

const createGuardianTransferCase = async ({
  client,
  req,
  guardianId,
  infantId,
  sourceFacility,
  submittedVaccines,
  vaccinationCardUrl = null,
  remarks = null,
}) => {
  await ensureTransferCaseSchemaColumnsExist(client);
  await ensurePatientTransferColumnsExist(client);

  const normalizedSubmittedVaccines = normalizeSubmittedVaccinesInput(submittedVaccines);

  if (!sourceFacility || sourceFacility.trim().length === 0) {
    throw createHttpError(400, 'Previous health center name is required.');
  }

  if (
    !submittedVaccines ||
    !Array.isArray(submittedVaccines) ||
    submittedVaccines.length === 0
  ) {
    throw createHttpError(
      400,
      'At least one previously received vaccine must be specified.',
    );
  }

  const infantCheck = await client.query(
    `SELECT id, first_name, last_name, dob FROM patients
     WHERE id = $1 AND guardian_id = $2 AND is_active = true`,
    [infantId, guardianId],
  );

  if (infantCheck.rows.length === 0) {
    throw createHttpError(404, 'Child not found or does not belong to your account.');
  }

  await ensureAtBirthVaccinationRecords(infantId, {
    patientDob: infantCheck.rows[0].dob,
    client,
  });

  const {
    normalizedRecords,
    validationSummary,
    hasBlockingErrors,
  } = await validateTransferSubmission({
    patientId: infantId,
    childDob: infantCheck.rows[0].dob,
    submittedVaccines: normalizedSubmittedVaccines,
  });

  if (normalizedRecords.length === 0) {
    throw createHttpError(400, 'No valid vaccine entries found.');
  }

  const status = hasBlockingErrors
    ? VALIDATION_STATUS.FOR_VALIDATION
    : VALIDATION_STATUS.APPROVED;
  const autoApproved = status === VALIDATION_STATUS.APPROVED;
  const triageCategory = autoApproved
    ? 'ready_for_scheduling'
    : 'needs_record_verification';

  const result = await client.query(
    `
      INSERT INTO transfer_in_cases (
        guardian_id,
        infant_id,
        source_facility,
        submitted_vaccines,
        vaccination_card_url,
        remarks,
        validation_status,
        validation_priority,
        triage_category,
        auto_approved,
        validation_summary,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `,
    [
      guardianId,
      infantId,
      sourceFacility,
      JSON.stringify(normalizedRecords),
      vaccinationCardUrl || null,
      remarks || null,
      status,
      PRIORITY.NORMAL,
      triageCategory,
      autoApproved,
      JSON.stringify(validationSummary),
    ],
  );

  let transferCase = result.rows[0];
  let autoImportSummary = null;
  let readinessProjection = null;

  await recordTransferAuditEvent({
    client,
    req,
    eventType: 'TRANSFER_CASE_CREATED',
    caseId: transferCase.id,
    newValues: transferCase,
    metadata: {
      infant_id: infantId,
      source_facility: sourceFacility,
      auto_approved: autoApproved,
    },
  });

  if (autoApproved) {
    autoImportSummary = await importTransferCaseVaccines({
      client,
      transferCaseId: transferCase.id,
      currentCase: transferCase,
      vaccines: normalizedRecords,
    });

    readinessProjection = await syncTransferReadinessState({
      client,
      infantId,
      actorUserId: resolveActorUserId(req),
      notes: 'Auto-confirmed after verified transfer import.',
    });

    const refreshedTransferCase = await client.query(
      'SELECT * FROM transfer_in_cases WHERE id = $1',
      [transferCase.id],
    );
    transferCase = refreshedTransferCase.rows[0] || transferCase;
  }

  const transferOutcome = describeTransferOutcome({
    autoApproved,
    readinessProjection,
  });

  await client.query(
    `UPDATE patients
     SET transfer_in_source = $1,
         validation_status = $2,
         auto_computed_next_vaccine = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [
      sourceFacility,
      autoApproved ? VALIDATION_STATUS.APPROVED : VALIDATION_STATUS.FOR_VALIDATION,
      readinessProjection?.nextRecommendedVaccineLabel || null,
      infantId,
    ],
  );

  return {
    infant: infantCheck.rows[0],
    transferCase,
    autoApproved,
    triageCategory,
    status,
    validationSummary,
    normalizedRecords,
    autoImportSummary,
    readinessProjection,
    readyForScheduling: transferOutcome.readyForScheduling,
    nextRecommendedVaccineLabel: readinessProjection?.nextRecommendedVaccineLabel || null,
    nextAction: transferOutcome.nextAction,
    message: transferOutcome.message,
  };
};

const recordTransferAuditEvent = async ({
  client = null,
  req,
  eventType,
  caseId,
  severity = 'INFO',
  oldValues = null,
  newValues = null,
  metadata = null,
  success = true,
}) => {
  const dbClient = client || pool;
  const canonicalRole = getCanonicalRole(req);
  const adminId = Number.isInteger(Number(req.user?.id)) ? Number(req.user.id) : null;
  const username =
    req.user?.username ||
    req.user?.email ||
    (canonicalRole === CANONICAL_ROLES.GUARDIAN
      ? `guardian:${req.user?.guardian_id || 'unknown'}`
      : `user:${req.user?.id || 'unknown'}`);

  try {
    await dbClient.query(
      `INSERT INTO audit_logs (
         admin_id,
         username,
         role,
         event_type,
         entity_type,
         entity_id,
         old_values,
         new_values,
         metadata,
         details,
         severity,
         success,
         timestamp
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)`,
      [
        canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN ? adminId : null,
        username,
        canonicalRole,
        eventType,
        'transfer_in_case',
        caseId || null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        metadata ? JSON.stringify(metadata) : null,
        metadata || null,
        severity,
        success,
      ],
    );
  } catch (auditError) {
    console.error('Failed to record transfer-in audit event:', auditError);
  }
};

const importTransferCaseVaccines = async ({ client, transferCaseId, currentCase, vaccines }) => {
  await ensureAtBirthVaccinationRecords(currentCase.infant_id, {
    client,
  });

  const normalizedApprovedVaccines = [];
  const importResults = [];

  for (const vaccine of vaccines || []) {
    const vaccineNameValidation = validateApprovedVaccineName(vaccine?.vaccine_name, {
      fieldName: 'approvedVaccines.vaccine_name',
    });

    if (!vaccineNameValidation.valid) {
      importResults.push({
        vaccine_name: vaccine?.vaccine_name || null,
        dose_number: vaccine?.dose_number || null,
        status: 'failed',
        message: vaccineNameValidation.error,
      });
      continue;
    }

    normalizedApprovedVaccines.push({
      ...vaccine,
      vaccine_name: vaccineNameValidation.vaccineName,
    });

    const vaccineResult = await client.query(
      'SELECT id FROM vaccines WHERE name = $1 AND is_active = true LIMIT 1',
      [vaccineNameValidation.vaccineName],
    );

    if (vaccineResult.rows.length === 0) {
      importResults.push({
        vaccine_name: vaccineNameValidation.vaccineName,
        dose_number: vaccine?.dose_number || null,
        status: 'failed',
        message: 'Vaccine not found',
      });
      continue;
    }

    const importOutcome = await importVaccinationRecord({
      client,
      patientId: currentCase.infant_id,
      vaccineName: vaccineNameValidation.vaccineName,
      doseNo: vaccine.dose_number,
      adminDate: vaccine.date_administered,
      sourceFacility: currentCase.source_facility,
      transferCaseId,
      notes: vaccine.batch_number ? `Batch: ${vaccine.batch_number}` : null,
    });

    importResults.push({
      vaccine_name: vaccineNameValidation.vaccineName,
      dose_number: vaccine.dose_number,
      vaccine_id: vaccineResult.rows[0].id,
      status: importOutcome.action === 'skipped' ? 'skipped' : 'success',
      message: importOutcome.message,
    });
  }

  await client.query(
    `UPDATE transfer_in_cases
     SET approved_vaccines = $1,
         vaccines_imported = true,
         vaccines_imported_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [JSON.stringify(normalizedApprovedVaccines), transferCaseId],
  );

  return {
    normalizedApprovedVaccines,
    importResults,
    summary: {
      total: importResults.length,
      success: importResults.filter((entry) => entry.status === 'success').length,
      skipped: importResults.filter((entry) => entry.status === 'skipped').length,
      failed: importResults.filter((entry) => entry.status === 'failed').length,
    },
  };
};

// Guardian creates a child and transfer-in case in one atomic workflow
router.post('/register-child', async (req, res) => {
  try {
    if (!isGuardian(req)) {
      return res.status(403).json({
        success: false,
        error: 'Only guardians can submit transfer-in cases.',
      });
    }

    const guardianId = parseInt(req.user.guardian_id, 10);
    if (Number.isNaN(guardianId) || guardianId <= 0) {
      return res.status(403).json({
        success: false,
        error: 'Guardian account mapping is missing. Please sign in again.',
      });
    }

    const {
      infant,
      source_facility,
      submitted_vaccines,
      vaccination_card_url,
      remarks,
    } = req.body;

    if (!infant || typeof infant !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Child registration data is required.',
      });
    }

    const client = await pool.connect();
    let outcome;
    let childResult;

    try {
      await client.query('BEGIN');

      childResult = await createGuardianChildRecord({
        guardianId,
        payload: {
          ...infant,
          guardian_id: guardianId,
        },
        client,
      });

      outcome = await createGuardianTransferCase({
        client,
        req,
        guardianId,
        infantId: childResult.patient.id,
        sourceFacility: source_facility,
        submittedVaccines: submitted_vaccines,
        vaccinationCardUrl: vaccination_card_url,
        remarks,
      });

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    socketService.broadcast('infant_created', childResult.patient);
    socketService.broadcast('transfer_in_case_created', {
      id: outcome.transferCase.id,
      infant_name: `${outcome.infant.first_name} ${outcome.infant.last_name}`,
      source_facility,
      triage_category: outcome.triageCategory,
    });

    if (outcome.autoImportSummary) {
      socketService.broadcast('vaccinations_imported', {
        caseId: outcome.transferCase.id,
        infantId: childResult.patient.id,
        count: outcome.autoImportSummary.summary.success,
      });
    }

    await sendGuardianTransferNotification({
      guardianId,
      title: outcome.autoApproved ? 'Transfer Case Approved' : 'Transfer Case Submitted',
      message: buildGuardianTransferStatusMessage({
        sourceFacility: source_facility,
        autoApproved: outcome.autoApproved,
        readyForScheduling: outcome.readyForScheduling,
        nextRecommendedVaccineLabel: outcome.nextRecommendedVaccineLabel,
      }),
      transferCaseId: outcome.transferCase.id,
      metadata: {
        infant_id: childResult.patient.id,
        source_facility,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        infant: childResult.patient,
        control_number: childResult.controlNumber,
        caseId: outcome.transferCase.id,
        status: outcome.status,
        validationSummary: outcome.validationSummary,
        nextAction: outcome.nextAction,
        submittedVaccines: outcome.normalizedRecords,
        autoImportSummary: outcome.autoImportSummary,
      },
      message: outcome.message,
    });
  } catch (error) {
    console.error('Error creating transfer-in case:', error);
    if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({
        success: false,
        error: 'Please correct the highlighted child registration fields.',
        fields: error.fields || {},
      });
    }

    if (error.code === 'AMBIGUOUS_INFANT_MATCH') {
      return res.status(409).json({
        success: false,
        error:
          'Multiple child records already match this name and date of birth. Please contact support to resolve duplicates.',
        matches: error.matches || [],
      });
    }

    if (error.code === 'FOREIGN_CHILD_MATCH' || error.code === 'GUARDIAN_MAPPING_MISSING') {
      return res.status(403).json({
        success: false,
        error: error.message,
      });
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to register child and submit transfer-in case.',
    });
  }
});

// Guardian creates a new transfer-in case for an existing child
router.post('/', async (req, res) => {
  try {
    if (!isGuardian(req)) {
      return res.status(403).json({
        success: false,
        error: 'Only guardians can submit transfer-in cases.',
      });
    }

    const guardianId = parseInt(req.user.guardian_id, 10);
    if (Number.isNaN(guardianId) || guardianId <= 0) {
      return res.status(403).json({
        success: false,
        error: 'Guardian account mapping is missing. Please sign in again.',
      });
    }

    const {
      infant_id,
      source_facility,
      submitted_vaccines,
      vaccination_card_url,
      remarks,
    } = req.body;

    if (!infant_id) {
      return res.status(400).json({
        success: false,
        error: 'Infant ID is required.',
      });
    }

    const client = await pool.connect();
    let outcome;
    try {
      await client.query('BEGIN');
      outcome = await createGuardianTransferCase({
        client,
        req,
        guardianId,
        infantId: infant_id,
        sourceFacility: source_facility,
        submittedVaccines: submitted_vaccines,
        vaccinationCardUrl: vaccination_card_url,
        remarks,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    socketService.broadcast('transfer_in_case_created', {
      id: outcome.transferCase.id,
      infant_name: `${outcome.infant.first_name} ${outcome.infant.last_name}`,
      source_facility,
      triage_category: outcome.triageCategory,
    });

    if (outcome.autoImportSummary) {
      socketService.broadcast('vaccinations_imported', {
        caseId: outcome.transferCase.id,
        infantId: outcome.infant.id,
        count: outcome.autoImportSummary.summary.success,
      });
    }

    await sendGuardianTransferNotification({
      guardianId,
      title: outcome.autoApproved ? 'Transfer Case Approved' : 'Transfer Case Submitted',
      message: buildGuardianTransferStatusMessage({
        sourceFacility: source_facility,
        autoApproved: outcome.autoApproved,
        readyForScheduling: outcome.readyForScheduling,
        nextRecommendedVaccineLabel: outcome.nextRecommendedVaccineLabel,
      }),
      transferCaseId: outcome.transferCase.id,
      metadata: {
        infant_id,
        source_facility,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        caseId: outcome.transferCase.id,
        status: outcome.status,
        validationSummary: outcome.validationSummary,
        nextAction: outcome.nextAction,
        submittedVaccines: outcome.normalizedRecords,
        autoImportSummary: outcome.autoImportSummary,
      },
      message: outcome.message,
    });
  } catch (error) {
    console.error('Error creating transfer-in case:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to submit transfer-in case.',
    });
  }
});

// Guardian gets their own transfer-in cases
router.get('/guardian', async (req, res) => {
  try {
    if (!isGuardian(req)) {
      return res.status(403).json({
        success: false,
        error: 'Only guardians can view their transfer-in cases.',
      });
    }

    const guardianId = parseInt(req.user.guardian_id, 10);
    if (Number.isNaN(guardianId) || guardianId <= 0) {
      return res.status(403).json({
        success: false,
        error: 'Guardian account mapping is missing.',
      });
    }

    const result = await pool.query(
      `
        SELECT
          tic.*,
          p.first_name as infant_first_name,
          p.last_name as infant_last_name,
          p.dob as infant_dob,
          p.control_number
        FROM transfer_in_cases tic
        JOIN patients p ON p.id = tic.infant_id
        WHERE tic.guardian_id = $1
        ORDER BY tic.created_at DESC
      `,
      [guardianId],
    );

    res.json({
      success: true,
      data: result.rows || [],
    });
  } catch (error) {
    console.error('Error fetching guardian transfer-in cases:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transfer-in cases.',
    });
  }
});

// Get single transfer-in case by ID
router.get('/:id', async (req, res) => {
  try {
    const caseId = parseInt(req.params.id, 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid case ID.',
      });
    }

    // Get the case
    const caseResult = await pool.query(
      `
        SELECT
          tic.*,
          p.first_name as infant_first_name,
          p.last_name as infant_last_name,
          p.dob as infant_dob,
          p.control_number,
          p.sex,
          g.name as guardian_name,
          g.phone as guardian_phone,
          g.email as guardian_email
        FROM transfer_in_cases tic
        JOIN patients p ON p.id = tic.infant_id
        JOIN guardians g ON g.id = tic.guardian_id
        WHERE tic.id = $1
      `,
      [caseId],
    );

    if (caseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Transfer-in case not found.',
      });
    }

    const transferCase = caseResult.rows[0];

    // Check access - guardian can only see their own
    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      if (transferCase.guardian_id !== guardianId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied.',
        });
      }
    }

    res.json({
      success: true,
      data: transferCase,
    });
  } catch (error) {
    console.error('Error fetching transfer-in case:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transfer-in case.',
    });
  }
});

// Admin: Get all transfer-in cases with filters
router.get('/', requirePermission('transfer:view'), async (req, res) => {
  try {
    const {
      status,
      priority,
      triage_category,
      limit = 1000,
      offset = 0,
    } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status) {
      whereClause += ` AND tic.validation_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (priority) {
      whereClause += ` AND tic.validation_priority = $${paramIndex}`;
      params.push(priority);
      paramIndex++;
    }

    if (triage_category) {
      whereClause += ` AND tic.triage_category = $${paramIndex}`;
      params.push(triage_category);
      paramIndex++;
    }

    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(
      `
        SELECT
          tic.*,
          p.first_name as infant_first_name,
          p.last_name as infant_last_name,
          p.dob as infant_dob,
          p.control_number,
          g.name as guardian_name,
          g.phone as guardian_phone
        FROM transfer_in_cases tic
        JOIN patients p ON p.id = tic.infant_id
        JOIN guardians g ON g.id = tic.guardian_id
        ${whereClause}
        ORDER BY
          CASE tic.validation_priority
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            ELSE 3
          END,
          tic.created_at ASC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      params,
    );

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM transfer_in_cases tic ${whereClause}`,
      params.slice(0, -2),
    );

    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      success: true,
      data: result.rows || [],
      pagination: {
        total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      },
    });
  } catch (error) {
    console.error('Error fetching transfer-in cases:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transfer-in cases.',
    });
  }
});

// Admin: Update transfer-in case validation
router.put('/:id/validate', requirePermission('transfer:validate'), async (req, res) => {
  try {
    const caseId = parseInt(req.params.id, 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid case ID.',
      });
    }

    const {
      validation_status,
      validation_notes,
      validation_priority,
      triage_category,
      next_recommended_vaccine,
      auto_computed_next_vaccine,
    } = req.body;

    // Validate status
    const validStatuses = Object.values(VALIDATION_STATUS);
    if (validation_status && !validStatuses.includes(validation_status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid validation status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    // Check if case exists
    const existingCase = await pool.query(
      'SELECT * FROM transfer_in_cases WHERE id = $1',
      [caseId],
    );

    if (existingCase.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Transfer-in case not found.',
      });
    }

    const currentCase = existingCase.rows[0];

    // Build update query
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (validation_status) {
      updates.push(`validation_status = $${paramIndex}`);
      params.push(validation_status);
      paramIndex++;
    }

    if (validation_notes !== undefined) {
      updates.push(`validation_notes = $${paramIndex}`);
      params.push(validation_notes);
      paramIndex++;
    }

    if (validation_priority) {
      updates.push(`validation_priority = $${paramIndex}`);
      params.push(validation_priority);
      paramIndex++;
    }

    if (triage_category) {
      updates.push(`triage_category = $${paramIndex}`);
      params.push(triage_category);
      paramIndex++;
    }

    if (next_recommended_vaccine !== undefined) {
      updates.push(`next_recommended_vaccine = $${paramIndex}`);
      params.push(next_recommended_vaccine);
      paramIndex++;
    }

    if (auto_computed_next_vaccine !== undefined) {
      updates.push(`auto_computed_next_vaccine = $${paramIndex}`);
      params.push(auto_computed_next_vaccine);
      paramIndex++;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(caseId);

    const targetValidationStatus = validation_status || currentCase.validation_status;
    const shouldAutoImportApprovedVaccines =
      targetValidationStatus === VALIDATION_STATUS.APPROVED &&
      !currentCase.vaccines_imported;

    let updatedCase;
    let autoImportSummary = null;
    let readinessProjection = null;
    let resolvedAutoComputedNextVaccine = null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE transfer_in_cases
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        params,
      );

      updatedCase = result.rows[0];

      if (shouldAutoImportApprovedVaccines) {
        const vaccinesToImport = normalizeTransferVaccines(
          currentCase.approved_vaccines,
        ).length > 0
          ? normalizeTransferVaccines(currentCase.approved_vaccines)
          : normalizeTransferVaccines(currentCase.submitted_vaccines);

        autoImportSummary = await importTransferCaseVaccines({
          client,
          transferCaseId: caseId,
          currentCase,
          vaccines: vaccinesToImport,
        });
      }

      if (targetValidationStatus === VALIDATION_STATUS.APPROVED) {
        readinessProjection = await syncTransferReadinessState({
          client,
          infantId: currentCase.infant_id,
          actorUserId: resolveActorUserId(req),
          notes: 'Confirmed after transfer case approval.',
        });
      }

      resolvedAutoComputedNextVaccine =
        readinessProjection?.nextRecommendedVaccineLabel ||
        auto_computed_next_vaccine ||
        updatedCase.auto_computed_next_vaccine ||
        currentCase.auto_computed_next_vaccine ||
        null;

      const refreshedCase = await client.query(
        `UPDATE transfer_in_cases
         SET auto_computed_next_vaccine = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [resolvedAutoComputedNextVaccine, caseId],
      );
      updatedCase = refreshedCase.rows[0];

      await client.query(
        `UPDATE patients
         SET validation_status = $1,
             auto_computed_next_vaccine = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [
          targetValidationStatus,
          resolvedAutoComputedNextVaccine,
          currentCase.infant_id,
        ],
      );

      await recordTransferAuditEvent({
        client,
        req,
        eventType: 'TRANSFER_CASE_VALIDATED',
        caseId,
        oldValues: currentCase,
        newValues: updatedCase,
        metadata: {
          auto_import_summary: autoImportSummary?.summary || null,
          readiness_projection: readinessProjection || null,
          validation_status: targetValidationStatus,
        },
      });

      await client.query('COMMIT');
    } catch (transactionError) {
      await client.query('ROLLBACK');
      throw transactionError;
    } finally {
      client.release();
    }

    // Send notification to guardian
    const guardianId = currentCase.guardian_id;
    let notificationTitle = '';
    let notificationMessage = '';

    switch (targetValidationStatus) {
    case VALIDATION_STATUS.APPROVED:
      notificationTitle = 'Transfer Case Approved';
      notificationMessage = buildTransferApprovalMessage({
        sourceFacility: currentCase.source_facility,
        readyForScheduling:
          readinessProjection?.readinessStatus === 'READY' ||
          readinessProjection?.readinessStatus === 'OVERDUE',
        nextRecommendedVaccineLabel:
          readinessProjection?.nextRecommendedVaccineLabel ||
          resolvedAutoComputedNextVaccine ||
          next_recommended_vaccine ||
          null,
        importedDoseCount: autoImportSummary?.summary?.success || 0,
      });
      break;
    case VALIDATION_STATUS.REJECTED:
      notificationTitle = 'Transfer Case Rejected';
      notificationMessage = `Your transfer case was not approved. Reason: ${
        validation_notes || 'Please contact the health center for more information.'
      }`;
      break;
    case VALIDATION_STATUS.NEEDS_CLARIFICATION:
      notificationTitle = 'Additional Information Required';
      notificationMessage = `Please provide additional information: ${
        validation_notes || 'Please contact the health center.'
      }`;
      break;
    default:
      notificationTitle = 'Transfer Case Updated';
      notificationMessage = 'Your transfer case status has been updated.';
    }

    if (notificationTitle) {
      await sendGuardianTransferNotification({
        guardianId,
        title: notificationTitle,
        message: notificationMessage,
        transferCaseId: caseId,
        metadata: {
          infant_id: currentCase.infant_id,
          validation_status: targetValidationStatus,
        },
      });
    }

    // Broadcast update
    socketService.broadcast('transfer_in_case_updated', {
      id: updatedCase.id,
      validation_status: updatedCase.validation_status,
      triage_category: updatedCase.triage_category,
    });

    if (autoImportSummary) {
      socketService.broadcast('vaccinations_imported', {
        caseId,
        infantId: currentCase.infant_id,
        count: autoImportSummary.summary.success,
      });
    }

    res.json({
      success: true,
      data: {
        ...updatedCase,
        readinessProjection,
        autoImportSummary,
      },
      message: autoImportSummary
        ? 'Transfer case approved and vaccination records imported successfully.'
        : 'Transfer case updated successfully.',
    });
  } catch (error) {
    console.error('Error updating transfer-in case:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update transfer-in case.',
    });
  }
});

// Admin: Approve vaccines for bulk import
router.put('/:id/approve-vaccines', requirePermission('transfer:approve'), async (req, res) => {
  try {
    const caseId = parseInt(req.params.id, 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid case ID.',
      });
    }

    const { approvedVaccines, importToRecords } = req.body;

    // Check if case exists
    const existingCase = await pool.query(
      'SELECT * FROM transfer_in_cases WHERE id = $1',
      [caseId],
    );

    if (existingCase.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Transfer-in case not found.',
      });
    }

    const currentCase = existingCase.rows[0];

    // If importToRecords is true, perform the actual import
    if (importToRecords && approvedVaccines && Array.isArray(approvedVaccines)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const autoImportSummary = await importTransferCaseVaccines({
          client,
          transferCaseId: caseId,
          currentCase,
          vaccines: approvedVaccines,
        });

        await recordTransferAuditEvent({
          client,
          req,
          eventType: 'TRANSFER_CASE_VACCINES_IMPORTED',
          caseId,
          oldValues: currentCase,
          newValues: {
            approved_vaccines: autoImportSummary.normalizedApprovedVaccines,
            vaccines_imported: true,
          },
          metadata: {
            import_summary: autoImportSummary.summary,
          },
        });
        const readinessProjection = await syncTransferReadinessState({
          client,
          infantId: currentCase.infant_id,
          actorUserId: resolveActorUserId(req),
          notes: 'Vaccination history imported after transfer approval.',
        });

        const resolvedAutoComputedNextVaccine =
          readinessProjection?.nextRecommendedVaccineLabel ||
          currentCase.auto_computed_next_vaccine ||
          currentCase.next_recommended_vaccine ||
          null;

        await client.query(
          `UPDATE transfer_in_cases
           SET auto_computed_next_vaccine = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [resolvedAutoComputedNextVaccine, caseId],
        );

        await client.query(
          `UPDATE patients
           SET validation_status = $1,
               auto_computed_next_vaccine = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [
            currentCase.validation_status,
            resolvedAutoComputedNextVaccine,
            currentCase.infant_id,
          ],
        );

        await client.query('COMMIT');

        // Broadcast update
        socketService.broadcast('vaccinations_imported', {
          caseId,
          infantId: currentCase.infant_id,
          count: autoImportSummary.summary.success,
        });
        socketService.broadcast('transfer_in_case_updated', {
          id: caseId,
          validation_status: currentCase.validation_status,
          triage_category: currentCase.triage_category,
        });

        if (currentCase.guardian_id) {
          await sendGuardianTransferNotification({
            guardianId: currentCase.guardian_id,
            title: 'Transfer Vaccination Records Imported',
            message: buildTransferApprovalMessage({
              sourceFacility: currentCase.source_facility,
              readyForScheduling:
                readinessProjection?.readinessStatus === 'READY' ||
                readinessProjection?.readinessStatus === 'OVERDUE',
              nextRecommendedVaccineLabel: resolvedAutoComputedNextVaccine,
              importedDoseCount: autoImportSummary.summary.success,
            }),
            transferCaseId: caseId,
            metadata: {
              infant_id: currentCase.infant_id,
              validation_status: currentCase.validation_status,
            },
          });
        }

        res.json({
          success: true,
          data: {
            importResults: autoImportSummary.importResults,
            summary: autoImportSummary.summary,
            readinessProjection,
          },
          message: 'Vaccines imported successfully',
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      const normalizedApprovedVaccines = [];
      for (const vaccine of approvedVaccines || []) {
        const vaccineNameValidation = validateApprovedVaccineName(vaccine?.vaccine_name, {
          fieldName: 'approvedVaccines.vaccine_name',
        });

        if (!vaccineNameValidation.valid) {
          return res.status(400).json({
            success: false,
            error: vaccineNameValidation.error,
          });
        }

        normalizedApprovedVaccines.push({
          ...vaccine,
          vaccine_name: vaccineNameValidation.vaccineName,
        });
      }

      // Just save the approved vaccines without importing
      await pool.query(
        `UPDATE transfer_in_cases
         SET approved_vaccines = $1,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [JSON.stringify(normalizedApprovedVaccines), caseId],
      );

      await recordTransferAuditEvent({
        req,
        eventType: 'TRANSFER_CASE_APPROVED_VACCINES_SET',
        caseId,
        oldValues: currentCase,
        newValues: {
          approved_vaccines: normalizedApprovedVaccines,
        },
        metadata: {
          approved_count: normalizedApprovedVaccines.length,
        },
      });

      res.json({
        success: true,
        message: 'Vaccines approved for import',
      });
    }
  } catch (error) {
    console.error('Error approving vaccines:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve vaccines.',
    });
  }
});

// Get transfer-in statistics (Admin)
router.get('/stats/overview', requirePermission('transfer:view'), async (_req, res) => {
  try {
    const [total, pending, approved, rejected, byTriage] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM transfer_in_cases'),
      pool.query(
        `SELECT COUNT(*) as count FROM transfer_in_cases
         WHERE validation_status IN ('pending', 'for_validation')`,
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM transfer_in_cases
         WHERE validation_status = 'approved'`,
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM transfer_in_cases
         WHERE validation_status = 'rejected'`,
      ),
      pool.query(
        `SELECT triage_category, COUNT(*) as count
         FROM transfer_in_cases
         GROUP BY triage_category`,
      ),
    ]);

    const triageStats = {};
    byTriage.rows.forEach((row) => {
      triageStats[row.triage_category] = parseInt(row.count, 10);
    });

    res.json({
      success: true,
      data: {
        total: parseInt(total.rows[0].count, 10),
        pending: parseInt(pending.rows[0].count, 10),
        approved: parseInt(approved.rows[0].count, 10),
        rejected: parseInt(rejected.rows[0].count, 10),
        by_triage: triageStats,
      },
    });
  } catch (error) {
    console.error('Error fetching transfer-in stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transfer-in statistics.',
    });
  }
});

module.exports = router;
