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
const { calculateVaccineReadiness } = require('../services/vaccineRulesEngine');
const immunizationScheduleService = require('../services/immunizationScheduleService');

// Middleware to authenticate all routes
router.use(authenticateToken);

const guardianOwnsInfant = async (guardianId, infantId) => {
  const result = await pool.query(
    'SELECT id FROM patients WHERE id = $1 AND guardian_id = $2 AND is_active = true LIMIT 1',
    [infantId, guardianId],
  );

  return result.rows.length > 0;
};

const formatIsoDateTime = (value) => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const formatGuardianProjectionInfant = (projection = {}) => ({
  id: projection?.infantInfo?.id || null,
  first_name: projection?.infantInfo?.firstName || null,
  last_name: projection?.infantInfo?.lastName || null,
  dob: formatIsoDateTime(projection?.infantInfo?.dateOfBirth),
});

const formatReadinessManagerSchedules = (projection = {}) =>
  (Array.isArray(projection?.schedules) ? projection.schedules : []).map((scheduleItem) => ({
    id: scheduleItem.id,
    vaccineId: scheduleItem.vaccineId,
    vaccineName: scheduleItem.vaccineName,
    vaccineCode: scheduleItem.vaccineCode,
    doseNumber: scheduleItem.doseNumber,
    totalDoses: scheduleItem.totalDoses,
    dosesCompleted: scheduleItem.dosesCompleted,
    isComplete: scheduleItem.isCompleted,
    isNextDueDose: scheduleItem.isNextDueDose,
    ageInMonths: scheduleItem.ageMonths,
    minimumAgeDays: scheduleItem.minimumAgeDays,
    dueDate: formatIsoDateTime(scheduleItem.dueDate),
    adminDate: formatIsoDateTime(scheduleItem.adminDate),
    recordId: scheduleItem.recordId || null,
    isOverdue: Boolean(scheduleItem.isPastDue),
    isDueSoon: Boolean(scheduleItem.isDueToday),
    isReady: Boolean(scheduleItem.isReady),
    readinessConfirmedBy: scheduleItem.readinessConfirmedBy || null,
    readinessConfirmedAt: scheduleItem.readinessConfirmedAt || null,
    status: scheduleItem.status,
    canBeAdministered: Boolean(scheduleItem.canBeAdministered),
  }));

const formatGuardianChartSchedules = (projection = {}) =>
  (Array.isArray(projection?.schedules) ? projection.schedules : []).map((scheduleItem) => ({
    vaccine: {
      id: scheduleItem.vaccineId,
      name: scheduleItem.vaccineName,
      code: scheduleItem.vaccineCode,
    },
    dose: {
      number: scheduleItem.doseNumber,
      total: scheduleItem.totalDoses,
      completed: scheduleItem.dosesCompleted,
    },
    schedule: {
      ageInMonths: scheduleItem.ageMonths,
      minimumAgeDays: scheduleItem.minimumAgeDays,
      dueDate: formatIsoDateTime(scheduleItem.dueDate),
      isOverdue: Boolean(scheduleItem.isPastDue),
      isDueSoon: Boolean(scheduleItem.isDueToday),
      description: scheduleItem.description || null,
    },
    status: scheduleItem.status,
    isReady: Boolean(scheduleItem.isReady),
    isNextDueDose: scheduleItem.isNextDueDose,
    recordId: scheduleItem.recordId || null,
    lastAdministered: formatIsoDateTime(scheduleItem.adminDate),
    canBeAdministered: Boolean(scheduleItem.canBeAdministered),
  }));

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

    if (getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);

      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const projection = await immunizationScheduleService.getGuardianScheduleProjection(infantId);
    if (projection?.error) {
      return res.status(404).json({ error: projection.error });
    }

    res.json({
      infant: formatGuardianProjectionInfant(projection),
      ageInDays: projection?.currentAge?.days || 0,
      ageInWeeks: Math.floor((projection?.currentAge?.days || 0) / 7),
      ageInMonths: projection?.currentAge?.months || 0,
      schedules: formatReadinessManagerSchedules(projection),
      summary: projection.summary || null,
      readiness: projection.readiness || null,
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

const READINESS_ROUTE_TIMEOUT_MS = 20000;
const READINESS_CACHE_TTL_MS = 60000;

const readinessCache = new Map();

const getCachedReadiness = (cacheKey) => {
  const entry = readinessCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > READINESS_CACHE_TTL_MS) {
    readinessCache.delete(cacheKey);
    return null;
  }
  return entry.promise;
};

const setCachedReadiness = (cacheKey, promise) => {
  readinessCache.set(cacheKey, { promise, timestamp: Date.now() });
  promise.catch(() => readinessCache.delete(cacheKey));
};

const withRouteTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        const err = new Error('Readiness calculation timed out');
        err.code = 'READINESS_TIMEOUT';
        reject(err);
      }, ms),
    ),
  ]);

/**
 * Get simplified vaccine readiness snapshot
 * GET /api/vaccination-readiness/:childId
 */
router.get('/:childId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.childId, 10);
    const scheduledDate = String(req.query.scheduled_date || '').trim() || null;
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ success: false, error: 'Invalid infant ID' });
    }

    if (getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);

      if (!isOwner) {
        return res.status(403).json({ success: false, error: 'Access denied for this infant' });
      }
    }

    const cacheKey = `${infantId}:${scheduledDate || ''}`;
    let readinessPromise = getCachedReadiness(cacheKey);
    if (!readinessPromise) {
      readinessPromise = calculateVaccineReadiness(infantId, { scheduledDate });
      setCachedReadiness(cacheKey, readinessPromise);
    }

    const readinessResult = await withRouteTimeout(readinessPromise, READINESS_ROUTE_TIMEOUT_MS);

    if (!readinessResult.success) {
      return res.status(500).json(readinessResult);
    }

    res.json({
      success: true,
      data: readinessResult.data,
    });
  } catch (error) {
    if (res.headersSent) {
      return;
    }
    if (error.code === 'READINESS_TIMEOUT') {
      console.error(`Readiness timeout for child ${req.params.childId}`);
      return res.status(504).json({ success: false, error: 'Readiness calculation timed out. Please try again.' });
    }
    console.error('Error fetching vaccine readiness:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch vaccine readiness' });
  }
});

/**
 * Get vaccination schedule with proper status for guardian dashboard
 * GET /api/vaccination-readiness/schedule/:infantId
 */
router.get('/schedule/:infantId', async (req, res) => {
  try {
    const infantId = parseInt(req.params.infantId, 10);
    if (Number.isNaN(infantId)) {
      return res.status(400).json({ error: 'Invalid infant ID' });
    }

    if (getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN) {
      const guardianId = parseInt(req.user.guardian_id, 10);
      const isOwner = await guardianOwnsInfant(guardianId, infantId);

      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied for this infant' });
      }
    }

    const projection = await immunizationScheduleService.getGuardianScheduleProjection(infantId);
    if (projection?.error) {
      return res.status(404).json({ error: projection.error });
    }

    res.json({
      infant: formatGuardianProjectionInfant(projection),
      age: {
        days: projection?.currentAge?.days || 0,
        weeks: Math.floor((projection?.currentAge?.days || 0) / 7),
        months: projection?.currentAge?.months || 0,
      },
      schedule: formatGuardianChartSchedules(projection),
      summary: projection.summary || {
        totalVaccines: 0,
        completed: 0,
        ready: 0,
        pendingConfirmation: 0,
        upcoming: 0,
        overdue: 0,
      },
      readiness: projection.readiness || null,
    });
  } catch (error) {
    console.error('Error fetching vaccination schedule:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination schedule' });
  }
});

module.exports = router;
