/**
 * Infant age routes and utilities.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const {
  calculateAgeInMonths,
  calculateAge,
  updateAllInfantAges,
  updatePatientAge,
  getInfantAgeInfo,
  getAllInfantsWithAges,
  getAgeStatistics,
} = require('../utils/ageCalculation');

router.use(authenticateToken);

const sanitizeLimit = (value, fallback = 100, max = 1000) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
};

const sanitizeOffset = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

/**
 * POST /api/infant-ages/update-all
 * Bulk update age_months for all active infants.
 */
router.post('/update-all', requirePermission('patient:update'), async (req, res) => {
  try {
    console.log('[Infant Ages] Starting bulk age update...');
    const result = await updateAllInfantAges();

    if (result.success) {
      console.log(`[Infant Ages] Updated ${result.updated} of ${result.total} infants`);
      res.json({
        success: true,
        message: `Successfully updated age for ${result.updated} of ${result.total} infants`,
        data: {
          updated: result.updated,
          total: result.total,
          errors: result.errors,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to update infant ages',
        details: result.errors,
      });
    }
  } catch (error) {
    console.error('[Infant Ages] Error in bulk update:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/infant-ages/stats
 * Age statistics for all infants.
 */
router.get('/stats', requirePermission('patient:view'), async (req, res) => {
  try {
    const stats = await getAgeStatistics();

    if (stats) {
      res.json({
        success: true,
        data: {
          totalInfants: parseInt(stats.total_infants, 10),
          withAgeRecord: parseInt(stats.with_age_record, 10),
          averageAgeMonths: stats.average_age_months ? parseFloat(stats.average_age_months).toFixed(1) : null,
          youngestMonths: stats.youngest_months ? parseInt(stats.youngest_months, 10) : null,
          oldestMonths: stats.oldest_months ? parseInt(stats.oldest_months, 10) : null,
          under1Year: parseInt(stats.under_1_year, 10),
          age1To2: parseInt(stats.age_1_to_2, 10),
          age2Plus: parseInt(stats.age_2_plus, 10),
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve statistics',
      });
    }
  } catch (error) {
    console.error('[Infant Ages] Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/infant-ages
 * List infants with calculated ages.
 */
router.get('/', requirePermission('patient:view'), async (req, res) => {
  try {
    const limit = sanitizeLimit(req.query.limit, 100, 1000);
    const offset = sanitizeOffset(req.query.offset, 0);

    const infants = await getAllInfantsWithAges(limit, offset);

    res.json({
      success: true,
      data: infants,
      pagination: {
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('[Infant Ages] Error getting infants:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve infants',
    });
  }
});

/**
 * GET /api/infant-ages/:id
 * Detailed age info for a single infant.
 */
router.get('/:id(\\d+)', requirePermission('patient:view'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.id, 10);

    if (Number.isNaN(infantId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid infant ID',
      });
    }

    const infantInfo = await getInfantAgeInfo(infantId);

    if (!infantInfo) {
      return res.status(404).json({
        success: false,
        error: 'Infant not found',
      });
    }

    res.json({
      success: true,
      data: infantInfo,
    });
  } catch (error) {
    console.error('[Infant Ages] Error getting infant info:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * PUT /api/infant-ages/:id
 * Recalculate age for a single infant.
 */
router.put('/:id(\\d+)', requirePermission('patient:update'), async (req, res) => {
  try {
    const infantId = parseInt(req.params.id, 10);

    if (Number.isNaN(infantId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid infant ID',
      });
    }

    const result = await updatePatientAge(infantId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Infant age updated successfully',
        data: {
          infantId,
          ageMonths: result.ageMonths,
        },
      });
    } else {
      res.status(404).json({
        success: false,
        error: result.error || 'Failed to update infant age',
      });
    }
  } catch (error) {
    console.error('[Infant Ages] Error updating infant age:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/infant-ages/calculate
 * Utility endpoint to calculate age for a DOB.
 */
router.post('/calculate', async (req, res) => {
  try {
    const { dob } = req.body;

    if (!dob) {
      return res.status(400).json({
        success: false,
        error: 'Date of birth is required',
      });
    }

    const ageInMonths = calculateAgeInMonths(dob);
    const ageDetails = calculateAge(dob);

    res.json({
      success: true,
      data: {
        dob,
        ageInMonths,
        ageDetails,
      },
    });
  } catch (error) {
    console.error('[Infant Ages] Error calculating age:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

module.exports = router;
