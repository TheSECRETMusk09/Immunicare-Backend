const ExcelJS = require('exceljs');

const ReportService = require('../services/reportService');

describe('ReportService export rendering', () => {
  let service;

  beforeEach(() => {
    service = new ReportService({
      pool: { query: jest.fn() },
    });
  });

  it('builds branded Excel worksheets for non-inventory reports with portrait layout defaults', async () => {
    const buffer = await service.buildExcelBuffer({
      reportType: 'vaccination',
      title: 'Vaccination Report',
      generatedAt: new Date('2026-03-18T12:30:00.000Z'),
      filters: { startDate: '2026-03-01', endDate: '2026-03-18' },
      headers: ['Child Name', 'Vaccine', 'Dose', 'Date Administered', 'Next Due Date', 'Status'],
      rows: [
        {
          child_name: 'Sample Child',
          vaccine: 'BCG',
          dose: 1,
          date_administered: '2026-03-02',
          next_due_date: '2026-04-02',
          status: 'completed',
        },
      ],
      summary: { totalRows: 1, completed: 1 },
      sections: [],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    expect(worksheet.getCell('A1').value).toBe('IMMUNICARE HEALTH CENTER');
    expect(worksheet.getCell('A3').value).toBe('VACCINATION REPORT');
    expect(worksheet.getCell('A4').value).toBe('Report Period: March 01, 2026 to March 18, 2026');
    expect(worksheet.getRow(8).getCell(1).value).toBe('Child Name');
    expect(worksheet.pageSetup.orientation).toBe('portrait');
    expect(worksheet.pageSetup.printTitlesRow).toBe('1:8');
    expect(worksheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 8 });
  });

  it('switches branded Excel worksheets to landscape only when the table is too dense for portrait', async () => {
    const buffer = await service.buildExcelBuffer({
      reportType: 'guardian',
      title: 'Guardian Report',
      generatedAt: new Date('2026-03-18T12:30:00.000Z'),
      filters: { startDate: '2026-03-01', endDate: '2026-03-18' },
      headers: ['Name', 'Phone', 'Email', 'Relationship', 'Infants', 'Address'],
      rows: [
        {
          name: 'Guardian One',
          phone: '09171234567',
          email: 'guardian.one@example.com',
          relationship: 'Mother',
          infants: 2,
          address:
            'Blk 10 Lot 12 Phase 5, San Nicolas Extension, Pasig City, near the covered court',
        },
      ],
      summary: { totalRows: 1, active: 1 },
      sections: [],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    expect(worksheet.pageSetup.orientation).toBe('landscape');
  });

  it('keeps consolidated inventory worksheets on the legacy layout while branding other worksheets', async () => {
    const buffer = await service.buildExcelBuffer({
      reportType: 'consolidated',
      title: 'Consolidated Report',
      generatedAt: new Date('2026-03-18T12:30:00.000Z'),
      filters: { startDate: '2026-03-01', endDate: '2026-03-18' },
      headers: [],
      rows: [],
      summary: { sections: 2, totalRows: 3, sectionNames: ['Vaccination Report', 'Inventory Report'] },
      sections: [
        {
          sectionTitle: 'Vaccination Report',
          reportType: 'vaccination',
          headers: ['Child Name', 'Vaccine', 'Dose', 'Date Administered', 'Next Due Date', 'Status'],
          rows: [
            {
              child_name: 'Sample Child',
              vaccine: 'BCG',
              dose: 1,
              date_administered: '2026-03-02',
              next_due_date: '2026-04-02',
              status: 'completed',
            },
          ],
        },
        {
          sectionTitle: 'Inventory Report',
          reportType: 'inventory',
          headers: [
            'A',
            'Items',
            'Beginning Balance',
            'Received',
            'Lot Batch Number',
            'Stock Movement In Out',
            'Expired Wasted',
            'Total Available',
            'Issued',
            'Stock On Hand',
          ],
          rows: [
            {
              a: 1,
              items: 'BCG',
              beginning_balance: 20,
              received: 10,
              lot_batch_number: 'LOT-100',
              transferred_in: 2,
              transferred_out: 1,
              expired_wasted: 0,
              total_available: 30,
              issued: 5,
              stock_on_hand: 26,
            },
          ],
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const summarySheet = workbook.getWorksheet('Summary');
    const vaccinationSheet = workbook.getWorksheet('Vaccination Report');
    const inventorySheet = workbook.getWorksheet('Inventory Report');

    expect(summarySheet.getCell('A1').value).toBe('IMMUNICARE HEALTH CENTER');
    expect(vaccinationSheet.getCell('A1').value).toBe('IMMUNICARE HEALTH CENTER');
    expect(inventorySheet.getCell('A1').value).toBe('Inventory Report');
    expect(inventorySheet.getCell('A3').value).toBeNull();
  });

  it('builds branded PDFs for non-inventory reports and preserves legacy inventory output inside consolidated reports', async () => {
    const brandedSpy = jest.spyOn(service, 'writeBrandedPdfSection');
    const legacySpy = jest.spyOn(service, 'writeLegacyPdfSection');

    const buffer = await service.buildPdfBuffer({
      reportType: 'consolidated',
      title: 'Consolidated Report',
      generatedAt: new Date('2026-03-18T12:30:00.000Z'),
      filters: { startDate: '2026-03-01', endDate: '2026-03-18' },
      headers: [],
      rows: [],
      summary: { sections: 2, totalRows: 2, sectionNames: ['Vaccination Report', 'Inventory Report'] },
      sections: [
        {
          sectionTitle: 'Vaccination Report',
          reportType: 'vaccination',
          headers: ['Child Name', 'Vaccine', 'Dose', 'Date Administered', 'Next Due Date', 'Status'],
          rows: [
            {
              child_name: 'Sample Child',
              vaccine: 'BCG',
              dose: 1,
              date_administered: '2026-03-02',
              next_due_date: '2026-04-02',
              status: 'completed',
            },
          ],
        },
        {
          sectionTitle: 'Inventory Report',
          reportType: 'inventory',
          headers: [
            'A',
            'Items',
            'Beginning Balance',
            'Received',
            'Lot Batch Number',
            'Stock Movement In Out',
            'Expired Wasted',
            'Total Available',
            'Issued',
            'Stock On Hand',
          ],
          rows: [
            {
              a: 1,
              items: 'BCG',
              beginning_balance: 20,
              received: 10,
              lot_batch_number: 'LOT-100',
              transferred_in: 2,
              transferred_out: 1,
              expired_wasted: 0,
              total_available: 30,
              issued: 5,
              stock_on_hand: 26,
            },
          ],
        },
      ],
    });

    expect(buffer.toString('latin1')).toContain('%PDF-1.3');
    expect(brandedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Consolidated Report Summary',
        reportType: 'summary',
      }),
    );
    expect(brandedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Vaccination Report',
        reportType: 'vaccination',
      }),
    );
    expect(legacySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Inventory Report',
        reportType: 'inventory',
      }),
    );
  });
});
