const fs = require('fs').promises;
const path = require('path');

const ReportService = require('../services/reportService');

describe('ReportService generation + download contract', () => {
  let tempReportDir;
  let service;
  let dbMock;

  const infoSchemaTableRows = (...tableNames) =>
    tableNames.map((table_name) => ({ table_name }));

  beforeEach(async () => {
    dbMock = {
      query: jest.fn(),
    };

    tempReportDir = path.join(__dirname, '..', 'uploads', 'reports-test');
    await fs.rm(tempReportDir, { recursive: true, force: true });
    await fs.mkdir(tempReportDir, { recursive: true });

    service = new ReportService({
      pool: dbMock,
      reportDir: tempReportDir,
    });
  });

  afterEach(async () => {
    await fs.rm(tempReportDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const setupVaccinationSchemaMocks = () => {
    dbMock.query.mockImplementation(async (queryText) => {
      if (/information_schema\.tables/i.test(queryText)) {
        return {
          rows: infoSchemaTableRows(
            'patients',
            'users',
            'roles',
            'clinics',
            'appointments',
            'vaccine_inventory',
            'reports',
          ),
        };
      }

      if (/information_schema\.columns/i.test(queryText)) {
        if (/table_name = 'immunization_records'/.test(queryText)) {
          return { rows: [{ '?column?': 1 }] };
        }
        if (/table_name = 'patients'/.test(queryText)) {
          return { rows: [{ '?column?': 1 }] };
        }
        if (/table_name = 'reports'/.test(queryText)) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      }

      if (/FROM\s+immunization_records\s+ir/i.test(queryText)) {
        return {
          rows: [
            {
              child_name: 'Test Child',
              vaccine: 'BCG',
              dose: 1,
              date_administered: '2026-03-01',
              next_due_date: '2026-04-01',
              status: 'completed',
            },
          ],
        };
      }

      if (/INSERT\s+INTO\s+reports/i.test(queryText)) {
        const currentReportFiles = await fs.readdir(tempReportDir);
        const generatedName =
          currentReportFiles.find((name) =>
            /^vaccination-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/.test(name),
          ) || 'vaccination-report-2026-03-08-00-00-00.csv';

        return {
          rows: [
            {
              id: 111,
              type: 'vaccination',
              title: 'Vaccination Report',
              description: 'Comprehensive vaccination administration and compliance report',
              parameters: {},
              file_path: path.join(tempReportDir, generatedName),
              file_format: 'csv',
              file_size: 128,
              generated_by: 1,
              date_generated: '2026-03-08T00:00:00.000Z',
              status: 'completed',
              download_count: 0,
            },
          ],
        };
      }

      if (/SELECT[\s\S]+file_path[\s\S]+status[\s\S]+file_format[\s\S]+FROM\s+reports/i.test(queryText)) {
        const currentReportFiles = await fs.readdir(tempReportDir);
        const generatedName =
          currentReportFiles.find((name) =>
            /^vaccination-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/.test(name),
          ) || 'vaccination-report-2026-03-08-00-00-00.csv';

        return {
          rows: [
            {
              id: 111,
              type: 'vaccination',
              title: 'Vaccination Report',
              file_path: path.join(tempReportDir, generatedName),
              file_format: 'csv',
              status: 'completed',
              parameters: {},
              generated_by: 1,
              date_generated: '2026-03-08T00:00:00.000Z',
            },
          ],
        };
      }

      return { rows: [] };
    });
  };

  it('rejects disallowed JSON format during generation', async () => {
    await expect(
      service.generateReport('vaccination', {}, 'json', 1),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'REPORT_INVALID_FORMAT',
    });
  });

  it('returns explicit empty dataset validation error', async () => {
    dbMock.query.mockImplementation(async (queryText) => {
      if (/information_schema\.tables/i.test(queryText)) {
        return {
          rows: infoSchemaTableRows(
            'patients',
            'users',
            'roles',
            'clinics',
            'appointments',
            'vaccine_inventory',
            'reports',
          ),
        };
      }

      if (/information_schema\.columns/i.test(queryText)) {
        return { rows: [{ '?column?': 1 }] };
      }

      if (/FROM\s+immunization_records\s+ir/i.test(queryText)) {
        return { rows: [] };
      }

      return { rows: [] };
    });

    await expect(
      service.generateReport('vaccination', {}, 'csv', 1),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'REPORT_EMPTY_DATASET',
    });
  });

  it('generates a CSV report with canonical filename and metadata', async () => {
    setupVaccinationSchemaMocks();

    const result = await service.generateReport('vaccination', {}, 'csv', 1);

    expect(result).toBeDefined();
    expect(result.file_format).toBe('csv');
    expect(result.status).toBe('completed');
    expect(result.file_path).toMatch(/vaccination-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);

    const generatedFilePath = result.file_path;
    const fileContent = await fs.readFile(generatedFilePath, 'utf8');
    expect(fileContent).toContain('Vaccination Report');
    expect(fileContent).toContain('Child Name');
    expect(fileContent).toContain('Test Child');
  });

  it('downloadReport regenerates a completed report when the legacy file is missing', async () => {
    dbMock.query.mockImplementation(async (queryText) => {
      if (/SELECT[\s\S]+file_path[\s\S]+status[\s\S]+file_format[\s\S]+FROM\s+reports/i.test(queryText)) {
        return {
          rows: [
            {
              id: 99,
              type: 'vaccination',
              title: 'Vaccination Report',
              file_path: '/reports/missing-report.csv',
              file_format: 'csv',
              status: 'completed',
              parameters: { month: '2026-03' },
              generated_by: 1,
              date_generated: '2026-03-08T00:00:00.000Z',
            },
          ],
        };
      }

      if (/UPDATE\s+reports\s+SET/i.test(queryText)) {
        return { rows: [] };
      }

      return { rows: [] };
    });

    jest.spyOn(service, 'getReportData').mockResolvedValue({
      reportTitle: 'Vaccination Report',
      columns: ['Child Name'],
      rows: [{ child_name: 'Test Child' }],
    });
    jest.spyOn(service, 'buildReportBuffer').mockResolvedValue(Buffer.from('report'));

    const downloadMeta = await service.downloadReport(99);

    expect(downloadMeta).toBeDefined();
    expect(downloadMeta.path).toContain(path.join('uploads', 'reports-test', 'missing-report.csv'));
    expect(downloadMeta.filename).toBe('missing-report.csv');
    expect(downloadMeta.mimeType).toBe('text/csv');
    expect(downloadMeta.fileSize).toBe(6);
    await expect(fs.access(downloadMeta.path)).resolves.toBeUndefined();
  });

  it('downloadReport returns stream metadata for existing file', async () => {
    setupVaccinationSchemaMocks();

    const generatedReport = await service.generateReport('vaccination', {}, 'csv', 1);
    const downloadMeta = await service.downloadReport(generatedReport.id || 111);

    expect(downloadMeta).toBeDefined();
    expect(downloadMeta.path).toMatch(/vaccination-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
    expect(downloadMeta.filename).toMatch(/vaccination-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
    expect(downloadMeta.mimeType).toBe('text/csv');
    expect(downloadMeta.fileSize).toBeGreaterThan(0);
  });

  it('creates a persisted completed history row for every supported report type', async () => {
    const supportedTypes = service.getReportTypes();
    let nextId = 200;

    jest.spyOn(service, 'getReportData').mockImplementation(async (reportType) => {
      if (reportType === 'consolidated') {
        return {
          reportType,
          title: 'Consolidated Report',
          description: 'All-in-one comprehensive report',
          generatedAt: new Date('2026-03-08T00:00:00.000Z'),
          filters: {},
          rows: [],
          headers: [],
          sections: [
            {
              reportType: 'vaccination',
              sectionTitle: 'Vaccination Report',
              headers: service.getHeadersForReportType('vaccination'),
              rows: [{ child_name: 'Test Child', vaccine: 'BCG', dose: 1, status: 'completed' }],
            },
          ],
          summary: { sections: 1, totalRows: 1 },
        };
      }

      return {
        reportType,
        title: service.getReportTitle(reportType),
        description: service.getReportDescription(reportType),
        generatedAt: new Date('2026-03-08T00:00:00.000Z'),
        filters: {},
        headers: service.getHeadersForReportType(reportType),
        rows: [{ child_name: 'Test Child', vaccine: 'BCG', dose: 1, status: 'completed' }],
        sections: [],
        summary: { totalRows: 1 },
      };
    });

    dbMock.query.mockImplementation(async (queryText, params = []) => {
      if (/information_schema\.columns/i.test(queryText)) {
        return { rows: [{ exists: 1 }] };
      }

      if (/INSERT\s+INTO\s+reports/i.test(queryText)) {
        nextId += 1;
        return {
          rows: [
            {
              id: nextId,
              type: params[0],
              title: params[1],
              parameters: params[3],
              file_path: params[4],
              file_format: params[5],
              status: params[6],
              generated_by: params[7],
              date_generated: params[8],
              file_size: params[9],
              download_count: 0,
            },
          ],
        };
      }

      return { rows: [] };
    });

    for (const reportType of supportedTypes) {
      const result = await service.generateReport(
        reportType,
        { scopeIds: [203], facilityId: 203 },
        'csv',
        1,
      );

      expect(result).toMatchObject({
        type: reportType,
        file_format: 'csv',
        status: 'completed',
      });
      expect(result.parameters).toMatchObject({
        facilityId: 203,
        scopeIds: [203],
      });
    }

    const insertCalls = dbMock.query.mock.calls.filter(([queryText]) =>
      /INSERT\s+INTO\s+reports/i.test(queryText),
    );
    expect(insertCalls).toHaveLength(supportedTypes.length);
  });

  it('getReportHistory excludes soft-deleted reports and returns a real total', async () => {
    dbMock.query.mockImplementation(async (queryText, params = []) => {
      if (/information_schema\.columns/i.test(queryText)) {
        if (params[1] === 'is_active' || params[1] === 'file_size') {
          return { rows: [{ exists: 1 }] };
        }
        return { rows: [] };
      }

      if (/SELECT COUNT\(\*\)::int AS total/i.test(queryText)) {
        expect(queryText).toContain('COALESCE(r.is_active, true) = true');
        return { rows: [{ total: 7 }] };
      }

      if (/FROM reports r/i.test(queryText)) {
        expect(queryText).toContain('COALESCE(r.is_active, true) = true');
        return {
          rows: [
            {
              id: 1,
              type: 'vaccination',
              title: 'Vaccination Report',
              file_format: 'pdf',
              status: 'completed',
              file_size: 1024,
            },
          ],
        };
      }

      return { rows: [] };
    });

    const history = await service.getReportHistory({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      scopeIds: [203],
      limit: 5,
      offset: 0,
    });

    expect(history.total).toBe(7);
    expect(history.rows).toHaveLength(1);
  });

  it('downloadReport returns 404 for soft-deleted reports', async () => {
    dbMock.query.mockImplementation(async (queryText, params = []) => {
      if (/information_schema\.columns/i.test(queryText)) {
        if (['is_active', 'file_size'].includes(params[1])) {
          return { rows: [{ exists: 1 }] };
        }
        return { rows: [] };
      }

      if (/FROM reports/i.test(queryText)) {
        return {
          rows: [
            {
              id: 99,
              type: 'vaccination',
              title: 'Vaccination Report',
              file_path: '/reports/deleted-report.csv',
              file_format: 'csv',
              status: 'completed',
              parameters: { facilityId: 203, scopeIds: [203] },
              generated_by: 1,
              date_generated: '2026-03-08T00:00:00.000Z',
              is_active: false,
            },
          ],
        };
      }

      return { rows: [] };
    });

    await expect(service.downloadReport(99, { scopeIds: [203] })).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPORT_NOT_FOUND',
    });
  });

  it('getReportStatus returns 403 when the persisted report scope does not match', async () => {
    dbMock.query.mockImplementation(async (queryText, params = []) => {
      if (/information_schema\.columns/i.test(queryText)) {
        if (['is_active', 'file_size'].includes(params[1])) {
          return { rows: [{ exists: 1 }] };
        }
        return { rows: [] };
      }

      if (/FROM reports/i.test(queryText)) {
        return {
          rows: [
            {
              id: 99,
              type: 'vaccination',
              title: 'Vaccination Report',
              status: 'completed',
              file_format: 'pdf',
              parameters: { facilityId: 203, scopeIds: [203] },
              generated_by: 1,
              date_generated: '2026-03-08T00:00:00.000Z',
              is_active: true,
            },
          ],
        };
      }

      return { rows: [] };
    });

    await expect(service.getReportStatus(99, { scopeIds: [999] })).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPORT_SCOPE_FORBIDDEN',
    });
  });
});
