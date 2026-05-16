const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken: auth } = require('../middleware/auth');

// Root route - return API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Vaccine Supply API',
    endpoints: [
      '/requests',
      '/allocations',
      '/temperature',
      '/storage',
      '/reports',
      '/dashboard/barangay/:id',
      '/dashboard/city',
      '/dashboard/alerts',
      '/facilities/barangays',
      '/facilities/warehouse',
      '/vaccines',
    ],
  });
});

// Vaccine request endpoints (barangay to city)

// POST /api/vaccine-supply/requests
// Submit new vaccine request (Barangay)
router.post('/requests', auth, async (req, res) => {
  try {
    const {
      vaccineId,
      requestedQuantity,
      priority,
      neededByDate,
      purpose,
      notes,
      consumptionReport,
    } = req.body;

    const facilityId = req.user.facility_id || req.user.clinic_id;

    // Get next request number
    const requestNumberResult = await db.query(
      'SELECT fn_generate_request_number() as request_number',
    );
    const requestNumber = requestNumberResult.rows[0].request_number;

    const requestQuery = `
      INSERT INTO vaccine_requests (
        request_number, requesting_barangay_id, requested_vaccine_id,
        requested_quantity, priority, request_date, needed_by_date,
        purpose, notes, consumption_report, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, 'pending', $10)
      RETURNING *
    `;

    const values = [
      requestNumber,
      facilityId,
      vaccineId,
      requestedQuantity,
      priority || 'medium',
      neededByDate,
      purpose,
      notes,
      consumptionReport ? JSON.stringify(consumptionReport) : null,
      req.user.id,
    ];

    const result = await db.query(requestQuery, values);

    res.status(201).json({
      message: 'Vaccine request submitted successfully',
      request: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Submit request error:', error);
    res.status(500).json({
      error: 'Failed to submit vaccine request',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/requests
// Get requests (filtered by user's facility)
router.get('/requests', auth, async (req, res) => {
  try {
    const { status, priority, vaccineId, dateFrom, dateTo } = req.query;
    const facilityId = req.user.facility_id || req.user.clinic_id;

    // Check if user is city-level (can see all requests) or barangay-level
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    let query = `
      SELECT
        vr.id,
        vr.request_number,
        vr.requesting_barangay_id,
        hf.name as requesting_barangay_name,
        vr.requested_vaccine_id,
        v.name as vaccine_name,
        v.code as vaccine_code,
        vr.requested_quantity,
        vr.allocated_quantity,
        vr.priority,
        vr.status,
        vr.request_date,
        vr.needed_by_date,
        vr.purpose,
        vr.notes,
        vr.consumption_report,
        vr.reviewed_by,
        vr.reviewed_at,
        vr.review_notes,
        vr.created_at,
        vr.updated_at,
        CASE
          WHEN vr.requested_quantity > COALESCE(vr.allocated_quantity, 0) THEN 'partial'
          WHEN vr.allocated_quantity >= vr.requested_quantity THEN 'fulfilled'
          ELSE 'pending'
        END as fulfillment_status
      FROM vaccine_requests vr
      JOIN vaccines v ON vr.requested_vaccine_id = v.id
      JOIN clinics hf ON vr.requesting_barangay_id = hf.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // City users see all requests, barangay users see only their own
    if (!isCityLevel) {
      query += ` AND vr.requesting_barangay_id = $${paramIndex}`;
      params.push(facilityId);
      paramIndex++;
    }

    if (status) {
      query += ` AND vr.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (priority) {
      query += ` AND vr.priority = $${paramIndex}`;
      params.push(priority);
      paramIndex++;
    }

    if (vaccineId) {
      query += ` AND vr.requested_vaccine_id = $${paramIndex}`;
      params.push(vaccineId);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND vr.request_date >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND vr.request_date <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ` ORDER BY
      CASE vr.priority
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END,
      vr.request_date DESC
    `;

    const result = await db.query(query, params);

    res.json({
      requests: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({
      error: 'Failed to retrieve requests',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/requests/:id
// Get single request details
router.get('/requests/:id', auth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const facilityId = req.user.facility_id || req.user.clinic_id;
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    let query = `
      SELECT
        vr.*,
        hf.name as requesting_barangay_name,
        v.name as vaccine_name,
        v.code as vaccine_code,
        a.username as reviewed_by_name
      FROM vaccine_requests vr
      JOIN vaccines v ON vr.requested_vaccine_id = v.id
      JOIN clinics hf ON vr.requesting_barangay_id = hf.id
      LEFT JOIN admin a ON vr.reviewed_by = a.id
      WHERE vr.id = $1
    `;

    if (!isCityLevel) {
      query += ' AND vr.requesting_barangay_id = $2';
    }

    const result = await db.query(query, isCityLevel ? [requestId] : [requestId, facilityId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Request not found',
        success: false,
      });
    }

    res.json({
      request: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({
      error: 'Failed to retrieve request',
      success: false,
    });
  }
});

// PUT /api/vaccine-supply/requests/:id
// Update request (only if pending)
router.put('/requests/:id', auth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { requestedQuantity, priority, neededByDate, purpose, notes, consumptionReport } =
      req.body;
    const facilityId = req.user.facility_id || req.user.clinic_id;

    // Check if request is still pending
    const checkResult = await db.query(
      'SELECT status FROM vaccine_requests WHERE id = $1 AND requesting_barangay_id = $2',
      [requestId, facilityId],
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Request not found',
        success: false,
      });
    }

    if (checkResult.rows[0].status !== 'pending') {
      return res.status(400).json({
        error: 'Cannot modify request that is not in pending status',
        success: false,
      });
    }

    const query = `
      UPDATE vaccine_requests SET
        requested_quantity = COALESCE($1, requested_quantity),
        priority = COALESCE($2, priority),
        needed_by_date = COALESCE($3, needed_by_date),
        purpose = COALESCE($4, purpose),
        notes = COALESCE($5, notes),
        consumption_report = COALESCE($6, consumption_report),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 AND status = 'pending'
      RETURNING *
    `;

    const values = [
      requestedQuantity,
      priority,
      neededByDate,
      purpose,
      notes,
      consumptionReport ? JSON.stringify(consumptionReport) : null,
      requestId,
    ];

    const result = await db.query(query, values);

    res.json({
      message: 'Request updated successfully',
      request: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Update request error:', error);
    res.status(500).json({
      error: 'Failed to update request',
      success: false,
    });
  }
});

// PUT /api/vaccine-supply/requests/:id/review
// Review and update request status (City only)
router.put('/requests/:id/review', auth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { status, allocatedQuantity, reviewNotes } = req.body;

    // Verify user is city-level
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';
    if (!isCityLevel) {
      return res.status(403).json({
        error: 'Only city-level users can review requests',
        success: false,
      });
    }

    const query = `
      UPDATE vaccine_requests SET
        status = $1,
        allocated_quantity = COALESCE($2, allocated_quantity),
        reviewed_by = $3,
        reviewed_at = CURRENT_TIMESTAMP,
        review_notes = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `;

    const result = await db.query(query, [
      status,
      allocatedQuantity,
      req.user.id,
      reviewNotes,
      requestId,
    ]);

    // If approved, create allocation record
    if (status === 'approved' && allocatedQuantity > 0) {
      const allocationNumberResult = await db.query(
        'SELECT fn_generate_allocation_number() as allocation_number',
      );
      const allocationNumber = allocationNumberResult.rows[0].allocation_number;

      const request = result.rows[0];

      // Get city warehouse facility
      const warehouseResult = await db.query(
        'SELECT id FROM clinics ORDER BY id LIMIT 1',
      );
      const warehouseId = warehouseResult.rows[0]?.id;

      if (warehouseId) {
        await db.query(
          `
          INSERT INTO vaccine_allocations (
            allocation_number, request_id, allocating_facility_id,
            receiving_barangay_id, vaccine_id, allocated_quantity,
            allocation_date, status, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, 'pending', $7)
        `,
          [
            allocationNumber,
            requestId,
            warehouseId,
            request.requesting_barangay_id,
            request.requested_vaccine_id,
            allocatedQuantity,
            req.user.id,
          ],
        );
      }
    }

    res.json({
      message: 'Request reviewed successfully',
      request: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Review request error:', error);
    res.status(500).json({
      error: 'Failed to review request',
      success: false,
    });
  }
});

// Vaccine allocation endpoints (city to barangay)

// POST /api/vaccine-supply/allocations
// Create new allocation (City only)
router.post('/allocations', auth, async (req, res) => {
  try {
    const {
      requestId,
      receivingBarangayId,
      vaccineId,
      allocatedQuantity,
      batchNumber,
      expiryDate,
      distributionMode,
      scheduledDate,
      notes,
    } = req.body;

    // Verify user is city-level
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';
    if (!isCityLevel) {
      return res.status(403).json({
        error: 'Only city-level users can create allocations',
        success: false,
      });
    }

    // Get next allocation number
    const allocationNumberResult = await db.query(
      'SELECT fn_generate_allocation_number() as allocation_number',
    );
    const allocationNumber = allocationNumberResult.rows[0].allocation_number;

    // Get city warehouse facility
    const warehouseResult = await db.query(
      'SELECT id FROM clinics ORDER BY id LIMIT 1',
    );
    const warehouseId = warehouseResult.rows[0]?.id;

    const query = `
      INSERT INTO vaccine_allocations (
        allocation_number, request_id, allocating_facility_id,
        receiving_barangay_id, vaccine_id, allocated_quantity,
        batch_number, expiry_date, allocation_date,
        distribution_mode, scheduled_date, notes, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, $9, $10, $11, 'pending', $12)
      RETURNING *
    `;

    const values = [
      allocationNumber,
      requestId,
      warehouseId,
      receivingBarangayId,
      vaccineId,
      allocatedQuantity,
      batchNumber,
      expiryDate,
      distributionMode || 'pickup',
      scheduledDate,
      notes,
      req.user.id,
    ];

    const result = await db.query(query, values);

    // If request exists, update its allocated quantity
    if (requestId) {
      await db.query(
        `
        UPDATE vaccine_requests SET
          allocated_quantity = COALESCE(allocated_quantity, 0) + $1,
          status = CASE
            WHEN allocated_quantity + $1 >= requested_quantity THEN 'fulfilled'
            ELSE 'partially_fulfilled'
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
        [allocatedQuantity, requestId],
      );
    }

    res.status(201).json({
      message: 'Allocation created successfully',
      allocation: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Create allocation error:', error);
    res.status(500).json({
      error: 'Failed to create allocation',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/allocations
// Get allocations (filtered by user's facility)
router.get('/allocations', auth, async (req, res) => {
  try {
    const { status, vaccineId, dateFrom, dateTo } = req.query;
    const facilityId = req.user.facility_id || req.user.clinic_id;

    // Check if user is city-level or barangay-level
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    let query = `
      SELECT
        va.id,
        va.allocation_number,
        va.request_id,
        vr.request_number as request_number,
        va.allocating_facility_id,
        hf1.name as allocating_facility_name,
        va.receiving_barangay_id,
        hf2.name as receiving_barangay_name,
        va.vaccine_id,
        v.name as vaccine_name,
        v.code as vaccine_code,
        va.allocated_quantity,
        va.batch_number,
        va.expiry_date,
        va.allocation_date,
        va.distribution_mode,
        va.scheduled_date,
        va.delivered_date,
        va.status,
        va.notes,
        va.cold_chain_verified,
        va.received_at,
        va.received_by,
        va.created_at,
        va.updated_at
      FROM vaccine_allocations va
      JOIN vaccines v ON va.vaccine_id = v.id
      JOIN clinics hf1 ON va.allocating_facility_id = hf1.id
      JOIN clinics hf2 ON va.receiving_barangay_id = hf2.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // City users see all, barangay users see only those for their facility
    if (!isCityLevel) {
      query += ` AND va.receiving_barangay_id = $${paramIndex}`;
      params.push(facilityId);
      paramIndex++;
    }

    if (status) {
      query += ` AND va.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (vaccineId) {
      query += ` AND va.vaccine_id = $${paramIndex}`;
      params.push(vaccineId);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND va.allocation_date >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND va.allocation_date <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ' ORDER BY va.created_at DESC';

    const result = await db.query(query, params);

    res.json({
      allocations: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Get allocations error:', error);
    res.status(500).json({
      error: 'Failed to retrieve allocations',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/allocations/:id
// Get single allocation details
router.get('/allocations/:id', auth, async (req, res) => {
  try {
    const allocationId = req.params.id;
    const facilityId = req.user.facility_id || req.user.clinic_id;
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    let query = `
      SELECT
        va.*,
        v.name as vaccine_name,
        v.code as vaccine_code,
        hf1.name as allocating_facility_name,
        hf2.name as receiving_barangay_name,
        a.username as created_by_name
      FROM vaccine_allocations va
      JOIN vaccines v ON va.vaccine_id = v.id
      JOIN clinics hf1 ON va.allocating_facility_id = hf1.id
      JOIN clinics hf2 ON va.receiving_barangay_id = hf2.id
      LEFT JOIN admin a ON va.created_by = a.id
      WHERE va.id = $1
    `;

    if (!isCityLevel) {
      query += ' AND va.receiving_barangay_id = $2';
    }

    const result = await db.query(query, isCityLevel ? [allocationId] : [allocationId, facilityId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Allocation not found',
        success: false,
      });
    }

    res.json({
      allocation: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Get allocation error:', error);
    res.status(500).json({
      error: 'Failed to retrieve allocation',
      success: false,
    });
  }
});

// PUT /api/vaccine-supply/allocations/:id/deliver
// Mark allocation as delivered/received
router.put('/allocations/:id/deliver', auth, async (req, res) => {
  try {
    const allocationId = req.params.id;
    const { receivedBy, receivedSignature, coldChainVerified, notes } = req.body;

    const query = `
      UPDATE vaccine_allocations SET
        status = 'received',
        received_at = CURRENT_TIMESTAMP,
        received_by = $1,
        received_signature = $2,
        cold_chain_verified = COALESCE($3, cold_chain_verified),
        notes = COALESCE($4, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 AND status IN ('pending', 'prepared', 'in_transit', 'delivered')
      RETURNING *
    `;

    const result = await db.query(query, [
      receivedBy,
      receivedSignature,
      coldChainVerified,
      notes,
      allocationId,
    ]);

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Allocation cannot be marked as received. Check status.',
        success: false,
      });
    }

    // Add vaccines to barangay storage
    const allocation = result.rows[0];

    await db.query(
      `
      INSERT INTO barangay_storage (
        facility_id, vaccine_id, batch_number,
        quantity_received, quantity_on_hand, expiry_date,
        date_received, received_from, received_by,
        temperature_at_receipt, condition_at_receipt, status
      ) VALUES ($1, $2, $3, $4, $4, $5, CURRENT_DATE, 'City Health Office', $6, $7, 'good', 'active')
      ON CONFLICT (facility_id, vaccine_id, batch_number)
      DO UPDATE SET
        quantity_received = barangay_storage.quantity_received + $4,
        quantity_on_hand = barangay_storage.quantity_on_hand + $4
    `,
      [
        allocation.receiving_barangay_id,
        allocation.vaccine_id,
        allocation.batch_number,
        allocation.allocated_quantity,
        allocation.expiry_date,
        receivedBy,
        req.body.temperatureAtReceipt,
      ],
    );

    res.json({
      message: 'Allocation received successfully',
      allocation: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Mark delivered error:', error);
    res.status(500).json({
      error: 'Failed to mark allocation as received',
      success: false,
    });
  }
});

// PUT /api/vaccine-supply/allocations/:id/status
// Update allocation status (City only)
router.put('/allocations/:id/status', auth, async (req, res) => {
  try {
    const allocationId = req.params.id;
    const { status, deliveredDate, deliveredBy, notes } = req.body;

    // Verify user is city-level
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';
    if (!isCityLevel) {
      return res.status(403).json({
        error: 'Only city-level users can update allocation status',
        success: false,
      });
    }

    const query = `
      UPDATE vaccine_allocations SET
        status = $1,
        delivered_date = COALESCE($2, delivered_date),
        delivered_by = COALESCE($3, delivered_by),
        notes = COALESCE($4, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `;

    const result = await db.query(query, [status, deliveredDate, deliveredBy, notes, allocationId]);

    res.json({
      message: 'Allocation status updated successfully',
      allocation: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Update allocation status error:', error);
    res.status(500).json({
      error: 'Failed to update allocation status',
      success: false,
    });
  }
});

// ============================================================================
// TEMPERATURE MONITORING ENDPOINTS
// ============================================================================

// POST /api/vaccine-supply/temperature
// Log temperature reading
router.post('/temperature', auth, async (req, res) => {
  try {
    const { facilityId, storageUnitId, vaccineId, temperatureCelsius, humidity, notes } = req.body;

    // Determine temperature status
    let temperatureStatus = 'normal';
    if (temperatureCelsius < 2 || temperatureCelsius > 8) {
      temperatureStatus = 'critical';
    } else if (temperatureCelsius < 3 || temperatureCelsius > 7) {
      temperatureStatus = 'warning';
    }

    const query = `
      INSERT INTO temperature_logs (
        facility_id, storage_unit_id, vaccine_id,
        temperature_celsius, humidity, temperature_status,
        recorded_at, recorded_by, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8)
      RETURNING *
    `;

    const values = [
      facilityId || req.user.facility_id || req.user.clinic_id,
      storageUnitId,
      vaccineId,
      temperatureCelsius,
      humidity,
      temperatureStatus,
      req.user.id,
      notes,
    ];

    const result = await db.query(query, values);

    // TODO: Send alert if temperature is critical

    res.status(201).json({
      message: 'Temperature logged successfully',
      temperatureLog: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Log temperature error:', error);
    res.status(500).json({
      error: 'Failed to log temperature',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/temperature/:facilityId
// Get temperature logs for facility
router.get('/temperature/:facilityId', auth, async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { dateFrom, dateTo, status } = req.query;

    let query = `
      SELECT
        tl.id,
        tl.facility_id,
        tl.storage_unit_id,
        tl.vaccine_id,
        v.name as vaccine_name,
        tl.temperature_celsius,
        tl.humidity,
        tl.temperature_status,
        tl.recorded_at,
        tl.recorded_by,
        a.username as recorded_by_name,
        tl.notes,
        tl.alert_sent,
        tl.alert_sent_at
      FROM temperature_logs tl
      LEFT JOIN vaccines v ON tl.vaccine_id = v.id
      LEFT JOIN admin a ON tl.recorded_by = a.id
      WHERE tl.facility_id = $1
    `;

    const params = [facilityId];
    let paramIndex = 2;

    if (dateFrom) {
      query += ` AND tl.recorded_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND tl.recorded_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    if (status) {
      query += ` AND tl.temperature_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ' ORDER BY tl.recorded_at DESC LIMIT 100';

    const result = await db.query(query, params);

    res.json({
      temperatureLogs: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Get temperature logs error:', error);
    res.status(500).json({
      error: 'Failed to retrieve temperature logs',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/temperature/alerts
// Get temperature alerts
router.get('/temperature/alerts', auth, async (req, res) => {
  try {
    const facilityId = req.user.facility_id || req.user.clinic_id;
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    let query = `
      SELECT
        tl.id,
        tl.facility_id,
        hf.name as facility_name,
        tl.temperature_celsius,
        tl.temperature_status,
        tl.recorded_at,
        tl.recorded_by,
        a.username as recorded_by_name,
        tl.notes,
        tl.alert_sent
      FROM temperature_logs tl
      JOIN clinics hf ON tl.facility_id = hf.id
      LEFT JOIN admin a ON tl.recorded_by = a.id
      WHERE tl.temperature_status IN ('warning', 'critical')
    `;

    const params = [];
    let paramIndex = 1;

    if (!isCityLevel) {
      query += ` AND tl.facility_id = $${paramIndex}`;
      params.push(facilityId);
      paramIndex++;
    }

    query += ` ORDER BY
      CASE tl.temperature_status
        WHEN 'critical' THEN 1
        WHEN 'warning' THEN 2
      END,
      tl.recorded_at DESC
    `;

    const result = await db.query(query, params);

    res.json({
      alerts: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Get temperature alerts error:', error);
    res.status(500).json({
      error: 'Failed to retrieve temperature alerts',
      success: false,
    });
  }
});

// ============================================================================
// STORAGE MANAGEMENT ENDPOINTS
// ============================================================================

// GET /api/vaccine-supply/storage/:facilityId
// Get storage inventory for facility
router.get('/storage/:facilityId', auth, async (req, res) => {
  try {
    const { facilityId } = req.params;

    const query = `
      SELECT
        bs.id,
        bs.facility_id,
        bs.vaccine_id,
        v.name as vaccine_name,
        v.code as vaccine_code,
        bs.batch_number,
        bs.quantity_received,
        bs.quantity_on_hand,
        bs.quantity_used,
        bs.quantity_expired,
        bs.quantity_damaged,
        bs.expiry_date,
        bs.storage_location,
        bs.storage_unit,
        bs.date_received,
        bs.received_from,
        bs.received_by,
        bs.status,
        bs.notes,
        bs.last_counted_at,
        bs.created_at,
        bs.updated_at,
        CASE
          WHEN bs.expiry_date <= CURRENT_DATE THEN 'expired'
          WHEN bs.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'active'
        END as expiry_status,
        EXTRACT(DAY FROM (bs.expiry_date - CURRENT_DATE)) as days_until_expiry
      FROM barangay_storage bs
      JOIN vaccines v ON bs.vaccine_id = v.id
      WHERE bs.facility_id = $1 AND bs.is_active = true
      ORDER BY bs.expiry_date ASC, v.name ASC
    `;

    const result = await db.query(query, [facilityId]);

    // Calculate summary
    const summary = {
      totalItems: result.rows.length,
      totalQuantity: result.rows.reduce((sum, item) => sum + parseInt(item.quantity_on_hand), 0),
      expiringSoon: result.rows.filter((item) => item.expiry_status === 'expiring_soon').length,
      expired: result.rows.filter((item) => item.expiry_status === 'expired').length,
    };

    res.json({
      storage: result.rows,
      summary,
      success: true,
    });
  } catch (error) {
    console.error('Get storage error:', error);
    res.status(500).json({
      error: 'Failed to retrieve storage inventory',
      success: false,
    });
  }
});

// POST /api/vaccine-supply/storage
// Add/update storage record
router.post('/storage', auth, async (req, res) => {
  try {
    const {
      facilityId,
      vaccineId,
      batchNumber,
      quantityReceived,
      expiryDate,
      storageLocation,
      storageUnit,
      receivedFrom,
      receivedBy,
      temperatureAtReceipt,
      notes,
    } = req.body;

    const query = `
      INSERT INTO barangay_storage (
        facility_id, vaccine_id, batch_number,
        quantity_received, quantity_on_hand, expiry_date,
        storage_location, storage_unit, date_received,
        received_from, received_by, temperature_at_receipt,
        condition_at_receipt, status, notes
      ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, CURRENT_DATE, $8, $9, $10, 'good', 'active', $11)
      ON CONFLICT (facility_id, vaccine_id, batch_number)
      DO UPDATE SET
        quantity_received = barangay_storage.quantity_received + $4,
        quantity_on_hand = barangay_storage.quantity_on_hand + $4,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [
      facilityId || req.user.facility_id || req.user.clinic_id,
      vaccineId,
      batchNumber,
      quantityReceived,
      expiryDate,
      storageLocation,
      storageUnit,
      receivedFrom,
      receivedBy || req.user.username,
      temperatureAtReceipt,
      notes,
    ];

    const result = await db.query(query, values);

    res.status(201).json({
      message: 'Storage record added/updated successfully',
      storage: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Add storage error:', error);
    res.status(500).json({
      error: 'Failed to add storage record',
      success: false,
    });
  }
});

// POST /api/vaccine-supply/storage/:id/count
// Record stock count
router.post('/storage/:id/count', auth, async (req, res) => {
  try {
    const storageId = req.params.id;
    const { count, notes } = req.body;

    const query = `
      UPDATE barangay_storage SET
        quantity_on_hand = $1,
        last_counted_at = CURRENT_TIMESTAMP,
        last_counted_by = $2,
        notes = COALESCE($3, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;

    const result = await db.query(query, [count, req.user.id, notes, storageId]);

    res.json({
      message: 'Stock count recorded successfully',
      storage: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Stock count error:', error);
    res.status(500).json({
      error: 'Failed to record stock count',
      success: false,
    });
  }
});

// POST /api/vaccine-supply/storage/:id/use
// Record vaccine usage
router.post('/storage/:id/use', auth, async (req, res) => {
  try {
    const storageId = req.params.id;
    const { quantityUsed } = req.body;

    const query = `
      UPDATE barangay_storage SET
        quantity_on_hand = quantity_on_hand - $1,
        quantity_used = quantity_used + $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND quantity_on_hand >= $1
      RETURNING *
    `;

    const result = await db.query(query, [quantityUsed, storageId]);

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Insufficient quantity or invalid record',
        success: false,
      });
    }

    res.json({
      message: 'Vaccine usage recorded successfully',
      storage: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Record usage error:', error);
    res.status(500).json({
      error: 'Failed to record vaccine usage',
      success: false,
    });
  }
});

// POST /api/vaccine-supply/storage/:id/expire
// Record expired vaccines
router.post('/storage/:id/expire', auth, async (req, res) => {
  try {
    const storageId = req.params.id;
    const { quantityExpired } = req.body;

    const query = `
      UPDATE barangay_storage SET
        quantity_on_hand = quantity_on_hand - $1,
        quantity_expired = quantity_expired + $1,
        status = CASE
          WHEN quantity_on_hand - $1 <= 0 THEN 'expired'
          ELSE status
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND quantity_on_hand >= $1
      RETURNING *
    `;

    const result = await db.query(query, [quantityExpired, storageId]);

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Insufficient quantity or invalid record',
        success: false,
      });
    }

    res.json({
      message: 'Expired vaccines recorded successfully',
      storage: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Record expire error:', error);
    res.status(500).json({
      error: 'Failed to record expired vaccines',
      success: false,
    });
  }
});

// ============================================================================
// REPORTING ENDPOINTS
// ============================================================================

// POST /api/vaccine-supply/reports
// Submit vaccination report
router.post('/reports', auth, async (req, res) => {
  try {
    const {
      facilityId,
      reportType,
      reportPeriodStart,
      reportPeriodEnd,
      vaccinesAdministered,
      remainingStock,
      expiredVaccines,
      damagedVaccines,
      stockDiscrepancies,
      temperatureCompliance,
      activitiesSummary,
      issuesEncountered,
      recommendations,
    } = req.body;

    // Get next report number
    const reportNumberResult = await db.query(
      'SELECT fn_generate_report_number() as report_number',
    );
    const reportNumber = reportNumberResult.rows[0].report_number;

    const query = `
      INSERT INTO vaccination_reports (
        report_number, facility_id, report_type,
        report_period_start, report_period_end,
        vaccines_administered, remaining_stock,
        expired_vaccines, damaged_vaccines, stock_discrepancies,
        temperature_compliance, activities_summary,
        issues_encountered, recommendations, submitted_by, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'submitted')
      RETURNING *
    `;

    const values = [
      reportNumber,
      facilityId || req.user.facility_id || req.user.clinic_id,
      reportType,
      reportPeriodStart,
      reportPeriodEnd,
      vaccinesAdministered ? JSON.stringify(vaccinesAdministered) : null,
      remainingStock ? JSON.stringify(remainingStock) : null,
      expiredVaccines ? JSON.stringify(expiredVaccines) : null,
      damagedVaccines ? JSON.stringify(damagedVaccines) : null,
      stockDiscrepancies ? JSON.stringify(stockDiscrepancies) : null,
      temperatureCompliance ? JSON.stringify(temperatureCompliance) : null,
      activitiesSummary,
      issuesEncountered,
      recommendations,
      req.user.id,
    ];

    const result = await db.query(query, values);

    res.status(201).json({
      message: 'Report submitted successfully',
      report: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Submit report error:', error);
    res.status(500).json({
      error: 'Failed to submit report',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/reports
// Get reports (filtered by user's facility)
router.get('/reports', auth, async (req, res) => {
  try {
    const { reportType, status, dateFrom, dateTo } = req.query;
    const facilityId = req.user.facility_id || req.user.clinic_id;

    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    let query = `
      SELECT
        vr.id,
        vr.report_number,
        vr.facility_id,
        hf.name as facility_name,
        vr.report_type,
        vr.report_period_start,
        vr.report_period_end,
        vr.vaccines_administered,
        vr.remaining_stock,
        vr.status,
        vr.submitted_by,
        a.username as submitted_by_name,
        vr.submitted_at,
        vr.reviewed_by,
        vr.reviewed_at,
        vr.review_notes,
        vr.created_at,
        vr.updated_at
      FROM vaccination_reports vr
      JOIN clinics hf ON vr.facility_id = hf.id
      LEFT JOIN admin a ON vr.submitted_by = a.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (!isCityLevel) {
      query += ` AND vr.facility_id = $${paramIndex}`;
      params.push(facilityId);
      paramIndex++;
    }

    if (reportType) {
      query += ` AND vr.report_type = $${paramIndex}`;
      params.push(reportType);
      paramIndex++;
    }

    if (status) {
      query += ` AND vr.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND vr.submitted_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND vr.submitted_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ' ORDER BY vr.submitted_at DESC';

    const result = await db.query(query, params);

    res.json({
      reports: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({
      error: 'Failed to retrieve reports',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/reports/:id
// Get single report details
router.get('/reports/:id', auth, async (req, res) => {
  try {
    const reportId = req.params.id;
    const facilityId = req.user.facility_id || req.user.clinic_id;
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    let query = `
      SELECT
        vr.*,
        hf.name as facility_name,
        a1.username as submitted_by_name,
        a2.username as reviewed_by_name
      FROM vaccination_reports vr
      JOIN clinics hf ON vr.facility_id = hf.id
      LEFT JOIN admin a1 ON vr.submitted_by = a1.id
      LEFT JOIN admin a2 ON vr.reviewed_by = a2.id
      WHERE vr.id = $1
    `;

    if (!isCityLevel) {
      query += ' AND vr.facility_id = $2';
    }

    const result = await db.query(query, isCityLevel ? [reportId] : [reportId, facilityId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Report not found',
        success: false,
      });
    }

    res.json({
      report: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({
      error: 'Failed to retrieve report',
      success: false,
    });
  }
});

// PUT /api/vaccine-supply/reports/:id/review
// Review and comment on report (City only)
router.put('/reports/:id/review', auth, async (req, res) => {
  try {
    const reportId = req.params.id;
    const { status, reviewNotes } = req.body;

    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';
    if (!isCityLevel) {
      return res.status(403).json({
        error: 'Only city-level users can review reports',
        success: false,
      });
    }

    const query = `
      UPDATE vaccination_reports SET
        status = $1,
        reviewed_by = $2,
        reviewed_at = CURRENT_TIMESTAMP,
        review_notes = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;

    const result = await db.query(query, [status, req.user.id, reviewNotes, reportId]);

    res.json({
      message: 'Report reviewed successfully',
      report: result.rows[0],
      success: true,
    });
  } catch (error) {
    console.error('Review report error:', error);
    res.status(500).json({
      error: 'Failed to review report',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/reports/consolidated
// Get consolidated city-wide report (City only)
router.get('/reports/consolidated', auth, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';
    if (!isCityLevel) {
      return res.status(403).json({
        error: 'Only city-level users can view consolidated reports',
        success: false,
      });
    }

    // Get summary by facility
    const summaryQuery = `
      SELECT
        hf.name as facility_name,
        hf.id as facility_id,
        COUNT(vr.id) as total_reports,
        COUNT(CASE WHEN vr.status = 'submitted' THEN 1 END) as pending_review,
        COUNT(CASE WHEN vr.status = 'reviewed' THEN 1 END) as reviewed,
        MAX(vr.submitted_at) as last_report_date
      FROM clinics hf
      LEFT JOIN vaccination_reports vr ON hf.id = vr.facility_id
      GROUP BY hf.id, hf.name
      ORDER BY hf.name
    `;

    // Get summary by vaccine type
    const vaccineQuery = `
      SELECT
        v.name as vaccine_name,
        v.code as vaccine_code,
        SUM((vr.vaccines_administered->>'total')::INTEGER) as total_administered
      FROM vaccination_reports vr
      CROSS JOIN LATERAL jsonb_array_elements(vr.vaccines_administered) va
      JOIN vaccines v ON va.vaccine_id = v.id::TEXT OR va.vaccine_name = v.name
      WHERE vr.submitted_at BETWEEN $1 AND $2
      GROUP BY v.id, v.name, v.code
      ORDER BY total_administered DESC
    `;

    const [summaryResult, vaccineResult] = await Promise.all([
      db.query(summaryQuery),
      db.query(vaccineQuery, [dateFrom || '1970-01-01', dateTo || '2099-12-31']),
    ]);

    res.json({
      facilitySummary: summaryResult.rows,
      vaccineSummary: vaccineResult.rows,
      period: { dateFrom, dateTo },
      success: true,
    });
  } catch (error) {
    console.error('Get consolidated report error:', error);
    res.status(500).json({
      error: 'Failed to retrieve consolidated report',
      success: false,
    });
  }
});

// ============================================================================
// DASHBOARD ENDPOINTS
// ============================================================================

// GET /api/vaccine-supply/dashboard/barangay/:id
// Get barangay health center dashboard
router.get('/dashboard/barangay/:id', auth, async (req, res) => {
  try {
    const { id: facilityId } = req.params;

    // Get current inventory
    const inventoryResult = await db.query(
      `
      SELECT
        COUNT(*) as total_items,
        SUM(quantity_on_hand) as total_quantity,
        COUNT(CASE WHEN expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 1 END) as expiring_soon,
        COUNT(CASE WHEN expiry_date <= CURRENT_DATE THEN 1 END) as expired
      FROM barangay_storage
      WHERE facility_id = $1 AND is_active = true
    `,
      [facilityId],
    );

    // Get pending requests
    const pendingRequestsResult = await db.query(
      `
      SELECT COUNT(*) as pending_count
      FROM vaccine_requests
      WHERE requesting_barangay_id = $1 AND status IN ('pending', 'under_review', 'approved')
    `,
      [facilityId],
    );

    // Get pending allocations
    const pendingAllocationsResult = await db.query(
      `
      SELECT COUNT(*) as pending_count
      FROM vaccine_allocations
      WHERE receiving_barangay_id = $1 AND status IN ('pending', 'prepared', 'in_transit')
    `,
      [facilityId],
    );

    // Get recent temperature logs
    const temperatureResult = await db.query(
      `
      SELECT
        COUNT(*) as total_readings,
        COUNT(CASE WHEN temperature_status = 'normal' THEN 1 END) as normal_readings,
        COUNT(CASE WHEN temperature_status IN ('warning', 'critical') THEN 1 END) as alerts
      FROM temperature_logs
      WHERE facility_id = $1
      AND recorded_at >= CURRENT_DATE - INTERVAL '7 days'
    `,
      [facilityId],
    );

    // Get recent reports
    const reportsResult = await db.query(
      `
      SELECT COUNT(*) as recent_reports
      FROM vaccination_reports
      WHERE facility_id = $1
      AND submitted_at >= CURRENT_DATE - INTERVAL '30 days'
    `,
      [facilityId],
    );

    res.json({
      dashboard: {
        inventory: inventoryResult.rows[0],
        pendingRequests: pendingRequestsResult.rows[0].pending_count,
        pendingAllocations: pendingAllocationsResult.rows[0].pending_count,
        temperature: temperatureResult.rows[0],
        recentReports: reportsResult.rows[0].recent_reports,
      },
      success: true,
    });
  } catch (error) {
    console.error('Get barangay dashboard error:', error);
    res.status(500).json({
      error: 'Failed to retrieve dashboard data',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/dashboard/city
// Get city health office dashboard
router.get('/dashboard/city', auth, async (req, res) => {
  try {
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';
    if (!isCityLevel) {
      return res.status(403).json({
        error: 'Only city-level users can view city dashboard',
        success: false,
      });
    }

    // Get pending requests from all barangays
    const pendingRequestsResult = await db.query(`
      SELECT
        COUNT(*) as total_pending,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority,
        COUNT(CASE WHEN priority = 'medium' THEN 1 END) as medium_priority,
        COUNT(CASE WHEN priority = 'low' THEN 1 END) as low_priority
      FROM vaccine_requests
      WHERE status IN ('pending', 'under_review')
    `);

    // Get active distributions
    const distributionsResult = await db.query(`
      SELECT
        COUNT(*) as total_active,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'prepared' THEN 1 END) as prepared,
        COUNT(CASE WHEN status = 'in_transit' THEN 1 END) as in_transit,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered
      FROM vaccine_allocations
      WHERE status IN ('pending', 'prepared', 'in_transit', 'delivered')
    `);

    // Get temperature alerts
    const alertsResult = await db.query(`
      SELECT
        COUNT(*) as total_alerts,
        COUNT(CASE WHEN temperature_status = 'critical' THEN 1 END) as critical,
        COUNT(CASE WHEN temperature_status = 'warning' THEN 1 END) as warning
      FROM temperature_logs
      WHERE temperature_status IN ('warning', 'critical')
      AND recorded_at >= CURRENT_DATE - INTERVAL '7 days'
    `);

    // Get facilities summary
    const facilitiesResult = await db.query(`
      SELECT
        COUNT(*) as total_barangays,
        0 as warehouses
      FROM clinics
    `);

    // Get recent reports
    const reportsResult = await db.query(`
      SELECT
        COUNT(*) as total_reports,
        COUNT(CASE WHEN status = 'submitted' THEN 1 END) as pending_review,
        COUNT(CASE WHEN status = 'reviewed' THEN 1 END) as reviewed
      FROM vaccination_reports
      WHERE submitted_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    res.json({
      dashboard: {
        pendingRequests: pendingRequestsResult.rows[0],
        activeDistributions: distributionsResult.rows[0],
        temperatureAlerts: alertsResult.rows[0],
        facilities: facilitiesResult.rows[0],
        recentReports: reportsResult.rows[0],
      },
      success: true,
    });
  } catch (error) {
    console.error('Get city dashboard error:', error);
    res.status(500).json({
      error: 'Failed to retrieve dashboard data',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/dashboard/alerts
// Get all active alerts
router.get('/dashboard/alerts', auth, async (req, res) => {
  try {
    const facilityId = req.user.facility_id || req.user.clinic_id;
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    // Get temperature alerts
    let tempAlertQuery = `
      SELECT
        'temperature' as alert_type,
        tl.id,
        tl.facility_id,
        hf.name as facility_name,
        tl.temperature_celsius,
        tl.temperature_status,
        tl.recorded_at,
        tl.notes
      FROM temperature_logs tl
      JOIN clinics hf ON tl.facility_id = hf.id
      WHERE tl.temperature_status IN ('warning', 'critical')
      AND tl.recorded_at >= CURRENT_DATE - INTERVAL '7 days'
    `;

    if (!isCityLevel) {
      tempAlertQuery += ' AND tl.facility_id = $1';
    }

    const tempAlerts = await db.query(tempAlertQuery, isCityLevel ? [] : [facilityId]);

    // Get low stock alerts
    let stockAlertQuery = `
      SELECT
        'low_stock' as alert_type,
        bs.id,
        bs.facility_id,
        hf.name as facility_name,
        bs.vaccine_id,
        v.name as vaccine_name,
        bs.quantity_on_hand,
        'low stock' as alert_reason
      FROM barangay_storage bs
      JOIN clinics hf ON bs.facility_id = hf.id
      JOIN vaccines v ON bs.vaccine_id = v.id
      WHERE bs.quantity_on_hand <= 10
    `;

    if (!isCityLevel) {
      stockAlertQuery += ' AND bs.facility_id = $1';
    }

    const stockAlerts = await db.query(stockAlertQuery, isCityLevel ? [] : [facilityId]);

    // Get expiring soon alerts
    let expiryAlertQuery = `
      SELECT
        'expiring' as alert_type,
        bs.id,
        bs.facility_id,
        hf.name as facility_name,
        bs.vaccine_id,
        v.name as vaccine_name,
        bs.expiry_date,
        EXTRACT(DAY FROM (bs.expiry_date - CURRENT_DATE)) as days_until_expiry
      FROM barangay_storage bs
      JOIN clinics hf ON bs.facility_id = hf.id
      JOIN vaccines v ON bs.vaccine_id = v.id
      WHERE bs.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
      AND bs.expiry_date > CURRENT_DATE
    `;

    if (!isCityLevel) {
      expiryAlertQuery += ' AND bs.facility_id = $1';
    }

    const expiryAlerts = await db.query(expiryAlertQuery, isCityLevel ? [] : [facilityId]);

    res.json({
      alerts: {
        temperature: tempAlerts.rows,
        lowStock: stockAlerts.rows,
        expiring: expiryAlerts.rows,
        total: tempAlerts.rows.length + stockAlerts.rows.length + expiryAlerts.rows.length,
      },
      success: true,
    });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      error: 'Failed to retrieve alerts',
      success: false,
    });
  }
});

// ============================================================================
// HELPER ENDPOINTS
// ============================================================================

// GET /api/vaccine-supply/facilities/barangays
// Get list of barangay health centers
router.get('/facilities/barangays', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        id,
        name,
        contact,
        address,
        'N/A' as cold_chain_capacity,
        false as has_digital_thermometer
      FROM clinics
      ORDER BY name
    `);

    res.json({
      facilities: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Get barangays error:', error);
    res.status(500).json({
      error: 'Failed to retrieve barangay list',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/facilities/warehouse
// Get city warehouse info
router.get('/facilities/warehouse', auth, async (req, res) => {
  try {
    // Return first clinic as warehouse or null
    const result = await db.query(`
      SELECT
        id,
        name,
        contact,
        address,
        'N/A' as cold_chain_capacity
      FROM clinics
      ORDER BY name
      LIMIT 1
    `);

    res.json({
      warehouse: result.rows[0] || null,
      success: true,
    });
  } catch (error) {
    console.error('Get warehouse error:', error);
    res.status(500).json({
      error: 'Failed to retrieve warehouse info',
      success: false,
    });
  }
});

// GET /api/vaccine-supply/vaccines
// Get list of vaccines
router.get('/vaccines', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        id,
        code,
        name,
        manufacturer,
        doses_required,
        is_active
      FROM vaccines
      WHERE is_active = true
      ORDER BY name
    `);

    res.json({
      vaccines: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Get vaccines error:', error);
    res.status(500).json({
      error: 'Failed to retrieve vaccine list',
      success: false,
    });
  }
});

module.exports = router;
