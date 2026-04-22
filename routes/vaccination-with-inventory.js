const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const socketService = require('../services/socketService');
const { validateApprovedVaccine } = require('../utils/approvedVaccines');
const {
  isAutoAtBirthRecord,
  normalizeDateOnly,
} = require('../services/atBirthVaccinationService');

router.use(authenticateToken);

const schemaCache = new Map();

const resolveFirstExistingColumn = async (
  tableName,
  candidateColumns,
  fallback = candidateColumns[0],
) => {
  const cacheKey = `${tableName}:${candidateColumns.join(',')}`;
  if (schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey);
  }

  try {
    const result = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = ANY($2::text[])
      `,
      [tableName, candidateColumns],
    );

    const availableColumns = new Set(result.rows.map((row) => row.column_name));
    const resolvedColumn =
      candidateColumns.find((columnName) => availableColumns.has(columnName)) ||
      fallback;

    schemaCache.set(cacheKey, resolvedColumn);
    return resolvedColumn;
  } catch (_error) {
    schemaCache.set(cacheKey, fallback);
    return fallback;
  }
};

const getAppointmentPatientColumn = () =>
  resolveFirstExistingColumn('appointments', ['infant_id', 'patient_id'], 'infant_id');

const getInventoryTransactionsFacilityColumn = () =>
  resolveFirstExistingColumn(
    'vaccine_inventory_transactions',
    ['clinic_id', 'facility_id'],
    'clinic_id',
  );

const getBatchFacilityColumn = () =>
  resolveFirstExistingColumn('vaccine_batches', ['clinic_id', 'facility_id'], 'clinic_id');

const getInventoryFacilityColumn = () =>
  resolveFirstExistingColumn('vaccine_inventory', ['clinic_id', 'facility_id'], 'clinic_id');

const ensureAppointmentLinkColumn = async (client) => {
  await client.query(
    `
      ALTER TABLE immunization_records
        ADD COLUMN IF NOT EXISTS appointment_id INTEGER,
        ADD COLUMN IF NOT EXISTS is_ready_confirmed BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ready_confirmed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS ready_confirmed_by INTEGER,
        ADD COLUMN IF NOT EXISTS health_care_provider VARCHAR(255),
        ADD COLUMN IF NOT EXISTS route_of_injection VARCHAR(50),
        ADD COLUMN IF NOT EXISTS time_administered TIME,
        ADD COLUMN IF NOT EXISTS expiration_date DATE,
        ADD COLUMN IF NOT EXISTS schedule_id INTEGER
    `,
  );
};

const getScopedFacilityId = (user = {}) =>
  Number(user?.facility_id || user?.clinic_id || 0) || null;

const toNullableString = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const computeInventoryBalance = (inventoryRecord) => {
  return (
    Number(inventoryRecord.beginning_balance || 0) +
    Number(inventoryRecord.received_during_period || 0) +
    Number(inventoryRecord.transferred_in || 0) -
    Number(inventoryRecord.transferred_out || 0) -
    Number(inventoryRecord.expired_wasted || 0) -
    Number(inventoryRecord.issuance || 0)
  );
};

const validateAdministrationDateForPatient = async (patientId, adminDate) => {
  const normalizedAdminDate = normalizeDateOnly(adminDate);
  if (!normalizedAdminDate) {
    return {
      valid: false,
      error: 'Administration date must be a valid date',
    };
  }

  const patientResult = await pool.query(
    `
      SELECT dob
      FROM patients
      WHERE id = $1
        AND is_active = true
      LIMIT 1
    `,
    [patientId],
  );

  if (patientResult.rows.length === 0) {
    return {
      valid: false,
      error: 'Patient not found',
    };
  }

  const normalizedDob = normalizeDateOnly(patientResult.rows[0].dob);
  const today = normalizeDateOnly(new Date());

  if (normalizedAdminDate > today) {
    return {
      valid: false,
      error: 'Administration date cannot be in the future',
    };
  }

  if (normalizedDob && normalizedAdminDate < normalizedDob) {
    return {
      valid: false,
      error: 'Administration date cannot be earlier than the infant\'s date of birth',
    };
  }

  return {
    valid: true,
    normalizedAdminDate,
  };
};

const resolveLinkedAppointmentId = async ({ client, patientId, adminDate, appointmentId }) => {
  const appointmentPatientColumn = await getAppointmentPatientColumn();

  if (appointmentId) {
    const explicitResult = await client.query(
      `
        SELECT id, status
        FROM appointments
        WHERE id = $1
          AND ${appointmentPatientColumn} = $2
          AND is_active = true
        LIMIT 1
      `,
      [appointmentId, patientId],
    );

    return explicitResult.rows[0] || null;
  }

  const autoMatchedResult = await client.query(
    `
      SELECT id, status
      FROM appointments
      WHERE ${appointmentPatientColumn} = $1
        AND DATE(scheduled_date) = DATE($2)
        AND is_active = true
        AND status <> 'cancelled'
      ORDER BY
        CASE WHEN status = 'attended' THEN 1 ELSE 2 END,
        scheduled_date DESC
      LIMIT 1
    `,
    [patientId, adminDate],
  );

  return autoMatchedResult.rows[0] || null;
};

/**
 * Enhanced vaccination recording with automatic inventory deduction
 * POST /api/vaccinations/record-with-inventory
 */
router.post('/record-with-inventory', requirePermission('vaccination:create'), async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      patient_id,
      vaccine_id,
      dose_no,
      admin_date,
      appointment_id,
      administered_by,
      health_care_provider,
      site_of_injection,
      route_of_injection,
      time_administered,
      expiration_date,
      reactions,
      next_due_date,
      notes,
      batch_id,
      lot_batch_number,
      lot_number,
      batch_number,
      schedule_id,
      vaccine_inventory_id,
      skip_inventory_deduction = false,
    } = req.body;

    // Validate required fields
    if (!patient_id || !vaccine_id || !dose_no || !admin_date) {
      return res.status(400).json({
        error: 'Missing required fields: patient_id, vaccine_id, dose_no, and admin_date are required',
      });
    }

    const adminDateValidation = await validateAdministrationDateForPatient(patient_id, admin_date);
    if (!adminDateValidation.valid) {
      return res.status(400).json({ error: adminDateValidation.error });
    }

    const normalizedAdminDate = adminDateValidation.normalizedAdminDate;
    const scopedFacilityId = getScopedFacilityId(req.user);
    const normalizedLotBatchNumber =
      toNullableString(lot_batch_number) ||
      toNullableString(lot_number) ||
      toNullableString(batch_number);
    const normalizedHealthCareProvider = toNullableString(health_care_provider);
    const normalizedRouteOfInjection = toNullableString(route_of_injection);
    const normalizedTimeAdministered = toNullableString(time_administered);
    const normalizedExpirationDate = normalizeDateOnly(expiration_date);
    const normalizedScheduleId = Number.parseInt(schedule_id, 10) || null;

    // Validate vaccine is approved
    const vaccineValidation = await validateApprovedVaccine(vaccine_id);
    if (!vaccineValidation.valid) {
      return res.status(400).json({ error: vaccineValidation.error });
    }

    // Verify infant exists
    const infantResult = await client.query(
      'SELECT id, first_name, last_name, dob FROM patients WHERE id = $1 AND is_active = true',
      [patient_id],
    );

    if (infantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Infant not found' });
    }

    // Check if infant is ready for this vaccine
    const readinessResult = await client.query(
      `SELECT is_ready FROM infant_vaccine_readiness
       WHERE infant_id = $1 AND vaccine_id = $2 AND is_active = true AND is_ready = true`,
      [patient_id, vaccine_id],
    );

    const isReady = readinessResult.rows.length > 0;

    await client.query('BEGIN');
    await ensureAppointmentLinkColumn(client);

    // Check for duplicate vaccination record
    const duplicateCheck = await client.query(
      `SELECT * FROM immunization_records
       WHERE patient_id = $1 AND vaccine_id = $2 AND dose_no = $3 AND is_active = true
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [patient_id, vaccine_id, dose_no],
    );

    let existingPlaceholderRecord = null;
    if (duplicateCheck.rows.length > 0) {
      const existingRecord = duplicateCheck.rows[0];
      const existingStatus = String(existingRecord.status || '').trim().toLowerCase();

      if (
        isAutoAtBirthRecord(existingRecord) ||
        !existingRecord.admin_date ||
        existingStatus === 'pending' ||
        existingStatus === 'scheduled'
      ) {
        existingPlaceholderRecord = existingRecord;
      } else {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Duplicate vaccination record for this infant and dose',
        });
      }
    }

    const linkedAppointment = await resolveLinkedAppointmentId({
      client,
      patientId: patient_id,
      adminDate: normalizedAdminDate,
      appointmentId: appointment_id,
    });

    let inventoryTransactionId = null;
    let batchUpdated = false;
    let updatedBatchRecord = null;
    let inventoryDeducted = false;
    let updatedInventoryRecord = null;

    if (skip_inventory_deduction && batch_id) {
      const batchFacilityColumn = await getBatchFacilityColumn();
      const batchResult = await client.query(
        `SELECT id, vaccine_id, ${batchFacilityColumn} AS scoped_facility_id
         FROM vaccine_batches
         WHERE id = $1 AND is_active = true AND status = 'active'`,
        [batch_id],
      );

      if (batchResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Selected vaccine batch not found or inactive' });
      }

      const batch = batchResult.rows[0];
      if (Number(batch.vaccine_id) !== Number(vaccine_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Selected vaccine batch does not match the vaccine being recorded',
        });
      }

      const batchFacilityId = Number(batch.scoped_facility_id || 0) || null;
      if (scopedFacilityId && batchFacilityId && batchFacilityId !== scopedFacilityId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Selected vaccine batch is outside your clinic scope',
        });
      }
    }

    // Handle inventory deduction if not skipped
    if (!skip_inventory_deduction) {
      if (!vaccine_inventory_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A vaccine inventory record is required for stock deduction' });
      }

      const inventoryResult = await client.query(
        'SELECT * FROM vaccine_inventory WHERE id = $1 LIMIT 1',
        [vaccine_inventory_id],
      );

      if (inventoryResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Selected vaccine inventory record was not found' });
      }

      const inventoryRecord = inventoryResult.rows[0];
      const inventoryFacilityColumn = await getInventoryFacilityColumn();
      const inventoryFacilityId = inventoryFacilityColumn
        ? Number(inventoryRecord[inventoryFacilityColumn] || 0) || null
        : null;

      if (Number(inventoryRecord.vaccine_id) !== Number(vaccine_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Selected vaccine inventory record does not match the vaccine being recorded' });
      }

      if (scopedFacilityId && inventoryFacilityId && inventoryFacilityId !== scopedFacilityId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Selected vaccine inventory record is outside your clinic scope',
        });
      }

      const previousBalance = computeInventoryBalance(inventoryRecord);
      if (previousBalance < 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient stock in the selected vaccine inventory record' });
      }

      // Check batch availability
      if (batch_id) {
        const batchFacilityColumn = await getBatchFacilityColumn();
        const batchResult = await client.query(
          `SELECT id, qty_current, vaccine_id, ${batchFacilityColumn} AS scoped_facility_id FROM vaccine_batches
           WHERE id = $1 AND is_active = true AND status = 'active'`,
          [batch_id],
        );

        if (batchResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Selected vaccine batch not found or inactive' });
        }

        const batch = batchResult.rows[0];

        if (Number(batch.vaccine_id) !== Number(vaccine_id)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Selected vaccine batch does not match the vaccine being recorded',
          });
        }

        const batchFacilityId = Number(batch.scoped_facility_id || 0) || null;
        if (scopedFacilityId && batchFacilityId && batchFacilityId !== scopedFacilityId) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Selected vaccine batch is outside your clinic scope',
          });
        }

        if (inventoryFacilityId && batchFacilityId && inventoryFacilityId !== batchFacilityId) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Selected vaccine batch does not belong to the same clinic as the inventory record',
          });
        }

        if (batch.qty_current < 1) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Insufficient vaccine stock in selected batch' });
        }

        // Deduct from batch
        await client.query(
          'UPDATE vaccine_batches SET qty_current = qty_current - 1 WHERE id = $1',
          [batch_id],
        );
        const updatedBatchResult = await client.query(
          `SELECT *
           FROM vaccine_batches
           WHERE id = $1
           LIMIT 1`,
          [batch_id],
        );
        updatedBatchRecord = updatedBatchResult.rows[0] || null;
        batchUpdated = true;
      }

      const transactionFacilityColumn = await getInventoryTransactionsFacilityColumn();
      const facilityId =
        inventoryRecord.clinic_id ||
        inventoryRecord.facility_id ||
        req.user.clinic_id ||
        req.user.facility_id ||
        null;
      const newBalance = previousBalance - 1;

      const transactionColumns = [
        'vaccine_inventory_id',
        'vaccine_id',
        'transaction_type',
        'quantity',
        'previous_balance',
        'new_balance',
        'reference_number',
        'notes',
        'performed_by',
      ];
      const transactionValues = [
        vaccine_inventory_id,
        vaccine_id,
        'ISSUE',
        1,
        previousBalance,
        newBalance,
        `VAC-${patient_id}-${vaccine_id}-${dose_no}`,
        `Vaccination administered to infant ID ${patient_id}, dose ${dose_no}`,
        administered_by || req.user.id,
      ];

      if (facilityId) {
        transactionColumns.splice(2, 0, transactionFacilityColumn);
        transactionValues.splice(2, 0, facilityId);
      }

      // Create inventory transaction
      const transactionPlaceholders = transactionValues.map((_, index) => `$${index + 1}`);
      const txnResult = await client.query(
        `INSERT INTO vaccine_inventory_transactions (
          ${transactionColumns.join(', ')}
        ) VALUES (${transactionPlaceholders.join(', ')})
        RETURNING id`,
        transactionValues,
      );
      inventoryTransactionId = txnResult.rows[0].id;

      const inventoryUpdateResult = await client.query(
        `UPDATE vaccine_inventory
         SET issuance = COALESCE(issuance, 0) + 1,
             stock_on_hand = $2,
             updated_by = $1,
             is_low_stock = CASE
               WHEN ($2 <= COALESCE(low_stock_threshold, 10)) THEN true
               ELSE false
             END,
             is_critical_stock = CASE
               WHEN ($2 <= COALESCE(critical_stock_threshold, 5)) THEN true
               ELSE false
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [req.user.id, newBalance, vaccine_inventory_id],
      );

      updatedInventoryRecord = inventoryUpdateResult.rows[0] || null;
      inventoryDeducted = inventoryUpdateResult.rowCount > 0;
    }

    let vaccinationRecord = null;
    let socketEventName = 'vaccination_created';

    if (existingPlaceholderRecord) {
      const updateResult = await client.query(
        `UPDATE immunization_records
         SET admin_date = $1,
             administered_by = COALESCE($2, administered_by),
             site_of_injection = $3,
             reactions = $4,
             next_due_date = $5,
             notes = $6,
             status = 'completed',
             batch_id = COALESCE($7, batch_id),
             appointment_id = COALESCE($8, appointment_id),
             lot_number = COALESCE($9, lot_number),
             batch_number = COALESCE($10, batch_number),
             health_care_provider = $11,
             route_of_injection = $12,
             time_administered = $13,
             expiration_date = $14,
             schedule_id = COALESCE(schedule_id, $15),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $16
         RETURNING *`,
        [
          normalizedAdminDate,
          administered_by || req.user.id,
          site_of_injection || null,
          reactions || null,
          next_due_date || null,
          notes || null,
          batch_id || null,
          linkedAppointment?.id || null,
          normalizedLotBatchNumber,
          normalizedLotBatchNumber,
          normalizedHealthCareProvider,
          normalizedRouteOfInjection,
          normalizedTimeAdministered,
          normalizedExpirationDate,
          normalizedScheduleId,
          existingPlaceholderRecord.id,
        ],
      );

      vaccinationRecord = updateResult.rows[0] || null;
      socketEventName = 'vaccination_updated';
    } else {
      const recordResult = await client.query(
        `INSERT INTO immunization_records (
          patient_id, vaccine_id, dose_no, admin_date, administered_by,
          site_of_injection, reactions, next_due_date, notes, status,
          batch_id, is_ready_confirmed, ready_confirmed_at, ready_confirmed_by, appointment_id,
          lot_number, batch_number, health_care_provider, route_of_injection,
          time_administered, expiration_date, schedule_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING *`,
        [
          patient_id,
          vaccine_id,
          dose_no,
          normalizedAdminDate,
          administered_by || req.user.id,
          site_of_injection || null,
          reactions || null,
          next_due_date || null,
          notes || null,
          batch_id || null,
          isReady,
          isReady ? new Date() : null,
          isReady ? req.user.id : null,
          linkedAppointment?.id || null,
          normalizedLotBatchNumber,
          normalizedLotBatchNumber,
          normalizedHealthCareProvider,
          normalizedRouteOfInjection,
          normalizedTimeAdministered,
          normalizedExpirationDate,
          normalizedScheduleId,
        ],
      );

      vaccinationRecord = recordResult.rows[0] || null;
    }

    if (linkedAppointment?.id) {
      await client.query(
        `UPDATE appointments
         SET status = 'attended',
             completion_notes = COALESCE(completion_notes, 'Vaccination recorded'),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [linkedAppointment.id],
      );
    }

    // Create audit log
    await client.query(
      `INSERT INTO vaccination_audit_log (
        infant_id, vaccine_id, action_type, previous_status, new_status,
       inventory_deducted, inventory_transaction_id, performed_by, notes
      ) VALUES ($1, $2, 'VACCINATION_RECORDED', $3, 'completed', $4, $5, $6, $7)`,
      [
        patient_id,
        vaccine_id,
        existingPlaceholderRecord?.status || 'pending',
        inventoryDeducted,
        inventoryTransactionId,
        req.user.id,
        notes || null,
      ],
    );

    await client.query('COMMIT');

    // Broadcast updates
    socketService.broadcast(socketEventName, vaccinationRecord);
    if (updatedInventoryRecord) {
      socketService.broadcast('vaccine_inventory_updated', updatedInventoryRecord);
    }
    if (inventoryTransactionId) {
      socketService.broadcast('vaccine_inventory_transaction_created', {
        id: inventoryTransactionId,
        vaccine_inventory_id,
        vaccine_id,
        transaction_type: 'ISSUE',
        quantity: 1,
        previous_balance: updatedInventoryRecord
          ? Number(updatedInventoryRecord.stock_on_hand || 0) + 1
          : null,
        new_balance: updatedInventoryRecord
          ? Number(updatedInventoryRecord.stock_on_hand || 0)
          : null,
        performed_by: administered_by || req.user.id,
        notes: `Vaccination administered to infant ID ${patient_id}, dose ${dose_no}`,
      });
    }
    if (batchUpdated) {
      socketService.broadcast('vaccine_batch_updated', {
        ...updatedBatchRecord,
        change: -1,
      });
      socketService.broadcast('inventory_updated', {
        batchId: batch_id,
        vaccineId: vaccine_id,
        change: -1,
      });
    }
    if (linkedAppointment?.id) {
      socketService.broadcast('appointment_updated', {
        id: linkedAppointment.id,
        status: 'attended',
      });
    }

    res.status(existingPlaceholderRecord ? 200 : 201).json({
      success: true,
      vaccination: vaccinationRecord,
      appointment: linkedAppointment
        ? {
          id: linkedAppointment.id,
          status: 'attended',
        }
        : null,
      inventory: {
        deducted: inventoryDeducted,
        transactionId: inventoryTransactionId,
        batchUpdated,
        inventoryRecord: updatedInventoryRecord,
      },
      readiness: {
        wasConfirmed: isReady,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error recording vaccination with inventory:', error);
    res.status(500).json({ error: 'Failed to record vaccination' });
  } finally {
    client.release();
  }
});

/**
 * Get vaccination inventory status for a specific vaccine
 * GET /api/vaccinations/inventory-status/:vaccineId
 */
router.get('/inventory-status/:vaccineId', async (req, res) => {
  try {
    const vaccineId = parseInt(req.params.vaccineId, 10);

    if (Number.isNaN(vaccineId)) {
      return res.status(400).json({ error: 'Invalid vaccine ID' });
    }

    const clinicId = req.user.clinic_id || req.user.facility_id;

    if (!clinicId) {
      return res.status(400).json({ error: 'Clinic ID not found for user' });
    }

    // Get available batches
    const batchesResult = await pool.query(
      `SELECT vb.id, vb.lot_no, vb.qty_current, vb.expiry_date, vb.status,
              v.name as vaccine_name, v.code as vaccine_code
       FROM vaccine_batches vb
       JOIN vaccines v ON vb.vaccine_id = v.id
       WHERE vb.vaccine_id = $1
         AND vb.clinic_id = $2
         AND vb.is_active = true
         AND vb.qty_current > 0
         AND vb.expiry_date >= CURRENT_DATE
       ORDER BY vb.expiry_date ASC`,
      [vaccineId, clinicId],
    );

    // Get total available
    const totalAvailable = batchesResult.rows.reduce((sum, batch) => sum + batch.qty_current, 0);

    // Get vaccine info
    const vaccineResult = await pool.query(
      'SELECT id, name, code, manufacturer FROM vaccines WHERE id = $1',
      [vaccineId],
    );

    if (vaccineResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine not found' });
    }

    res.json({
      vaccine: vaccineResult.rows[0],
      totalAvailable,
      batches: batchesResult.rows,
      clinicId,
    });
  } catch (error) {
    console.error('Error fetching inventory status:', error);
    res.status(500).json({ error: 'Failed to fetch inventory status' });
  }
});

/**
 * Get all inventory transactions for monitoring
 * GET /api/vaccinations/transactions
 */
router.get('/transactions', requirePermission('vaccination:view'), async (req, res) => {
  try {
    const { infant_id, vaccine_id, start_date, end_date, limit = 100 } = req.query;

    let query = `
      SELECT val.*, v.name as vaccine_name, p.first_name, p.last_name
      FROM vaccination_audit_log val
      LEFT JOIN vaccines v ON val.vaccine_id = v.id
      LEFT JOIN patients p ON val.infant_id = p.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (infant_id) {
      query += ` AND val.infant_id = $${paramCount}`;
      params.push(parseInt(infant_id, 10));
      paramCount++;
    }

    if (vaccine_id) {
      query += ` AND val.vaccine_id = $${paramCount}`;
      params.push(parseInt(vaccine_id, 10));
      paramCount++;
    }

    if (start_date) {
      query += ` AND val.created_at >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }

    if (end_date) {
      query += ` AND val.created_at <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }

    query += ` ORDER BY val.created_at DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit, 10));

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vaccination transactions:', error);
    res.status(500).json({ error: 'Failed to fetch vaccination transactions' });
  }
});

module.exports = router;
