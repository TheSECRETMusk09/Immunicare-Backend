const express = require('express');
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const vaccineInventoryController = require('../controllers/vaccineInventoryController');

const router = express.Router();

// Middleware to authenticate all inventory routes
router.use(authenticateToken);

// Middleware to require admin role for vaccine inventory management
const requireAdmin = requireRole(['admin', 'super_admin', 'clinic_manager', 'healthcare_worker']);

// Apply admin protection to vaccine inventory routes
router.use('/vaccine-inventory', requireAdmin);
router.use('/vaccine-inventory-transactions', requireAdmin);
router.use('/vaccine-stock-alerts', requireAdmin);

// Vaccine Inventory Routes
router.get(
  '/vaccine-inventory/clinic/:clinic_id',
  vaccineInventoryController.getVaccineInventoryByClinic,
);
router.post('/vaccine-inventory', vaccineInventoryController.createVaccineInventory);
router.put('/vaccine-inventory/:id', vaccineInventoryController.updateVaccineInventory);
router.delete('/vaccine-inventory/:id', vaccineInventoryController.deleteVaccineInventory);

// Vaccine Inventory Transactions Routes
router.get(
  '/vaccine-inventory-transactions/:vaccine_inventory_id',
  vaccineInventoryController.getVaccineInventoryTransactions,
);
router.post(
  '/vaccine-inventory-transactions',
  vaccineInventoryController.createVaccineInventoryTransaction,
);

// Vaccine Stock Alerts Routes
router.get(
  '/vaccine-stock-alerts/clinic/:clinic_id',
  vaccineInventoryController.getVaccineStockAlerts,
);
router.put(
  '/vaccine-stock-alerts/:id/acknowledge',
  vaccineInventoryController.acknowledgeVaccineStockAlert,
);
router.put(
  '/vaccine-stock-alerts/:id/resolve',
  vaccineInventoryController.resolveVaccineStockAlert,
);

// Vaccine Inventory Statistics
router.get(
  '/vaccine-inventory/stats/clinic/:clinic_id',
  vaccineInventoryController.getVaccineInventoryStats,
);

// Get all items
router.get('/items', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*,
        COALESCE(SUM(ib.qty_available), 0) as total_available
      FROM items i
      LEFT JOIN item_batches ib ON i.id = ib.item_id AND ib.status = 'active'
      GROUP BY i.id
      ORDER BY i.type, i.name
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get items by category/type
router.get('/items/type/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const result = await pool.query(
      `
      SELECT i.*,
        COALESCE(SUM(ib.qty_available), 0) as total_available
      FROM items i
      LEFT JOIN item_batches ib ON i.id = ib.item_id AND ib.status = 'active'
      WHERE i.type = $1
      GROUP BY i.id
      ORDER BY i.name
    `,
      [type],
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create item
router.post('/items', async (req, res) => {
  try {
    const { type, name, description, doses_required } = req.body;

    const result = await pool.query(
      `
      INSERT INTO items (type, name, description, doses_required)
      VALUES ($1, $2, $3, $4) RETURNING *
    `,
      [type, name, description, doses_required],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update item
router.put('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, name, description, doses_required } = req.body;

    const result = await pool.query(
      `
      UPDATE items SET
        type = $1, name = $2, description = $3, doses_required = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 RETURNING *
    `,
      [type, name, description, doses_required, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete item
router.delete('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM items WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all vaccine batches
router.get('/vaccine-batches', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT vb.*, v.name as vaccine_name, v.code as vaccine_code,
             c.name as clinic_name
      FROM vaccine_batches vb
      JOIN vaccines v ON vb.vaccine_id = v.id
      JOIN clinics c ON vb.clinic_id = c.id
      ORDER BY vb.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create vaccine batch
router.post('/vaccine-batches', async (req, res) => {
  try {
    const { vaccine_id, lot_no, expiry_date, qty_received, clinic_id } = req.body;

    const result = await pool.query(
      `
      INSERT INTO vaccine_batches (
        vaccine_id, lot_no, expiry_date, qty_received, qty_current, clinic_id
      ) VALUES ($1, $2, $3, $4, $4, $5) RETURNING *
    `,
      [vaccine_id, lot_no, expiry_date, qty_received, clinic_id],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update vaccine batch
router.put('/vaccine-batches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { lot_no, expiry_date, qty_current } = req.body;

    const result = await pool.query(
      `
      UPDATE vaccine_batches SET
        lot_no = $1, expiry_date = $2, qty_current = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 RETURNING *
    `,
      [lot_no, expiry_date, qty_current, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine batch not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get low stock items (vaccines with low quantity)
router.get('/low-stock', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT vb.*, v.name as vaccine_name, v.code as vaccine_code
      FROM vaccine_batches vb
      JOIN vaccines v ON vb.vaccine_id = v.id
      WHERE vb.qty_current < 10 AND vb.status = 'active'
      ORDER BY vb.qty_current ASC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get expiring items (expiring within 30 days)
router.get('/expiring', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT vb.*, v.name as vaccine_name, v.code as vaccine_code
      FROM vaccine_batches vb
      JOIN vaccines v ON vb.vaccine_id = v.id
      WHERE vb.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
      AND vb.status = 'active'
      ORDER BY vb.expiry_date ASC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all suppliers
router.get('/suppliers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM suppliers
      WHERE is_active = true
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create supplier
router.post('/suppliers', async (req, res) => {
  try {
    const {
      name,
      supplier_code,
      contact_person,
      email,
      phone,
      address_line_1,
      city,
      province,
      supplier_type,
      payment_terms,
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO suppliers (
        name, supplier_code, contact_person, email, phone,
        address_line_1, city, province, supplier_type, payment_terms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `,
      [
        name,
        supplier_code,
        contact_person,
        email,
        phone,
        address_line_1,
        city,
        province,
        supplier_type,
        payment_terms,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update supplier
router.put('/suppliers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      supplier_code,
      contact_person,
      email,
      phone,
      address_line_1,
      city,
      province,
      supplier_type,
      payment_terms,
      is_active,
    } = req.body;

    const result = await pool.query(
      `
      UPDATE suppliers SET
        name = $1, supplier_code = $2, contact_person = $3, email = $4, phone = $5,
        address_line_1 = $6, city = $7, province = $8, supplier_type = $9,
        payment_terms = $10, is_active = $11, updated_at = CURRENT_TIMESTAMP
      WHERE id = $12 RETURNING *
    `,
      [
        name,
        supplier_code,
        contact_person,
        email,
        phone,
        address_line_1,
        city,
        province,
        supplier_type,
        payment_terms,
        is_active,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete supplier (soft delete)
router.delete('/suppliers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE suppliers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    res.json({ message: 'Supplier deactivated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get inventory transactions
router.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT it.*, vb.lot_no, v.name as vaccine_name, u.username as user_name
      FROM inventory_transactions it
      JOIN vaccine_batches vb ON it.batch_id = vb.id
      JOIN vaccines v ON vb.vaccine_id = v.id
      JOIN users u ON it.user_id = u.id
      ORDER BY it.created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create inventory transaction
router.post('/transactions', async (req, res) => {
  try {
    const { batch_id, txn_type, qty, notes } = req.body;

    // Get current user ID from JWT token
    const userId = req.user.id;

    const result = await pool.query(
      `
      INSERT INTO inventory_transactions (batch_id, txn_type, qty, user_id, notes)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `,
      [batch_id, txn_type, qty, userId, notes],
    );

    // Update batch quantity based on transaction type
    let stockChange = 0;
    if (txn_type === 'RECEIVE') {
      stockChange = qty;
    } else if (txn_type === 'ISSUE') {
      stockChange = -qty;
    } else if (txn_type === 'WASTAGE') {
      stockChange = -qty;
    }

    if (stockChange !== 0) {
      await pool.query(
        `
        UPDATE vaccine_batches
        SET qty_current = qty_current + $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
        [stockChange, batch_id],
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get inventory statistics
router.get('/stats', async (req, res) => {
  try {
    const [totalBatches, lowStock, expiringItems, totalSuppliers] = await Promise.all([
      // Total vaccine batches
      pool.query('SELECT COUNT(*) as count FROM vaccine_batches WHERE status = \'active\''),
      // Low stock batches
      pool.query(
        'SELECT COUNT(*) as count FROM vaccine_batches WHERE qty_current < 10 AND status = \'active\'',
      ),
      // Expiring batches (30 days)
      pool.query(`
        SELECT COUNT(*) as count FROM vaccine_batches
        WHERE expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND status = 'active'
      `),
      // Active suppliers
      pool.query('SELECT COUNT(*) as count FROM suppliers WHERE is_active = true'),
    ]);

    res.json({
      totalBatches: parseInt(totalBatches.rows[0].count),
      lowStock: parseInt(lowStock.rows[0].count),
      expiringItems: parseInt(expiringItems.rows[0].count),
      totalSuppliers: parseInt(totalSuppliers.rows[0].count),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// VACCINE INVENTORY MANAGEMENT (SECURED - SQL Injection Fixed)
// ===========================================

// Get all vaccine inventory records (SECURED - Using parameterized queries)
router.get('/vaccine-inventory', async (req, res) => {
  try {
    const { clinic_id, period_start, period_end } = req.query;

    let query = `
      SELECT vi.*, v.name as vaccine_name, v.code as vaccine_code,
             c.name as clinic_name, u.username as created_by_name
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      JOIN clinics c ON vi.clinic_id = c.id
      JOIN users u ON vi.created_by = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (clinic_id) {
      query += ` AND vi.clinic_id = $${paramCount}`;
      params.push(clinic_id);
      paramCount++;
    }

    if (period_start) {
      query += ` AND vi.period_start >= $${paramCount}`;
      params.push(period_start);
      paramCount++;
    }

    if (period_end) {
      query += ` AND vi.period_end <= $${paramCount}`;
      params.push(period_end);
      paramCount++;
    }

    query += ' ORDER BY v.name, vi.period_start DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create vaccine inventory record
router.post('/vaccine-inventory', async (req, res) => {
  try {
    const {
      vaccine_id,
      clinic_id,
      beginning_balance,
      received_during_period,
      lot_batch_number,
      transferred_in,
      transferred_out,
      expired_wasted,
      issuance,
      low_stock_threshold,
      critical_stock_threshold,
      period_start,
      period_end,
    } = req.body;

    // Get current user ID from JWT token
    const userId = req.user.id;

    // Calculate stock status
    const totalAvailable = beginning_balance + received_during_period;
    const stockOnHand =
      totalAvailable + transferred_in - transferred_out - expired_wasted - issuance;
    const isLowStock = stockOnHand <= (low_stock_threshold || 10);
    const isCriticalStock = stockOnHand <= (critical_stock_threshold || 5);

    const result = await pool.query(
      `INSERT INTO vaccine_inventory (
        vaccine_id, clinic_id, beginning_balance, received_during_period,
        lot_batch_number, transferred_in, transferred_out, expired_wasted,
        issuance, low_stock_threshold, critical_stock_threshold,
        is_low_stock, is_critical_stock, period_start, period_end, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [
        vaccine_id,
        clinic_id,
        beginning_balance,
        received_during_period,
        lot_batch_number,
        transferred_in,
        transferred_out,
        expired_wasted,
        issuance,
        low_stock_threshold,
        critical_stock_threshold,
        isLowStock,
        isCriticalStock,
        period_start,
        period_end,
        userId,
      ],
    );

    // Create stock alert if needed
    if (isCriticalStock || isLowStock) {
      await pool.query(
        `INSERT INTO vaccine_stock_alerts (
          vaccine_inventory_id, vaccine_id, clinic_id, alert_type, current_stock,
          threshold_value, status, message, priority
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          result.rows[0].id,
          vaccine_id,
          clinic_id,
          isCriticalStock ? 'CRITICAL_STOCK' : 'LOW_STOCK',
          stockOnHand,
          isCriticalStock ? critical_stock_threshold : low_stock_threshold,
          'ACTIVE',
          isCriticalStock
            ? `Critical: ${stockOnHand} units remaining`
            : `Low stock: ${stockOnHand} units remaining`,
          isCriticalStock ? 'URGENT' : 'HIGH',
        ],
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update vaccine inventory record
router.put('/vaccine-inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      beginning_balance,
      received_during_period,
      lot_batch_number,
      transferred_in,
      transferred_out,
      expired_wasted,
      issuance,
      low_stock_threshold,
      critical_stock_threshold,
      period_start,
      period_end,
    } = req.body;

    // Get current user ID from JWT token
    const userId = req.user.id;

    // Calculate stock status
    const totalAvailable = beginning_balance + received_during_period;
    const stockOnHand =
      totalAvailable + transferred_in - transferred_out - expired_wasted - issuance;
    const isLowStock = stockOnHand <= (low_stock_threshold || 10);
    const isCriticalStock = stockOnHand <= (critical_stock_threshold || 5);

    const result = await pool.query(
      `UPDATE vaccine_inventory SET
        beginning_balance = $1, received_during_period = $2, lot_batch_number = $3,
        transferred_in = $4, transferred_out = $5, expired_wasted = $6, issuance = $7,
        low_stock_threshold = $8, critical_stock_threshold = $9,
        is_low_stock = $10, is_critical_stock = $11, period_start = $12, period_end = $13,
        updated_by = $14, updated_at = CURRENT_TIMESTAMP
      WHERE id = $15 RETURNING *`,
      [
        beginning_balance,
        received_during_period,
        lot_batch_number,
        transferred_in,
        transferred_out,
        expired_wasted,
        issuance,
        low_stock_threshold,
        critical_stock_threshold,
        isLowStock,
        isCriticalStock,
        period_start,
        period_end,
        userId,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine inventory record not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get vaccine inventory transactions (SECURED - Using parameterized queries)
router.get('/vaccine-inventory-transactions', async (req, res) => {
  try {
    const { vaccine_id, clinic_id, transaction_type, limit = 100 } = req.query;

    let query = `
      SELECT vit.*, v.name as vaccine_name, v.code as vaccine_code,
             u.username as performed_by_name, ua.username as approved_by_name
      FROM vaccine_inventory_transactions vit
      JOIN vaccines v ON vit.vaccine_id = v.id
      JOIN users u ON vit.performed_by = u.id
      LEFT JOIN users ua ON vit.approved_by = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (vaccine_id) {
      query += ` AND vit.vaccine_id = $${paramCount}`;
      params.push(vaccine_id);
      paramCount++;
    }

    if (clinic_id) {
      query += ` AND vit.clinic_id = $${paramCount}`;
      params.push(clinic_id);
      paramCount++;
    }

    if (transaction_type) {
      query += ` AND vit.transaction_type = $${paramCount}`;
      params.push(transaction_type);
      paramCount++;
    }

    query += ` ORDER BY vit.created_at DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create vaccine inventory transaction
router.post('/vaccine-inventory-transactions', async (req, res) => {
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

    // Get current user ID from JWT token
    const userId = req.user.id;

    // Get current inventory record to calculate balance
    const inventoryResult = await pool.query('SELECT * FROM vaccine_inventory WHERE id = $1', [
      vaccine_inventory_id,
    ]);

    if (inventoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine inventory record not found' });
    }

    const inventory = inventoryResult.rows[0];

    // Derive clinic_id from inventory record if not provided in request
    const effectiveClinicId = clinic_id || inventory.clinic_id || req.user.clinic_id || req.user.facility_id;

    if (!effectiveClinicId) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }

    const previousBalance = inventory.stock_on_hand;
    let newBalance = previousBalance;

    // Calculate new balance based on transaction type
    switch (transaction_type) {
    case 'RECEIVE':
      newBalance += quantity;
      break;
    case 'TRANSFER_IN':
      newBalance += quantity;
      break;
    case 'TRANSFER_OUT':
      newBalance -= quantity;
      break;
    case 'ISSUE':
      newBalance -= quantity;
      break;
    case 'EXPIRE':
    case 'WASTE':
      newBalance -= quantity;
      break;
    case 'ADJUST':
      newBalance = quantity; // Direct adjustment
      break;
    }

    // Create transaction record
    const transactionResult = await pool.query(
      `INSERT INTO vaccine_inventory_transactions (
        vaccine_inventory_id, vaccine_id, clinic_id, transaction_type, quantity,
        previous_balance, new_balance, lot_number, batch_number, expiry_date,
        supplier_name, reference_number, performed_by, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        vaccine_inventory_id,
        vaccine_id,
        effectiveClinicId,
        transaction_type,
        quantity,
        previousBalance,
        newBalance,
        lot_number,
        batch_number,
        expiry_date,
        supplier_name,
        reference_number,
        userId,
        notes,
      ],
    );

    // Update inventory record
    await pool.query(
      `UPDATE vaccine_inventory SET
        updated_by = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
      [userId, vaccine_inventory_id],
    );

    res.status(201).json(transactionResult.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get vaccine stock alerts (SECURED - Using parameterized queries)
router.get('/vaccine-stock-alerts', async (req, res) => {
  try {
    const { status, alert_type, priority } = req.query;

    let query = `
      SELECT vsa.*, v.name as vaccine_name, v.code as vaccine_code,
             c.name as clinic_name, u.username as acknowledged_by_name,
             ur.username as resolved_by_name
      FROM vaccine_stock_alerts vsa
      JOIN vaccines v ON vsa.vaccine_id = v.id
      JOIN clinics c ON vsa.clinic_id = c.id
      LEFT JOIN users u ON vsa.acknowledged_by = u.id
      LEFT JOIN users ur ON vsa.resolved_by = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (status) {
      query += ` AND vsa.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (alert_type) {
      query += ` AND vsa.alert_type = $${paramCount}`;
      params.push(alert_type);
      paramCount++;
    }

    if (priority) {
      query += ` AND vsa.priority = $${paramCount}`;
      params.push(priority);
      paramCount++;
    }

    query += ` ORDER BY
      CASE vsa.priority
        WHEN 'URGENT' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        WHEN 'LOW' THEN 4
      END,
      vsa.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Acknowledge vaccine stock alert
router.put('/vaccine-stock-alerts/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;

    // Get current user ID from JWT token
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE vaccine_stock_alerts SET
        status = 'ACKNOWLEDGED', acknowledged_by = $1, acknowledged_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [userId, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Stock alert not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resolve vaccine stock alert
router.put('/vaccine-stock-alerts/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_notes } = req.body;

    // Get current user ID from JWT token
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE vaccine_stock_alerts SET
        status = 'RESOLVED', resolved_by = $1, resolved_at = CURRENT_TIMESTAMP,
        resolution_notes = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 RETURNING *`,
      [userId, resolution_notes, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Stock alert not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get vaccine inventory statistics
router.get('/vaccine-inventory/stats', async (req, res) => {
  try {
    const { clinic_id } = req.query;

    let whereClause = '';
    const params = [];

    if (clinic_id) {
      whereClause = 'WHERE clinic_id = $1';
      params.push(clinic_id);
    }

    const [totalInventory, lowStockAlerts, criticalStockAlerts, recentTransactions] =
      await Promise.all([
        // Total inventory records
        pool.query(`SELECT COUNT(*) as count FROM vaccine_inventory ${whereClause}`, params),

        // Low stock alerts
        pool.query(
          `SELECT COUNT(*) as count FROM vaccine_stock_alerts
           WHERE status = 'ACTIVE' AND alert_type = 'LOW_STOCK' ${
  clinic_id ? 'AND clinic_id = $1' : ''
}`,
          params,
        ),

        // Critical stock alerts
        pool.query(
          `SELECT COUNT(*) as count FROM vaccine_stock_alerts
           WHERE status = 'ACTIVE' AND alert_type = 'CRITICAL_STOCK' ${
  clinic_id ? 'AND clinic_id = $1' : ''
}`,
          params,
        ),

        // Recent transactions (last 30 days)
        pool.query(
          `SELECT COUNT(*) as count FROM vaccine_inventory_transactions
           WHERE created_at >= CURRENT_DATE - INTERVAL '30 days' ${
  clinic_id ? 'AND clinic_id = $1' : ''
}`,
          params,
        ),
      ]);

    res.json({
      totalInventory: parseInt(totalInventory.rows[0].count),
      lowStockAlerts: parseInt(lowStockAlerts.rows[0].count),
      criticalStockAlerts: parseInt(criticalStockAlerts.rows[0].count),
      recentTransactions: parseInt(recentTransactions.rows[0].count),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
