const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken: auth } = require('../middleware/auth');
const { checkPermission } = require('../middleware/role-based-access');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

// Root route - return API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Enhanced Reports API',
    endpoints: [
      '/vaccination-coverage',
      '/immunization-schedule',
      '/inventory-status',
      '/appointment-summary',
      '/growth-tracking',
      '/custom',
    ],
  });
});

/**
 * @route   GET /api/reports/vaccination-coverage
 * @desc    Get vaccination coverage report
 * @access  Private (Admin, Doctor, Nurse)
 */
router.get(
  '/vaccination-coverage',
  auth,
  checkPermission(['admin', 'doctor', 'nurse', 'staff']),
  async (req, res) => {
    try {
      const { startDate, endDate, format = 'json' } = req.query;

      const query = `
      SELECT
        v.name as vaccine_name,
        v.doses_required,
        COUNT(DISTINCT ir.patient_id) as infants_registered,
        COUNT(ir.id) as doses_administered,
        COUNT(DISTINCT CASE WHEN ir.status = 'completed' THEN ir.patient_id END) as infants_completed,
        ROUND(COUNT(DISTINCT CASE WHEN ir.status = 'completed' THEN ir.patient_id END) * 100.0 / NULLIF(COUNT(DISTINCT ir.patient_id), 0), 2) as coverage_percentage
      FROM vaccines v
      LEFT JOIN immunization_records ir ON v.id = ir.vaccine_id AND ir.is_active = true
        AND ($1::date IS NULL OR ir.admin_date >= $1)
        AND ($2::date IS NULL OR ir.admin_date <= $2)
      WHERE v.is_active = true
      GROUP BY v.id, v.name, v.doses_required
      ORDER BY v.name
    `;

      const result = await pool.query(query, [startDate || null, endDate || null]);

      if (format === 'pdf') {
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="vaccination-coverage-report.pdf"',
        );

        doc.pipe(res);
        doc.fontSize(20).text('Vaccination Coverage Report', 100, 100);
        doc.fontSize(12).text(`Generated: ${new Date().toLocaleDateString()}`, 100, 130);

        let y = 180;
        result.rows.forEach((row) => {
          doc
            .fontSize(10)
            .text(
              `${row.vaccine_name}: ${row.coverage_percentage}% coverage (${row.doses_administered} doses)`,
              100,
              y,
            );
          y += 20;
        });

        doc.end();
      } else if (format === 'excel') {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Vaccination Coverage');

        worksheet.columns = [
          { header: 'Vaccine Name', key: 'vaccine_name', width: 30 },
          { header: 'Doses Required', key: 'doses_required', width: 15 },
          { header: 'Infants Registered', key: 'infants_registered', width: 18 },
          { header: 'Doses Administered', key: 'doses_administered', width: 18 },
          { header: 'Infants Completed', key: 'infants_completed', width: 18 },
          { header: 'Coverage %', key: 'coverage_percentage', width: 12 },
        ];

        result.rows.forEach((row) => worksheet.addRow(row));

        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="vaccination-coverage-report.xlsx"',
        );

        await workbook.xlsx.write(res);
        res.end();
      } else {
        res.json({
          success: true,
          data: result.rows,
          meta: {
            generatedAt: new Date(),
            period: { startDate, endDate },
          },
        });
      }
    } catch (error) {
      console.error('Error generating vaccination coverage report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate report',
        message: error.message,
      });
    }
  },
);

/**
 * @route   GET /api/reports/immunization-schedule
 * @desc    Get immunization schedule compliance report
 * @access  Private (Admin, Doctor, Nurse)
 */
router.get(
  '/immunization-schedule',
  auth,
  checkPermission(['admin', 'doctor', 'nurse', 'staff']),
  async (req, res) => {
    try {
      const { infantId, format = 'json' } = req.query;

      let query = `
      SELECT
        p.first_name || ' ' || p.last_name as infant_name,
        p.dob as date_of_birth,
        g.name as guardian_name,
        v.name as vaccine_name,
        ir.dose_no as dose_number,
        ir.next_due_date as scheduled_date,
        ir.status,
        ir.admin_date as administered_date,
        CASE
          WHEN ir.admin_date IS NOT NULL THEN 'Completed'
          WHEN ir.next_due_date < CURRENT_DATE THEN 'Overdue'
          WHEN ir.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'Due Soon'
          ELSE 'Upcoming'
        END as compliance_status
      FROM patients p
      LEFT JOIN guardians g ON p.guardian_id = g.id
      JOIN immunization_records ir ON p.id = ir.patient_id AND ir.is_active = true
      JOIN vaccines v ON ir.vaccine_id = v.id
      WHERE p.is_active = true
    `;

      const params = [];
      if (infantId) {
        query += ' AND p.id = $1';
        params.push(infantId);
      }

      query += ' ORDER BY p.first_name, ir.next_due_date';

      const result = await pool.query(query, params);

      // Calculate compliance statistics
      const stats = {
        total: result.rows.length,
        completed: result.rows.filter((r) => r.compliance_status === 'Completed').length,
        overdue: result.rows.filter((r) => r.compliance_status === 'Overdue').length,
        dueSoon: result.rows.filter((r) => r.compliance_status === 'Due Soon').length,
        upcoming: result.rows.filter((r) => r.compliance_status === 'Upcoming').length,
      };

      if (format === 'json') {
        res.json({
          success: true,
          data: result.rows,
          statistics: stats,
          meta: { generatedAt: new Date() },
        });
      } else {
        // Handle PDF/Excel export similar to above
        res.json({ success: true, data: result.rows, statistics: stats });
      }
    } catch (error) {
      console.error('Error generating immunization schedule report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate report',
        message: error.message,
      });
    }
  },
);

/**
 * @route   GET /api/reports/inventory-status
 * @desc    Get inventory status report
 * @access  Private (Admin, Doctor, Nurse)
 */
router.get(
  '/inventory-status',
  auth,
  checkPermission(['admin', 'doctor', 'nurse', 'staff']),
  async (req, res) => {
    try {
      const query = `
      SELECT
        v.name as vaccine_name,
        vb.lot_no as batch_number,
        vb.qty_current,
        10 as minimum_stock,
        vb.expiry_date,
        s.name as supplier_name,
        vb.created_at as received_date,
        vb.status,
        CASE
          WHEN vb.qty_current <= 10 THEN 'Low Stock'
          WHEN vb.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Expiring Soon'
          ELSE 'Normal'
        END as stock_status
      FROM vaccine_batches vb
      JOIN vaccines v ON vb.vaccine_id = v.id
      LEFT JOIN suppliers s ON vb.supplier_id = s.id
      WHERE vb.is_active = true
      ORDER BY v.name, vb.expiry_date
    `;

      const result = await pool.query(query);

      const stats = {
        totalBatches: result.rows.length,
        lowStock: result.rows.filter((r) => r.stock_status === 'Low Stock').length,
        expiringSoon: result.rows.filter((r) => r.stock_status === 'Expiring Soon').length,
        normal: result.rows.filter((r) => r.stock_status === 'Normal').length,
      };

      res.json({
        success: true,
        data: result.rows,
        statistics: stats,
        meta: { generatedAt: new Date() },
      });
    } catch (error) {
      console.error('Error generating inventory status report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate report',
        message: error.message,
      });
    }
  },
);

/**
 * @route   GET /api/reports/appointment-summary
 * @desc    Get appointment summary report
 * @access  Private (Admin, Doctor, Nurse)
 */
router.get(
  '/appointment-summary',
  auth,
  checkPermission(['admin', 'doctor', 'nurse', 'staff']),
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const query = `
      SELECT
        DATE(a.appointment_date) as date,
        COUNT(*) as total_appointments,
        COUNT(CASE WHEN a.status = 'attended' THEN 1 END) as completed,
        COUNT(CASE WHEN a.status = 'cancelled' THEN 1 END) as cancelled,
        COUNT(CASE WHEN a.status = 'no_show' THEN 1 END) as no_shows,
        COUNT(CASE WHEN a.status IN ('scheduled', 'pending', 'confirmed') THEN 1 END) as scheduled,
        a.appointment_type
      FROM appointments a
      WHERE ($1::date IS NULL OR a.appointment_date >= $1)
        AND ($2::date IS NULL OR a.appointment_date <= $2)
      GROUP BY DATE(a.appointment_date), a.appointment_type
      ORDER BY date DESC
    `;

      const result = await pool.query(query, [startDate || null, endDate || null]);

      // Calculate summary statistics
      const summary = {
        total: result.rows.reduce((acc, row) => acc + parseInt(row.total_appointments), 0),
        completed: result.rows.reduce((acc, row) => acc + parseInt(row.completed), 0),
        cancelled: result.rows.reduce((acc, row) => acc + parseInt(row.cancelled), 0),
        noShows: result.rows.reduce((acc, row) => acc + parseInt(row.no_shows), 0),
        scheduled: result.rows.reduce((acc, row) => acc + parseInt(row.scheduled), 0),
      };

      res.json({
        success: true,
        data: result.rows,
        summary,
        meta: {
          generatedAt: new Date(),
          period: { startDate, endDate },
        },
      });
    } catch (error) {
      console.error('Error generating appointment summary report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate report',
        message: error.message,
      });
    }
  },
);

/**
 * @route   GET /api/reports/growth-tracking
 * @desc    Get infant growth tracking report
 * @access  Private (Admin, Doctor, Nurse)
 */
router.get(
  '/growth-tracking',
  auth,
  checkPermission(['admin', 'doctor', 'nurse', 'staff']),
  async (req, res) => {
    try {
      const { infantId, startDate, endDate } = req.query;

      let query = `
      SELECT
        p.first_name || ' ' || p.last_name as infant_name,
        p.dob as date_of_birth,
        g.name as guardian_name,
        gr.measurement_date,
        gr.weight_kg,
        gr.height_cm,
        gr.head_circumference_cm,
        gr.percentile_weight,
        gr.percentile_height,
        gr.notes
      FROM growth_records gr
      JOIN patients p ON gr.patient_id = p.id
      LEFT JOIN guardians g ON p.guardian_id = g.id
      WHERE p.is_active = true
    `;

      const params = [];
      let paramCount = 0;

      if (infantId) {
        query += ` AND p.id = ${++paramCount}`;
        params.push(infantId);
      }

      if (startDate) {
        query += ` AND gr.measurement_date >= ${++paramCount}`;
        params.push(startDate);
      }

      if (endDate) {
        query += ` AND gr.measurement_date <= ${++paramCount}`;
        params.push(endDate);
      }

      query += ' ORDER BY p.first_name, gr.measurement_date DESC';

      const result = await pool.query(query, params);

      res.json({
        success: true,
        data: result.rows,
        meta: {
          generatedAt: new Date(),
          recordCount: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Error generating growth tracking report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate report',
        message: error.message,
      });
    }
  },
);

/**
 * @route   POST /api/reports/custom
 * @desc    Generate custom report
 * @access  Private (Admin only)
 */
router.post('/custom', auth, checkPermission(['admin']), async (req, res) => {
  try {
    const { reportType, filters, columns } = req.body;

    let query;
    const params = [];

    switch (reportType) {
    case 'vaccinations':
      query = `
          SELECT ${columns.join(', ')}
          FROM immunization_records ir
          JOIN patients p ON ir.patient_id = p.id
          JOIN vaccines v ON ir.vaccine_id = v.id
          WHERE ir.is_active = true
        `;
      break;
    case 'appointments':
      query = `
          SELECT ${columns.join(', ')}
          FROM appointments a
          JOIN patients p ON a.infant_id = p.id
          WHERE a.is_active = true
        `;
      break;
    case 'infants':
      query = `
          SELECT ${columns.join(', ')}
          FROM patients p
          LEFT JOIN guardians g ON p.guardian_id = g.id
          WHERE p.is_active = true
        `;
      break;
    default:
      return res.status(400).json({
        success: false,
        error: 'Invalid report type',
      });
    }

    // Apply filters
    if (filters) {
      Object.entries(filters).forEach(([key, value], index) => {
        query += ` AND ${key} = $${index + 1}`;
        params.push(value);
      });
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      meta: {
        reportType,
        generatedAt: new Date(),
        recordCount: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Error generating custom report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate custom report',
      message: error.message,
    });
  }
});

module.exports = router;
