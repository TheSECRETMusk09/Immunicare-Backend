/**
 * Infant Allergies API Routes
 * Handles CRUD operations for infant allergy records
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * GET /api/infant-allergies/:infantId/vaccine-check/:vaccineId
 * Check if infant has vaccine allergy contraindication
 */
router.get('/:infantId/vaccine-check/:vaccineId', async (req, res) => {
  try {
    const { infantId, vaccineId } = req.params;

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
    const { infantId } = req.params;

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
 * GET /api/infant-allergies/:infantId/vaccine-check/:vaccineId
 * Check if infant has vaccine allergy contraindication
 */
router.get('/:infantId/vaccine-check/:vaccineId', async (req, res) => {
  try {
    const { infantId, vaccineId } = req.params;

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
      infant_id,
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
    const { id } = req.params;
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

    values.push(id);

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
    const { id } = req.params;

    const query = `
            UPDATE infant_allergies
            SET is_active = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;

    const result = await pool.query(query, [id]);

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
router.get('/', requireRole(['admin', 'healthcare_worker']), async (req, res) => {
  try {
    const { page = 1, limit = 50, type, severity, infant_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
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
            WHERE 1=1
        `;

    const queryParams = [];
    let paramCount = 1;

    if (type) {
      query += ` AND ia.allergy_type = $${paramCount++}`;
      queryParams.push(type);
    }
    if (severity) {
      query += ` AND ia.severity = $${paramCount++}`;
      queryParams.push(severity);
    }
    if (infant_id) {
      query += ` AND ia.infant_id = $${paramCount++}`;
      queryParams.push(infant_id);
    }

    // Get total count
    const countQuery = query.replace(/SELECT ia\..* FROM/gi, 'SELECT COUNT(*) as total FROM');
    const countResult = await pool.query(countQuery, queryParams);
    const total = countResult.rows.length > 0 ? parseInt(countResult.rows[0].total) : 0;

    // Add pagination
    query += ` ORDER BY ia.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
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
    console.error('Error fetching all allergies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch allergies',
    });
  }
});

module.exports = router;
