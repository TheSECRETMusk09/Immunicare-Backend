const PDFGenerator = require('./pdfGenerator');
const path = require('path');
const fs = require('fs').promises;
const pool = require('../db');
const { resolveStorageRoot } = require('../utils/runtimeStorage');
const {
  normalizePaperTemplateType,
} = require('../utils/paperTemplateTypeCompatibility');

class DocumentService {
  constructor() {
    this.pdfGenerator = new PDFGenerator();
    this.documentDir = resolveStorageRoot('uploads', 'documents');
  }

  async getTableColumns(tableName) {
    try {
      const result = await pool.query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
        `,
        [tableName],
      );
      return new Set((result.rows || []).map((row) => row.column_name));
    } catch (_error) {
      return new Set();
    }
  }

  async tryResolveLegacyInfantId(patient = null) {
    if (!patient || typeof patient !== 'object') {
      return null;
    }

    const columns = await this.getTableColumns('patients');
    if (!columns.has('id')) {
      return null;
    }

    const candidates = [];

    const controlNumber = patient.control_number || patient.controlNumber || null;
    if (controlNumber && columns.has('control_number')) {
      candidates.push({
        query: 'SELECT id FROM patients WHERE control_number = $1 LIMIT 1',
        params: [controlNumber],
      });
    }

    const firstName = patient.first_name || patient.firstName || null;
    const lastName = patient.last_name || patient.lastName || null;
    const dob = patient.dob || patient.date_of_birth || patient.birth_date || null;

    if (firstName && lastName && dob && columns.has('first_name') && columns.has('last_name') && columns.has('dob')) {
      candidates.push({
        query:
          'SELECT id FROM patients WHERE LOWER(TRIM(first_name)) = LOWER($1) AND LOWER(TRIM(last_name)) = LOWER($2) AND dob = $3 LIMIT 1',
        params: [firstName, lastName, dob],
      });
    }

    for (const candidate of candidates) {
      try {
        const result = await pool.query(candidate.query, candidate.params);
        const resolved = result.rows[0]?.id ?? null;
        if (resolved) {
          const parsed = parseInt(resolved, 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        }
      } catch (_error) {
        // ignore and try next candidate
      }
    }

    return null;
  }

  async ensureDocumentDirectory() {
    try {
      await fs.access(this.documentDir);
    } catch (_error) {
      try {
        await fs.mkdir(this.documentDir, { recursive: true });
      } catch (_mkdirError) {
        // Ignore directory bootstrap failures in read-only/serverless runtimes.
      }
    }
  }

  async generateDocument(templateId, infantId, guardianId, userId, data) {
    try {
      const templateResult = await pool.query(
        'SELECT * FROM paper_templates WHERE id = $1 AND is_active = true',
        [templateId],
      );

      if (templateResult.rows.length === 0) {
        return {
          success: false,
          statusCode: 404,
          message: 'Template not found or inactive',
        };
      }

      const template = templateResult.rows[0];
      const rawTemplateType = String(template.template_type || '').trim();
      if (!rawTemplateType) {
        return {
          success: false,
          statusCode: 400,
          message: 'Template type is missing for this template',
        };
      }

      let infant = null;
      let guardian = null;
      let resolvedGuardianId = guardianId || null;

      if (infantId) {
        const infantResult = await pool.query(
          'SELECT * FROM patients WHERE id = $1 AND is_active = true',
          [infantId],
        );
        if (infantResult.rows.length > 0) {
          infant = infantResult.rows[0];
          resolvedGuardianId = resolvedGuardianId || infant.guardian_id || null;
        }
      }

      if (resolvedGuardianId) {
        const guardianResult = await pool.query(
          'SELECT * FROM guardians WHERE id = $1',
          [resolvedGuardianId],
        );
        if (guardianResult.rows.length > 0) {
          guardian = guardianResult.rows[0];
        }
      }

      const normalizedTemplateType = normalizePaperTemplateType(rawTemplateType);
      const templateTypeToRender = normalizedTemplateType || rawTemplateType;

      const documentData = {
        infant,
        guardian,
        template,
        user: { id: userId },
        ...(data && typeof data === 'object' ? data : {}),
      };

      const pdfResult = await this.pdfGenerator.generatePDF(
        templateTypeToRender,
        documentData,
      );

      if (!pdfResult.success) {
        return {
          success: false,
          statusCode: 500,
          message: 'Failed to render document template',
          error: pdfResult.error || 'Unknown PDF rendering error',
        };
      }

      await this.ensureDocumentDirectory();
      const filename = pdfResult.filename;
      const filePath = path.join(this.documentDir, filename);

      await fs.writeFile(filePath, pdfResult.buffer);

      const insertGeneration = async ({ persistedInfantId } = {}) => {
        return pool.query(
          `INSERT INTO document_generation (
            template_id, infant_id, guardian_id, generated_by,
            file_path, file_name, file_size, mime_type, status, generated_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            templateId,
            persistedInfantId ?? null,
            resolvedGuardianId,
            userId,
            filePath,
            filename,
            pdfResult.buffer.length,
            'application/pdf',
            'generated',
            JSON.stringify(documentData),
          ],
        );
      };

      let generationResult;
      try {
        generationResult = await insertGeneration({ persistedInfantId: infantId ?? null });
      } catch (insertError) {
        const isForeignKeyViolation = insertError?.code === '23503';
        const constraint = insertError?.constraint || insertError?.detail || '';
        const isInfantFk =
          String(constraint).includes('document_generation_infant_id_fkey') ||
          String(insertError?.detail || '').includes('infant_id');

        if (isForeignKeyViolation && isInfantFk) {
          const resolvedLegacyInfantId = await this.tryResolveLegacyInfantId(infant);
          generationResult = await insertGeneration({
            persistedInfantId: resolvedLegacyInfantId ?? null,
          });
        } else {
          throw insertError;
        }
      }

      const generationRecord = generationResult.rows[0];

      const digitalPaperResult = await pool.query(
        `INSERT INTO digital_papers (
          document_generation_id, title, document_type, content, metadata
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *`,
        [
          generationRecord.id,
          template.name,
          templateTypeToRender,
          'PDF Document',
          JSON.stringify({
            template_id: templateId,
            infant_id: infantId,
            guardian_id: resolvedGuardianId,
            generated_at: new Date().toISOString(),
            file_size: pdfResult.buffer.length,
          }),
        ],
      );

      return {
        success: true,
        documentGeneration: generationRecord,
        digitalPaper: digitalPaperResult.rows[0],
        downloadUrl: `/api/documents/download/${generationRecord.id}`,
      };
    } catch (error) {
      console.error('Document generation error:', error);
      return {
        success: false,
        statusCode: 500,
        message: 'Unexpected error generating document',
        error: error?.message || String(error),
      };
    }
  }

  async getDocumentGeneration(id) {
    try {
      const result = await pool.query(
        `SELECT dg.*, dp.title, dp.document_type, t.name as template_name
         FROM document_generation dg
         LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
         LEFT JOIN paper_templates t ON dg.template_id = t.id
         WHERE dg.id = $1`,
        [id]
      );

      return result.rows[0] || null;
    } catch (error) {
      console.error('Error fetching document generation:', error);
      throw error;
    }
  }

  async getDocumentGenerationsByInfant(infantId) {
    try {
      const result = await pool.query(
        `SELECT dg.*, dp.title, dp.document_type, t.name as template_name
         FROM document_generation dg
         LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
         LEFT JOIN paper_templates t ON dg.template_id = t.id
         WHERE dg.infant_id = $1
         ORDER BY dg.created_at DESC`,
        [infantId]
      );

      return result.rows;
    } catch (error) {
      console.error('Error fetching document generations:', error);
      throw error;
    }
  }

  async getDocumentGenerationsByGuardian(guardianId) {
    try {
      const result = await pool.query(
        `SELECT dg.*, dp.title, dp.document_type, t.name as template_name, i.first_name, i.last_name
         FROM document_generation dg
         LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
         LEFT JOIN paper_templates t ON dg.template_id = t.id
         LEFT JOIN patients i ON dg.infant_id = i.id
         WHERE dg.guardian_id = $1
         ORDER BY dg.created_at DESC`,
        [guardianId]
      );

      return result.rows;
    } catch (error) {
      console.error('Error fetching document generations:', error);
      throw error;
    }
  }

  async getDocumentGenerationsByUser(userId) {
    try {
      const result = await pool.query(
        `SELECT dg.*, dp.title, dp.document_type, t.name as template_name, i.first_name, i.last_name, g.name as guardian_name
         FROM document_generation dg
         LEFT JOIN digital_papers dp ON dg.id = dp.document_generation_id
         LEFT JOIN paper_templates t ON dg.template_id = t.id
         LEFT JOIN patients i ON dg.infant_id = i.id
         LEFT JOIN guardians g ON dg.guardian_id = g.id
         WHERE dg.generated_by = $1
         ORDER BY dg.created_at DESC`,
        [userId]
      );

      return result.rows;
    } catch (error) {
      console.error('Error fetching document generations:', error);
      throw error;
    }
  }

  async downloadDocument(id) {
    try {
      const generation = await this.getDocumentGeneration(id);

      if (!generation) {
        return {
          success: false,
          statusCode: 404,
          error: 'Document not found',
        };
      }

      const filePath = generation.file_path || generation.filePath || generation.path || null;

      if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
        return {
          success: false,
          statusCode: 500,
          error: 'Document has no associated file path',
        };
      }

      const attemptRead = async (targetPath) => {
        try {
          await fs.access(targetPath);
        } catch (accessError) {
          if (accessError?.code === 'ENOENT') {
            return { ok: false, code: 'ENOENT', error: accessError };
          }
          return { ok: false, code: 'EACCESS', error: accessError };
        }

        const fileBuffer = await fs.readFile(targetPath);
        return { ok: true, buffer: fileBuffer };
      };

      const readResult = await attemptRead(filePath);
      if (readResult.ok) {
        return {
          success: true,
          buffer: readResult.buffer,
          filename: generation.file_name || `document_${id}.pdf`,
          mimeType: generation.mime_type || 'application/pdf',
          filePath,
        };
      }

      if (readResult.code === 'ENOENT') {
        // Best-effort regeneration for missing local files.
        try {
          const regenerateResult = await this.regenerateDocument(id);
          if (regenerateResult?.success && regenerateResult.filePath) {
            const regenReadResult = await attemptRead(regenerateResult.filePath);
            if (regenReadResult.ok) {
              return {
                success: true,
                buffer: regenReadResult.buffer,
                filename: regenerateResult.filename || `document_${id}.pdf`,
                mimeType: 'application/pdf',
                filePath: regenerateResult.filePath,
                regenerated: true,
              };
            }
          }
        } catch (regenerateError) {
          console.error('Document regeneration error:', regenerateError);
        }

        return {
          success: false,
          statusCode: 404,
          error: 'Document file not found on disk',
          path: filePath,
        };
      }

      return {
        success: false,
        statusCode: 500,
        error: 'Failed to read document file',
        path: filePath,
      };
    } catch (error) {
      console.error('Document download error:', error);
      return {
        success: false,
        statusCode: 500,
        error: error?.message || String(error),
      };
    }
  }

  async regenerateDocument(id) {
    try {
      const generation = await this.getDocumentGeneration(id);

      if (!generation) {
        throw new Error('Document generation record not found');
      }

      // Get template
      const templateResult = await pool.query(
        'SELECT * FROM paper_templates WHERE id = $1',
        [generation.template_id]
      );

      if (templateResult.rows.length === 0) {
        throw new Error('Template not found');
      }

      const template = templateResult.rows[0];

      // Get original data
      const originalData = JSON.parse(generation.generated_data || '{}');
      const normalizedTemplateType = normalizePaperTemplateType(template.template_type);

      // Regenerate PDF
      const pdfResult = await this.pdfGenerator.generatePDF(
        normalizedTemplateType || template.template_type,
        originalData
      );

      if (!pdfResult.success) {
        throw new Error(pdfResult.error);
      }

      // Save new file
      await this.ensureDocumentDirectory();
      const newFilename = `regenerated_${Date.now()}_${pdfResult.filename}`;
      const newFilePath = path.join(this.documentDir, newFilename);

      await fs.writeFile(newFilePath, pdfResult.buffer);

      // Update generation record
      await pool.query(
        `UPDATE document_generation 
         SET file_path = $1, file_name = $2, file_size = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [newFilePath, newFilename, pdfResult.buffer.length, id]
      );

      return {
        success: true,
        filePath: newFilePath,
        filename: newFilename
      };
    } catch (error) {
      console.error('Document regeneration error:', error);
      throw error;
    }
  }

  async incrementDownloadCount(id) {
    try {
      await pool.query(
        `UPDATE document_generation 
         SET download_count = COALESCE(download_count, 0) + 1, last_downloaded = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );
    } catch (error) {
      console.error('Error incrementing download count:', error);
      throw error;
    }
  }

  async getDocumentAnalytics(filters = {}) {
    try {
      const { startDate, endDate, templateType, infantId } = filters;

      let query = `
        SELECT 
          t.name as template_name,
          t.template_type,
          COUNT(dg.id) as total_generated,
          SUM(dg.download_count) as total_downloads,
          COUNT(CASE WHEN dg.status = 'generated' THEN 1 END) as generated_count,
          COUNT(CASE WHEN dg.status = 'downloaded' THEN 1 END) as downloaded_count,
          AVG(dg.file_size) as avg_file_size
        FROM document_generation dg
        LEFT JOIN paper_templates t ON dg.template_id = t.id
        WHERE 1=1
      `;

      const params = [];
      let paramIndex = 1;

      if (startDate) {
        query += ` AND dg.created_at >= $${paramIndex}`;
        params.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        query += ` AND dg.created_at <= $${paramIndex}`;
        params.push(endDate);
        paramIndex++;
      }

      if (templateType) {
        query += ` AND t.template_type = $${paramIndex}`;
        params.push(templateType);
        paramIndex++;
      }

      if (infantId) {
        query += ` AND dg.infant_id = $${paramIndex}`;
        params.push(infantId);
        paramIndex++;
      }

      query += ' GROUP BY t.name, t.template_type ORDER BY total_generated DESC';

      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error fetching document analytics:', error);
      throw error;
    }
  }

  async getDocumentStats() {
    try {
      const [total, today, thisMonth, byType] = await Promise.all([
        pool.query('SELECT COUNT(*) as count FROM document_generation'),
        pool.query(`
          SELECT COUNT(*) as count FROM document_generation 
          WHERE DATE(created_at) = CURRENT_DATE
        `),
        pool.query(`
          SELECT COUNT(*) as count FROM document_generation 
          WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
        `),
        pool.query(`
          SELECT t.template_type, COUNT(*) as count
          FROM document_generation dg
          LEFT JOIN paper_templates t ON dg.template_id = t.id
          GROUP BY t.template_type
        `)
      ]);

      return {
        total: parseInt(total.rows[0].count),
        today: parseInt(today.rows[0].count),
        thisMonth: parseInt(thisMonth.rows[0].count),
        byType: byType.rows
      };
    } catch (error) {
      console.error('Error fetching document stats:', error);
      throw error;
    }
  }
}

module.exports = DocumentService;
