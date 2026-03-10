/**
 * Infant Allergies API Routes
 * Handles CRUD operations for infant allergy records
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');

// Apply authentication to all routes
router.use(authenticateToken);

const parsePositiveInt = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const ensureInfantAccess = async (req, infantId) => {
  const canonicalRole = getCanonicalRole(req);

  if (canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN) {
    return true;
  }

  if (canonicalRole !== CANONICAL_ROLES.GUARDIAN) {
    return false;
  }

  const guardianId = parsePositiveInt(req.user?.guardian_id);
  if (!guardianId) {
    return false;
  }

  const ownershipResult = await pool.query(
    `
      SELECT 1
      FROM patients
      WHERE id = $1 AND guardian_id = $2 AND is_active = true
      LIMIT 1
    `,
    [infantId, guardianId],
  );

  return ownershipResult.rows.length > 0;
};

/**
 * GET /api/infant-allergies/:infantId/vaccine-check/:vaccineId
 * Check if infant has vaccine allergy contraindication
 */
router.get('/:infantId/vaccine-check/:vaccineId', async (req, res) => {
  try {
    const infantId = parsePositiveInt(req.params.infantId);
    const vaccineId = parsePositiveInt(req.params.vaccineId);

    if (!infantId || !vaccineId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid infant or vaccine ID',
      });
    }

    const hasInfantAccess = await ensureInfantAccess(req, infantId);
    if (!hasInfantAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Get infant allergies for vaccines
    const query = `
            SELECT
                id,
                allergen,
                severity,
                reaction_description
            FROM infant_allergies
            WHERE infant_id = $1
            AND allergy_type = 'vaccine'
            AND is_active = true
        `;

    const result = await pool.query(query, [infantId]);

    // Get vaccine info
    const vaccineQuery = `
            SELECT name, manufacturer, contraindications
            FROM vaccines
            WHERE id = $1
        `;

    const vaccineResult = await pool.query(vaccineQuery, [vaccineId]);

    if (vaccineResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vaccine not found',
      });
    }

    // Check for contraindications
    const hasContraindication = result.rows.length > 0;

    res.json({
      success: true,
      data: {
        has_allergy: hasContraindication,
        allergies: result.rows,
        vaccine: vaccineResult.rows[0],
        can_administer: !hasContraindication,
      },
    });
  } catch (error) {
    console.error('Error checking vaccine allergies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check vaccine allergies',
    });
  }
});

/**
 * GET /api/infant-allergies/:infantId
 * Get all allergies for a specific infant
 */
router.get('/:infantId', async (req, res) => {
  try {
    const infantId = parsePositiveInt(req.params.infantId);
    if (!infantId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid infant ID',
      });
    }

    const hasInfantAccess = await ensureInfantAccess(req, infantId);
    if (!hasInfantAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const query = `
            SELECT
                ia.id,
                ia.infant_id,
                ia.allergy_type,
                ia.allergen,
                ia.severity,
                ia.reaction_description,
                ia.onset_date,
                ia.is_active,
                ia.created_at,
                ia.updated_at
            FROM infant_allergies ia
            WHERE ia.infant_id = $1
            ORDER BY
                CASE ia.severity
                    WHEN 'life_threatening' THEN 1
                    WHEN 'severe' THEN 2
                    WHEN 'moderate' THEN 3
                    WHEN 'mild' THEN 4
                END,
                ia.created_at DESC
        `;

    const result = await pool.query(query, [infantId]);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error('Error fetching infant allergies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch allergies',
    });
  }
});

/**
 * POST /api/infant-allergies
 * Create a new allergy record
 */
router.post('/', async (req, res) => {
  try {
    const {
      infant_id,
      allergy_type,
      allergen,
      severity = 'mild',
      reaction_description,
      onset_date,
    } = req.body;

    // Validate required fields
    if (!infant_id || !allergy_type || !allergen) {
      return res.status(400).json({
        success: false,
        message: 'infant_id, allergy_type, and allergen are required',
      });
    }

    const infantId = parsePositiveInt(infant_id);
    if (!infantId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid infant ID',
      });
    }

    const hasInfantAccess = await ensureInfantAccess(req, infantId);
    if (!hasInfantAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Validate allergy type
    const validTypes = ['vaccine', 'food', 'medication', 'environmental', 'other'];
    if (!validTypes.includes(allergy_type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid allergy type',
      });
    }

    // Validate severity
    const validSeverities = ['mild', 'moderate', 'severe', 'life_threatening'];
    if (!validSeverities.includes(severity)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid severity level',
      });
    }

    const query = `
            INSERT INTO infant_allergies (
                infant_id,
                allergy_type,
                allergen,
                severity,
                reaction_description,
                onset_date
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;

    const result = await pool.query(query, [
      infantId,
      allergy_type,
      allergen,
      severity,
      reaction_description,
      onset_date,
    ]);

    res.status(201).json({
      success: true,
      message: 'Allergy record created successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error creating allergy record:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create allergy record',
    });
  }
});

/**
 * PUT /api/infant-allergies/:id
 * Update an allergy record
 */
router.put('/:id', async (req, res) => {
  try {
    const allergyId = parsePositiveInt(req.params.id);
    if (!allergyId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid allergy record ID',
      });
    }

    const allergyLookup = await pool.query(
      `
        SELECT infant_id
        FROM infant_allergies
        WHERE id = $1
        LIMIT 1
      `,
      [allergyId],
    );

    if (allergyLookup.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Allergy record not found',
      });
    }

    const hasInfantAccess = await ensureInfantAccess(req, allergyLookup.rows[0].infant_id);
    if (!hasInfantAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const { allergy_type, allergen, severity, reaction_description, onset_date, is_active } =
      req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (allergy_type) {
      updates.push(`allergy_type = $${paramCount++}`);
      values.push(allergy_type);
    }
    if (allergen) {
      updates.push(`allergen = $${paramCount++}`);
      values.push(allergen);
    }
    if (severity) {
      updates.push(`severity = $${paramCount++}`);
      values.push(severity);
    }
    if (reaction_description !== undefined) {
      updates.push(`reaction_description = $${paramCount++}`);
      values.push(reaction_description);
    }
    if (onset_date !== undefined) {
      updates.push(`onset_date = $${paramCount++}`);
      values.push(onset_date);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
      });
    }

    values.push(allergyId);

    const query = `
            UPDATE infant_allergies
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramCount}
            RETURNING *
        `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Allergy record not found',
      });
    }

    res.json({
      success: true,
      message: 'Allergy record updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error updating allergy record:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update allergy record',
    });
  }
});

/**
 * DELETE /api/infant-allergies/:id
 * Soft delete an allergy record (set is_active to false)
 */
router.delete('/:id', async (req, res) => {
  try {
    const allergyId = parsePositiveInt(req.params.id);
    if (!allergyId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid allergy record ID',
      });
    }

    const allergyLookup = await pool.query(
      `
        SELECT infant_id
        FROM infant_allergies
        WHERE id = $1
        LIMIT 1
      `,
      [allergyId],
    );

    if (allergyLookup.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Allergy record not found',
      });
    }

    const hasInfantAccess = await ensureInfantAccess(req, allergyLookup.rows[0].infant_id);
    if (!hasInfantAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const query = `
            UPDATE infant_allergies
            SET is_active = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;

    const result = await pool.query(query, [allergyId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Allergy record not found',
      });
    }

    res.json({
      success: true,
      message: 'Allergy record deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting allergy record:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete allergy record',
    });
  }
});

/**
 * GET /api/infant-allergies
 * Get all allergies (admin view)
 */
router.get('/', requirePermission('patient:view'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = (page - 1) * limit;
    const { type, severity, infant_id } = req.query;

    let whereClause = ' WHERE 1=1';

    const queryParams = [];
    let paramCount = 1;

    if (type) {
      whereClause += ` AND ia.allergy_type = $${paramCount++}`;
      queryParams.push(type);
    }
    if (severity) {
      whereClause += ` AND ia.severity = $${paramCount++}`;
      queryParams.push(severity);
    }
    if (infant_id) {
      const infantId = parsePositiveInt(infant_id);
      if (!infantId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid infant_id filter',
        });
      }
      whereClause += ` AND ia.infant_id = $${paramCount++}`;
      queryParams.push(infantId);
    }

    const countQuery = `
            SELECT COUNT(*) as total
            FROM infant_allergies ia
            JOIN patients p ON ia.infant_id = p.id
            ${whereClause}
        `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = countResult.rows.length > 0 ? parseInt(countResult.rows[0].total) : 0;

    const dataQuery = `
            SELECT
                ia.id,
                ia.infant_id,
                p.first_name || ' ' || p.last_name as infant_name,
                ia.allergy_type,
                ia.allergen,
                ia.severity,
                ia.reaction_description,
                ia.onset_date,
                ia.is_active,
                ia.created_at
            FROM infant_allergies ia
            JOIN patients p ON ia.infant_id = p.id
            ${whereClause}
            ORDER BY ia.created_at DESC
            LIMIT $${paramCount++}
            OFFSET $${paramCount++}
        `;
    const dataParams = [...queryParams, limit, offset];

    const result = await pool.query(dataQuery, dataParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching all allergies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch allergies',
    });
  }
});

module.exports = router;
