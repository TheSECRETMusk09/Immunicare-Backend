const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken: auth } = require('../middleware/auth');
const socketService = require('../services/socketService');
const { body, validationResult } = require('express-validator');

// Helper function to handle validation errors
const handleValidationErrors = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }
  return null;
};

// GET /api/paper-templates - Get all paper templates
router.get('/', auth, async (req, res) => {
  try {
    const { type, active } = req.query;
    let query = 'SELECT * FROM paper_templates WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND template_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (active !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(active === 'true');
      paramIndex++;
    }

    query += ' ORDER BY name';

    const result = await db.query(query, params);
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching paper templates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch paper templates',
      error: error.message,
    });
  }
});

// GET /api/paper-templates/:id - Get specific paper template
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'SELECT * FROM paper_templates WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Paper template not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error fetching paper template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch paper template',
      error: error.message,
    });
  }
});

// POST /api/paper-templates - Create new paper template
router.post(
  '/',
  [
    auth,
    body('name').notEmpty().withMessage('Template name is required'),
    body('template_type')
      .isIn([
        'VACCINE_SCHEDULE',
        'IMMUNIZATION_RECORD',
        'INVENTORY_LOGBOOK',
        'GROWTH_CHART',
      ])
      .withMessage('Invalid template type'),
    body('fields').isArray().withMessage('Fields must be an array'),
  ],
  async (req, res) => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) {
      return validationError;
    }

    try {
      const { name, description, template_type, fields, validation_rules } =
        req.body;
      const created_by = req.user.id;

      const result = await db.query(
        `INSERT INTO paper_templates (name, description, template_type, fields, validation_rules, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
        [
          name,
          description,
          template_type,
          fields ? JSON.stringify(fields) : null,
          validation_rules ? JSON.stringify(validation_rules) : null,
          created_by,
        ],
      );

      socketService.broadcast('paper_template_created', result.rows[0]);
      res.status(201).json({
        success: true,
        message: 'Paper template created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      console.error('Error creating paper template:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create paper template',
        error: error.message,
      });
    }
  },
);

// PUT /api/paper-templates/:id - Update paper template
router.put(
  '/:id',
  [
    auth,
    body('name')
      .optional()
      .notEmpty()
      .withMessage('Template name cannot be empty'),
    body('template_type')
      .optional()
      .isIn([
        'VACCINE_SCHEDULE',
        'IMMUNIZATION_RECORD',
        'INVENTORY_LOGBOOK',
        'GROWTH_CHART',
      ])
      .withMessage('Invalid template type'),
    body('fields').optional().isArray().withMessage('Fields must be an array'),
  ],
  async (req, res) => {
    const validationError = handleValidationErrors(req, res);
    if (validationError) {
      return validationError;
    }

    try {
      const { id } = req.params;
      const {
        name,
        description,
        template_type,
        fields,
        validation_rules,
        is_active,
      } = req.body;
      const updated_by = req.user.id;

      // Check if template exists
      const existing = await db.query(
        'SELECT * FROM paper_templates WHERE id = $1',
        [id],
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Paper template not found',
        });
      }

      // Build dynamic update query
      let query = 'UPDATE paper_templates SET ';
      const params = [];
      let paramIndex = 1;
      const updates = [];

      if (name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        params.push(name);
        paramIndex++;
      }
      if (description !== undefined) {
        updates.push(`description = $${paramIndex}`);
        params.push(description);
        paramIndex++;
      }
      if (template_type !== undefined) {
        updates.push(`template_type = $${paramIndex}`);
        params.push(template_type);
        paramIndex++;
      }
      if (fields !== undefined) {
        updates.push(`fields = $${paramIndex}`);
        params.push(JSON.stringify(fields));
        paramIndex++;
      }
      if (validation_rules !== undefined) {
        updates.push(`validation_rules = $${paramIndex}`);
        params.push(JSON.stringify(validation_rules));
        paramIndex++;
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${paramIndex}`);
        params.push(is_active);
        paramIndex++;
      }

      updates.push(`updated_by = $${paramIndex}`);
      params.push(updated_by);
      paramIndex++;

      updates.push(`updated_at = $${paramIndex}`);
      params.push(new Date());
      paramIndex++;

      query += updates.join(', ') + ` WHERE id = $${paramIndex} RETURNING *`;
      params.push(id);

      const result = await db.query(query, params);

      socketService.broadcast('paper_template_updated', result.rows[0]);
      res.json({
        success: true,
        message: 'Paper template updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      console.error('Error updating paper template:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update paper template',
        error: error.message,
      });
    }
  },
);

// DELETE /api/paper-templates/:id - Delete paper template
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if template exists
    const existing = await db.query(
      'SELECT * FROM paper_templates WHERE id = $1',
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Paper template not found',
      });
    }

    await db.query('DELETE FROM paper_templates WHERE id = $1', [id]);

    socketService.broadcast('paper_template_deleted', { id });
    res.json({
      success: true,
      message: 'Paper template deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting paper template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete paper template',
      error: error.message,
    });
  }
});

// GET /api/paper-templates/:id/fields - Get template fields
router.get('/:id/fields', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'SELECT fields FROM paper_templates WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Paper template not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0].fields ? JSON.parse(result.rows[0].fields) : [],
    });
  } catch (error) {
    console.error('Error fetching template fields:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch template fields',
      error: error.message,
    });
  }
});

module.exports = router;
