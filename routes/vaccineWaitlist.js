/**
 * Vaccine Waitlist API Routes
 * Handles waitlist management for vaccines
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getCanonicalRole, CANONICAL_ROLES } = require('../middleware/rbac');

// Apply authentication to all routes
router.use(authenticateToken);

const isGuardianRequest = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

const getResolvedGuardianId = (req) => {
  const guardianId = Number.parseInt(req.user?.guardian_id || req.user?.id, 10);
  return Number.isFinite(guardianId) && guardianId > 0 ? guardianId : null;
};

const assertGuardianScope = (req, requestedGuardianId) => {
  if (!isGuardianRequest(req)) {
    return null;
  }

  const currentGuardianId = getResolvedGuardianId(req);
  if (!currentGuardianId || currentGuardianId !== Number.parseInt(requestedGuardianId, 10)) {
    return {
      success: false,
      message: 'You can only access your own waitlist entries',
    };
  }

  return null;
};

const getWaitlistEntryById = async (id) => {
  const result = await pool.query(
    `
      SELECT id, guardian_id, infant_id, vaccine_id, clinic_id, status
      FROM vaccine_waitlist
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] || null;
};

/**
 * GET /api/vaccine-waitlist/check/:vaccineId/:clinicId
 * Check if vaccine is available and notify waitlist
 */
router.get(
  '/check/:vaccineId/:clinicId',
  requireRole(['admin', 'healthcare_worker']),
  async (req, res) => {
    try {
      const { vaccineId, clinicId } = req.params;

      // Check current stock
      const stockQuery = `
            SELECT
                COALESCE(SUM(qty_current), 0) as total_stock
            FROM vaccine_batches
            WHERE vaccine_id = $1
            AND clinic_id = $2
            AND expiry_date > CURRENT_DATE
            AND status = 'active'
        `;

      const stockResult = await pool.query(stockQuery, [vaccineId, clinicId]);
      const currentStock = parseInt(stockResult.rows[0].total_stock);

      // Get waitlist count
      const waitlistQuery = `
            SELECT COUNT(*) as count
            FROM vaccine_waitlist
            WHERE vaccine_id = $1
            AND clinic_id = $2
            AND status = 'waiting'
        `;

      const waitlistResult = await pool.query(waitlistQuery, [vaccineId, clinicId]);
      const waitlistCount = parseInt(waitlistResult.rows[0].count);

      res.json({
        success: true,
        data: {
          vaccine_id: parseInt(vaccineId),
          clinic_id: parseInt(clinicId),
          current_stock: currentStock,
          waitlist_count: waitlistCount,
          is_available: currentStock > 0,
        },
      });
    } catch (error) {
      console.error('Error checking vaccine availability:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check availability',
      });
    }
  },
);

/**
 * GET /api/vaccine-waitlist
 * Get all waitlist entries (admin view)
 */
router.get('/', requireRole(['admin', 'healthcare_worker']), async (req, res) => {
  try {
    const { page = 1, limit = 50, status, vaccine_id, clinic_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
            SELECT
                vw.id,
                vw.infant_id,
                p.first_name || ' ' || p.last_name as infant_name,
                p.control_number as control_number,
                vw.vaccine_id,
                v.name as vaccine_name,
                vw.clinic_id,
                c.name as clinic_name,
                g.name as guardian_name,
                g.phone as guardian_phone,
                vw.status,
                vw.notified_at,
                vw.created_at
            FROM vaccine_waitlist vw
            JOIN patients p ON vw.infant_id = p.id
            JOIN vaccines v ON vw.vaccine_id = v.id
            JOIN clinics c ON vw.clinic_id = c.id
            JOIN guardians g ON vw.guardian_id = g.id
            WHERE 1=1
        `;

    const queryParams = [];
    let paramCount = 1;

    if (status) {
      query += ` AND vw.status = $${paramCount++}`;
      queryParams.push(status);
    }
    if (vaccine_id) {
      query += ` AND vw.vaccine_id = $${paramCount++}`;
      queryParams.push(vaccine_id);
    }
    if (clinic_id) {
      query += ` AND vw.clinic_id = $${paramCount++}`;
      queryParams.push(clinic_id);
    }

    // Get total count
    const countQuery = query.replace(/SELECT vw\..* FROM/gi, 'SELECT COUNT(*) as total FROM');
    const countResult = await pool.query(countQuery, queryParams);
    const total = countResult.rows.length > 0 ? parseInt(countResult.rows[0].total) : 0;

    query += ` ORDER BY vw.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    queryParams.push(limit, offset);

    const result = await pool.query(query, queryParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching waitlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch waitlist',
    });
  }
});

/**
 * GET /api/vaccine-waitlist/guardian/:guardianId
 * Get waitlist entries for a specific guardian
 */
router.get('/guardian/:guardianId', async (req, res) => {
  try {
    const { guardianId } = req.params;
    const scopeError = assertGuardianScope(req, guardianId);

    if (scopeError) {
      return res.status(403).json(scopeError);
    }

    const query = `
            SELECT
                vw.id,
                vw.infant_id,
                p.first_name || ' ' || p.last_name as infant_name,
                p.control_number as control_number,
                vw.vaccine_id,
                v.name as vaccine_name,
                vw.clinic_id,
                c.name as clinic_name,
                vw.status,
                vw.notified_at,
                vw.created_at
            FROM vaccine_waitlist vw
            JOIN patients p ON vw.infant_id = p.id
            JOIN vaccines v ON vw.vaccine_id = v.id
            JOIN clinics c ON vw.clinic_id = c.id
            WHERE vw.guardian_id = $1
            ORDER BY vw.created_at DESC
        `;

    const result = await pool.query(query, [guardianId]);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching guardian waitlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch waitlist',
    });
  }
});

/**
 * POST /api/vaccine-waitlist
 * Add infant to vaccine waitlist
 */
router.post('/', async (req, res) => {
  try {
    const { infant_id, vaccine_id, clinic_id } = req.body;

    if (!infant_id || !vaccine_id || !clinic_id) {
      return res.status(400).json({
        success: false,
        message: 'infant_id, vaccine_id, and clinic_id are required',
      });
    }

    // Get guardian for the infant
    const guardianQuery = `
            SELECT guardian_id FROM patients WHERE id = $1
        `;
    const guardianResult = await pool.query(guardianQuery, [infant_id]);

    if (guardianResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Infant not found',
      });
    }

    const guardian_id = guardianResult.rows[0].guardian_id;

    if (isGuardianRequest(req)) {
      const currentGuardianId = getResolvedGuardianId(req);

      if (!currentGuardianId || currentGuardianId !== Number.parseInt(guardian_id, 10)) {
        return res.status(403).json({
          success: false,
          message: 'You can only add your own child to the vaccine waitlist',
        });
      }
    }

    // Check if already on waitlist
    const checkQuery = `
            SELECT id FROM vaccine_waitlist
            WHERE infant_id = $1 AND vaccine_id = $2 AND clinic_id = $3 AND status = 'waiting'
        `;
    const checkResult = await pool.query(checkQuery, [infant_id, vaccine_id, clinic_id]);

    if (checkResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Infant is already on the waitlist for this vaccine',
      });
    }

    // Add to waitlist
    const insertQuery = `
            INSERT INTO vaccine_waitlist (
                infant_id, vaccine_id, guardian_id, clinic_id, status
            ) VALUES ($1, $2, $3, $4, 'waiting')
            RETURNING *
        `;

    const result = await pool.query(insertQuery, [infant_id, vaccine_id, guardian_id, clinic_id]);

    res.status(201).json({
      success: true,
      message: 'Added to waitlist successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error adding to waitlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add to waitlist',
    });
  }
});

/**
 * DELETE /api/vaccine-waitlist/:id
 * Remove infant from waitlist
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const waitlistEntry = await getWaitlistEntryById(id);

    if (!waitlistEntry) {
      return res.status(404).json({
        success: false,
        message: 'Waitlist entry not found',
      });
    }

    if (isGuardianRequest(req)) {
      const currentGuardianId = getResolvedGuardianId(req);

      if (!currentGuardianId || currentGuardianId !== Number.parseInt(waitlistEntry.guardian_id, 10)) {
        return res.status(403).json({
          success: false,
          message: 'You can only remove your own waitlist entries',
        });
      }
    }

    const query = `
            UPDATE vaccine_waitlist
            SET status = 'removed', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;

    const result = await pool.query(query, [id]);

    res.json({
      success: true,
      message: 'Removed from waitlist successfully',
    });
  } catch (error) {
    console.error('Error removing from waitlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove from waitlist',
    });
  }
});

/**
 * POST /api/vaccine-waitlist/:id/notify
 * Manually trigger notification for waitlist entry
 */
router.post('/:id/notify', requireRole(['admin', 'healthcare_worker']), async (req, res) => {
  try {
    const { id } = req.params;

    // Get waitlist entry with details
    const query = `
            SELECT
                vw.*,
                p.first_name || ' ' || p.last_name as infant_name,
                p.control_number as control_number,
                v.name as vaccine_name,
                g.phone as guardian_phone,
                c.name as clinic_name
            FROM vaccine_waitlist vw
            JOIN patients p ON vw.infant_id = p.id
            JOIN vaccines v ON vw.vaccine_id = v.id
            JOIN guardians g ON vw.guardian_id = g.id
            JOIN clinics c ON vw.clinic_id = c.id
            WHERE vw.id = $1
        `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Waitlist entry not found',
      });
    }

    const entry = result.rows[0];

    // TODO: Integrate with SMS service to send notification
    // For now, just update the notified_at timestamp

    const updateQuery = `
            UPDATE vaccine_waitlist
            SET notified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;

    await pool.query(updateQuery, [id]);

    // Log the notification
    const logQuery = `
            INSERT INTO vaccine_availability_notifications (
                waitlist_id, infant_id, vaccine_id, guardian_id,
                notification_type, message, status, sent_at
            ) VALUES ($1, $2, $3, $4, 'manual_notification', $5, 'sent', CURRENT_TIMESTAMP)
        `;

    const message = `Vaccine ${entry.vaccine_name} is now available at ${entry.clinic_name} for ${entry.infant_name}`;

    await pool.query(logQuery, [id, entry.infant_id, entry.vaccine_id, entry.guardian_id, message]);

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        phone: entry.guardian_phone,
        message: message,
      },
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send notification',
    });
  }
});

module.exports = router;
