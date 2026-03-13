const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const socketService = require('../services/socketService');

// Middleware to authenticate all routes
router.use(authenticateToken);

/**
 * Get infant vaccine readiness status
 * GET /api/vaccination-readiness/infant/:infantId
 */
router.get('/infant/:infantId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    // Verify infant exists
    const infantResult = await pool.query(
      'SELECT id, first_name, last_name, dob FROM patients WHERE id = $1 AND is_active = true',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    // Get all vaccination schedules
    const schedulesResult = await pool.query(
      `SELECT vs.*, v.name as vaccine_name, v.code as vaccine_code
       FROM vaccination_schedules vs
       JOIN vaccines v ON vs.vaccine_id = v.id
       WHERE vs.is_active = true
       ORDER BY vs.age_in_months ASC, vs.vaccine_name ASC`,
    );

    // Get readiness status for this infant
    const readinessResult = await pool.query(
      `SELECT ivr.*, v.name as vaccine_name
       FROM infant_vaccine_readiness ivr
       JOIN vaccines v ON ivr.vaccine_id = v.id
       WHERE ivr.infant_id = $1 AND ivr.is_active = true`,
      [infantId],
    );

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

    const readinessMap = {};
    readinessResult.rows.forEach(record => {
      readinessMap[record.vaccine_id] = {
        isReady: record.is_ready,
        confirmedBy: record.ready_confirmed_by,
        confirmedAt: record.ready_confirmed_at,
        notes: record.notes,
      };
    });

    const infantDob = new Date(infantResult.rows[0].dob);
    const today = new Date();
    const ageInDays = Math.floor((today - infantDob) / (1000 * 60 * 60 * 24));

    // Build response with status
    const schedules = schedulesResult.rows.map(schedule => {
      const dosesCompleted = completedVaccines[schedule.vaccine_id] || 0;
      const isComplete = dosesCompleted >= schedule.total_doses;
      const readiness = readinessMap[schedule.vaccine_id] || { isReady: false };

      // Calculate due date based on schedule
      const dueDate = new Date(infantDob);
      dueDate.setDate(dueDate.getDate() + (schedule.minimum_age_days || schedule.age_in_months * 30));

      const isOverdue = !isComplete && dueDate < today;
      const isDueSoon = !isComplete && !isOverdue && dueDate <= new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

      // Determine status based on age and readiness
      let status;
      if (isComplete) {
        status = 'completed';
      } else if (ageInDays < (schedule.minimum_age_days || schedule.age_in_months * 30)) {
        status = 'upcoming'; // Not yet eligible due to age
      } else if (!readiness.isReady) {
        status = 'pending_confirmation'; // Age is right but admin hasn't confirmed
      } else if (isOverdue) {
        status = 'overdue';
      } else if (isDueSoon) {
        status = 'due_soon';
      } else {
        status = 'ready'; // Ready to receive
      }

      return {
        id: schedule.id,
        vaccineId: schedule.vaccine_id,
        vaccineName: schedule.vaccine_name,
        vaccineCode: schedule.vaccine_code,
        doseNumber: schedule.dose_number,
        totalDoses: schedule.total_doses,
        dosesCompleted,
        isComplete,
        ageInMonths: schedule.age_in_months,
        minimumAgeDays: schedule.minimum_age_days || schedule.age_in_months * 30,
        dueDate: dueDate.toISOString(),
        isOverdue,
        isDueSoon,
        isReady: readiness.isReady,
        readinessConfirmedBy: readiness.confirmedBy,
        readinessConfirmedAt: readiness.confirmedAt,
        status,
        canBeAdministered: readiness.isReady && !isComplete,
      };
    });

    res.json({
      infant: infantResult.rows[0],
      ageInDays,
      schedules,
    });
  } catch (error) {
    console.error('Error fetching infant vaccine readiness:', error);
    res.status(500).json({ error: 'Failed to fetch infant vaccine readiness' });
  }
});

/**
 * Set infant vaccine readiness for a specific vaccine
 * POST /api/vaccination-readiness/infant/:infantId/vaccine/:vaccineId
 */
router.post('/infant/:infantId/vaccine/:vaccineId', requirePermission('vaccination:create'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    const vaccineId = parseInt(req.params.vaccineId, 10);
    const { isReady, notes } = req.body;

    if (Number.isNaN(infantId) || Number.isNaN(vaccineId)) {
      return res.status(400).json({ error: 'Invalid infant or vaccine ID' });
    }

    if (typeof isReady !== 'boolean') {
      return res.status(400).json({ error: 'isReady must be a boolean' });
    }

    // Verify infant exists
    const infantResult = await pool.query(
      'SELECT id FROM patients WHERE id = $1 AND is_active = true',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    // Verify vaccine exists
    const vaccineResult = await pool.query(
      'SELECT id, name FROM vaccines WHERE id = $1 AND is_active = true',
      [vaccineId],
    );

    if (vaccineResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine not found' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if readiness record exists
      const existingResult = await client.query(
        `SELECT id FROM infant_vaccine_readiness
         WHERE infant_id = $1 AND vaccine_id = $2 AND is_active = true`,
        [infantId, vaccineId],
      );

      let result;
      if (existingResult.rows.length > 0) {
        // Update existing record
        result = await client.query(
          `UPDATE infant_vaccine_readiness
           SET is_ready = $1, ready_confirmed_by = $2, ready_confirmed_at = CURRENT_TIMESTAMP, notes = $3, updated_at = CURRENT_TIMESTAMP
           WHERE id = $4
           RETURNING *`,
          [isReady, req.user.id, notes || null, existingResult.rows[0].id],
        );
      } else {
        // Create new record
        result = await client.query(
          `INSERT INTO infant_vaccine_readiness (infant_id, vaccine_id, is_ready, ready_confirmed_by, ready_confirmed_at, notes, created_by)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $4)
           RETURNING *`,
          [infantId, vaccineId, isReady, req.user.id, notes || null],
        );
      }

      // Create audit log
      await client.query(
        `INSERT INTO vaccination_audit_log (infant_id, vaccine_id, action_type, new_status, performed_by, notes)
         VALUES ($1, $2, 'READINESS_CONFIRMED', $3, $4, $5)`,
        [infantId, vaccineId, isReady ? 'ready' : 'not_ready', req.user.id, notes || null],
      );

      await client.query('COMMIT');

      socketService.broadcast('infant_vaccine_readiness_updated', {
        infantId,
        vaccineId,
        isReady,
        confirmedBy: req.user.id,
      });

      res.json({
        success: true,
        message: isReady
          ? `Infant is now confirmed ready to receive ${vaccineResult.rows[0].name}`
          : `Infant readiness for ${vaccineResult.rows[0].name} has been reset`,
        readiness: result.rows[0],
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error setting infant vaccine readiness:', error);
    res.status(500).json({ error: 'Failed to set infant vaccine readiness' });
  }
});

/**
 * Batch set infant vaccine readiness for multiple vaccines
 * POST /api/vaccination-readiness/infant/:infantId/batch
 */
router.post('/infant/:infantId/batch', requirePermission('vaccination:create'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    const { vaccineIds, isReady, notes } = req.body;

    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (!Array.isArray(vaccineIds) || vaccineIds.length === 0) {
      return res.status(400).json({ error: 'vaccineIds must be a non-empty array' });
    }

    if (typeof isReady !== 'boolean') {
      return res.status(400).json({ error: 'isReady must be a boolean' });
    }

    // Verify infant exists
    const infantResult = await pool.query(
      'SELECT id FROM patients WHERE id = $1 AND is_active = true',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    const client = await pool.connect();
    const results = [];

    try {
      await client.query('BEGIN');

      for (const vaccineId of vaccineIds) {
        // Check if readiness record exists
        const existingResult = await client.query(
          `SELECT id FROM infant_vaccine_readiness
           WHERE infant_id = $1 AND vaccine_id = $2 AND is_active = true`,
          [infantId, vaccineId],
        );

        if (existingResult.rows.length > 0) {
          await client.query(
            `UPDATE infant_vaccine_readiness
             SET is_ready = $1, ready_confirmed_by = $2, ready_confirmed_at = CURRENT_TIMESTAMP, notes = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [isReady, req.user.id, notes || null, existingResult.rows[0].id],
          );
        } else {
          await client.query(
            `INSERT INTO infant_vaccine_readiness (infant_id, vaccine_id, is_ready, ready_confirmed_by, ready_confirmed_at, notes, created_by)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $4)`,
            [infantId, vaccineId, isReady, req.user.id, notes || null],
          );
        }

        // Create audit log
        await client.query(
          `INSERT INTO vaccination_audit_log (infant_id, vaccine_id, action_type, new_status, performed_by, notes)
           VALUES ($1, $2, 'READINESS_CONFIRMED', $3, $4, $5)`,
          [infantId, vaccineId, isReady ? 'ready' : 'not_ready', req.user.id, notes || null],
        );

        results.push({ vaccineId, success: true });
      }

      await client.query('COMMIT');

      socketService.broadcast('infant_vaccine_readiness_batch_updated', {
        infantId,
        vaccineIds,
        isReady,
      });

      res.json({
        success: true,
        message: `Updated readiness for ${results.length} vaccines`,
        results,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error batch setting infant vaccine readiness:', error);
    res.status(500).json({ error: 'Failed to batch set infant vaccine readiness' });
  }
});

/**
 * Get vaccination schedule with proper status for guardian dashboard
 * GET /api/vaccination-readiness/schedule/:infantId
 */
router.get('/schedule/:infantId', async (req, res) => {
  console.log('[DEBUG] Vaccination schedule request for infant:', req.params.infantId);
  try {
    const infantId = parseInt(req.params.infantId, 10);
    console.log('[DEBUG] Parsed infantId:', infantId);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    // Verify guardian access
    if (req.user.role === 'guardian') {
      const guardianId = req.user.guardian_id;
      const ownershipResult = await pool.query(
        'SELECT id FROM patients WHERE id = $1 AND guardian_id = $2 AND is_active = true',
        [infantId, guardianId],
      );

      if (ownershipResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    // This endpoint returns the same data as /infant/:infantId but formatted for guardian display
    const infantResult = await pool.query(
      'SELECT id, first_name, last_name, dob FROM patients WHERE id = $1 AND is_active = true',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    const infantDob = new Date(infantResult.rows[0].dob);
    const today = new Date();
    const ageInDays = Math.floor((today - infantDob) / (1000 * 60 * 60 * 24));
    const ageInWeeks = Math.floor(ageInDays / 7);
    const ageInMonths = Math.floor(ageInDays / 30);

    // Get completed vaccinations
    const completedResult = await pool.query(
      `SELECT ir.vaccine_id, ir.dose_no, ir.admin_date, v.name as vaccine_name
       FROM immunization_records ir
       JOIN vaccines v ON ir.vaccine_id = v.id
       WHERE ir.patient_id = $1 AND ir.is_active = true AND ir.status = 'completed'
       ORDER BY ir.admin_date DESC`,
      [infantId],
    );

    // Get readiness status
    const readinessResult = await pool.query(
      `SELECT ivr.vaccine_id, ivr.is_ready, ivr.ready_confirmed_at
       FROM infant_vaccine_readiness ivr
       WHERE ivr.infant_id = $1 AND ivr.is_active = true AND ivr.is_ready = true`,
      [infantId],
    );

    const readyVaccines = new Set(readinessResult.rows.map(r => r.vaccine_id));

    // Get all schedules
    const schedulesResult = await pool.query(
      `SELECT vs.*, v.name as vaccine_name, v.code as vaccine_code
       FROM vaccination_schedules vs
       JOIN vaccines v ON vs.vaccine_id = v.id
       WHERE vs.is_active = true
       ORDER BY vs.age_in_months ASC`,
    );

    // Map completed vaccinations
    const completedMap = {};
    completedResult.rows.forEach(record => {
      if (!completedMap[record.vaccine_id]) {
        completedMap[record.vaccine_id] = [];
      }
      completedMap[record.vaccine_id].push(record);
    });

    // Build guardian-friendly response
    const scheduleData = schedulesResult.rows.map(schedule => {
      const completedDoses = completedMap[schedule.vaccine_id] || [];
      const isComplete = completedDoses.length >= schedule.total_doses;
      const isReady = readyVaccines.has(schedule.vaccine_id);

      const dueDate = new Date(infantDob);
      dueDate.setDate(dueDate.getDate() + (schedule.minimum_age_days || schedule.age_in_months * 30));

      const isOverdue = !isComplete && dueDate < today;
      const ageRequirementMet = ageInDays >= (schedule.minimum_age_days || schedule.age_in_months * 30);

      // Status logic:
      // - completed: all doses administered
      // - upcoming: infant too young for this vaccine
      // - pending_confirmation: age is right but admin hasn't confirmed readiness
      // - ready: admin confirmed and ready to receive
      // - overdue: past due date and not complete
      let status;
      if (isComplete) {
        status = 'completed';
      } else if (!ageRequirementMet) {
        status = 'upcoming';
      } else if (!isReady) {
        status = 'pending_confirmation';
      } else if (isOverdue) {
        status = 'overdue';
      } else {
        status = 'ready';
      }

      const lastDose = completedDoses.length > 0 ? completedDoses[0] : null;

      return {
        vaccine: {
          id: schedule.vaccine_id,
          name: schedule.vaccine_name,
          code: schedule.vaccine_code,
        },
        dose: {
          number: schedule.dose_number,
          total: schedule.total_doses,
          completed: completedDoses.length,
        },
        schedule: {
          ageInMonths: schedule.age_in_months,
          minimumAgeDays: schedule.minimum_age_days || schedule.age_in_months * 30,
          dueDate: dueDate.toISOString(),
          isOverdue,
        },
        status,
        isReady,
        lastAdministered: lastDose ? lastDose.admin_date : null,
        canBeAdministered: isReady && !isComplete,
      };
    });

    res.json({
      infant: infantResult.rows[0],
      age: {
        days: ageInDays,
        weeks: ageInWeeks,
        months: ageInMonths,
      },
      schedule: scheduleData,
      summary: {
        totalVaccines: scheduleData.length,
        completed: scheduleData.filter(s => s.status === 'completed').length,
        ready: scheduleData.filter(s => s.status === 'ready').length,
        upcoming: scheduleData.filter(s => s.status === 'upcoming').length,
        overdue: scheduleData.filter(s => s.status === 'overdue').length,
        pendingConfirmation: scheduleData.filter(s => s.status === 'pending_confirmation').length,
      },
    });
  } catch (error) {
    console.error('[DEBUG] Error fetching vaccination schedule:', error);
    console.error('[DEBUG] Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch vaccination schedule' });
  }
});

module.exports = router;
