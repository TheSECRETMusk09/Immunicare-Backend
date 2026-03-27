const pool = require('../db');
const { parsePagination, buildPaginationMeta, getPaginationClause } = require('../utils/pagination');
const {
  validateApprovedVaccine,
  validateApprovedVaccineName,
} = require('../utils/approvedVaccines');

// Get vaccine inventory by clinic
exports.getVaccineInventoryByClinic = async (req, res) => {
  try {
    const { clinic_id } = req.params;
    const { period_start, period_end } = req.query;
    const pagination = parsePagination(req.query);

    let query = `
      SELECT vi.*, c.name as clinic_name, u.username as created_by_name
      FROM vaccine_inventory vi
      JOIN clinics c ON vi.clinic_id = c.id
      JOIN users u ON vi.created_by = u.id
      WHERE vi.clinic_id = $1
    `;
    const params = [clinic_id];

    if (period_start && period_end) {
      query += ' AND vi.period_start >= $2 AND vi.period_end <= $3';
      params.push(period_start, period_end);
    }

    // Get total count
    const countQuery = query.replace(/SELECT vi\.\*/, 'SELECT COUNT(*) as total,');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    query += ' ORDER BY vi.vaccine_name';
    query += getPaginationClause(pagination.limit, pagination.offset);

    const result = await pool.query(query, params);
    res.json({
      data: result.rows,
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    });
  } catch (error) {
    console.error('Error getting vaccine inventory:', error);
    res.status(500).json({ error: error.message });
  }
};

// Create vaccine inventory record
exports.createVaccineInventory = async (req, res) => {
  try {
    const {
      vaccine_name,
      beginning_balance,
      received_during_period,
      lot_batch_number,
      transferred_in,
      transferred_out,
      expired_wasted,
      issuance,
      clinic_id,
      period_start,
      period_end,
    } = req.body;

    const vaccineNameValidation = validateApprovedVaccineName(vaccine_name);
    if (!vaccineNameValidation.valid) {
      return res.status(400).json({ error: vaccineNameValidation.error });
    }

    const result = await pool.query(
      `INSERT INTO vaccine_inventory (
        vaccine_name, beginning_balance, received_during_period, lot_batch_number,
        transferred_in, transferred_out, expired_wasted, issuance, clinic_id,
        period_start, period_end, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        vaccineNameValidation.vaccineName,
        beginning_balance,
        received_during_period,
        lot_batch_number,
        transferred_in,
        transferred_out,
        expired_wasted,
        issuance,
        clinic_id,
        period_start,
        period_end,
        req.user.id,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating vaccine inventory:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update vaccine inventory record
exports.updateVaccineInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      vaccine_name,
      beginning_balance,
      received_during_period,
      lot_batch_number,
      transferred_in,
      transferred_out,
      expired_wasted,
      issuance,
      period_start,
      period_end,
    } = req.body;

    const vaccineNameValidation = validateApprovedVaccineName(vaccine_name);
    if (!vaccineNameValidation.valid) {
      return res.status(400).json({ error: vaccineNameValidation.error });
    }

    const result = await pool.query(
      `UPDATE vaccine_inventory SET
        vaccine_name = $1,
        beginning_balance = $2,
        received_during_period = $3,
        lot_batch_number = $4,
        transferred_in = $5,
        transferred_out = $6,
        expired_wasted = $7,
        issuance = $8,
        period_start = $9,
        period_end = $10,
        updated_by = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING *`,
      [
        vaccineNameValidation.vaccineName,
        beginning_balance,
        received_during_period,
        lot_batch_number,
        transferred_in,
        transferred_out,
        expired_wasted,
        issuance,
        period_start,
        period_end,
        req.user.id,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine inventory record not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating vaccine inventory:', error);
    res.status(500).json({ error: error.message });
  }
};

// Delete vaccine inventory record
exports.deleteVaccineInventory = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM vaccine_inventory WHERE id = $1 RETURNING *', [
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine inventory record not found' });
    }

    res.json({ message: 'Vaccine inventory record deleted successfully' });
  } catch (error) {
    console.error('Error deleting vaccine inventory:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get vaccine inventory transactions
exports.getVaccineInventoryTransactions = async (req, res) => {
  try {
    const { vaccine_inventory_id } = req.params;
    const pagination = parsePagination(req.query);

    let query = `
      SELECT vit.*, u.username as performed_by_name, ua.username as approved_by_name
      FROM vaccine_inventory_transactions vit
      LEFT JOIN users u ON vit.performed_by = u.id
      LEFT JOIN users ua ON vit.approved_by = ua.id
      WHERE vit.vaccine_inventory_id = $1
    `;
    const params = [vaccine_inventory_id];

    // Get total count
    const countQuery = query.replace(/SELECT vit\.\*/, 'SELECT COUNT(*) as total,');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    query += ' ORDER BY vit.created_at DESC';
    query += getPaginationClause(pagination.limit, pagination.offset);

    const result = await pool.query(query, params);
    res.json({
      data: result.rows,
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    });
  } catch (error) {
    console.error('Error getting vaccine inventory transactions:', error);
    res.status(500).json({ error: error.message });
  }
};

// Create vaccine inventory transaction
exports.createVaccineInventoryTransaction = async (req, res) => {
  try {
    const {
      vaccine_inventory_id,
      vaccine_id,
      clinic_id,
      transaction_type,
      quantity,
      lot_number,
      batch_number,
      expiry_date,
      supplier_name,
      reference_number,
      notes,
    } = req.body;

    // Log incoming request data for debugging
    console.log('Creating vaccine inventory transaction:', {
      vaccine_inventory_id,
      vaccine_id,
      clinic_id,
      transaction_type,
      quantity,
      lot_number,
      batch_number,
      expiry_date,
      supplier_name,
      reference_number,
      notes,
      userId: req.user?.id,
    });

    // Validate required fields
    if (!vaccine_inventory_id) {
      return res.status(400).json({ error: 'Vaccine inventory ID is required' });
    }
    if (!vaccine_id) {
      return res.status(400).json({ error: 'Vaccine ID is required' });
    }
    if (!transaction_type) {
      return res.status(400).json({ error: 'Transaction type is required' });
    }
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Valid quantity is required' });
    }

    const vaccineValidation = await validateApprovedVaccine(vaccine_id, {
      fieldName: 'vaccine_id',
    });
    if (!vaccineValidation.valid) {
      return res.status(400).json({ error: vaccineValidation.error });
    }

    // Fetch the inventory record to get current stock and verify vaccine_id and clinic_id
    const inventoryResult = await pool.query(
      'SELECT * FROM vaccine_inventory WHERE id = $1',
      [vaccine_inventory_id],
    );

    if (inventoryResult.rows.length === 0) {
      console.error(`Vaccine inventory record not found: ${vaccine_inventory_id}`);
      return res.status(404).json({ error: 'Vaccine inventory record not found' });
    }

    const inventory = inventoryResult.rows[0];

    // Verify that the provided vaccine_id and clinic_id match the inventory record (if provided)
    if (
      vaccine_id !== undefined &&
      vaccine_id !== null &&
      Number(vaccineValidation.vaccine.id) !== Number(inventory.vaccine_id)
    ) {
      console.error(`Vaccine ID mismatch: provided ${vaccine_id}, inventory has ${inventory.vaccine_id}`);
      return res.status(400).json({ error: 'Vaccine ID does not match inventory record' });
    }
    if (clinic_id !== undefined && clinic_id !== null && clinic_id !== inventory.clinic_id) {
      console.error(`Clinic ID mismatch: provided ${clinic_id}, inventory has ${inventory.clinic_id}`);
      return res.status(400).json({ error: 'Clinic ID does not match inventory record' });
    }

    // Use the inventory record's vaccine_id and clinic_id for consistency
    const finalVaccineId = inventory.vaccine_id;
    const finalClinicId = inventory.clinic_id;

    // Calculate previous and new balances
    const previousBalance = inventory.stock_on_hand !== null ? inventory.stock_on_hand : 0;
    let newBalance;
    if (transaction_type === 'ISSUE') {
      newBalance = previousBalance - quantity;
    } else if (transaction_type === 'RECEIPT' || transaction_type === 'ADJUSTMENT') {
      newBalance = previousBalance + quantity;
    } else {
      // For other transaction types, assume no change in stock (or handle as needed)
      newBalance = previousBalance;
    }

    // Ensure newBalance is not negative
    if (newBalance < 0) {
      console.error(`Insufficient stock: previousBalance=${previousBalance}, quantity=${quantity}`);
      return res.status(400).json({ error: 'Insufficient stock for ISSUE transaction' });
    }

    // Check if this transaction results in out of stock
    const isOutOfStock = newBalance === 0;

    console.log(`Processing transaction: vaccineId=${finalVaccineId}, clinicId=${finalClinicId}, previousBalance=${previousBalance}, quantity=${quantity}, newBalance=${newBalance}, isOutOfStock=${isOutOfStock}`);

    // Start transaction to ensure consistency
    await pool.query('BEGIN');

    try {
      const result = await pool.query(
        `INSERT INTO vaccine_inventory_transactions (
           vaccine_inventory_id, vaccine_id, clinic_id, transaction_type, quantity, lot_number, batch_number,
           expiry_date, supplier_name, reference_number, notes, performed_by, previous_balance, new_balance
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          vaccine_inventory_id,
          finalVaccineId,
          finalClinicId,
          transaction_type,
          quantity,
          lot_number,
          batch_number,
          expiry_date,
          supplier_name,
          reference_number,
          notes,
          req.user.id,
          previousBalance,
          newBalance,
        ],
      );

      // Update vaccine inventory stock_on_hand
      await pool.query(
        'UPDATE vaccine_inventory SET stock_on_hand = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newBalance, vaccine_inventory_id],
      );

      // Handle out of stock and low stock alerts
      if (isOutOfStock || (newBalance > 0 && newBalance <= 10)) {
        // Get vaccine and clinic details for the alert
        const inventoryDetails = await pool.query(
          `SELECT vi.stock_on_hand, v.name as vaccine_name, c.name as clinic_name
            FROM vaccine_inventory vi
            JOIN vaccines v ON vi.vaccine_id = v.id
            JOIN clinics c ON vi.clinic_id = c.id
            WHERE vi.id = $1`,
          [vaccine_inventory_id],
        );

        const { vaccine_name, clinic_name } = inventoryDetails.rows[0];

        if (isOutOfStock) {
          // Check if there's already an active out-of-stock alert for this inventory item to prevent duplicates
          const existingAlert = await pool.query(
            `SELECT id FROM vaccine_stock_alerts
              WHERE vaccine_inventory_id = $1 AND alert_type = 'OUT_OF_STOCK' AND status = 'ACTIVE'`,
            [vaccine_inventory_id],
          );

          if (existingAlert.rows.length === 0) {
            // Create new out-of-stock alert
            await pool.query(
              `INSERT INTO vaccine_stock_alerts (
                 vaccine_inventory_id, vaccine_id, facility_id, alert_type, current_stock, threshold_value,
                 status, message, priority
               ) VALUES ($1, $2, $3, 'OUT_OF_STOCK', $4, $5, 'ACTIVE', $6, 'URGENT')`,
              [
                vaccine_inventory_id,
                finalVaccineId,
                finalClinicId,
                newBalance, // current_stock = 0
                0, // threshold_value = 0 for out of stock
                `${vaccine_name} at ${clinic_name} is OUT OF STOCK: 0 remaining.`,
              ],
            );

            // Send notifications using admin notification service
            const adminNotificationService = require('../services/adminNotificationService');
            await adminNotificationService.sendOutOfStockAlert(
              vaccine_name,
              finalVaccineId,
              lot_number || 'UNKNOWN',
            );
          }
        } else if (newBalance > 0 && newBalance <= 10) {
          // Check if there's already an active low stock alert
          const existingLowStockAlert = await pool.query(
            `SELECT id FROM vaccine_stock_alerts
              WHERE vaccine_inventory_id = $1 AND alert_type = 'LOW_STOCK' AND status = 'ACTIVE'`,
            [vaccine_inventory_id],
          );

          if (existingLowStockAlert.rows.length === 0) {
            // Create new low stock alert
            await pool.query(
              `INSERT INTO vaccine_stock_alerts (
                 vaccine_inventory_id, vaccine_id, facility_id, alert_type, current_stock, threshold_value,
                 status, message, priority
               ) VALUES ($1, $2, $3, 'LOW_STOCK', $4, $5, 'ACTIVE', $6, 'HIGH')`,
              [
                vaccine_inventory_id,
                finalVaccineId,
                finalClinicId,
                newBalance,
                10,
                `${vaccine_name} at ${clinic_name} is running LOW: ${newBalance} remaining.`,
              ],
            );
          }
        }
      }

      await pool.query('COMMIT');

      console.log(`Successfully created vaccine inventory transaction: ${result.rows[0].id}`);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

    console.log(`Successfully created vaccine inventory transaction: ${result.rows[0].id}`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating vaccine inventory transaction:', error);
    // Log additional context for debugging
    console.error('Request body:', req.body);
    console.error('User:', req.user);
    res.status(500).json({ error: error.message });
  }
};

// Get vaccine stock alerts
exports.getVaccineStockAlerts = async (req, res) => {
  try {
    const { clinic_id } = req.params;
    const pagination = parsePagination(req.query);

    let query = `
      SELECT vsa.*, vi.vaccine_name, c.name as clinic_name,
              u.username as acknowledged_by_name, ur.username as resolved_by_name
      FROM vaccine_stock_alerts vsa
      JOIN vaccine_inventory vi ON vsa.vaccine_inventory_id = vi.id
      JOIN clinics c ON vi.clinic_id = c.id
      LEFT JOIN users u ON vsa.acknowledged_by = u.id
      LEFT JOIN users ur ON vsa.resolved_by = ur.id
      WHERE vi.clinic_id = $1 AND vsa.status = 'ACTIVE'
    `;
    const params = [clinic_id];

    // Get total count
    const countQuery = query.replace(/SELECT vsa\.\*/, 'SELECT COUNT(*) as total,');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    query += ' ORDER BY vsa.priority DESC, vsa.created_at DESC';
    query += getPaginationClause(pagination.limit, pagination.offset);

    const result = await pool.query(query, params);
    res.json({
      data: result.rows,
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    });
  } catch (error) {
    console.error('Error getting vaccine stock alerts:', error);
    res.status(500).json({ error: error.message });
  }
};

// Acknowledge vaccine stock alert
exports.acknowledgeVaccineStockAlert = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE vaccine_stock_alerts SET
        status = 'ACKNOWLEDGED',
        acknowledged_by = $1,
        acknowledged_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *`,
      [req.user.id, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine stock alert not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error acknowledging vaccine stock alert:', error);
    res.status(500).json({ error: error.message });
  }
};

// Resolve vaccine stock alert
exports.resolveVaccineStockAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_notes } = req.body;

    const result = await pool.query(
      `UPDATE vaccine_stock_alerts SET
        status = 'RESOLVED',
        resolved_by = $1,
        resolved_at = CURRENT_TIMESTAMP,
        resolution_notes = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *`,
      [req.user.id, resolution_notes, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine stock alert not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error resolving vaccine stock alert:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get vaccine inventory statistics
exports.getVaccineInventoryStats = async (req, res) => {
  try {
    const { clinic_id } = req.params;

    const [totalInventory, lowStock, expiringItems, recentTransactions] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM vaccine_inventory WHERE clinic_id = $1', [
        clinic_id,
      ]),
      pool.query(
        'SELECT COUNT(*) as count FROM vaccine_inventory WHERE clinic_id = $1 AND stock_on_hand <= 10 AND stock_on_hand > 0',
        [clinic_id],
      ),
      pool.query(
        'SELECT COUNT(*) as count FROM vaccine_inventory WHERE clinic_id = $1 AND stock_on_hand <= 5',
        [clinic_id],
      ),
      pool.query(
        `SELECT COUNT(*) as count
           FROM vaccine_inventory_transactions vit
          WHERE vit.clinic_id = $1
            AND vit.created_at >= CURRENT_DATE - INTERVAL '30 days'`,
        [clinic_id],
      ),
    ]);

    res.json({
      totalInventory: parseInt(totalInventory.rows[0].count),
      lowStock: parseInt(lowStock.rows[0].count),
      expiringItems: parseInt(expiringItems.rows[0].count),
      recentTransactions: parseInt(recentTransactions.rows[0].count),
    });
  } catch (error) {
    console.error('Error getting vaccine inventory stats:', error);
    res.status(500).json({ error: error.message });
  }
};
