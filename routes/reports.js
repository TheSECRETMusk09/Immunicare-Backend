const express = require('express');
const fs = require('fs');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { CANONICAL_ROLES, getCanonicalRole, requirePermission } = require('../middleware/rbac');
const ReportService = require('../services/reportService');
const {
  isScopeRequestAllowed,
  resolveEffectiveScope,
  resolveUserScopeIds,
} = require('../services/entityScopeService');
const { sanitizeText } = require('../utils/adminValidation');

const reportService = new ReportService();

const REPORT_FORMAT_ALIASES = Object.freeze({
  pdf: 'pdf',
  csv: 'csv',
  excel: 'excel',
  xlsx: 'excel',
});

const normalizeReportTypeInput = (value, allowedTypes = []) => {
  const normalized = sanitizeText(value).toLowerCase();
  return allowedTypes.includes(normalized) ? normalized : null;
};

const normalizeReportFormatInput = (value, allowedFormats = []) => {
  const normalized = REPORT_FORMAT_ALIASES[sanitizeText(value).toLowerCase()] || null;
  return normalized && allowedFormats.includes(normalized) ? normalized : null;
};

const sendReportError = (res, error, fallbackMessage = 'Report request failed') => {
  if (res.headersSent || res.writableEnded) {
    return;
  }

  const statusCode = error?.statusCode || 500;
  const message = error?.message || fallbackMessage;
  res.status(statusCode).json({
    success: false,
    message,
    error: error?.code || message,
    ...(error?.fields ? { fields: error.fields } : {}),
  });
};

const resolveReportsSummaryScope = (req) => {
  const canonicalRole =
    typeof getCanonicalRole === 'function'
      ? getCanonicalRole(req)
      : req.user?.runtime_role || req.user?.role_type || req.user?.role || null;
  const systemAdminRole = CANONICAL_ROLES?.SYSTEM_ADMIN || 'SYSTEM_ADMIN';
  const effectiveScope =
    typeof resolveEffectiveScope === 'function'
      ? resolveEffectiveScope({
          query: req.query,
          user: req.user,
          canonicalRole,
        })
      : {
          scopeIds: typeof resolveUserScopeIds === 'function' ? resolveUserScopeIds(req.user) : [],
          useScope: false,
          userScopeIds:
            typeof resolveUserScopeIds === 'function' ? resolveUserScopeIds(req.user) : [],
          requestedScopeIds: [],
          allowSystemScope: false,
        };

  if (
    canonicalRole !== systemAdminRole &&
    typeof isScopeRequestAllowed === 'function' &&
    !isScopeRequestAllowed({
      requestedScopeIds: effectiveScope.requestedScopeIds,
      userScopeIds: effectiveScope.userScopeIds,
      allowSystemScope: effectiveScope.allowSystemScope,
    })
  ) {
    return {
      error: 'Cross-facility reports access is not allowed. Use your assigned facility scope.',
      status: 403,
    };
  }

  return {
    canonicalRole,
    scopeIds: effectiveScope.scopeIds,
    useScope: effectiveScope.useScope,
    allowSystemScope: effectiveScope.allowSystemScope,
  };
};

const resolveReportsRouteScope = (req) => resolveReportsSummaryScope(req);

const isSystemAdminRequest = (req) => {
  const canonicalRole =
    typeof getCanonicalRole === 'function'
      ? getCanonicalRole(req)
      : req.user?.runtime_role || req.user?.role_type || req.user?.role || null;
  return canonicalRole === (CANONICAL_ROLES?.SYSTEM_ADMIN || 'SYSTEM_ADMIN');
};

const appendScopeFilters = (filters = {}, scopeContext = {}) => ({
  ...(filters && typeof filters === 'object' ? filters : {}),
  scopeIds: scopeContext.scopeIds || [],
  facilityId: scopeContext.scopeIds?.[0] || null,
});

const validateReportGenerationBody = (body = {}) => {
  const { type, format } = body || {};
  const allowedTypes = reportService.getReportTypes();
  const allowedFormats = reportService.getReportFormats();
  const normalizedType = normalizeReportTypeInput(type, allowedTypes);
  const normalizedFormat = normalizeReportFormatInput(format, allowedFormats);
  const fields = {};

  if (!type) {
    fields.type = 'type is required';
  } else if (!normalizedType) {
    fields.type = `type must be one of: ${allowedTypes.join(', ')}`;
  }

  if (!format) {
    fields.format = 'format is required';
  } else if (!normalizedFormat) {
    fields.format = `format must be one of: ${allowedFormats.join(', ')}`;
  }

  return {
    fields,
    normalizedType,
    normalizedFormat,
    allowedTypes,
    allowedFormats,
  };
};

const sendValidationError = (res, fields) =>
  res.status(400).json({
    success: false,
    message: 'Invalid report request',
    error: 'REPORT_VALIDATION_ERROR',
    fields,
  });

router.use(authenticateToken);

// Root route - return API info
router.get('/info', async (req, res) => {
  res.json({
    success: true,
    message: 'Reports API',
    endpoints: [
      'GET /reports - Get all reports',
      'GET /reports/admin/summary - Get admin dashboard summary',
      'GET /reports/templates - Get available report templates',
      'POST /reports/generate - Generate new report',
      'POST /reports/generate-job - Start async report generation',
      'GET /reports/:id/status - Get generated report status',
      'GET /reports/:id/download - Download report',
      'DELETE /reports/:id - Delete report',
    ],
  });
});

// Get all reports
router.get('/', requirePermission('reports:view'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const scopeContext = resolveReportsRouteScope(req);

    if (scopeContext.error) {
      return res.status(scopeContext.status).json({
        success: false,
        error: scopeContext.error,
      });
    }

    const reportHistory = await reportService.getReportHistory({
      type: req.query.type,
      startDate: req.query.startDate || req.query.start_date,
      endDate: req.query.endDate || req.query.end_date,
      generatedBy: Number.parseInt(req.query.generatedBy || req.query.generated_by, 10) || null,
      limit,
      offset,
      scopeIds: scopeContext.scopeIds,
    });
    const reports = Array.isArray(reportHistory) ? reportHistory : reportHistory.rows || [];
    const total = Array.isArray(reportHistory)
      ? reports.length
      : reportHistory.total || reports.length;

    res.json({
      success: true,
      data: reports,
      pagination: {
        limit,
        offset,
        total,
      },
      meta: {
        total,
        generatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error fetching reports:', error);
    sendReportError(res, error, 'Failed to fetch reports');
  }
});

// Get admin dashboard summary
router.get('/admin/summary', requirePermission('reports:view'), async (req, res) => {
  try {
    const startDate = sanitizeText(req.query?.startDate ?? req.query?.start_date);
    const endDate = sanitizeText(req.query?.endDate ?? req.query?.end_date);
    const scopeContext = resolveReportsSummaryScope(req);

    if (scopeContext.error) {
      return res.status(scopeContext.status).json({
        success: false,
        error: scopeContext.error,
      });
    }

    const summary = await reportService.getAdminSummary({
      startDate,
      endDate,
      facilityId: scopeContext.scopeIds.length > 0 ? scopeContext.scopeIds[0] : null,
      scopeIds: scopeContext.scopeIds,
    });

    res.json({
      success: true,
      data: summary,
      meta: {
        generatedAt: new Date(),
        scope: summary.scope,
      },
    });
  } catch (error) {
    console.error('Error fetching admin summary:', error);
    sendReportError(res, error, 'Failed to fetch admin summary');
  }
});

// Get report templates
router.get('/templates', requirePermission('reports:view'), async (req, res) => {
  try {
    const templates = reportService.getReportTemplates();

    res.json({
      success: true,
      data: templates,
      meta: {
        generatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error fetching report templates:', error);
    sendReportError(res, error, 'Failed to fetch report templates');
  }
});

// Generate new report
router.post('/generate', requirePermission('reports:create'), async (req, res) => {
  try {
    req.setTimeout?.(300000);
    res.setTimeout?.(300000);

    const { startDate, endDate, filters } = req.body || {};
    const { fields, normalizedType, normalizedFormat } = validateReportGenerationBody(
      req.body || {}
    );

    if (Object.keys(fields).length > 0) {
      return sendValidationError(res, fields);
    }

    const scopeContext = resolveReportsRouteScope(req);

    if (scopeContext.error) {
      return res.status(scopeContext.status).json({
        success: false,
        error: scopeContext.error,
      });
    }

    const report = await reportService.generateReport(
      normalizedType,
      appendScopeFilters(
        {
          startDate,
          endDate,
          ...(filters && typeof filters === 'object' ? filters : {}),
        },
        scopeContext
      ),
      normalizedFormat,
      req.user?.id || null
    );

    if (res.headersSent || res.writableEnded) {
      return undefined;
    }

    res.status(201).json({
      success: true,
      message: 'Report generated successfully.',
      data: report,
      meta: {
        generatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error generating report:', error);
    sendReportError(res, error, 'Failed to generate report');
  }
});

// Start async report generation job — returns 202 immediately with a jobId
router.post('/generate-job', requirePermission('reports:create'), async (req, res) => {
  try {
    const { startDate, endDate, filters } = req.body || {};
    const { fields, normalizedType, normalizedFormat } = validateReportGenerationBody(
      req.body || {}
    );

    if (Object.keys(fields).length > 0) {
      return sendValidationError(res, fields);
    }

    const scopeContext = resolveReportsRouteScope(req);

    if (scopeContext.error) {
      return res.status(scopeContext.status).json({
        success: false,
        error: scopeContext.error,
      });
    }

    const scopedFilters = appendScopeFilters(
      {
        startDate,
        endDate,
        ...(filters && typeof filters === 'object' ? filters : {}),
      },
      scopeContext
    );
    const reportRow = await reportService.createReportHistoryPlaceholder(
      normalizedType,
      scopedFilters,
      normalizedFormat,
      req.user?.id || null
    );

    // Fire generation without blocking the HTTP response
    (async () => {
      try {
        await reportService.generateReport(
          normalizedType,
          scopedFilters,
          normalizedFormat,
          req.user?.id || null,
          { existingReportId: reportRow.id }
        );
      } catch (err) {
        await reportService.markReportGenerationFailed(reportRow.id, err);
        console.error('Async report job failed [reportId=%s]:', reportRow.id, err);
      }
    })();

    res.status(202).json({
      success: true,
      jobId: String(reportRow.id),
      reportId: reportRow.id,
      status: reportRow.status || 'generating',
      message: 'Report generation started',
    });
  } catch (error) {
    console.error('Error creating report job:', error);
    sendReportError(res, error, 'Failed to start report generation');
  }
});

// Backward-compatible async report job status. New frontend polling uses /reports/:id/status.
router.get('/job/:jobId/status', requirePermission('reports:view'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const reportId = parseInt(jobId, 10);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid job ID' });
    }

    const unscopedStatus = await reportService.getReportStatus(reportId);
    if (
      !isSystemAdminRequest(req) &&
      unscopedStatus.generated_by &&
      Number(unscopedStatus.generated_by) !== Number(req.user?.id)
    ) {
      return res.status(404).json({ success: false, error: 'Job not found or expired' });
    }

    const scopeContext = resolveReportsRouteScope(req);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({
        success: false,
        error: scopeContext.error,
      });
    }

    const reportStatus = await reportService.getReportStatus(reportId, {
      scopeIds: scopeContext.scopeIds,
    });

    return res.json({
      success: true,
      data: {
        jobId: String(reportStatus.id),
        status: reportStatus.status,
        reportId: reportStatus.id,
        report: reportStatus.status === 'completed' ? reportStatus : null,
        error: reportStatus.error_message || null,
      },
    });
  } catch (error) {
    console.error('Error fetching job status:', error);
    return sendReportError(res, error, 'Failed to fetch job status');
  }
});

// Get report status
router.get('/:id/status', requirePermission('reports:view'), async (req, res) => {
  try {
    const reportId = parseInt(req.params.id, 10);
    if (Number.isNaN(reportId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid report ID',
        error: 'REPORT_INVALID_ID',
      });
    }

    const scopeContext = resolveReportsRouteScope(req);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({
        success: false,
        error: scopeContext.error,
      });
    }

    const reportStatus = await reportService.getReportStatus(reportId, {
      scopeIds: scopeContext.scopeIds,
    });
    res.json({
      success: true,
      data: reportStatus,
    });
  } catch (error) {
    console.error('Error fetching report status:', error);
    sendReportError(res, error, 'Failed to fetch report status');
  }
});

// Download report
router.get('/:id/download', requirePermission('reports:download'), async (req, res) => {
  try {
    const reportId = parseInt(req.params.id, 10);
    if (Number.isNaN(reportId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid report ID',
        error: 'REPORT_INVALID_ID',
      });
    }

    const scopeContext = resolveReportsRouteScope(req);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({
        success: false,
        error: scopeContext.error,
      });
    }

    const reportFile = await reportService.downloadReport(reportId, {
      scopeIds: scopeContext.scopeIds,
    });

    res.setHeader('Content-Type', reportFile.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${reportFile.filename || `report-${reportId}`}"`
    );
    if (reportFile.fileSize) {
      res.setHeader('Content-Length', reportFile.fileSize);
    }

    await pool.query('UPDATE reports SET download_count = download_count + 1 WHERE id = $1', [
      reportId,
    ]);

    fs.createReadStream(reportFile.path)
      .on('error', (streamError) => {
        if (!res.headersSent) {
          sendReportError(res, streamError, 'Failed to stream report');
        } else {
          res.destroy(streamError);
        }
      })
      .pipe(res);
  } catch (error) {
    console.error('Error downloading report:', error);
    sendReportError(res, error, 'Failed to download report');
  }
});

// Delete report
router.delete('/:id', requirePermission('reports:delete'), async (req, res) => {
  try {
    const reportId = parseInt(req.params.id, 10);
    if (Number.isNaN(reportId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid report ID',
      });
    }

    const scopeContext = resolveReportsRouteScope(req);
    if (scopeContext.error) {
      return res.status(scopeContext.status).json({
        success: false,
        error: scopeContext.error,
      });
    }

    await reportService.getReportStatus(reportId, {
      scopeIds: scopeContext.scopeIds,
    });

    const result = await pool.query(
      'UPDATE reports SET is_active = false WHERE id = $1 AND COALESCE(is_active, true) = true RETURNING id',
      [reportId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
      });
    }

    res.json({
      success: true,
      message: 'Report deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete report',
    });
  }
});

module.exports = router;
