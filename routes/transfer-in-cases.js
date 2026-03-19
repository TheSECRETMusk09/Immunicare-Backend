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

const router = express.Router();

router.use(authenticateToken);

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

// Priority levels
const PRIORITY = {
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
};

// Guardian creates a new transfer-in case
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

    // Validate required fields
    if (!infant_id) {
      return res.status(400).json({
        success: false,
        error: 'Infant ID is required.',
      });
    }

    if (!source_facility || source_facility.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Previous health center name is required.',
      });
    }

    if (!submitted_vaccines || !Array.isArray(submitted_vaccines) || submitted_vaccines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one previously received vaccine must be specified.',
      });
    }

    // Verify the infant belongs to this guardian
    const infantCheck = await pool.query(
      `SELECT id, first_name, last_name, dob FROM patients
       WHERE id = $1 AND guardian_id = $2 AND is_active = true`,
      [infant_id, guardianId],
    );

    if (infantCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Child not found or does not belong to your account.',
      });
    }

    // Validate each submitted vaccine
    const validVaccines = [];
    for (let index = 0; index < submitted_vaccines.length; index += 1) {
      const vaccine = submitted_vaccines[index] || {};
      const vaccineNameValidation = validateApprovedVaccineName(vaccine.vaccine_name, {
        fieldName: `submitted_vaccines[${index}].vaccine_name`,
      });

      if (!vaccineNameValidation.valid) {
        return res.status(400).json({
          success: false,
          error: vaccineNameValidation.error,
        });
      }

      const parsedDoseNumber = parseInt(vaccine.dose_number, 10);
      if (!Number.isInteger(parsedDoseNumber) || parsedDoseNumber <= 0) {
        return res.status(400).json({
          success: false,
          error: `submitted_vaccines[${index}].dose_number must be a positive integer.`,
        });
      }

      validVaccines.push({
        vaccine_name: vaccineNameValidation.vaccineName,
        dose_number: parsedDoseNumber,
        date_administered: vaccine.date_administered || null,
        batch_number: vaccine.batch_number || null,
        facility_name: vaccine.facility_name || null,
      });
    }

    if (validVaccines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid vaccine entries found.',
      });
    }

    // Get child profile for validation
    const childProfile = {
      id: infant_id,
      first_name: infantCheck.rows[0].first_name,
      last_name: infantCheck.rows[0].last_name,
      dob: infantCheck.rows[0].dob,
    };

    const validationSummary = {
      validDoses: 0,
      duplicateDoses: 0,
      invalidDates: 0,
      invalidDoses: 0,
      invalidVaccines: 0,
      totalDoses: validVaccines.length,
      errors: [],
      warnings: [],
    };
    const seenDoseKeys = new Set();
    const childDob = childProfile.dob ? new Date(childProfile.dob) : null;
    const now = new Date();

    validVaccines.forEach((record) => {
      const doseKey = `${record.vaccine_name}:${record.dose_number}`;
      let recordHasErrors = false;

      if (seenDoseKeys.has(doseKey)) {
        validationSummary.duplicateDoses += 1;
        validationSummary.errors.push(`Duplicate dose detected for ${record.vaccine_name} dose ${record.dose_number}.`);
        recordHasErrors = true;
      } else {
        seenDoseKeys.add(doseKey);
      }

      if (!record.date_administered) {
        validationSummary.warnings.push(
          `Administration date for ${record.vaccine_name} dose ${record.dose_number} was not provided.`,
        );
      } else {
        const administeredDate = new Date(record.date_administered);
        if (Number.isNaN(administeredDate.getTime())) {
          validationSummary.invalidDates += 1;
          validationSummary.errors.push(
            `Invalid administration date for ${record.vaccine_name} dose ${record.dose_number}.`,
          );
          recordHasErrors = true;
        } else {
          if (administeredDate > now) {
            validationSummary.invalidDates += 1;
            validationSummary.errors.push(
              `Administration date for ${record.vaccine_name} dose ${record.dose_number} cannot be in the future.`,
            );
            recordHasErrors = true;
          }

          if (childDob && administeredDate < childDob) {
            validationSummary.invalidDates += 1;
            validationSummary.errors.push(
              `Administration date for ${record.vaccine_name} dose ${record.dose_number} cannot be earlier than the child's date of birth.`,
            );
            recordHasErrors = true;
          }
        }
      }

      if (!recordHasErrors) {
        validationSummary.validDoses += 1;
      }
    });

    const hasValidationErrors =
      validationSummary.duplicateDoses > 0 ||
      validationSummary.invalidDates > 0 ||
      validationSummary.invalidDoses > 0 ||
      validationSummary.invalidVaccines > 0;

    const validationResult = {
      data: {
        status: hasValidationErrors ? VALIDATION_STATUS.FOR_VALIDATION : VALIDATION_STATUS.APPROVED,
        validationSummary,
        nextAction: hasValidationErrors ? 'Needs nurse review' : 'Ready for scheduling',
      },
    };
    const autoApproved = validationResult.data.status === VALIDATION_STATUS.APPROVED;
    const triageCategory = autoApproved ? 'ready_for_scheduling' : 'needs_record_verification';

    // Insert the transfer-in case
    const result = await pool.query(
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
        infant_id,
        source_facility,
        JSON.stringify(validVaccines),
        vaccination_card_url || null,
        remarks || null,
        validationResult.data.status,
        PRIORITY.NORMAL,
        triageCategory,
        autoApproved,
        JSON.stringify(validationResult.data.validationSummary),
      ],
    );

    const transferCase = result.rows[0];

    // Update infant record with transfer-in source
    await pool.query(
      `UPDATE patients
       SET transfer_in_source = $1,
           validation_status = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [
        source_facility,
        autoApproved ? VALIDATION_STATUS.APPROVED : VALIDATION_STATUS.FOR_VALIDATION,
        infant_id,
      ],
    );

    // Broadcast to admins
    socketService.broadcast('transfer_in_case_created', {
      id: transferCase.id,
      infant_name: `${infantCheck.rows[0].first_name} ${infantCheck.rows[0].last_name}`,
      source_facility,
      triage_category: triageCategory,
    });

    // Send notification to guardian
    await pool.query(
      `
        INSERT INTO notifications (user_id, user_type, title, message, type, is_read, created_at)
        VALUES ($1, 'guardian', $2, $3, 'transfer_in', false, CURRENT_TIMESTAMP)
      `,
      [
        guardianId,
        autoApproved ? 'Transfer Case Approved' : 'Transfer Case Submitted',
        autoApproved
          ? `Your child's vaccination records from ${source_facility} have been verified. Your child is now ready for scheduling.`
          : `Your child's vaccination records from ${source_facility} have been submitted for review. You will be notified once verified.`,
      ],
    );

    res.status(201).json({
      success: true,
      data: {
        caseId: transferCase.id,
        status: validationResult.data.status,
        validationSummary: validationResult.data.validationSummary,
        nextAction: validationResult.data.nextAction,
      },
      message: autoApproved
        ? 'Transfer case automatically approved. Child is ready for scheduling.'
        : 'Transfer case submitted successfully for review.',
    });
  } catch (error) {
    console.error('Error creating transfer-in case:', error);
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
router.get('/', requirePermission('patient:view'), async (req, res) => {
  try {
    const {
      status,
      priority,
      triage_category,
      limit = 50,
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
router.put('/:id/validate', requirePermission('patient:update'), async (req, res) => {
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

    const result = await pool.query(
      `UPDATE transfer_in_cases
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      params,
    );

    const updatedCase = result.rows[0];

    // Update the infant record
    await pool.query(
      `UPDATE patients
       SET validation_status = $1,
           auto_computed_next_vaccine = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [
        validation_status || currentCase.validation_status,
        auto_computed_next_vaccine || currentCase.auto_computed_next_vaccine,
        currentCase.infant_id,
      ],
    );

    // Send notification to guardian
    const guardianId = currentCase.guardian_id;
    let notificationTitle = '';
    let notificationMessage = '';

    switch (validation_status) {
    case VALIDATION_STATUS.APPROVED:
      notificationTitle = 'Transfer Case Approved';
      notificationMessage = `Your child's vaccination records have been verified. ${
        next_recommended_vaccine
          ? `The next recommended vaccine is ${next_recommended_vaccine}.`
          : 'Your child is now ready for scheduling.'
      }`;
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
      await pool.query(
        `
          INSERT INTO notifications (user_id, user_type, title, message, type, is_read, created_at)
          VALUES ($1, 'guardian', $2, $3, 'transfer_in', false, CURRENT_TIMESTAMP)
        `,
        [guardianId, notificationTitle, notificationMessage],
      );
    }

    // Broadcast update
    socketService.broadcast('transfer_in_case_updated', {
      id: updatedCase.id,
      validation_status: updatedCase.validation_status,
      triage_category: updatedCase.triage_category,
    });

    res.json({
      success: true,
      data: updatedCase,
      message: 'Transfer case updated successfully.',
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
router.put('/:id/approve-vaccines', requirePermission('patient:update'), async (req, res) => {
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

        const importResults = [];

        for (const vaccine of approvedVaccines) {
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

          // Get vaccine ID by name
          const vaccineResult = await client.query(
            'SELECT id FROM vaccines WHERE name = $1 AND is_active = true LIMIT 1',
            [vaccineNameValidation.vaccineName],
          );

          if (vaccineResult.rows.length === 0) {
            importResults.push({
              vaccine_name: vaccine.vaccine_name,
              dose_number: vaccine.dose_number,
              status: 'failed',
              message: 'Vaccine not found',
            });
            continue;
          }

          const vaccineId = vaccineResult.rows[0].id;

          // Check for duplicate
          const duplicateCheck = await client.query(
            `SELECT id FROM immunization_records
             WHERE patient_id = $1 AND vaccine_id = $2 AND dose_no = $3
             AND DATE(admin_date) = DATE($4) AND is_active = true LIMIT 1`,
            [currentCase.infant_id, vaccineId, vaccine.dose_number, vaccine.date_administered],
          );

          if (duplicateCheck.rows.length > 0) {
            importResults.push({
              vaccine_name: vaccine.vaccine_name,
              dose_number: vaccine.dose_number,
              status: 'skipped',
              message: 'Duplicate record',
            });
            continue;
          }

          // Insert immunization record
          await client.query(
            `INSERT INTO immunization_records (
              patient_id,
              vaccine_id,
              dose_no,
              admin_date,
              status,
              is_imported,
              source_facility,
              transfer_case_id,
              notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              currentCase.infant_id,
              vaccineId,
              vaccine.dose_number,
              vaccine.date_administered,
              'completed',
              true,
              currentCase.source_facility,
              caseId,
              vaccine.batch_number ? `Batch: ${vaccine.batch_number}` : null,
            ],
          );

          importResults.push({
            vaccine_name: vaccine.vaccine_name,
            dose_number: vaccine.dose_number,
            status: 'success',
            message: 'Imported successfully',
          });
        }

        // Update transfer case
        await client.query(
          `UPDATE transfer_in_cases
           SET approved_vaccines = $1,
               vaccines_imported = true,
               vaccines_imported_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [JSON.stringify(approvedVaccines), caseId],
        );

        await client.query('COMMIT');

        // Broadcast update
        socketService.broadcast('vaccinations_imported', {
          caseId,
          infantId: currentCase.infant_id,
          count: importResults.filter(r => r.status === 'success').length,
        });

        res.json({
          success: true,
          data: {
            importResults,
            summary: {
              total: importResults.length,
              success: importResults.filter(r => r.status === 'success').length,
              skipped: importResults.filter(r => r.status === 'skipped').length,
              failed: importResults.filter(r => r.status === 'failed').length,
            },
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
router.get('/stats/overview', requirePermission('patient:view'), async (_req, res) => {
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
