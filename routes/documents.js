const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const DocumentService = require('../services/documentService');

const documentService = new DocumentService();

// Middleware to authenticate all document routes
router.use(authenticateToken);

// GET /api/documents - Get all documents (MUST be before /:id)
router.get('/', async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const { limit = 50, offset = 0, infantId, templateType, status } = req.query;

    let query = `
      SELECT dg.*, dp.title, dp.document_type, t.name as template_name,
             i.first_name, i.last_name, g.name as guardian_name
      FROM document_generation dg
      LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
      LEFT JOIN paper_templates t ON dg.template_id = t.id
      LEFT JOIN infants i ON dg.infant_id = i.id
      LEFT JOIN guardians g ON dg.guardian_id = g.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (role === 'super_admin' || role === 'admin') {
      // Admin roles can see all documents
    } else if (role === 'clinic_manager' || role === 'healthcare_worker') {
      // Filter by clinic
      query += ` AND i.clinic_id = $${paramIndex}`;
      params.push(req.user.clinic_id);
      paramIndex++;
    } else {
      // Guardian can only see their own documents
      query += ` AND (dg.guardian_id = $${paramIndex} OR i.guardian_id = $${paramIndex})`;
      params.push(req.user.guardian_id || userId);
      paramIndex++;
    }

    if (infantId) {
      query += ` AND dg.infant_id = $${paramIndex}`;
      params.push(infantId);
      paramIndex++;
    }

    if (templateType) {
      query += ` AND t.template_type = $${paramIndex}`;
      params.push(templateType);
      paramIndex++;
    }

    if (status) {
      query += ` AND dg.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY dg.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch documents',
      error: error.message,
    });
  }
});

// GET /api/documents/history - Get document download history
router.get('/history', async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const { limit = 50, offset = 0, infantId, templateType } = req.query;

    let query = `
      SELECT dg.*, dp.title, dp.document_type, t.name as template_name,
             i.first_name, i.last_name, g.name as guardian_name
      FROM document_generation dg
      LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
      LEFT JOIN paper_templates t ON dg.template_id = t.id
      LEFT JOIN infants i ON dg.infant_id = i.id
      LEFT JOIN guardians g ON dg.guardian_id = g.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (role === 'super_admin' || role === 'admin') {
      // Admin roles can see all documents
    } else if (role === 'clinic_manager' || role === 'healthcare_worker') {
      // Filter by clinic
      query += ` AND i.clinic_id = $${paramIndex}`;
      params.push(req.user.clinic_id);
      paramIndex++;
    } else {
      // Guardian can only see their own documents
      query += ` AND (dg.guardian_id = $${paramIndex} OR i.guardian_id = $${paramIndex})`;
      params.push(req.user.guardian_id || userId);
      paramIndex++;
    }

    if (infantId) {
      query += ` AND dg.infant_id = $${paramIndex}`;
      params.push(infantId);
      paramIndex++;
    }

    if (templateType) {
      query += ` AND t.template_type = $${paramIndex}`;
      params.push(templateType);
      paramIndex++;
    }

    query += ` ORDER BY dg.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Error fetching document history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document history',
      error: error.message,
    });
  }
});

// GET /api/documents/status/:infantId - Get document completion status
router.get('/status/:infantId', async (req, res) => {
  try {
    const { infantId } = req.params;
    const { id: userId, role, guardian_id } = req.user;

    // Check if user has access to this infant's records
    const infantResult = await pool.query(
      'SELECT guardian_id, clinic_id FROM infants WHERE id = $1',
      [infantId],
    );

    if (infantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Infant not found',
      });
    }

    const infant = infantResult.rows[0];

    // Check permissions
    if (role === 'guardian' && infant.guardian_id !== (guardian_id || userId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    if (
      (role === 'healthcare_worker' || role === 'clinic_manager') &&
      infant.clinic_id !== req.user.clinic_id
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Get required documents based on vaccination schedule
    const vaccinationsResult = await pool.query(
      `SELECT DISTINCT v.vaccine_name, vr.dose_no
       FROM vaccination_records vr
       JOIN vaccines v ON vr.vaccine_id = v.id
       WHERE vr.infant_id = $1`,
      [infantId],
    );

    // Get generated documents
    const generatedResult = await pool.query(
      `SELECT template_type, COUNT(*) as count
       FROM document_generation
       WHERE infant_id = $1 AND status = 'generated'
       GROUP BY template_type`,
      [infantId],
    );

    const generatedMap = generatedResult.rows.reduce((acc, row) => {
      acc[row.template_type] = row.count;
      return acc;
    }, {});

    // Calculate completion status
    const requiredDocuments = [
      { type: 'VACCINE_SCHEDULE', name: 'Vaccine Schedule', required: true },
      {
        type: 'IMMUNIZATION_RECORD',
        name: 'Immunization Record',
        required: true,
      },
      { type: 'GROWTH_CHART', name: 'Growth Chart', required: true },
    ];

    const completionStatus = requiredDocuments.map((doc) => ({
      ...doc,
      generated: generatedMap[doc.type] || 0,
      status: (generatedMap[doc.type] || 0) > 0 ? 'completed' : 'pending',
    }));

    res.json({
      success: true,
      infantId,
      completionStatus,
      totalVaccinations: vaccinationsResult.rows.length,
      generatedDocuments: generatedResult.rows,
    });
  } catch (error) {
    console.error('Error fetching completion status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch completion status',
      error: error.message,
    });
  }
});

// POST /api/documents/generate/:templateId - Generate document
router.post('/generate/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    const { id: userId, role, guardian_id } = req.user;
    const { infantId, guardianId, customData } = req.body;

    // Validate template exists and is active
    const templateResult = await pool.query(
      'SELECT * FROM paper_templates WHERE id = $1 AND is_active = true',
      [templateId],
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Template not found or inactive',
      });
    }

    // Validate infant and guardian access
    if (infantId) {
      const infantResult = await pool.query(
        'SELECT guardian_id, clinic_id FROM infants WHERE id = $1',
        [infantId],
      );

      if (infantResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Infant not found',
        });
      }

      const infant = infantResult.rows[0];

      // Check permissions
      if (role === 'guardian' && infant.guardian_id !== (guardian_id || userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      if (
        (role === 'healthcare_worker' || role === 'clinic_manager') &&
        infant.clinic_id !== req.user.clinic_id
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }
    }

    // Generate document
    const result = await documentService.generateDocument(
      templateId,
      infantId,
      guardianId,
      userId,
      customData || {},
    );

    res.status(201).json({
      success: true,
      message: 'Document generated successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error generating document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate document',
      error: error.message,
    });
  }
});

// GET /api/documents/download/:id - Download document
router.get('/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, role, guardian_id } = req.user;

    // Get document generation record
    const generation = await documentService.getDocumentGeneration(id);

    if (!generation) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Check permissions
    if (role === 'guardian') {
      // Guardian access check
      if (
        generation.guardian_id !== (guardian_id || userId) &&
        generation.generated_by !== userId
      ) {
        // Check if user is guardian of the infant
        if (generation.infant_id) {
          const infantResult = await pool.query('SELECT guardian_id FROM infants WHERE id = $1', [
            generation.infant_id,
          ]);

          if (
            infantResult.rows.length > 0 &&
            infantResult.rows[0].guardian_id !== (guardian_id || userId)
          ) {
            return res.status(403).json({
              success: false,
              message: 'Access denied',
            });
          }
        } else {
          return res.status(403).json({
            success: false,
            message: 'Access denied',
          });
        }
      }
    } else if (role === 'healthcare_worker' || role === 'clinic_manager') {
      // Clinic access check
      if (generation.infant_id) {
        const infantResult = await pool.query('SELECT clinic_id FROM infants WHERE id = $1', [
          generation.infant_id,
        ]);
        if (infantResult.rows.length > 0 && infantResult.rows[0].clinic_id !== req.user.clinic_id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied',
          });
        }
      }
    }

    // Download document
    const downloadResult = await documentService.downloadDocument(id);

    if (!downloadResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to download document',
        error: downloadResult.error,
      });
    }

    // Increment download count
    await documentService.incrementDownloadCount(id);

    // Set headers for file download
    res.setHeader('Content-Type', downloadResult.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadResult.filename}"`);
    res.setHeader('Content-Length', downloadResult.buffer.length);

    res.send(downloadResult.buffer);
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download document',
      error: error.message,
    });
  }
});

// GET /api/documents/analytics - Get document analytics
router.get('/analytics', async (req, res) => {
  try {
    const { startDate, endDate, templateType, infantId } = req.query;

    const analytics = await documentService.getDocumentAnalytics({
      startDate,
      endDate,
      templateType,
      infantId,
    });

    res.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    console.error('Error fetching document analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document analytics',
      error: error.message,
    });
  }
});

// GET /api/documents/stats - Get document statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await documentService.getDocumentStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching document stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document stats',
      error: error.message,
    });
  }
});

// GET /api/documents/templates/:templateId/fields - Get template fields (for frontend)
router.get('/templates/:templateId/fields', async (req, res) => {
  try {
    const { templateId } = req.params;

    const result = await pool.query(
      'SELECT fields FROM paper_templates WHERE id = $1 AND is_active = true',
      [templateId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    const fields = result.rows[0].fields ? JSON.parse(result.rows[0].fields) : [];

    res.json({
      success: true,
      data: fields,
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

// ============================================
// ADDITIONAL DOCUMENT ROUTES (Missing Endpoints)
// ============================================

// GET /api/documents/:id - Get specific document details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, role, guardian_id } = req.user;

    // Get document generation record with all details
    const result = await pool.query(
      `SELECT dg.*,
              dp.title, dp.document_type, dp.content,
              t.name as template_name, t.template_type,
              i.first_name as infant_first_name, i.last_name as infant_last_name,
              g.name as guardian_name, g.email as guardian_email,
              u_sender.first_name as generated_by_first, u_sender.last_name as generated_by_last
       FROM document_generation dg
       LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
       LEFT JOIN paper_templates t ON dg.template_id = t.id
       LEFT JOIN infants i ON dg.infant_id = i.id
       LEFT JOIN guardians g ON dg.guardian_id = g.id
       LEFT JOIN users u_sender ON dg.generated_by = u_sender.id
       WHERE dg.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = result.rows[0];

    // Check permissions
    if (role === 'guardian') {
      const infantResult = await pool.query('SELECT guardian_id FROM infants WHERE id = $1', [
        doc.infant_id || 0,
      ]);
      if (
        infantResult.rows.length > 0 &&
        infantResult.rows[0].guardian_id !== (guardian_id || userId)
      ) {
        if (doc.guardian_id !== (guardian_id || userId) && doc.generated_by !== userId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied',
          });
        }
      }
    } else if (role === 'healthcare_worker' || role === 'clinic_manager') {
      if (doc.infant_id) {
        const infantResult = await pool.query('SELECT clinic_id FROM infants WHERE id = $1', [
          doc.infant_id,
        ]);
        if (infantResult.rows.length > 0 && infantResult.rows[0].clinic_id !== req.user.clinic_id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied',
          });
        }
      }
    }

    res.json({
      success: true,
      data: doc,
    });
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document',
      error: error.message,
    });
  }
});

// PUT /api/documents/:id - Update document metadata
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user;
    const { title, notes, tags } = req.body;

    // Check if document exists and user has permission
    const existing = await pool.query('SELECT * FROM document_generation WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = existing.rows[0];

    // Only allow owner or admin to update
    if (role !== 'admin' && role !== 'super_admin' && doc.generated_by !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Update document
    const result = await pool.query(
      `UPDATE document_generation
       SET title = COALESCE($1, title),
           notes = COALESCE($2, notes),
           tags = COALESCE($3, tags),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [title, notes, tags ? JSON.stringify(tags) : null, id],
    );

    res.json({
      success: true,
      message: 'Document updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update document',
      error: error.message,
    });
  }
});

// DELETE /api/documents/:id - Delete document
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user;

    // Check if document exists
    const existing = await pool.query('SELECT * FROM document_generation WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = existing.rows[0];

    // Only allow owner or admin to delete
    if (role !== 'admin' && role !== 'super_admin' && doc.generated_by !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Delete associated digital paper if exists
    await pool.query('DELETE FROM digital_papers WHERE document_generation_id = $1', [id]);

    // Delete file if exists
    if (doc.file_path) {
      const fs = require('fs').promises;
      try {
        await fs.unlink(doc.file_path);
      } catch (fileError) {
        console.warn('File not found:', fileError.message);
      }
    }

    // Delete document generation record
    await pool.query('DELETE FROM document_generation WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message,
    });
  }
});

// GET /api/documents/shared - Get documents shared with user
router.get('/shared/with-me', async (req, res) => {
  try {
    const { id: userId, role, guardian_id } = req.user;
    const { limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT dg.*, dp.title, dp.document_type, t.name as template_name,
             i.first_name, i.last_name,
             shared_by.first_name as shared_by_first, shared_by.last_name as shared_by_last,
             ds.shared_at, ds.access_type
      FROM document_shares ds
      JOIN document_generation dg ON ds.document_id = dg.id
      LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
      LEFT JOIN paper_templates t ON dg.template_id = t.id
      LEFT JOIN infants i ON dg.infant_id = i.id
      LEFT JOIN users shared_by ON ds.shared_by = shared_by.id
      WHERE ds.shared_with_user_id = $1
        AND (ds.expires_at IS NULL OR ds.expires_at > CURRENT_TIMESTAMP)
    `;

    const params = [userId];

    if (role === 'guardian' && guardian_id) {
      query += ` OR ds.shared_with_guardian_id = $${params.length + 1}`;
      params.push(guardian_id);
    }

    query += ` ORDER BY ds.shared_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Error fetching shared documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shared documents',
      error: error.message,
    });
  }
});

// POST /api/documents/:id/share - Share document with another user
router.post('/:id/share', async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user;
    const { shareWithUserId, shareWithGuardianId, accessType = 'view', expiresAt } = req.body;

    // Check if document exists
    const existing = await pool.query('SELECT * FROM document_generation WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const doc = existing.rows[0];

    // Only allow owner or admin to share
    if (role !== 'admin' && role !== 'super_admin' && doc.generated_by !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    if (!shareWithUserId && !shareWithGuardianId) {
      return res.status(400).json({
        success: false,
        message: 'Either shareWithUserId or shareWithGuardianId is required',
      });
    }

    // Create document share record
    const result = await pool.query(
      `INSERT INTO document_shares (document_id, shared_by, shared_with_user_id, shared_with_guardian_id, access_type, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        userId,
        shareWithUserId || null,
        shareWithGuardianId || null,
        accessType,
        expiresAt || null,
      ],
    );

    res.status(201).json({
      success: true,
      message: 'Document shared successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error sharing document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share document',
      error: error.message,
    });
  }
});
