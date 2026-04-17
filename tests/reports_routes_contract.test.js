process.env.DB_SUPPRESS_POOL_LOGS = 'true';

const express = require('express');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const request = require('supertest');

const mockPoolQuery = jest.fn();

const mockGetReportTypes = jest.fn(() => [
  'vaccination',
  'inventory',
  'appointment',
  'guardian',
  'infant',
  'system',
  'barangay',
  'compliance',
  'healthcenter',
  'consolidated',
]);

const mockGetReportFormats = jest.fn(() => ['pdf', 'excel', 'csv']);

const mockReportService = {
  getReportTypes: jest.fn(),
  getReportFormats: jest.fn(),
  getReportTemplates: jest.fn(),
  getReportHistory: jest.fn(),
  getAdminSummary: jest.fn(),
  createReportHistoryPlaceholder: jest.fn(),
  markReportGenerationFailed: jest.fn(),
  generateReport: jest.fn(),
  downloadReport: jest.fn(),
  getReportStatus: jest.fn(),
  createHttpError: jest.fn((message, statusCode = 400, code = 'REPORT_ERROR') => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
  }),
};

const mockRequirePermission = jest.fn(() => (req, _res, next) => next());
let mockAuthenticatedUser = {
  id: 99,
  role: 'SYSTEM_ADMIN',
  role_type: 'SYSTEM_ADMIN',
  runtime_role: 'SYSTEM_ADMIN',
};

jest.mock('../db', () => ({
  query: (...args) => mockPoolQuery(...args),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = mockAuthenticatedUser;
    next();
  },
}));

jest.mock('../middleware/rbac', () => ({
  requirePermission: (...args) => mockRequirePermission(...args),
}));

jest.mock('../services/reportService', () => {
  return jest.fn().mockImplementation(() => mockReportService);
});

const reportsRouter = require('../routes/reports');

const ReportService = require('../services/reportService');

const getRouteHandler = (routePath, method = 'post') => {
  const routeLayer = reportsRouter.stack.find(
    (layer) => layer.route?.path === routePath && layer.route.methods?.[method],
  );

  if (!routeLayer) {
    throw new Error(`Unable to find ${method.toUpperCase()} ${routePath} route handler`);
  }

  return routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
};

const createMockResponse = (overrides = {}) => {
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader: jest.fn(),
    on: jest.fn(),
    destroy: jest.fn(),
    setTimeout: jest.fn(),
    ...overrides,
  };

  res.status = overrides.status || jest.fn(() => res);
  res.json = overrides.json || jest.fn(() => res);

  return res;
};

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

reportsRouter.stack
  .filter((layer) => layer?.route?.path === '/generate')
  .forEach((layer) => {
    layer.route.stack.forEach((routeLayer) => {
      if (routeLayer?.name === 'bound dispatch') {
        return;
      }
      if (typeof routeLayer.handle !== 'function') {
        return;
      }
      const isPermissionLayer = routeLayer.handle.length === 3;
      if (isPermissionLayer) {
        routeLayer.handle = (_req, _res, next) => next();
      }
    });
  });

describe('Reports routes contract', () => {
  let app;
  let tempFile;
  let consoleErrorSpy;
  const downloadFixtureContent = 'id,name\n1,Sample\n';

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthenticatedUser = {
      id: 99,
      role: 'SYSTEM_ADMIN',
      role_type: 'SYSTEM_ADMIN',
      runtime_role: 'SYSTEM_ADMIN',
    };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    ReportService.mockImplementation(() => mockReportService);

    const reportTypes = [
      'vaccination',
      'inventory',
      'appointment',
      'guardian',
      'infant',
      'system',
      'barangay',
      'compliance',
      'healthcenter',
      'consolidated',
    ];
    const reportFormats = ['pdf', 'excel', 'csv'];

    mockGetReportTypes.mockReturnValue(reportTypes);
    mockGetReportFormats.mockReturnValue(reportFormats);

    mockReportService.getReportTypes.mockImplementation(mockGetReportTypes);
    mockReportService.getReportFormats.mockImplementation(mockGetReportFormats);
    mockReportService.getReportTemplates.mockReturnValue([
      {
        type: 'vaccination',
        name: 'Vaccination Report',
        description: 'Vaccination module export',
        availableFormats: ['pdf', 'excel', 'csv'],
      },
    ]);
    mockReportService.getReportHistory.mockResolvedValue([]);
    mockReportService.getAdminSummary.mockResolvedValue({
      vaccination: { total: 0, completed: 0 },
      reports: { total_reports: 0, total_downloads: 0 },
    });
    mockReportService.createReportHistoryPlaceholder.mockResolvedValue({
      id: 701,
      type: 'vaccination',
      status: 'generating',
      generated_by: 99,
    });
    mockReportService.markReportGenerationFailed.mockResolvedValue({
      id: 701,
      status: 'failed',
    });
    mockReportService.getReportStatus.mockResolvedValue({
      id: 77,
      type: 'vaccination',
      title: 'Vaccination Report',
      status: 'completed',
      file_format: 'csv',
      generated_by: 99,
      download_count: 0,
    });
    mockPoolQuery.mockResolvedValue({ rows: [] });

    app = express();
    app.use(express.json());
    app.use('/api/reports', reportsRouter);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reports-route-'));
    tempFile = path.join(tmpDir, 'vaccination-report-2026-03-08-00-00-00.csv');
    await fs.writeFile(tempFile, downloadFixtureContent);
  });

  afterEach(async () => {
    if (consoleErrorSpy) {
      consoleErrorSpy.mockRestore();
    }

    if (tempFile) {
      const dir = path.dirname(tempFile);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns report history with normalized filters and pagination', async () => {
    mockReportService.getReportHistory.mockResolvedValue({
      rows: [
        {
          id: 88,
          type: 'vaccination',
          title: 'Vaccination Report',
          file_format: 'csv',
          status: 'completed',
        },
      ],
      total: 14,
    });

    const response = await request(app).get(
      '/api/reports?type=vaccination&startDate=2026-03-01&endDate=2026-03-08&limit=25&offset=0&generatedBy=99',
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toMatchObject({
      limit: 25,
      offset: 0,
      total: 14,
    });
    expect(mockReportService.getReportHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'vaccination',
        startDate: '2026-03-01',
        endDate: '2026-03-08',
        generatedBy: 99,
        limit: 25,
        offset: 0,
        scopeIds: [],
      }),
    );
  });

  it('returns templates in canonical success shape', async () => {
    const response = await request(app).get('/api/reports/templates');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: expect.any(Array),
    });
    expect(mockReportService.getReportTemplates).toHaveBeenCalledTimes(1);
  });

  it('lists active report generation and status endpoints in API info', async () => {
    const response = await request(app).get('/api/reports/info');

    expect(response.status).toBe(200);
    expect(response.body.endpoints).toEqual(
      expect.arrayContaining([
        'POST /reports/generate - Generate new report',
        'POST /reports/generate-job - Start async report generation',
        'GET /reports/:id/status - Get generated report status',
      ]),
    );
  });

  it('returns admin summary and forwards normalized date filters', async () => {
    mockReportService.getAdminSummary.mockResolvedValue({
      vaccination: { total: 4, completed: 3 },
      reports: { total_reports: 2, total_downloads: 5 },
    });

    const response = await request(app).get(
      '/api/reports/admin/summary?startDate=2026-03-01&endDate=2026-03-08',
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      vaccination: { total: 4, completed: 3 },
      reports: { total_reports: 2, total_downloads: 5 },
    });
    expect(mockReportService.getAdminSummary).toHaveBeenCalledWith({
      startDate: '2026-03-01',
      endDate: '2026-03-08',
      facilityId: null,
      scopeIds: [],
    });
  });

  it('returns report status metadata by id', async () => {
    mockReportService.getReportStatus.mockResolvedValue({
      id: 77,
      type: 'vaccination',
      status: 'completed',
      file_format: 'csv',
    });

    const response = await request(app).get('/api/reports/77/status');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      id: 77,
      status: 'completed',
      file_format: 'csv',
    });
    expect(mockReportService.getReportStatus).toHaveBeenCalledWith(77, {
      scopeIds: [],
    });
  });

  it('rejects invalid generate format with field-level validation error', async () => {
    const response = await request(app).post('/api/reports/generate').send({
      type: 'vaccination',
      format: 'json',
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.fields).toMatchObject({
      format: expect.stringMatching(/must be one of/i),
    });
    expect(mockReportService.generateReport).not.toHaveBeenCalled();
  });

  it('normalizes xlsx -> excel before invoking report generation service', async () => {
    mockReportService.generateReport.mockResolvedValue({
      id: 501,
      type: 'vaccination',
      title: 'Vaccination Report',
      file_format: 'excel',
      status: 'completed',
      file_size: 2048,
      date_generated: '2026-03-08T00:00:00.000Z',
      download_count: 0,
    });

    const response = await request(app).post('/api/reports/generate').send({
      type: 'vaccination',
      format: 'xlsx',
      startDate: '2026-03-01',
      endDate: '2026-03-08',
      filters: { status: 'completed' },
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockReportService.generateReport).toHaveBeenCalledWith(
      'vaccination',
      expect.objectContaining({
        startDate: '2026-03-01',
        endDate: '2026-03-08',
        status: 'completed',
      }),
      'excel',
      99,
    );
  });

  it('extends the timeout window for long-running report generation requests', async () => {
    const generateHandler = getRouteHandler('/generate');

    mockReportService.generateReport.mockResolvedValue({
      id: 501,
      type: 'vaccination',
      title: 'Vaccination Report',
    });

    const req = {
      user: { id: 99 },
      body: {
        type: 'vaccination',
        format: 'csv',
      },
      setTimeout: jest.fn(),
    };
    const res = createMockResponse();

    await generateHandler(req, res);

    expect(req.setTimeout).toHaveBeenCalledWith(300000);
    expect(res.setTimeout).toHaveBeenCalledWith(300000);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Report generated successfully.',
      }),
    );
  });

  it('does not attempt a second response when report generation finishes after headers were already sent', async () => {
    const generateHandler = getRouteHandler('/generate');

    mockReportService.generateReport.mockResolvedValue({
      id: 501,
      type: 'vaccination',
      title: 'Vaccination Report',
    });

    const req = {
      user: { id: 99 },
      body: {
        type: 'vaccination',
        format: 'csv',
      },
      setTimeout: jest.fn(),
    };
    const res = createMockResponse({ headersSent: true });

    await expect(generateHandler(req, res)).resolves.toBeUndefined();

    expect(mockReportService.generateReport).toHaveBeenCalledWith(
      'vaccination',
      expect.objectContaining({ startDate: undefined, endDate: undefined }),
      'csv',
      99,
    );
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('starts async report generation jobs and exposes completed status', async () => {
    let resolveGeneration;
    const generationPromise = new Promise((resolve) => {
      resolveGeneration = resolve;
    });

    mockReportService.generateReport.mockReturnValue(generationPromise);
    mockReportService.getReportStatus
      .mockResolvedValueOnce({
        id: 701,
        type: 'vaccination',
        status: 'generating',
        generated_by: 99,
      })
      .mockResolvedValueOnce({
        id: 701,
        type: 'vaccination',
        title: 'Vaccination Report',
        file_format: 'pdf',
        status: 'completed',
        generated_by: 99,
      });

    const response = await request(app).post('/api/reports/generate-job').send({
      type: 'vaccination',
      format: 'pdf',
      startDate: '2026-03-01',
      endDate: '2026-03-08',
      filters: { status: 'completed' },
    });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      success: true,
      status: 'generating',
      reportId: 701,
      message: 'Report generation started',
    });
    expect(response.body.jobId).toBe('701');
    expect(mockReportService.createReportHistoryPlaceholder).toHaveBeenCalledWith(
      'vaccination',
      expect.objectContaining({
        startDate: '2026-03-01',
        endDate: '2026-03-08',
        status: 'completed',
        scopeIds: [],
      }),
      'pdf',
      99,
    );
    expect(mockReportService.generateReport).toHaveBeenCalledWith(
      'vaccination',
      expect.objectContaining({
        startDate: '2026-03-01',
        endDate: '2026-03-08',
        status: 'completed',
        scopeIds: [],
      }),
      'pdf',
      99,
      { existingReportId: 701 },
    );

    const runningStatus = await request(app).get('/api/reports/701/status');

    expect(runningStatus.status).toBe(200);
    expect(runningStatus.body.data).toMatchObject({
      id: 701,
      status: 'generating',
    });

    resolveGeneration({
      id: 701,
      type: 'vaccination',
      title: 'Vaccination Report',
      file_format: 'pdf',
      status: 'completed',
    });
    await flushPromises();

    const completedStatus = await request(app).get('/api/reports/701/status');

    expect(completedStatus.status).toBe(200);
    expect(completedStatus.body.data).toMatchObject({
      id: 701,
      status: 'completed',
      type: 'vaccination',
    });
  });

  it('surfaces failed async report generation jobs through job status', async () => {
    mockReportService.generateReport.mockRejectedValue(
      new Error('No data found for selected filters. Please adjust filter criteria and try again.'),
    );
    mockReportService.getReportStatus.mockResolvedValue({
      id: 701,
      type: 'vaccination',
      status: 'failed',
      error_message: 'No data found for selected filters. Please adjust filter criteria and try again.',
      generated_by: 99,
    });

    const response = await request(app).post('/api/reports/generate-job').send({
      type: 'vaccination',
      format: 'pdf',
    });

    expect(response.status).toBe(202);
    await flushPromises();
    expect(mockReportService.markReportGenerationFailed).toHaveBeenCalledWith(
      701,
      expect.any(Error),
    );

    const failedStatus = await request(app).get('/api/reports/701/status');

    expect(failedStatus.status).toBe(200);
    expect(failedStatus.body.data).toMatchObject({
      id: 701,
      status: 'failed',
      error_message: 'No data found for selected filters. Please adjust filter criteria and try again.',
    });
  });

  it('rejects invalid async generate format with field-level validation error', async () => {
    const response = await request(app).post('/api/reports/generate-job').send({
      type: 'vaccination',
      format: 'json',
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.fields).toMatchObject({
      format: expect.stringMatching(/must be one of/i),
    });
    expect(mockReportService.generateReport).not.toHaveBeenCalled();
  });

  it('forwards facility scope to history and generation routes', async () => {
    mockAuthenticatedUser = {
      id: 50,
      role: 'ADMIN',
      role_type: 'ADMIN',
      runtime_role: 'ADMIN',
      facility_id: 203,
    };
    mockReportService.getReportHistory.mockResolvedValue({ rows: [], total: 0 });
    mockReportService.generateReport.mockResolvedValue({
      id: 702,
      type: 'appointment',
      status: 'completed',
    });

    await request(app).get('/api/reports?limit=10&offset=0');
    expect(mockReportService.getReportHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeIds: expect.arrayContaining([203]),
      }),
    );

    await request(app).post('/api/reports/generate').send({
      type: 'appointment',
      format: 'pdf',
    });
    expect(mockReportService.generateReport).toHaveBeenCalledWith(
      'appointment',
      expect.objectContaining({
        scopeIds: expect.arrayContaining([203]),
        facilityId: expect.any(Number),
      }),
      'pdf',
      50,
    );
  });

  it('forwards facility scope to status, download, and delete by id', async () => {
    mockAuthenticatedUser = {
      id: 50,
      role: 'ADMIN',
      role_type: 'ADMIN',
      runtime_role: 'ADMIN',
      facility_id: 203,
    };
    mockReportService.getReportStatus.mockResolvedValue({
      id: 77,
      type: 'vaccination',
      status: 'completed',
      generated_by: 50,
    });
    mockReportService.downloadReport.mockResolvedValue({
      path: tempFile,
      filename: 'vaccination-report.csv',
      mimeType: 'text/csv',
      fileSize: Buffer.byteLength(downloadFixtureContent, 'utf8'),
    });
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 77 }] });

    await request(app).get('/api/reports/77/status');
    expect(mockReportService.getReportStatus).toHaveBeenLastCalledWith(77, {
      scopeIds: expect.arrayContaining([203]),
    });

    await request(app)
      .get('/api/reports/77/download')
      .buffer(true)
      .parse((res, callback) => {
        res.resume();
        res.on('end', () => callback(null, Buffer.alloc(0)));
      });
    expect(mockReportService.downloadReport).toHaveBeenCalledWith(77, {
      scopeIds: expect.arrayContaining([203]),
    });

    await request(app).delete('/api/reports/77');
    expect(mockReportService.getReportStatus).toHaveBeenLastCalledWith(77, {
      scopeIds: expect.arrayContaining([203]),
    });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      'UPDATE reports SET is_active = false WHERE id = $1 AND COALESCE(is_active, true) = true RETURNING id',
      [77],
    );
  });

  it('returns 403 when report status access is outside caller scope', async () => {
    const forbidden = new Error('You do not have access to this report.');
    forbidden.statusCode = 403;
    forbidden.code = 'REPORT_SCOPE_FORBIDDEN';
    mockReportService.getReportStatus.mockRejectedValue(forbidden);

    const response = await request(app).get('/api/reports/77/status');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('REPORT_SCOPE_FORBIDDEN');
  });

  it('hides compatibility job status from non-owner callers', async () => {
    mockAuthenticatedUser = {
      id: 50,
      role: 'ADMIN',
      role_type: 'ADMIN',
      runtime_role: 'ADMIN',
      facility_id: 203,
    };
    mockReportService.getReportStatus.mockResolvedValue({
      id: 701,
      status: 'completed',
      generated_by: 99,
    });

    const response = await request(app).get('/api/reports/job/701/status');

    expect(response.status).toBe(404);
    expect(mockReportService.getReportStatus).toHaveBeenCalledTimes(1);
  });

  it('propagates empty dataset error semantics from service', async () => {
    const emptyError = new Error(
      'No data found for selected filters. Please adjust filter criteria and try again.',
    );
    emptyError.statusCode = 400;
    emptyError.code = 'REPORT_EMPTY_DATASET';
    mockReportService.generateReport.mockRejectedValue(emptyError);

    const response = await request(app).post('/api/reports/generate').send({
      type: 'vaccination',
      format: 'csv',
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/no data found/i);
    expect(response.body.error).toBe('REPORT_EMPTY_DATASET');
  });

  it('returns streamed file download with canonical headers', async () => {
    mockReportService.downloadReport.mockResolvedValue({
      path: tempFile,
      filename: 'vaccination-report-2026-03-08-00-00-00.csv',
      mimeType: 'text/csv',
      fileSize: Buffer.byteLength(downloadFixtureContent, 'utf8'),
    });

    const response = await request(app)
      .get('/api/reports/77/download')
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.headers['content-disposition']).toContain(
      'filename="vaccination-report-2026-03-08-00-00-00.csv"',
    );
    expect(response.body.toString('utf8')).toContain('id,name');
    expect(mockReportService.downloadReport).toHaveBeenCalledWith(77, {
      scopeIds: [],
    });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      'UPDATE reports SET download_count = download_count + 1 WHERE id = $1',
      [77],
    );
  });
});
