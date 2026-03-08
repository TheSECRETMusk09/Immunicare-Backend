const express = require('express');
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const socketService = require('../services/socketService');
const {
  hasFieldErrors,
  normalizeEnumValue,
  parseDateValue,
  respondValidationError,
  sanitizeText,
  validateDateRange,
} = require('../utils/adminValidation');

const router = express.Router();

const AUDIENCE_VALUES = ['all', 'patients', 'staff'];
const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'];
const STATUS_VALUES = ['draft', 'published', 'archived'];

const sanitizeAnnouncementPayload = (payload = {}) => {
  const errors = {};

  const title = sanitizeText(payload.title, { maxLength: 150 });
  const content = sanitizeText(payload.content, {
    maxLength: 2000,
    preserveNewLines: true,
  });

  const targetAudienceInput = sanitizeText(payload.target_audience).toLowerCase();
  const priorityInput = sanitizeText(payload.priority).toLowerCase();
  const statusInput = sanitizeText(payload.status).toLowerCase();

  const targetAudience = targetAudienceInput
    ? normalizeEnumValue(targetAudienceInput, AUDIENCE_VALUES, '')
    : 'all';
  const priority = priorityInput
    ? normalizeEnumValue(priorityInput, PRIORITY_VALUES, '')
    : 'medium';
  const status = statusInput
    ? normalizeEnumValue(statusInput, STATUS_VALUES, '')
    : 'draft';

  const startDateRaw = sanitizeText(payload.start_date);
  const endDateRaw = sanitizeText(payload.end_date);
  const expiresAtRaw = sanitizeText(payload.expires_at);

  if (!title) {
    errors.title = 'Title is required';
  } else if (title.length < 3) {
    errors.title = 'Title must be at least 3 characters';
  }

  if (!content) {
    errors.content = 'Content is required';
  } else if (content.length < 10) {
    errors.content = 'Content must be at least 10 characters';
  }

  if (!targetAudience) {
    errors.target_audience = `target_audience must be one of: ${AUDIENCE_VALUES.join(', ')}`;
  }

  if (!priority) {
    errors.priority = `priority must be one of: ${PRIORITY_VALUES.join(', ')}`;
  }

  if (!status) {
    errors.status = `status must be one of: ${STATUS_VALUES.join(', ')}`;
  }

  if (startDateRaw && !parseDateValue(startDateRaw)) {
    errors.start_date = 'start_date must be a valid date';
  }

  if (endDateRaw && !parseDateValue(endDateRaw)) {
    errors.end_date = 'end_date must be a valid date';
  }

  if (expiresAtRaw && !parseDateValue(expiresAtRaw)) {
    errors.expires_at = 'expires_at must be a valid date';
  }

  Object.assign(
    errors,
    validateDateRange({
      startDate: startDateRaw,
      endDate: endDateRaw,
      startKey: 'start_date',
      endKey: 'end_date',
      startLabel: 'Start date',
      endLabel: 'End date',
    }),
  );

  return {
    normalized: {
      title,
      content,
      target_audience: targetAudience,
      priority,
      status,
      start_date: startDateRaw || null,
      end_date: endDateRaw || null,
      expires_at: expiresAtRaw || null,
    },
    errors,
  };
};

// Middleware to authenticate all announcement routes
router.use(authenticateToken);

// Role-based access control for announcement management
const requireManagementRole = requireRole(['admin', 'super_admin', 'doctor', 'nurse', 'staff']);

// Get all announcements
router.get('/', async (req, res) => {
  try {
    const { status, priority, target_audience } = req.query;
    let query = `
      SELECT a.*, u.email as created_by_email
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND a.status = $' + (params.length + 1);
      params.push(status);
    }

    if (priority) {
      query += ' AND a.priority = $' + (params.length + 1);
      params.push(priority);
    }

    if (target_audience) {
      query +=
        ' AND (a.target_audience = \'all\' OR a.target_audience = $' + (params.length + 1) + ')';
      params.push(target_audience);
    }

    query += ' ORDER BY a.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get announcement by ID
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Announcement ID must be an integer' });
    }

    const result = await pool.query(
      `
      SELECT a.*, u.email as created_by_email
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.id = $1
    `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    socketService.broadcast('announcement_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create announcement
router.post('/', requireManagementRole, async (req, res) => {
  try {
    const { normalized, errors } = sanitizeAnnouncementPayload(req.body);
    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    const duplicateCheck = await pool.query(
      `
        SELECT id
        FROM announcements
        WHERE LOWER(TRIM(title)) = LOWER($1)
          AND LOWER(TRIM(content)) = LOWER($2)
          AND status <> 'archived'
        LIMIT 1
      `,
      [normalized.title, normalized.content],
    );

    if (duplicateCheck.rows.length > 0) {
      return respondValidationError(
        res,
        {
          title: 'An active announcement with the same title and content already exists',
          content: 'An active announcement with the same title and content already exists',
        },
        'Duplicate announcement detected',
        409,
      );
    }

    // Get current user ID from JWT token
    const userId = req.user.id;

    const result = await pool.query(
      `
      INSERT INTO announcements (
        title, content, target_audience, priority,
        status, start_date, end_date, expires_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `,
      [
        normalized.title,
        normalized.content,
        normalized.target_audience,
        normalized.priority,
        normalized.status,
        normalized.start_date,
        normalized.end_date,
        normalized.expires_at,
        userId,
      ],
    );

    socketService.broadcast('announcement_created', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update announcement
router.put('/:id', requireManagementRole, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Announcement ID must be an integer' });
    }

    const { normalized, errors } = sanitizeAnnouncementPayload(req.body);
    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    const duplicateCheck = await pool.query(
      `
        SELECT id
        FROM announcements
        WHERE LOWER(TRIM(title)) = LOWER($1)
          AND LOWER(TRIM(content)) = LOWER($2)
          AND id <> $3
          AND status <> 'archived'
        LIMIT 1
      `,
      [normalized.title, normalized.content, id],
    );

    if (duplicateCheck.rows.length > 0) {
      return respondValidationError(
        res,
        {
          title: 'An active announcement with the same title and content already exists',
          content: 'An active announcement with the same title and content already exists',
        },
        'Duplicate announcement detected',
        409,
      );
    }

    const result = await pool.query(
      `
      UPDATE announcements SET
        title = $1, content = $2, target_audience = $3,
        priority = $4, status = $5, start_date = $6,
        end_date = $7, expires_at = $8, updated_at = CURRENT_TIMESTAMP
        WHERE id = $9 RETURNING *
    `,
      [
        normalized.title,
        normalized.content,
        normalized.target_audience,
        normalized.priority,
        normalized.status,
        normalized.start_date,
        normalized.end_date,
        normalized.expires_at,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    socketService.broadcast('announcement_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete announcement
router.delete('/:id', requireManagementRole, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM announcements WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    socketService.broadcast('announcement_deleted', { id });
    res.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Publish announcement
router.put('/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE announcements SET
        status = 'published',
        published_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *
    `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    socketService.broadcast('announcement_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Archive announcement
router.put('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE announcements SET
        status = 'archived',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *
    `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    socketService.broadcast('announcement_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active announcements for specific audience
router.get('/active/:audience', async (req, res) => {
  try {
    const { audience } = req.params;
    const result = await pool.query(
      `
      SELECT a.*, u.email as created_by_email
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.status = 'published'
      AND (a.target_audience = 'all' OR a.target_audience = $1)
      AND (a.start_date IS NULL OR a.start_date <= CURRENT_DATE)
      AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)
      ORDER BY a.priority DESC, a.created_at DESC
    `,
      [audience],
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get announcement statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const [total, published, draft, archived, highPriority] = await Promise.all([
      // Total announcements
      pool.query('SELECT COUNT(*) as count FROM announcements'),
      // Published announcements
      pool.query('SELECT COUNT(*) as count FROM announcements WHERE status = \'published\''),
      // Draft announcements
      pool.query('SELECT COUNT(*) as count FROM announcements WHERE status = \'draft\''),
      // Archived announcements
      pool.query('SELECT COUNT(*) as count FROM announcements WHERE status = \'archived\''),
      // High priority announcements
      pool.query(
        'SELECT COUNT(*) as count FROM announcements WHERE priority = \'high\' AND status = \'published\'',
      ),
    ]);

    res.json({
      total: parseInt(total.rows[0].count),
      published: parseInt(published.rows[0].count),
      draft: parseInt(draft.rows[0].count),
      archived: parseInt(archived.rows[0].count),
      highPriority: parseInt(highPriority.rows[0].count),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search announcements
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;

    // Input validation
    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        error: 'Search query must be at least 2 characters long',
      });
    }

    // Sanitize input to prevent injection
    const sanitizedQuery = query.replace(/[%_]/g, '\\$&');

    const result = await pool.query(
      `
      SELECT a.*, u.email as created_by_email
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE
        a.title ILIKE $1 OR
        a.content ILIKE $1
      ORDER BY a.created_at DESC
    `,
      [`%${sanitizedQuery}%`],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'An error occurred while searching announcements',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Bulk update announcements
router.put('/bulk-update', async (req, res) => {
  try {
    const { announcement_ids, updates } = req.body;

    if (!Array.isArray(announcement_ids) || announcement_ids.length === 0) {
      return res.status(400).json({ error: 'Announcement IDs array is required' });
    }

    // Validate announcement_ids are integers
    const validIds = announcement_ids.filter((id) => Number.isInteger(parseInt(id)));
    if (validIds.length !== announcement_ids.length) {
      return res.status(400).json({ error: 'All announcement IDs must be integers' });
    }

    // Validate updates object
    const allowedFields = [
      'title',
      'content',
      'target_audience',
      'priority',
      'status',
      'start_date',
      'end_date',
      'expires_at',
    ];
    const invalidFields = Object.keys(updates).filter((field) => !allowedFields.includes(field));
    if (invalidFields.length > 0) {
      return res.status(400).json({ error: `Invalid fields: ${invalidFields.join(', ')}` });
    }

    // Build dynamic update query safely
    const setParts = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach((key) => {
      setParts.push(`${key} = $${paramIndex + 1}`);
      values.push(updates[key]);
      paramIndex++;
    });

    setParts.push('updated_at = CURRENT_TIMESTAMP');

    const query = `
      UPDATE announcements
      SET ${setParts.join(', ')}
      WHERE id = ANY($${paramIndex + 1}) RETURNING *
    `;

    const result = await pool.query(query, [...values, validIds]);

    // Broadcast updates for all modified announcements
    result.rows.forEach(announcement => {
      socketService.broadcast('announcement_updated', announcement);
    });
    res.json({
      updated: result.rows.length,
      announcements: result.rows,
    });
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({
      error: 'An error occurred while updating announcements',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Get announcements by priority
router.get('/priority/:priority', async (req, res) => {
  try {
    const { priority } = req.params;
    const result = await pool.query(
      `
      SELECT a.*, u.email as created_by_email
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.priority = $1 AND a.status = 'published'
      ORDER BY a.created_at DESC
    `,
      [priority],
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
