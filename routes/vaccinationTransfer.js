const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');
const socketService = require('../services/socketService');
const {
  getApprovedVaccines,
  validateApprovedVaccine,
  validateApprovedVaccineName,
} = require('../utils/approvedVaccines');
const {
  ensureAtBirthVaccinationRecords,
  importVaccinationRecord,
} = require('../services/atBirthVaccinationService');

router.use(authenticateToken);

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

// Validation result statuses
const VALIDATION_RESULT = {
  VALID: 'valid',
  DUPLICATE: 'duplicate',
  INVALID_DATE: 'invalid_date',
  FUTURE_DATE: 'future_date',
  BEFORE_BIRTH: 'before_birth',
  UNKNOWN_VACCINE: 'unknown_vaccine',
  INVALID_DOSE: 'invalid_dose',
};

// Map vaccine names to vaccine IDs (using getVaccineIdByName for consistency)
const getVaccineIdByName = async (vaccineName) => {
  const vaccineValidation = await validateApprovedVaccine(vaccineName, {
    fieldName: 'vaccineName',
  });

  return vaccineValidation.valid ? vaccineValidation.vaccine.id : null;
};

const parsePositiveDoseNumber = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

// Transfer permissions - require appropriate permission for transferring vaccinations
const TRANSFER_PERMISSIONS = {
  IMPORT: 'vaccination:import',
  VIEW: 'vaccination:view',
  VALIDATE: 'vaccination:validate',
};

// Get all vaccines for dropdown
router.get('/vaccines', async (req, res) => {
  try {
    const vaccines = await getApprovedVaccines(true);
    res.json({
      success: true,
      data: vaccines,
    });
  } catch (error) {
    console.error('Error fetching vaccines:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vaccines',
    });
  }
});

// Validate vaccines before import - require permission for validation
router.post('/validate', requirePermission(TRANSFER_PERMISSIONS.VALIDATE), async (req, res) => {
  try {
    const { infantId, vaccines } = req.body;

    if (!infantId) {
      return res.status(400).json({
        success: false,
        error: 'Infant ID is required',
      });
    }

    if (!vaccines || !Array.isArray(vaccines) || vaccines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one vaccine record is required',
      });
    }

    // Get infant details
    const infantResult = await pool.query(
      'SELECT id, first_name, last_name, dob FROM patients WHERE id = $1 AND is_active = true',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Infant not found',
      });
    }

    const infant = infantResult.rows[0];
    const dob = new Date(infant.dob);
    const today = new Date();

    await ensureAtBirthVaccinationRecords(infantId, {
      patientDob: infant.dob,
    });

    // Validate each vaccine
    const validationResults = [];

    for (const vaccine of vaccines) {
      const result = {
        vaccineName: vaccine.vaccineName,
        doseNumber: vaccine.doseNumber,
        dateAdministered: vaccine.dateAdministered,
        facilityName: vaccine.facilityName,
        batchNumber: vaccine.batchNumber,
        status: VALIDATION_RESULT.VALID,
        message: '',
      };

      const vaccineNameValidation = validateApprovedVaccineName(vaccine.vaccineName, {
        fieldName: 'vaccineName',
      });
      if (!vaccineNameValidation.valid) {
        result.status = VALIDATION_RESULT.UNKNOWN_VACCINE;
        result.message = vaccineNameValidation.error;
        validationResults.push(result);
        continue;
      }

      const parsedDoseNumber = parsePositiveDoseNumber(vaccine.doseNumber);
      if (!parsedDoseNumber) {
        result.status = VALIDATION_RESULT.INVALID_DOSE;
        result.message = 'Dose number must be a positive integer';
        validationResults.push(result);
        continue;
      }

      result.vaccineName = vaccineNameValidation.vaccineName;
      result.doseNumber = parsedDoseNumber;

      // Check if vaccine exists in database using strict exact-name validation
      const vaccineLookup = await validateApprovedVaccine(vaccineNameValidation.vaccineName, {
        fieldName: 'vaccineName',
      });
      if (!vaccineLookup.valid) {
        result.status = VALIDATION_RESULT.UNKNOWN_VACCINE;
        result.message = vaccineLookup.error;
        validationResults.push(result);
        continue;
      }
      result.vaccineId = vaccineLookup.vaccine.id;

      // Parse date
      const adminDate = new Date(vaccine.dateAdministered);
      if (isNaN(adminDate.getTime())) {
        result.status = VALIDATION_RESULT.INVALID_DATE;
        result.message = 'Invalid date format';
        validationResults.push(result);
        continue;
      }

      // Check if date is in the future
      if (adminDate > today) {
        result.status = VALIDATION_RESULT.FUTURE_DATE;
        result.message = 'Date cannot be in the future';
        validationResults.push(result);
        continue;
      }

      // Check if date is before birth
      if (adminDate < dob) {
        result.status = VALIDATION_RESULT.BEFORE_BIRTH;
        result.message = `Date (${adminDate.toLocaleDateString()}) is before infant's birth date (${dob.toLocaleDateString()})`;
        validationResults.push(result);
        continue;
      }

      // Check for duplicate (same vaccine, dose, date)
      const duplicateCheck = await pool.query(
        `SELECT id FROM immunization_records
         WHERE patient_id = $1 AND vaccine_id = $2 AND dose_no = $3
         AND DATE(admin_date) = DATE($4) AND is_active = true LIMIT 1`,
        [infantId, vaccineLookup.vaccine.id, parsedDoseNumber, vaccine.dateAdministered],
      );

      if (duplicateCheck.rows.length > 0) {
        result.status = VALIDATION_RESULT.DUPLICATE;
        result.message = 'A record with the same vaccine, dose, and date already exists';
        validationResults.push(result);
        continue;
      }

      validationResults.push(result);
    }

    // Summary
    const validCount = validationResults.filter(r => r.status === VALIDATION_RESULT.VALID).length;
    const invalidCount = validationResults.length - validCount;

    res.json({
      success: true,
      data: {
        validationResults,
        summary: {
          total: validationResults.length,
          valid: validCount,
          invalid: invalidCount,
        },
      },
    });
  } catch (error) {
    console.error('Error validating vaccines:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate vaccines',
    });
  }
});

// Bulk import vaccination records - require permission for transfer authorization
router.post('/import', requirePermission(TRANSFER_PERMISSIONS.IMPORT), async (req, res) => {
  try {
    const { infantId, vaccines, transferCaseId, sourceFacility } = req.body;

    if (!infantId) {
      return res.status(400).json({
        success: false,
        error: 'Infant ID is required',
      });
    }

    if (!vaccines || !Array.isArray(vaccines) || vaccines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one vaccine record is required',
      });
    }

    // Verify guardian owns the infant (if guardian)
    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const infantCheck = await pool.query(
        'SELECT id FROM patients WHERE id = $1 AND guardian_id = $2 AND is_active = true',
        [infantId, guardianId],
      );

      if (infantCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. This infant does not belong to your account.',
        });
      }
    }

    // Get infant details
    const infantResult = await pool.query(
      'SELECT id, first_name, last_name, dob FROM patients WHERE id = $1 AND is_active = true',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Infant not found',
      });
    }

    const infant = infantResult.rows[0];
    const dob = new Date(infant.dob);
    const today = new Date();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await ensureAtBirthVaccinationRecords(infantId, {
        patientDob: infant.dob,
        client,
      });

      const importResults = [];

      for (const vaccine of vaccines) {
        const result = {
          vaccineName: vaccine.vaccineName,
          doseNumber: vaccine.doseNumber,
          dateAdministered: vaccine.dateAdministered,
          status: 'success',
          message: '',
          recordId: null,
        };

        const vaccineNameValidation = validateApprovedVaccineName(vaccine.vaccineName, {
          fieldName: 'vaccineName',
        });
        if (!vaccineNameValidation.valid) {
          result.status = 'failed';
          result.message = vaccineNameValidation.error;
          importResults.push(result);
          continue;
        }

        const parsedDoseNumber = parsePositiveDoseNumber(vaccine.doseNumber);
        if (!parsedDoseNumber) {
          result.status = 'failed';
          result.message = 'Dose number must be a positive integer';
          importResults.push(result);
          continue;
        }

        result.vaccineName = vaccineNameValidation.vaccineName;
        result.doseNumber = parsedDoseNumber;

        // Get vaccine ID using strict exact-name validation
        const vaccineLookup = await validateApprovedVaccine(vaccineNameValidation.vaccineName, {
          fieldName: 'vaccineName',
        });
        if (!vaccineLookup.valid) {
          result.status = 'failed';
          result.message = vaccineLookup.error;
          importResults.push(result);
          continue;
        }

        // Parse date
        const adminDate = new Date(vaccine.dateAdministered);
        if (isNaN(adminDate.getTime())) {
          result.status = 'failed';
          result.message = 'Invalid date format';
          importResults.push(result);
          continue;
        }

        // Validate date
        if (adminDate > today) {
          result.status = 'failed';
          result.message = 'Date cannot be in the future';
          importResults.push(result);
          continue;
        }

        if (adminDate < dob) {
          result.status = 'failed';
          result.message = 'Date is before infant\'s birth date';
          importResults.push(result);
          continue;
        }

        const importOutcome = await importVaccinationRecord({
          client,
          patientId: infantId,
          vaccineName: vaccineNameValidation.vaccineName,
          doseNo: parsedDoseNumber,
          adminDate: vaccine.dateAdministered,
          sourceFacility: vaccine.facilityName || sourceFacility || 'External',
          transferCaseId: transferCaseId || null,
          notes: vaccine.batchNumber ? `Batch: ${vaccine.batchNumber}` : null,
        });

        result.recordId = importOutcome.record?.id || null;
        result.status = importOutcome.action === 'skipped' ? 'skipped' : 'success';
        result.message = importOutcome.message;
        importResults.push(result);
      }

      await client.query('COMMIT');

      // Broadcast update
      socketService.broadcast('vaccinations_imported', {
        infantId,
        infantName: `${infant.first_name} ${infant.last_name}`,
        count: importResults.filter(r => r.status === 'success').length,
      });

      // Summary
      const successCount = importResults.filter(r => r.status === 'success').length;
      const skippedCount = importResults.filter(r => r.status === 'skipped').length;
      const failedCount = importResults.filter(r => r.status === 'failed').length;

      res.json({
        success: true,
        data: {
          importResults,
          summary: {
            total: importResults.length,
            success: successCount,
            skipped: skippedCount,
            failed: failedCount,
          },
        },
        message: `Successfully imported ${successCount} vaccination record(s)`,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error importing vaccines:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import vaccines',
    });
  }
});

// Get all imported vaccination history for an infant - require permission for viewing
router.get('/infant/:infantId', requirePermission(TRANSFER_PERMISSIONS.VIEW), async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid infant ID',
      });
    }

    // Check access - guardian can only see their own infants
    if (isGuardian(req)) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const infantCheck = await pool.query(
        'SELECT id FROM patients WHERE id = $1 AND guardian_id = $2 AND is_active = true',
        [infantId, guardianId],
      );

      if (infantCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }
    }

    // Get imported vaccination records
    const result = await pool.query(
      `SELECT
        ir.id,
        ir.patient_id,
        ir.vaccine_id,
        ir.dose_no,
        ir.admin_date,
        ir.status,
        ir.is_imported,
        ir.source_facility,
        ir.transfer_case_id,
        ir.notes,
        ir.created_at,
        v.name as vaccine_name,
        v.code as vaccine_code
      FROM immunization_records ir
      JOIN vaccines v ON v.id = ir.vaccine_id
      WHERE ir.patient_id = $1
        AND ir.is_imported = true
        AND ir.is_active = true
      ORDER BY ir.admin_date DESC`,
      [infantId],
    );

    // Get transfer case info if exists
    const transferCases = await pool.query(
      `SELECT id, source_facility, created_at, validation_status
       FROM transfer_in_cases
       WHERE infant_id = $1
       ORDER BY created_at DESC`,
      [infantId],
    );

    res.json({
      success: true,
      data: {
        records: result.rows,
        transferCases: transferCases.rows,
      },
    });
  } catch (error) {
    console.error('Error fetching imported vaccination history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch imported vaccination history',
    });
  }
});

// Helper function removed - using getVaccineIdByName instead for consistency

module.exports = router;
