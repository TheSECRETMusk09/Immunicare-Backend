const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const socketService = require('../services/socketService');
const { validateApprovedVaccine } = require('../utils/approvedVaccines');

router.use(authenticateToken);

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
      administered_by,
      site_of_injection,
      reactions,
      next_due_date,
      notes,
      batch_id,
      vaccine_inventory_id,
      skip_inventory_deduction = false,
    } = req.body;

    // Validate required fields
    if (!patient_id || !vaccine_id || !dose_no || !admin_date) {
      return res.status(400).json({
        error: 'Missing required fields: patient_id, vaccine_id, dose_no, and admin_date are required',
      });
    }

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

    // Check for duplicate vaccination record
    const duplicateCheck = await client.query(
      `SELECT id FROM immunization_records
       WHERE patient_id = $1 AND vaccine_id = $2 AND dose_no = $3 AND is_active = true
       LIMIT 1`,
      [patient_id, vaccine_id, dose_no],
    );

    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Duplicate vaccination record for this infant and dose',
      });
    }

    let inventoryTransactionId = null;
    let batchUpdated = false;

    // Handle inventory deduction if not skipped
    if (!skip_inventory_deduction && batch_id) {
      // Check batch availability
      const batchResult = await client.query(
        `SELECT id, qty_current, vaccine_id FROM vaccine_batches
         WHERE id = $1 AND is_active = true AND status = 'active'`,
        [batch_id],
      );

      if (batchResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Selected vaccine batch not found or inactive' });
      }

      const batch = batchResult.rows[0];

      if (batch.qty_current < 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient vaccine stock in selected batch' });
      }

      // Deduct from batch
      await client.query(
        'UPDATE vaccine_batches SET qty_current = qty_current - 1 WHERE id = $1',
        [batch_id],
      );
      batchUpdated = true;

      // Create inventory transaction
      const txnResult = await client.query(
        `INSERT INTO vaccine_inventory_transactions (
          vaccine_inventory_id, vaccine_id, transaction_type, quantity,
          previous_balance, new_balance, reference_number, notes, performed_by
        ) VALUES ($1, $2, 'ISSUE', 1, $3, $3 - 1, $4, $5, $6)
        RETURNING id`,
        [
          vaccine_inventory_id || null,
          vaccine_id,
          batch.qty_current,
          `VAC-${patient_id}-${vaccine_id}-${dose_no}`,
          `Vaccination administered to infant ID ${patient_id}, dose ${dose_no}`,
          administered_by || req.user.id,
        ],
      );
      inventoryTransactionId = txnResult.rows[0].id;
    }

    // Create vaccination record
    const recordResult = await client.query(
      `INSERT INTO immunization_records (
        patient_id, vaccine_id, dose_no, admin_date, administered_by,
        site_of_injection, reactions, next_due_date, notes, status,
        batch_id, is_ready_confirmed, ready_confirmed_at, ready_confirmed_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10, $11, $12, $13)
      RETURNING *`,
      [
        patient_id,
        vaccine_id,
        dose_no,
        admin_date,
        administered_by || req.user.id,
        site_of_injection || null,
        reactions || null,
        next_due_date || null,
        notes || null,
        batch_id || null,
        isReady,
        isReady ? new Date() : null,
        isReady ? req.user.id : null,
      ],
    );

    const vaccinationRecord = recordResult.rows[0];

    // Create audit log
    await client.query(
      `INSERT INTO vaccination_audit_log (
        infant_id, vaccine_id, action_type, previous_status, new_status,
        inventory_deducted, inventory_transaction_id, performed_by, notes
      ) VALUES ($1, $2, 'VACCINATION_RECORDED', 'pending', 'completed', $3, $4, $5, $6)`,
      [
        patient_id,
        vaccine_id,
        batchUpdated,
        inventoryTransactionId,
        req.user.id,
        notes || null,
      ],
    );

    await client.query('COMMIT');

    // Broadcast updates
    socketService.broadcast('vaccination_created', vaccinationRecord);
    if (batchUpdated) {
      socketService.broadcast('inventory_updated', {
        batchId: batch_id,
        vaccineId: vaccine_id,
        change: -1,
      });
    }

    res.status(201).json({
      success: true,
      vaccination: vaccinationRecord,
      inventory: {
        deducted: batchUpdated,
        transactionId: inventoryTransactionId,
        batchUpdated,
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
         AND vb.status = 'active'
         AND vb.qty_current > 0
         AND vb.expiry_date > CURRENT_DATE
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
