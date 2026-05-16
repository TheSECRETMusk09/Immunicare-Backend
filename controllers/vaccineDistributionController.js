/**
 * Vaccine Distribution Controller
 * City → Barangay Distribution Flow
 * Barangay → City Feedback Loop
 * Excel-based Digitalization
 */

const db = require('../db');
const ExcelJS = require('exceljs');
const { validateApprovedVaccineName } = require('../utils/approvedVaccines');

// Helper function to generate unique numbers
const generateRequestNumber = () => {
  return (
    'REQ-' +
    Date.now().toString(36).toUpperCase() +
    '-' +
    Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')
  );
};

const generateDistributionNumber = () => {
  return (
    'DIST-' +
    Date.now().toString(36).toUpperCase() +
    '-' +
    Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')
  );
};

const generateReportNumber = (type) => {
  return (
    'RPT-' +
    type.toUpperCase().substring(0, 3) +
    '-' +
    Date.now().toString(36).toUpperCase() +
    '-' +
    Math.floor(Math.random() * 100)
      .toString()
      .padStart(2, '0')
  );
};

// Distribution requests (barangay to city)

/**
 * Create Distribution Request
 * POST /api/distribution/requests
 */
exports.createDistributionRequest = async (req, res) => {
  try {
    const { vaccineId, requestedQuantity, urgencyLevel, reasonForRequest, targetDeliveryDate } =
      req.body;

    const clinicId = req.user.clinic_id;
    const userId = req.user.id;

    // Get clinic/barangay name
    const clinicResult = await db.query('SELECT name FROM clinics WHERE id = $1', [clinicId]);

    const query = `
            INSERT INTO vaccine_distribution_requests (
                request_number,
                requesting_barangay_id,
                requesting_barangay_name,
                vaccine_id,
                requested_quantity,
                urgency_level,
                reason_for_request,
                target_delivery_date,
                requested_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `;

    const values = [
      generateRequestNumber(),
      clinicId,
      clinicResult.rows[0]?.name || 'Unknown',
      vaccineId,
      requestedQuantity,
      urgencyLevel || 'normal',
      reasonForRequest,
      targetDeliveryDate,
      userId,
    ];

    const result = await db.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Distribution request created successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Create distribution request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create distribution request',
    });
  }
};

/**
 * Get Distribution Requests
 * GET /api/distribution/requests
 */
exports.getDistributionRequests = async (req, res) => {
  try {
    const { status, urgency, vaccineId, dateFrom, dateTo } = req.query;
    const clinicId = req.user.clinic_id;
    const userRole = req.user.role;

    // If healthcare worker, only see own requests
    // If admin/city, see all requests
    let query = `
            SELECT
                dr.*,
                v.name as vaccine_name,
                v.code as vaccine_code
            FROM vaccine_distribution_requests dr
            JOIN vaccines v ON dr.vaccine_id = v.id
            WHERE 1=1
        `;

    const params = [];
    let paramIndex = 1;

    // Filter by role
    if (['healthcare_worker', 'nurse', 'midwife'].includes(userRole)) {
      query += ` AND dr.requesting_barangay_id = $${paramIndex}`;
      params.push(clinicId);
      paramIndex++;
    }

    if (status) {
      query += ` AND dr.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (urgency) {
      query += ` AND dr.urgency_level = $${paramIndex}`;
      params.push(urgency);
      paramIndex++;
    }

    if (vaccineId) {
      query += ` AND dr.vaccine_id = $${paramIndex}`;
      params.push(vaccineId);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND dr.created_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND dr.created_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ' ORDER BY dr.priority DESC, dr.created_at DESC';

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get distribution requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch distribution requests',
    });
  }
};

/**
 * Approve/Reject Distribution Request (City Level)
 * PUT /api/distribution/requests/:id/approve
 */
exports.approveDistributionRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approvalNotes } = req.body;
    const userId = req.user.id;

    if (!['approved', 'rejected', 'partial'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be approved, rejected, or partial',
      });
    }

    const query = `
            UPDATE vaccine_distribution_requests
            SET
                status = $1,
                approved_by = $2,
                approved_at = CURRENT_TIMESTAMP,
                approval_notes = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *
        `;

    const values = [status, userId, approvalNotes, id];

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Distribution request not found',
      });
    }

    res.json({
      success: true,
      message: `Request ${status} successfully`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Approve distribution request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process request',
    });
  }
};

// Distributions (city to barangay)

/**
 * Create Distribution (Dispatch vaccines to BHC)
 * POST /api/distribution/dispatch
 */
exports.createDistribution = async (req, res) => {
  try {
    const {
      destinationBarangayId,
      vaccineId,
      batchNumber,
      quantity,
      expiryDate,
      storageRequirement,
      temperatureDuringTransport,
      vehicleNumber,
      courierName,
      distributionRequestId,
    } = req.body;

    const sourceClinicId = req.user.clinic_id;
    const userId = req.user.id;

    // Get destination barangay name
    const destResult = await db.query('SELECT name FROM clinics WHERE id = $1', [
      destinationBarangayId,
    ]);

    // Get source clinic name
    const sourceResult = await db.query('SELECT name FROM clinics WHERE id = $1', [sourceClinicId]);

    const query = `
            INSERT INTO vaccine_distributions (
                distribution_number,
                source_clinic_id,
                source_clinic_name,
                destination_barangay_id,
                destination_barangay_name,
                vaccine_id,
                batch_number,
                quantity_distributed,
                expiry_date,
                storage_requirement,
                temperature_during_transport,
                vehicle_number,
                courier_name,
                dispatched_by,
                dispatched_at,
                status,
                distribution_request_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, 'in_transit', $15)
            RETURNING *
        `;

    const values = [
      generateDistributionNumber(),
      sourceClinicId,
      sourceResult.rows[0]?.name || 'City Health Office',
      destinationBarangayId,
      destResult.rows[0]?.name || 'Unknown',
      vaccineId,
      batchNumber,
      quantity,
      expiryDate,
      storageRequirement,
      temperatureDuringTransport,
      vehicleNumber,
      courierName,
      userId,
      distributionRequestId,
    ];

    const result = await db.query(query, values);

    // Create transaction record
    await db.query(
      `
            INSERT INTO vaccine_inventory_transactions (
                transaction_type, vaccine_id, clinic_id, quantity_change,
                quantity_before, quantity_after, reference_type, reference_id,
                source_type, destination_type, performed_by
            )
            SELECT
                'TRANSFER_OUT', $1, $2, -$3,
                (SELECT COALESCE(SUM(current_stock), 0) FROM vaccine_inventory WHERE clinic_id = $2),
                (SELECT COALESCE(SUM(current_stock), 0) - $3 FROM vaccine_inventory WHERE clinic_id = $2),
                'distribution', $4,
                'city_cho', 'barangay_bhc', $5
        `,
      [vaccineId, sourceClinicId, quantity, result.rows[0].id, userId],
    );

    res.status(201).json({
      success: true,
      message: 'Distribution created and dispatched successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Create distribution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create distribution',
    });
  }
};

/**
 * Receive Distribution (BHC receives vaccines)
 * PUT /api/distribution/:id/receive
 */
exports.receiveDistribution = async (req, res) => {
  try {
    const { id } = req.params;
    const { receivedCondition, receiptNotes } = req.body;
    const userId = req.user.id;
    const clinicId = req.user.clinic_id;

    // Get distribution details
    const distResult = await db.query(
      'SELECT * FROM vaccine_distributions WHERE id = $1 AND destination_barangay_id = $2',
      [id, clinicId],
    );

    if (distResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Distribution not found or not authorized',
      });
    }

    const distribution = distResult.rows[0];

    // Update distribution status
    const query = `
            UPDATE vaccine_distributions
            SET
                status = 'received',
                received_by = $1,
                received_at = CURRENT_TIMESTAMP,
                received_condition = $2,
                receipt_notes = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *
        `;

    const values = [userId, receivedCondition, receiptNotes, id];
    const result = await db.query(query, values);

    // Add to BHC inventory
    if (receivedCondition === 'good') {
      await db.query(
        `
                INSERT INTO vaccine_inventory_excel (
                    clinic_id, vaccine_id, vaccine_name, lot_batch_number,
                    expiry_date, received_during_period, received_date,
                    received_from, storage_location, created_by
                )
                VALUES ($1, $2, (
                    SELECT name FROM vaccines WHERE id = $2
                ), $3, $4, $5, CURRENT_DATE, 'City Health Office', 'main_refrigerator', $6)
                ON CONFLICT (clinic_id, vaccine_id, lot_batch_number) DO UPDATE
                SET received_during_period = vaccine_inventory_excel.received_during_period + $5,
                    updated_at = CURRENT_TIMESTAMP
            `,
        [
          clinicId,
          distribution.vaccine_id,
          distribution.batch_number,
          distribution.expiry_date,
          distribution.quantity_distributed,
          userId,
        ],
      );
    }

    // Create transaction record
    await db.query(
      `
            INSERT INTO vaccine_inventory_transactions (
                transaction_type, vaccine_id, clinic_id, quantity_change,
                quantity_before, quantity_after, reference_type, reference_id,
                source_type, destination_type, performed_by
            )
            SELECT
                'TRANSFER_IN', $1, $2, $3,
                COALESCE((SELECT current_stock FROM vaccine_inventory_excel
                          WHERE clinic_id = $2 AND vaccine_id = $1), 0),
                COALESCE((SELECT current_stock FROM vaccine_inventory_excel
                          WHERE clinic_id = $2 AND vaccine_id = $1), 0) + $3,
                'distribution', $4,
                'city_cho', 'barangay_bhc', $5
        `,
      [
        distribution.vaccine_id,
        clinicId,
        distribution.quantity_distributed,
        distribution.id,
        userId,
      ],
    );

    res.json({
      success: true,
      message: 'Distribution received successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Receive distribution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to receive distribution',
    });
  }
};

/**
 * Get Distributions
 * GET /api/distribution
 */
exports.getDistributions = async (req, res) => {
  try {
    const { status, vaccineId } = req.query;
    const clinicId = req.user.clinic_id;
    const userRole = req.user.role;

    let query = `
            SELECT
                d.*,
                v.name as vaccine_name,
                v.code as vaccine_code,
                s.name as source_name
            FROM vaccine_distributions d
            JOIN vaccines v ON d.vaccine_id = v.id
            LEFT JOIN clinics s ON d.source_clinic_id = s.id
            WHERE 1=1
        `;

    const params = [];
    let paramIndex = 1;

    // Filter by role
    if (['healthcare_worker', 'nurse', 'midwife'].includes(userRole)) {
      // BHC staff can see distributions to their clinic
      query += ` AND d.destination_barangay_id = $${paramIndex}`;
      params.push(clinicId);
      paramIndex++;
    } else {
      // City admin can see all distributions
      query += ` AND d.source_clinic_id = $${paramIndex}`;
      params.push(clinicId);
      paramIndex++;
    }

    if (status) {
      query += ` AND d.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (vaccineId) {
      query += ` AND d.vaccine_id = $${paramIndex}`;
      params.push(vaccineId);
      paramIndex++;
    }

    query += ' ORDER BY d.created_at DESC';

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get distributions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch distributions',
    });
  }
};

// ===========================================
// COLD CHAIN MONITORING
// ===========================================

/**
 * Record Temperature Reading
 * POST /api/distribution/:id/temperature
 */
exports.recordTemperatureReading = async (req, res) => {
  try {
    const { id } = req.params;
    const { temperature, humidity, sensorId, sensorLocation } = req.body;
    const userId = req.user.id;

    // Define thresholds
    const minThreshold = 2;
    const maxThreshold = 8;

    const isWithinRange = temperature >= minThreshold && temperature <= maxThreshold;
    let alertType = null;
    let alertMessage = null;

    if (temperature < minThreshold) {
      alertType = 'low_temp';
      alertMessage = `Temperature too low: ${temperature}°C (minimum: ${minThreshold}°C)`;
    } else if (temperature > maxThreshold) {
      alertType = 'high_temp';
      alertMessage = `Temperature too high: ${temperature}°C (maximum: ${maxThreshold}°C)`;
    }

    const query = `
            INSERT INTO cold_chain_readings (
                distribution_id, temperature_reading, humidity_reading,
                sensor_id, sensor_location, is_within_range,
                min_threshold, max_threshold, alert_triggered,
                alert_type, alert_message, recorded_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `;

    const values = [
      id,
      temperature,
      humidity,
      sensorId,
      sensorLocation,
      isWithinRange,
      minThreshold,
      maxThreshold,
      alertType !== null,
      alertType,
      alertMessage,
      userId,
    ];

    const result = await db.query(query, values);

    res.status(201).json({
      success: true,
      data: result.rows[0],
      alert:
        alertType !== null
          ? {
            type: alertType,
            message: alertMessage,
          }
          : null,
    });
  } catch (error) {
    console.error('Record temperature error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record temperature',
    });
  }
};

// ===========================================
// BHC PERIODIC REPORTS (Barangay → City)
// ===========================================

/**
 * Create/Submit BHC Periodic Report
 * POST /api/reports/periodic
 */
exports.createPeriodicReport = async (req, res) => {
  try {
    const {
      reportType,
      periodStart,
      periodEnd,
      vaccinationStats,
      dropoutAnalysis,
      aefiData,
      coverageRates,
      coldChainStatus,
      challenges,
    } = req.body;

    const clinicId = req.user.clinic_id;
    const userId = req.user.id;

    // Get clinic name
    const clinicResult = await db.query('SELECT name FROM clinics WHERE id = $1', [clinicId]);

    const query = `
            INSERT INTO bhc_periodic_reports (
                report_number,
                barangay_clinic_id,
                barangay_clinic_name,
                report_type,
                period_start,
                period_end,
                total_infants_served,
                total_vaccinations_administered,
                bcg_administered,
                hepb_administered,
                pentavalent_administered,
                opv_administered,
                ipv_administered,
                pcv_administered,
                mr_administered,
                mmr_administered,
                infants_started_series,
                infants_completed_series,
                dropout_rate,
                defaulters_identified,
                defaulters_traced,
                defaulters_vaccinated,
                aefi_reported,
                aefi_serious,
                bcg_coverage,
                penta3_coverage,
                mcv1_coverage,
                full_immunization_coverage,
                refrigerator_working,
                refrigerator_temperature_avg,
                temperature_excursions,
                stockouts_occurred,
                stockout_vaccines,
                challenges_encountered,
                recommendations,
                status,
                submitted_by,
                submitted_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, 'submitted', $34, CURRENT_TIMESTAMP)
            RETURNING *
        `;

    const values = [
      generateReportNumber(reportType),
      clinicId,
      clinicResult.rows[0]?.name || 'Unknown',
      reportType,
      periodStart,
      periodEnd,
      vaccinationStats?.totalInfantsServed || 0,
      vaccinationStats?.totalVaccinations || 0,
      vaccinationStats?.bcg || 0,
      vaccinationStats?.hepb || 0,
      vaccinationStats?.pentavalent || 0,
      vaccinationStats?.opv || 0,
      vaccinationStats?.ipv || 0,
      vaccinationStats?.pcv || 0,
      vaccinationStats?.mr || 0,
      vaccinationStats?.mmr || 0,
      dropoutAnalysis?.startedSeries || 0,
      dropoutAnalysis?.completedSeries || 0,
      dropoutAnalysis?.dropoutRate || 0,
      dropoutAnalysis?.defaultersIdentified || 0,
      dropoutAnalysis?.defaultersTraced || 0,
      dropoutAnalysis?.defaultersVaccinated || 0,
      aefiData?.reported || 0,
      aefiData?.serious || 0,
      coverageRates?.bcg || 0,
      coverageRates?.penta3 || 0,
      coverageRates?.mcv1 || 0,
      coverageRates?.fullImmunization || 0,
      coldChainStatus?.refrigeratorWorking || true,
      coldChainStatus?.avgTemperature,
      coldChainStatus?.temperatureExcursions || 0,
      challenges?.stockoutsOccurred || 0,
      JSON.stringify(challenges?.stockoutVaccines || []),
      challenges?.challengesEncountered,
      challenges?.recommendations,
      userId,
    ];

    const result = await db.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Periodic report submitted successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Create periodic report error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create periodic report',
    });
  }
};

/**
 * Get BHC Reports (for City review)
 * GET /api/reports/periodic
 */
exports.getPeriodicReports = async (req, res) => {
  try {
    const { status, reportType, barangayId, periodStart, periodEnd } = req.query;
    const userRole = req.user.role;
    const clinicId = req.user.clinic_id;

    let query = `
            SELECT
                br.*,
                c.name as barangay_name,
                u.username as submitted_by_name
            FROM bhc_periodic_reports br
            JOIN clinics c ON br.barangay_clinic_id = c.id
            LEFT JOIN users u ON br.submitted_by = u.id
            WHERE br.is_active = true
        `;

    const params = [];
    let paramIndex = 1;

    // If BHC staff, only see own reports
    if (['healthcare_worker', 'nurse', 'midwife'].includes(userRole)) {
      query += ` AND br.barangay_clinic_id = $${paramIndex}`;
      params.push(clinicId);
      paramIndex++;
    }

    if (status) {
      query += ` AND br.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (reportType) {
      query += ` AND br.report_type = $${paramIndex}`;
      params.push(reportType);
      paramIndex++;
    }

    if (barangayId && ['admin', 'super_admin'].includes(userRole)) {
      query += ` AND br.barangay_clinic_id = $${paramIndex}`;
      params.push(barangayId);
      paramIndex++;
    }

    if (periodStart) {
      query += ` AND br.period_start >= $${paramIndex}`;
      params.push(periodStart);
      paramIndex++;
    }

    if (periodEnd) {
      query += ` AND br.period_end <= $${paramIndex}`;
      params.push(periodEnd);
      paramIndex++;
    }

    query += ' ORDER BY br.created_at DESC';

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get periodic reports error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reports',
    });
  }
};

/**
 * Review BHC Report (City Level)
 * PUT /api/reports/periodic/:id/review
 */
exports.reviewPeriodicReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewNotes, feedback, actionRequired } = req.body;
    const userId = req.user.id;

    if (!['reviewed', 'approved'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be reviewed or approved',
      });
    }

    const query = `
            UPDATE bhc_periodic_reports
            SET
                status = $1,
                reviewed_by = $2,
                reviewed_at = CURRENT_TIMESTAMP,
                review_notes = $3,
                cho_feedback = $4,
                cho_action_required = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *
        `;

    const values = [status, userId, reviewNotes, feedback, actionRequired, id];
    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
      });
    }

    res.json({
      success: true,
      message: 'Report reviewed successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Review report error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to review report',
    });
  }
};

// ===========================================
// EXCEL IMPORT/EXPORT
// ===========================================

/**
 * Export Inventory to Excel
 * GET /api/inventory/export
 */
exports.exportInventoryToExcel = async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const { periodStart, periodEnd } = req.query;

    let query = `
            SELECT
                vaccine_name,
                beginning_balance,
                received_during_period,
                lot_batch_number,
                expiry_date,
                transferred_in,
                transferred_out,
                expired_wasted,
                (beginning_balance + received_during_period + transferred_in) as total_available,
                issuance,
                current_stock,
                low_stock_threshold,
                is_low_stock,
                is_critical_stock,
                storage_location,
                supplier_name,
                period_start,
                period_end
            FROM vaccine_inventory_excel
            WHERE clinic_id = $1
        `;

    const params = [clinicId];

    if (periodStart && periodEnd) {
      query += ' AND period_start = $2 AND period_end = $3';
      params.push(periodStart, periodEnd);
    }

    query += ' ORDER BY vaccine_name';

    const result = await db.query(query, params);

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Immunicare System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Vaccine Inventory');

    // Add headers matching Excel structure
    worksheet.columns = [
      { header: 'VACCINE NAME', key: 'vaccine_name', width: 25 },
      { header: 'BEGINNING BALANCE (VIALS PCS)', key: 'beginning_balance', width: 25 },
      { header: 'RECEIVED DURING PERIOD (VIALS PCS)', key: 'received_during_period', width: 30 },
      { header: 'LOT/BATCH NUMBER', key: 'lot_batch_number', width: 20 },
      { header: 'EXPIRY DATE', key: 'expiry_date', width: 15 },
      { header: 'TRANSFERRED IN', key: 'transferred_in', width: 18 },
      { header: 'TRANSFERRED OUT', key: 'transferred_out', width: 18 },
      { header: 'EXPIRED/WASTED', key: 'expired_wasted', width: 18 },
      { header: 'TOTAL AVAILABLE (VIALS PCS)', key: 'total_available', width: 28 },
      { header: 'ISSUANCE (VIALS PCS)', key: 'issuance', width: 22 },
      { header: 'STOCK ON HAND (VIALS PCS)', key: 'current_stock', width: 26 },
      { header: 'LOW STOCK THRESHOLD', key: 'low_stock_threshold', width: 22 },
      { header: 'IS LOW STOCK', key: 'is_low_stock', width: 15 },
      { header: 'IS CRITICAL STOCK', key: 'is_critical_stock', width: 20 },
      { header: 'STORAGE LOCATION', key: 'storage_location', width: 20 },
      { header: 'SUPPLIER', key: 'supplier_name', width: 25 },
      { header: 'PERIOD START', key: 'period_start', width: 15 },
      { header: 'PERIOD END', key: 'period_end', width: 15 },
    ];

    // Add data rows
    result.rows.forEach((row) => {
      worksheet.addRow(row);
    });

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

    // Add conditional formatting for stock levels
    result.rows.forEach((row, index) => {
      const rowNum = index + 2;
      const stockCell = worksheet.getCell(`K${rowNum}`);

      if (row.is_critical_stock) {
        stockCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFF0000' },
        };
      } else if (row.is_low_stock) {
        stockCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFF00' },
        };
      }
    });

    // Set response headers
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=vaccine_inventory_${Date.now()}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export inventory error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export inventory',
    });
  }
};

/**
 * Import Inventory from Excel
 * POST /api/inventory/import
 */
exports.importInventoryFromExcel = async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const userId = req.user.id;
    const { periodStart, periodEnd } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const worksheet = workbook.getWorksheet(1);
    const importedRecords = [];
    const errors = [];
    const rowTasks = [];

    // Process each row (skip header)
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      } // Skip header

      rowTasks.push((async () => {
        const values = row.values;

        try {
          // Map Excel columns to database fields
          const vaccineName = values[1];
          const beginningBalance = parseInt(values[2]) || 0;
          const receivedDuringPeriod = parseInt(values[3]) || 0;
          const lotBatchNumber = values[4];
          const expiryDate = values[5];
          const transferredIn = parseInt(values[6]) || 0;
          const transferredOut = parseInt(values[7]) || 0;
          const expiredWasted = parseInt(values[8]) || 0;
          const issuance = parseInt(values[10]) || 0;
          const storageLocation = values[15];
          const supplierName = values[16];

          const vaccineNameValidation = validateApprovedVaccineName(vaccineName, {
            fieldName: `row ${rowNumber} vaccine_name`,
          });

          if (!vaccineNameValidation.valid) {
            errors.push({
              row: rowNumber,
              vaccine: vaccineName,
              error: vaccineNameValidation.error,
            });
            return;
          }

          // Get vaccine ID
          const vaccineResult = await db.query(
            'SELECT id FROM vaccines WHERE name = $1 LIMIT 1',
            [vaccineNameValidation.vaccineName],
          );

          if (vaccineResult.rows.length === 0) {
            errors.push({
              row: rowNumber,
              vaccine: vaccineNameValidation.vaccineName,
              error: 'Approved vaccine was not found in the database',
            });
            return;
          }

          const vaccineId = vaccineResult.rows[0].id;

          // Insert or update inventory record
          const query = `
                    INSERT INTO vaccine_inventory_excel (
                        clinic_id, vaccine_id, vaccine_name, beginning_balance,
                        received_during_period, lot_batch_number, expiry_date,
                        transferred_in, transferred_out, expired_wasted, issuance,
                        storage_location, supplier_name, period_start, period_end,
                        created_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                    ON CONFLICT (clinic_id, vaccine_id, lot_batch_number, period_start)
                    DO UPDATE SET
                        beginning_balance = EXCLUDED.beginning_balance,
                        received_during_period = EXCLUDED.received_during_period,
                        transferred_in = EXCLUDED.transferred_in,
                        transferred_out = EXCLUDED.transferred_out,
                        expired_wasted = EXCLUDED.expired_wasted,
                        issuance = EXCLUDED.issuance,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING id
                `;

          const queryValues = [
            clinicId,
            vaccineId,
            vaccineNameValidation.vaccineName,
            beginningBalance,
            receivedDuringPeriod,
            lotBatchNumber,
            expiryDate ? new Date(expiryDate) : null,
            transferredIn,
            transferredOut,
            expiredWasted,
            issuance,
            storageLocation,
            supplierName,
            periodStart || new Date(),
            periodEnd || new Date(),
            userId,
          ];

          const result = await db.query(query, queryValues);
          importedRecords.push({
            row: rowNumber,
            vaccine: vaccineNameValidation.vaccineName,
            status: 'success',
            id: result.rows[0]?.id,
          });
        } catch (rowError) {
          errors.push({
            row: rowNumber,
            error: rowError.message,
          });
        }
      })());
    });

    await Promise.all(rowTasks);

    res.json({
      success: true,
      message: `Import completed: ${importedRecords.length} records, ${errors.length} errors`,
      importedRecords,
      errors,
    });
  } catch (error) {
    console.error('Import inventory error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import inventory',
    });
  }
};

// ===========================================
// INFANT VACCINATION SCHEDULE
// ===========================================

/**
 * Generate Vaccination Schedule for Infant
 * POST /api/schedules/generate
 */
exports.generateInfantSchedule = async (req, res) => {
  try {
    const { infantId } = req.body;
    const userId = req.user.id;

    // Get infant info
    const infantResult = await db.query('SELECT dob FROM patients WHERE id = $1', [infantId]);

    if (infantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Infant not found',
      });
    }

    const infant = infantResult.rows[0];
    const dob = new Date(infant.dob);

    // Get all active schedule templates
    const templates = await db.query(
      'SELECT * FROM infant_vaccination_schedule_templates WHERE is_active = true ORDER BY target_age_months',
    );

    const schedules = [];

    for (const template of templates.rows) {
      // Calculate scheduled date based on target age
      const targetDate = new Date(dob);
      targetDate.setMonth(targetDate.getMonth() + template.target_age_months);

      const query = `
                INSERT INTO infant_vaccination_schedules (
                    infant_id, schedule_template_id, dose_number,
                    scheduled_date, scheduled_age_months, status, created_by
                ) VALUES ($1, $2, $3, $4, $5, 'scheduled', $6)
                RETURNING *
            `;

      const values = [
        infantId,
        template.id,
        template.dose_number,
        targetDate,
        template.target_age_months,
        userId,
      ];

      const result = await db.query(query, values);
      schedules.push(result.rows[0]);
    }

    res.json({
      success: true,
      message: `Generated ${schedules.length} vaccination schedule entries`,
      schedules,
    });
  } catch (error) {
    console.error('Generate schedule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate schedule',
    });
  }
};

/**
 * Get Infant Vaccination Schedule
 * GET /api/schedules/:infantId
 */
exports.getInfantSchedule = async (req, res) => {
  try {
    const { infantId } = req.params;

    const query = `
            SELECT
                iss.*,
                ist.vaccine_name,
                ist.vaccine_code,
                ist.disease_prevented,
                ist.route_of_administration,
                ist.dosage,
                ist.administration_site,
                ist.target_age_months,
                ist.minimum_interval_weeks
            FROM infant_vaccination_schedules iss
            JOIN infant_vaccination_schedule_templates ist ON iss.schedule_template_id = ist.id
            WHERE iss.infant_id = $1 AND iss.is_active = true
            ORDER BY ist.target_age_months, iss.dose_number
        `;

    const result = await db.query(query, [infantId]);

    // Group by vaccine
    const scheduleByVaccine = {};
    result.rows.forEach((row) => {
      if (!scheduleByVaccine[row.vaccine_name]) {
        scheduleByVaccine[row.vaccine_name] = [];
      }
      scheduleByVaccine[row.vaccine_name].push(row);
    });

    res.json({
      success: true,
      data: {
        schedules: result.rows,
        scheduleByVaccine,
        totalScheduled: result.rows.length,
        administered: result.rows.filter((s) => s.status === 'administered').length,
        pending: result.rows.filter((s) => ['scheduled', 'due'].includes(s.status)).length,
        overdue: result.rows.filter((s) => s.status === 'overdue').length,
      },
    });
  } catch (error) {
    console.error('Get infant schedule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch schedule',
    });
  }
};

/**
 * Update Schedule Status (e.g., mark as administered)
 * PUT /api/schedules/:id
 */
exports.updateScheduleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      administeredDate,
      batchNumber,
      lotNumber,
      expiryDate,
      administeredBy,
      administrationSite,
      siteReaction,
    } = req.body;

    // Get template info for dose number
    const scheduleResult = await db.query(
      'SELECT * FROM infant_vaccination_schedules WHERE id = $1',
      [id],
    );

    if (scheduleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      });
    }

    const schedule = scheduleResult.rows[0];
    const infantId = schedule.infant_id;
    const templateId = schedule.schedule_template_id;

    // Get vaccine info
    const templateResult = await db.query(
      'SELECT * FROM infant_vaccination_schedule_templates WHERE id = $1',
      [templateId],
    );

    const template = templateResult.rows[0];

    // Calculate age at administration
    let administeredAgeMonths = null;
    if (administeredDate) {
      const infantResult = await db.query('SELECT dob FROM patients WHERE id = $1', [infantId]);
      const dob = new Date(infantResult.rows[0].dob);
      const adminDate = new Date(administeredDate);
      administeredAgeMonths =
        (adminDate.getFullYear() - dob.getFullYear()) * 12 +
        (adminDate.getMonth() - dob.getMonth());
    }

    const query = `
            UPDATE infant_vaccination_schedules
            SET
                status = $1,
                administered_date = $2,
                administered_age_months = $3,
                batch_number = $4,
                lot_number = $5,
                expiry_date = $6,
                administered_by = $7,
                administration_site = $8,
                site_reaction = $9,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $10
            RETURNING *
        `;

    const values = [
      status,
      administeredDate,
      administeredAgeMonths,
      batchNumber,
      lotNumber,
      expiryDate,
      administeredBy,
      administrationSite,
      siteReaction,
      id,
    ];

    const result = await db.query(query, values);

    // If administered, create vaccination record
    if (status === 'administered') {
      await db.query(
        `
                INSERT INTO vaccination_records (
                    infant_id, vaccine_id, dose_no, admin_date,
                    vaccinator_id, batch_number
                )
                SELECT $1, $2, $3, $4, $5, $6
            `,
        [
          infantId,
          template.vaccine_id,
          template.dose_number,
          administeredDate,
          administeredBy,
          batchNumber,
        ],
      );
    }

    res.json({
      success: true,
      message: 'Schedule updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update schedule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update schedule',
    });
  }
};

/**
 * Get Overdue Schedules
 * GET /api/schedules/overdue
 */
exports.getOverdueSchedules = async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const userRole = req.user.role;

    let query = `
            SELECT
                iss.*,
                ist.vaccine_name,
                ist.vaccine_code,
                p.first_name,
                p.last_name,
                p.dob,
                g.name as guardian_name,
                g.phone as guardian_phone,
                g.email as guardian_email
            FROM infant_vaccination_schedules iss
            JOIN infant_vaccination_schedule_templates ist ON iss.schedule_template_id = ist.id
            JOIN patients p ON iss.infant_id = p.id
            JOIN guardians g ON p.guardian_id = g.id
            WHERE iss.status IN ('scheduled', 'due', 'overdue')
            AND iss.scheduled_date < CURRENT_DATE
            AND iss.is_active = true
    `;

    if (['healthcare_worker', 'nurse', 'midwife'].includes(userRole)) {
      query += ' AND COALESCE(p.clinic_id, p.facility_id) = $1';
    }

    query += ' ORDER BY iss.scheduled_date ASC';

    const params = ['healthcare_worker', 'nurse', 'midwife'].includes(userRole) ? [clinicId] : [];

    const result = await db.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get overdue schedules error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch overdue schedules',
    });
  }
};

/**
 * Create Schedule Reminder
 * POST /api/schedules/:id/reminder
 */
exports.createScheduleReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reminderType, daysBeforeDue, notificationChannel } = req.body;

    // Get schedule info
    const scheduleResult = await db.query(
      'SELECT * FROM infant_vaccination_schedules WHERE id = $1',
      [id],
    );

    if (scheduleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      });
    }

    const schedule = scheduleResult.rows[0];
    const infantId = schedule.infant_id;

    // Calculate reminder date
    const scheduledDate = new Date(schedule.scheduled_date);
    const reminderDate = new Date(scheduledDate);
    reminderDate.setDate(reminderDate.getDate() - (daysBeforeDue || 7));

    // Generate message
    const infantResult = await db.query('SELECT first_name, last_name FROM patients WHERE id = $1', [
      infantId,
    ]);

    const infant = infantResult.rows[0];
    const vaccineResult = await db.query(
      `
            SELECT vaccine_name FROM infant_vaccination_schedule_templates WHERE id = $1
        `,
      [schedule.schedule_template_id],
    );

    const vaccine = vaccineResult.rows[0];

    const messageSubject = `Vaccination Reminder: ${vaccine.vaccine_name}`;
    const messageBody = `Dear Guardian,\n\nThis is a reminder that ${infant.first_name} ${infant.last_name} is scheduled to receive ${vaccine.vaccine_name} (Dose ${schedule.dose_number}) on ${scheduledDate.toDateString()}.\n\nPlease ensure to bring the child's vaccination card and arrive on time.\n\nThank you,\nCity Health Office`;

    const query = `
            INSERT INTO schedule_reminders (
                schedule_id, infant_id, reminder_type, reminder_date,
                days_before_due, notification_channel,
                message_subject, message_body
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

    const values = [
      id,
      infantId,
      reminderType || 'due_date',
      reminderDate,
      daysBeforeDue || 7,
      notificationChannel || 'sms',
      messageSubject,
      messageBody,
    ];

    const result = await db.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Reminder created successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Create reminder error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create reminder',
    });
  }
};

module.exports = exports;
