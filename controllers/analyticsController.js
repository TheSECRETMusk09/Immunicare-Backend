const fs = require('fs');
const analyticsService = require('../services/analyticsService');
const ReportService = require('../services/reportService');

const reportService = new ReportService();
const ANALYTICS_EXPORT_TYPE_MAP = Object.freeze({
  vaccinations: 'vaccination',
  appointments: 'appointment',
  infants: 'infant',
});

const handleError = (res, error, fallbackContext = 'Analytics request failed') => {
  const statusCode = Number.isFinite(error?.statusCode) ? error.statusCode : 500;

  if (statusCode >= 500) {
    console.error(`${fallbackContext}:`, error);
  }

  return res.status(statusCode).json({
    success: false,
    error: error?.message || fallbackContext,
    details: Array.isArray(error?.details) ? error.details : undefined,
  });
};

const dashboard = async (req, res) => {
  try {
    const data = await analyticsService.getDashboardAnalytics({
      query: req.query,
      user: req.user,
    });

    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Dashboard analytics request failed');
  }
};

const dashboardSummary = async (req, res) => {
  try {
    const data = await analyticsService.getDashboardSummaryAnalytics({
      query: req.query,
      user: req.user,
    });

    return res.json({ success: true, ...data });
  } catch (error) {
    return handleError(res, error, 'Dashboard summary analytics request failed');
  }
};

const vaccinations = async (req, res) => {
  try {
    const data = await analyticsService.getVaccinationAnalytics({
      query: req.query,
      user: req.user,
    });

    return res.json({ success: true, ...data });
  } catch (error) {
    return handleError(res, error, 'Vaccination analytics request failed');
  }
};

const appointments = async (req, res) => {
  try {
    const data = await analyticsService.getAppointmentAnalytics({
      query: req.query,
      user: req.user,
    });

    return res.json({ success: true, ...data });
  } catch (error) {
    return handleError(res, error, 'Appointment analytics request failed');
  }
};

const inventory = async (req, res) => {
  try {
    const data = await analyticsService.getInventoryAnalytics({
      query: req.query,
      user: req.user,
    });

    return res.json({ success: true, ...data });
  } catch (error) {
    return handleError(res, error, 'Inventory analytics request failed');
  }
};

const trends = async (req, res) => {
  try {
    const data = await analyticsService.getTrendsAnalytics({
      query: req.query,
      user: req.user,
    });

    return res.json({ success: true, trends: data });
  } catch (error) {
    return handleError(res, error, 'Trends analytics request failed');
  }
};

const demographics = async (req, res) => {
  try {
    const data = await analyticsService.getDemographicsAnalytics({
      query: req.query,
      user: req.user,
    });

    return res.json({ success: true, ...data });
  } catch (error) {
    return handleError(res, error, 'Demographics analytics request failed');
  }
};

const filters = async (_req, res) => {
  try {
    const options = analyticsService.getAvailableFilterOptions();
    return res.json({ success: true, options });
  } catch (error) {
    return handleError(res, error, 'Filter options request failed');
  }
};

const exportAnalytics = async (req, res) => {
  try {
    const requestedType = String(req.query.type || '')
      .trim()
      .toLowerCase();
    const mappedType = ANALYTICS_EXPORT_TYPE_MAP[requestedType];

    if (!mappedType) {
      return res.status(400).json({
        success: false,
        error: 'Invalid analytics export type.',
        details: ['type must be one of: vaccinations, appointments, infants'],
      });
    }

    const requestedFormat = String(req.query.format || 'csv')
      .trim()
      .toLowerCase();
    const normalizedFormat = requestedFormat === 'xlsx' ? 'excel' : requestedFormat;

    if (!['csv', 'pdf', 'excel'].includes(normalizedFormat)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid analytics export format.',
        details: ['format must be one of: csv, pdf, excel, xlsx'],
      });
    }

    const { type, format, ...rawFilters } = req.query || {};
    void type;
    void format;
    const generatedReport = await reportService.generateReport(
      mappedType,
      rawFilters,
      normalizedFormat,
      req.user?.id || null
    );
    const downloadResult = await reportService.downloadReport(generatedReport.id);

    res.setHeader('Content-Type', downloadResult.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadResult.filename}"`);
    res.setHeader('Content-Length', String(downloadResult.fileSize));

    return fs.createReadStream(downloadResult.path).pipe(res);
  } catch (error) {
    return handleError(res, error, 'Analytics export request failed');
  }
};

const health = (_req, res) => {
  return res.json({
    success: true,
    message: 'Analytics API',
    endpoints: [
      '/dashboard',
      '/dashboard-summary',
      '/vaccinations',
      '/appointments',
      '/inventory',
      '/trends',
      '/demographics',
      '/filters',
    ],
  });
};

module.exports = {
  health,
  dashboard,
  dashboardSummary,
  vaccinations,
  appointments,
  inventory,
  trends,
  demographics,
  filters,
  exportAnalytics,
};
