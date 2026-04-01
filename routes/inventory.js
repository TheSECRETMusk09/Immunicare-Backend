const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { requireSystemAdmin } = require('../middleware/rbac');
const socketService = require('../services/socketService');
const {
  hasFieldErrors,
  normalizeEnumValue,
  normalizeIntegerArray,
  parseDateValue,
  respondValidationError,
  sanitizeText,
  validateDateRange,
  validateNumberRange,
} = require('../utils/adminValidation');
const { validateApprovedVaccine: validateApprovedInventoryVaccine } = require('../utils/approvedVaccines');
const { decodeHtmlEntities } = require('../utils/htmlEntities');
const {
  sendExpiryAlert,
  sendLowStockAlert,
  sendOutOfStockAlert,
} = require('../services/adminNotificationService');

const router = express.Router();

// Middleware to authenticate all inventory routes
router.use(authenticateToken);
router.use(requireSystemAdmin);

// Canonical two-role model: inventory is SYSTEM_ADMIN-only
const canViewVaccineInventory = requireSystemAdmin;

// Canonical two-role model: inventory modifications are SYSTEM_ADMIN-only
const canModifyVaccineInventory = requireSystemAdmin;

const VACCINE_INVENTORY_TRANSACTION_TYPES = [
  'RECEIVE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ISSUE',
  'EXPIRE',
  'WASTE',
  'ADJUST',
];

const hasOwn = (payload, key) => Object.prototype.hasOwnProperty.call(payload || {}, key);

// Helper function to validate that a vaccine is approved
const validateVaccineApproved = async (vaccineId, _res) => {
  return validateApprovedInventoryVaccine(vaccineId, { fieldName: 'vaccine_id' });
};

const calculateDaysUntilDate = (value) => {
  const parsedDate = value ? new Date(value) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsedDate.setHours(0, 0, 0, 0);

  return Math.ceil((parsedDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
};

const safeTriggerExpiryNotification = async ({ vaccineName, vaccineId, expiryDate, lotNumber }) => {
  const daysUntilExpiry = calculateDaysUntilDate(expiryDate);
  if (daysUntilExpiry === null || daysUntilExpiry > 30 || daysUntilExpiry < 0) {
    return;
  }

  try {
    await sendExpiryAlert(
      vaccineName,
      vaccineId,
      new Date(expiryDate),
      daysUntilExpiry,
      lotNumber || 'N/A',
    );
  } catch (error) {
    console.error('Failed to send expiry notification:', error.message);
  }
};

const safeTriggerStockNotification = async ({
  vaccineName,
  vaccineId,
  currentStock,
  lotNumber,
  lowStockThreshold = 10,
}) => {
  const normalizedStock = Number(currentStock || 0);
  const normalizedThreshold = Number(lowStockThreshold || 10) || 10;
  const normalizedLotNumber = lotNumber || 'N/A';

  try {
    if (normalizedStock <= 0) {
      await sendOutOfStockAlert(vaccineName, vaccineId, normalizedLotNumber);
      return;
    }

    if (normalizedStock <= normalizedThreshold) {
      await sendLowStockAlert(
        vaccineName,
        vaccineId,
        normalizedStock,
        normalizedLotNumber,
        normalizedThreshold,
      );
    }
  } catch (error) {
    console.error('Failed to send stock notification:', error.message);
  }
};

const sanitizeInventoryTransactionPayload = (payload = {}) => {
  const errors = {};

  // For RECEIVE transactions, allow vaccine_inventory_id of 0 (will auto-create)
  const isReceiveTransaction = payload.transaction_type === 'RECEIVE';
  const vaccineInventoryIdCheck = validateNumberRange(payload.vaccine_inventory_id, {
    label: 'vaccine_inventory_id',
    required: true,
    min: isReceiveTransaction ? 0 : 1,
    integer: true,
  });
  // If vaccine_inventory_id is not a valid number, keep it for later handling
  if (vaccineInventoryIdCheck.error && payload.vaccine_inventory_id !== undefined) {
    // Store the value anyway for better error message
    vaccineInventoryIdCheck.value = payload.vaccine_inventory_id;
  }
  if (vaccineInventoryIdCheck.error) {
    errors.vaccine_inventory_id = vaccineInventoryIdCheck.error;
  }

  const vaccineIdCheck = validateNumberRange(payload.vaccine_id, {
    label: 'vaccine_id',
    required: true,
    min: 1,
    integer: true,
  });
  // If vaccine_id is not a valid number but is a non-empty string, keep it for later lookup
  // This allows sending vaccine name/code like "bcg", "hepa_b" for lookup
  const vaccineIdValue = payload.vaccine_id;
  const isNonEmptyString = vaccineIdValue !== null && vaccineIdValue !== undefined &&
    typeof vaccineIdValue === 'string' && vaccineIdValue.length > 0;

  if (vaccineIdCheck.error && isNonEmptyString) {
    // Allow exact vaccine name lookups without trimming or alias normalization.
    vaccineIdCheck.value = vaccineIdValue;
    delete vaccineIdCheck.error;
  }
  if (vaccineIdCheck.error) {
    errors.vaccine_id = vaccineIdCheck.error;
  }

  const clinicIdCheck = validateNumberRange(payload.clinic_id, {
    label: 'clinic_id',
    required: false,
    min: 1,
    integer: true,
  });
  if (hasOwn(payload, 'clinic_id') && clinicIdCheck.error) {
    errors.clinic_id = clinicIdCheck.error;
  }

  const transactionTypeInput = String(payload.transaction_type || '').trim().toUpperCase();
  const transactionType = normalizeEnumValue(
    transactionTypeInput,
    VACCINE_INVENTORY_TRANSACTION_TYPES,
    '',
  );
  if (!transactionType) {
    errors.transaction_type =
      `transaction_type must be one of ${VACCINE_INVENTORY_TRANSACTION_TYPES.join(', ')}`;
  }

  const quantityCheck = validateNumberRange(payload.quantity, {
    label: 'Quantity',
    required: true,
    min: 0,
    max: 1000000,
    integer: true,
  });
  if (quantityCheck.error) {
    errors.quantity = quantityCheck.error;
  }

  const quantityValue = quantityCheck.value;
  if (
    !quantityCheck.error &&
    transactionType &&
    transactionType !== 'ADJUST' &&
    quantityValue === 0
  ) {
    errors.quantity = 'Quantity must be greater than 0 for this transaction type';
  }

  const expiryDateRaw = sanitizeText(payload.expiry_date);
  if (expiryDateRaw && !parseDateValue(expiryDateRaw)) {
    errors.expiry_date = 'expiry_date must be a valid date';
  }

  const batchIdCheck = validateNumberRange(payload.batch_id, {
    label: 'batch_id',
    required: false,
    min: 1,
    integer: true,
  });
  if (hasOwn(payload, 'batch_id') && batchIdCheck.error) {
    errors.batch_id = batchIdCheck.error;
  }

  const transactionDateRaw = sanitizeText(payload.transaction_date);
  if (transactionDateRaw) {
    const parsedTransactionDate = parseDateValue(transactionDateRaw);
    if (!parsedTransactionDate) {
      errors.transaction_date = 'transaction_date must be a valid date';
    } else {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (parsedTransactionDate > today) {
        errors.transaction_date = 'transaction_date cannot be in the future';
      }
    }
  }

  const lotBatchNumber = sanitizeText(
    decodeHtmlEntities(
      payload.lot_batch_number || payload.lot_number || payload.batch_number,
    ),
    { maxLength: 100 },
  );
  const supplierName = sanitizeText(decodeHtmlEntities(payload.supplier_name), {
    maxLength: 255,
  });
  const referenceNumber = sanitizeText(decodeHtmlEntities(payload.reference_number), {
    maxLength: 255,
  });
  const notes = sanitizeText(decodeHtmlEntities(payload.notes), {
    maxLength: 500,
    preserveNewLines: true,
  });

  if (notes.length > 500) {
    errors.notes = 'Notes must not exceed 500 characters';
  }

  if (
    ['ISSUE', 'WASTE'].includes(transactionType) &&
    !batchIdCheck.error &&
    !batchIdCheck.value
  ) {
    errors.batch_id = 'Select the exact lot/batch with available stock.';
  }

  return {
    normalized: {
      vaccine_inventory_id: vaccineInventoryIdCheck.value,
      vaccine_id: vaccineIdCheck.value,
      batch_id: batchIdCheck.value || null,
      clinic_id: clinicIdCheck.value,
      transaction_type: transactionType,
      quantity: quantityValue,
      lot_number: lotBatchNumber || null,
      batch_number: lotBatchNumber || null,
      expiry_date: expiryDateRaw || null,
      supplier_name: supplierName || null,
      reference_number: referenceNumber || null,
      notes: notes || null,
      transaction_date: transactionDateRaw || null,
    },
    errors,
  };
};

const sanitizeVaccineInventoryRecordPayload = (payload = {}) => {
  const errors = {};

  const vaccineIdCheck = validateNumberRange(payload.vaccine_id, {
    label: 'vaccine_id',
    required: true,
    min: 1,
    integer: true,
  });
  if (vaccineIdCheck.error) {
    errors.vaccine_id = vaccineIdCheck.error;
  }

  const clinicIdCheck = validateNumberRange(payload.clinic_id, {
    label: 'clinic_id',
    required: false,
    min: 1,
    integer: true,
  });
  if (hasOwn(payload, 'clinic_id') && clinicIdCheck.error) {
    errors.clinic_id = clinicIdCheck.error;
  }

  const numberFieldConfig = {
    beginning_balance: 0,
    received_during_period: 0,
    transferred_in: 0,
    transferred_out: 0,
    expired_wasted: 0,
    issuance: 0,
    low_stock_threshold: 10,
    critical_stock_threshold: 5,
  };

  const normalizedNumbers = {};
  Object.entries(numberFieldConfig).forEach(([field, fallback]) => {
    const check = validateNumberRange(payload[field], {
      label: field,
      required: false,
      min: 0,
      max: 100000000,
      integer: true,
    });

    if (check.error) {
      errors[field] = check.error;
      normalizedNumbers[field] = fallback;
      return;
    }

    normalizedNumbers[field] = check.value ?? fallback;
  });

  const periodStart = sanitizeText(payload.period_start);
  const periodEnd = sanitizeText(payload.period_end);

  if (!periodStart) {
    errors.period_start = 'period_start is required';
  }
  if (!periodEnd) {
    errors.period_end = 'period_end is required';
  }

  Object.assign(
    errors,
    validateDateRange({
      startDate: periodStart,
      endDate: periodEnd,
      startKey: 'period_start',
      endKey: 'period_end',
      startLabel: 'Period start',
      endLabel: 'Period end',
    }),
  );

  if (
    !errors.low_stock_threshold &&
    !errors.critical_stock_threshold &&
    normalizedNumbers.critical_stock_threshold > normalizedNumbers.low_stock_threshold
  ) {
    errors.critical_stock_threshold =
      'critical_stock_threshold cannot exceed low_stock_threshold';
  }

  const totalAvailable =
    normalizedNumbers.beginning_balance + normalizedNumbers.received_during_period;
  const stockOnHand =
    totalAvailable +
    normalizedNumbers.transferred_in -
    normalizedNumbers.transferred_out -
    normalizedNumbers.expired_wasted -
    normalizedNumbers.issuance;

  if (stockOnHand < 0) {
    errors.stock_on_hand = 'Stock on hand cannot be negative';
  }

  const lotBatchNumber = sanitizeText(payload.lot_batch_number, { maxLength: 255 });

  return {
    normalized: {
      vaccine_id: vaccineIdCheck.value,
      clinic_id: clinicIdCheck.value,
      lot_batch_number: lotBatchNumber || null,
      period_start: periodStart || null,
      period_end: periodEnd || null,
      ...normalizedNumbers,
    },
    computed: {
      stockOnHand,
      isLowStock: stockOnHand <= normalizedNumbers.low_stock_threshold,
      isCriticalStock: stockOnHand <= normalizedNumbers.critical_stock_threshold,
    },
    errors,
  };
};

const schemaCache = {
  columns: new Map(),
  tables: new Map(),
};

const resolveFirstExistingColumn = async (
  tableName,
  candidateColumns,
  fallback = candidateColumns[0],
) => {
  const cacheKey = `${tableName}:${candidateColumns.join(',')}`;
  if (schemaCache.columns.has(cacheKey)) {
    return schemaCache.columns.get(cacheKey);
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

    schemaCache.columns.set(cacheKey, resolvedColumn);
    return resolvedColumn;
  } catch (_error) {
    schemaCache.columns.set(cacheKey, fallback);
    return fallback;
  }
};

const resolveFirstExistingTable = async (
  candidateTables,
  fallback = candidateTables[0],
) => {
  const cacheKey = candidateTables.join(',');
  if (schemaCache.tables.has(cacheKey)) {
    return schemaCache.tables.get(cacheKey);
  }

  try {
    const result = await pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [candidateTables],
    );

    const availableTables = new Set(result.rows.map((row) => row.table_name));
    const resolvedTable =
      candidateTables.find((tableName) => availableTables.has(tableName)) ||
      fallback;

    schemaCache.tables.set(cacheKey, resolvedTable);
    return resolvedTable;
  } catch (_error) {
    schemaCache.tables.set(cacheKey, fallback);
    return fallback;
  }
};

const getInventoryFacilityColumn = () =>
  resolveFirstExistingColumn('vaccine_inventory', ['clinic_id', 'facility_id'], 'clinic_id');

const getInventoryTransactionsFacilityColumn = () =>
  resolveFirstExistingColumn(
    'vaccine_inventory_transactions',
    ['clinic_id', 'facility_id'],
    'clinic_id',
  );

const getVaccineBatchFacilityColumn = () =>
  resolveFirstExistingColumn('vaccine_batches', ['clinic_id', 'facility_id'], 'clinic_id');

const getVaccineBatchLotColumn = () =>
  resolveFirstExistingColumn('vaccine_batches', ['lot_no', 'lot_number'], 'lot_no');

const getVaccineBatchStorageColumn = () =>
  resolveFirstExistingColumn(
    'vaccine_batches',
    ['storage_location', 'storage_conditions'],
    'storage_conditions',
  );

const getStockAlertsFacilityColumn = () =>
  resolveFirstExistingColumn(
    'vaccine_stock_alerts',
    ['clinic_id', 'facility_id'],
    'clinic_id',
  );

const getFacilityTableName = () =>
  resolveFirstExistingTable(['clinics', 'healthcare_facilities'], 'clinics');

const getUserDisplayNameExpression = (tableName, alias) => {
  if (tableName === 'users') {
    return `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)), ''), ${alias}.username)`;
  }

  return `${alias}.username`;
};

const getUserDisplayJoinSpec = async (foreignKeyExpression, aliasBase) => {
  const usersTableName = await resolveFirstExistingTable(['users'], null);
  const adminTableName = await resolveFirstExistingTable(['admin'], null);
  const joins = [];
  const displayNameExpressions = [];

  if (usersTableName) {
    const usersAlias = `${aliasBase}_users`;
    joins.push(`LEFT JOIN ${usersTableName} ${usersAlias} ON ${foreignKeyExpression} = ${usersAlias}.id`);
    displayNameExpressions.push(getUserDisplayNameExpression('users', usersAlias));
  }

  if (adminTableName) {
    const adminAlias = `${aliasBase}_admin`;
    joins.push(`LEFT JOIN ${adminTableName} ${adminAlias} ON ${foreignKeyExpression} = ${adminAlias}.id`);
    displayNameExpressions.push(getUserDisplayNameExpression('admin', adminAlias));
  }

  return {
    joins,
    displayNameSql: displayNameExpressions.length
      ? `COALESCE(${displayNameExpressions.join(', ')})`
      : 'NULL',
  };
};

const getInventoryActorJoinSpec = async (foreignKeyExpression, aliasBase) => {
  const usersTableName = await resolveFirstExistingTable(['users'], null);
  const adminTableName = await resolveFirstExistingTable(['admin'], null);
  const rolesTableName = await resolveFirstExistingTable(['roles'], null);
  const joins = [];
  const displayNameExpressions = [];
  const usernameExpressions = [];
  const roleExpressions = [];

  if (usersTableName) {
    const usersAlias = `${aliasBase}_users`;
    joins.push(`LEFT JOIN ${usersTableName} ${usersAlias} ON ${foreignKeyExpression} = ${usersAlias}.id`);
    displayNameExpressions.push(getUserDisplayNameExpression('users', usersAlias));
    usernameExpressions.push(`${usersAlias}.username`);

    const userRoleColumn = await resolveFirstExistingColumn(
      'users',
      ['role', 'role_name', 'role_type', 'role_id'],
      null,
    );

    if (userRoleColumn === 'role_id' && rolesTableName) {
      const rolesAlias = `${aliasBase}_users_roles`;
      joins.push(`LEFT JOIN ${rolesTableName} ${rolesAlias} ON ${usersAlias}.role_id = ${rolesAlias}.id`);
      roleExpressions.push(`${rolesAlias}.display_name`, `${rolesAlias}.name`);
    } else if (userRoleColumn) {
      roleExpressions.push(`${usersAlias}.${userRoleColumn}`);
    }
  }

  if (adminTableName) {
    const adminAlias = `${aliasBase}_admin`;
    joins.push(`LEFT JOIN ${adminTableName} ${adminAlias} ON ${foreignKeyExpression} = ${adminAlias}.id`);
    displayNameExpressions.push(getUserDisplayNameExpression('admin', adminAlias));
    usernameExpressions.push(`${adminAlias}.username`);

    const adminRoleColumn = await resolveFirstExistingColumn(
      'admin',
      ['role', 'role_name'],
      null,
    );

    if (adminRoleColumn) {
      roleExpressions.push(`${adminAlias}.${adminRoleColumn}`);
    }
  }

  return {
    joins,
    displayNameSql: displayNameExpressions.length
      ? `COALESCE(${displayNameExpressions.join(', ')})`
      : 'NULL',
    usernameSql: usernameExpressions.length
      ? `COALESCE(${usernameExpressions.join(', ')})`
      : 'NULL',
    roleSql: roleExpressions.length ? `COALESCE(${roleExpressions.join(', ')})` : 'NULL',
  };
};

const getAuthenticatedUserDisplayName = (user = {}) => {
  const fullName = sanitizeText(
    [user.first_name, user.last_name].filter(Boolean).join(' '),
    { maxLength: 255 },
  );

  if (fullName) {
    return fullName;
  }

  return (
    sanitizeText(user.display_name, { maxLength: 255 }) ||
    sanitizeText(user.name, { maxLength: 255 }) ||
    sanitizeText(user.username, { maxLength: 255 }) ||
    null
  );
};

// Apply read protection to vaccine inventory routes
router.get('/vaccine-inventory', canViewVaccineInventory);
router.get('/vaccine-inventory/stats', canViewVaccineInventory);

// Apply write protection to vaccine inventory routes
router.post('/vaccine-inventory', canModifyVaccineInventory);
router.put('/vaccine-inventory/:id', canModifyVaccineInventory);
router.delete('/vaccine-inventory/:id', canModifyVaccineInventory);

// Transactions and alerts - read for all, write for admins
router.get('/vaccine-inventory-transactions', canViewVaccineInventory);
router.post('/vaccine-inventory-transactions', canModifyVaccineInventory);

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

    socketService.broadcast('inventory_item_created', result.rows[0]);
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

    socketService.broadcast('inventory_item_updated', result.rows[0]);
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

    socketService.broadcast('inventory_item_deleted', { id });
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all vaccine batches
router.get('/vaccine-batches', async (req, res) => {
  try {
    const { role, clinic_id } = req.user;
    let query = `
      SELECT vb.*, v.name as vaccine_name, v.code as vaccine_code,
             c.name as clinic_name
      FROM vaccine_batches vb
      JOIN vaccines v ON vb.vaccine_id = v.id
      JOIN clinics c ON vb.clinic_id = c.id
      WHERE vb.is_active = true
    `;
    const params = [];

    if (role !== 'super_admin' && clinic_id) {
      query += ' AND vb.clinic_id = $' + (params.length + 1);
      params.push(clinic_id);
    }

    query += ' ORDER BY vb.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create vaccine batch
router.post('/vaccine-batches', async (req, res) => {
  try {
    const { vaccine_id, lot_no, expiry_date, qty_received, clinic_id } = req.body;
    const userClinicId = req.user.clinic_id;

    // Validate vaccine is approved
    const vaccineValidation = await validateVaccineApproved(vaccine_id, res);
    if (!vaccineValidation.valid) {
      return res.status(400).json({ error: vaccineValidation.error });
    }

    const result = await pool.query(
      `
      INSERT INTO vaccine_batches (
        vaccine_id, lot_no, expiry_date, qty_received, qty_current, clinic_id
      ) VALUES ($1, $2, $3, $4, $4, $5) RETURNING *
    `,
      [vaccine_id, lot_no, expiry_date, qty_received, clinic_id || userClinicId],
    );

    const createdBatch = result.rows[0];

    await safeTriggerExpiryNotification({
      vaccineName: vaccineValidation.vaccine.name,
      vaccineId: vaccineValidation.vaccine.id,
      expiryDate: createdBatch.expiry_date,
      lotNumber: createdBatch.lot_no,
    });

    socketService.broadcast('vaccine_batch_created', createdBatch);
    res.status(201).json(createdBatch);
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

    const updatedBatch = result.rows[0];
    const vaccineLookup = await pool.query('SELECT name FROM vaccines WHERE id = $1', [
      updatedBatch.vaccine_id,
    ]);

    await safeTriggerExpiryNotification({
      vaccineName: vaccineLookup.rows[0]?.name || 'Vaccine',
      vaccineId: updatedBatch.vaccine_id,
      expiryDate: updatedBatch.expiry_date,
      lotNumber: updatedBatch.lot_no,
    });

    socketService.broadcast('vaccine_batch_updated', updatedBatch);
    res.json(updatedBatch);
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
      WHERE vb.qty_current <= 10 AND vb.status = 'active'
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

    socketService.broadcast('supplier_created', result.rows[0]);
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

    socketService.broadcast('supplier_updated', result.rows[0]);
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

    socketService.broadcast('supplier_deleted', { id });
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
      const batchUpdate = await pool.query(
        `
        UPDATE vaccine_batchesvaccine_batches
        SET qty_current = qty_current + $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 RETURNING *
      `,
        [stockChange, batch_id],
      );
      socketService.broadcast('vaccine_batch_updated', batchUpdate.rows[0]);
    }

    socketService.broadcast('inventory_transaction_created', result.rows[0]);
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
        'SELECT COUNT(*) as count FROM vaccine_batches WHERE qty_current <= 10 AND status = \'active\'',
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
// VACCINE INVENTORY MANAGEMENT (Based on ITEMS_vaccines.docx)
// ===========================================

// Get all vaccine inventory records
router.get('/vaccine-inventory', async (req, res) => {
  try {
    // Disable caching
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { clinic_id, period_start, period_end } = req.query;

    const scopedClinicId =
      req.user?.clinic_id ||
      req.user?.facility_id ||
      req.healthCenterFilter?.clinic_id ||
      null;

    const clinicIdCheck = validateNumberRange(clinic_id, {
      label: 'clinic_id',
      required: false,
      min: 1,
      integer: true,
    });
    const normalizedPeriodStart = sanitizeText(period_start);
    const normalizedPeriodEnd = sanitizeText(period_end);

    const errors = {
      ...validateDateRange({
        startDate: normalizedPeriodStart,
        endDate: normalizedPeriodEnd,
        startKey: 'period_start',
        endKey: 'period_end',
        startLabel: 'Period start',
        endLabel: 'Period end',
      }),
    };

    if (clinic_id && clinicIdCheck.error) {
      errors.clinic_id = clinicIdCheck.error;
    }

    if (!clinic_id && !scopedClinicId) {
      errors.clinic_id = 'clinic_id is required for inventory access';
    }

    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    const inventoryFacilityColumn = await getInventoryFacilityColumn();
    const facilityTableName = await getFacilityTableName();
    const creatorJoinSpec = await getUserDisplayJoinSpec('vi.created_by', 'creator');

    let query = `
      SELECT vi.*, v.name as vaccine_name, v.code as vaccine_code,
             hf.name as facility_name, ${creatorJoinSpec.displayNameSql} as created_by_name
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      JOIN ${facilityTableName} hf ON vi.${inventoryFacilityColumn} = hf.id
      ${creatorJoinSpec.joins.join('\n      ')}
      WHERE v.is_active = true
    `;

    const params = [];
    let paramCount = 1;

    const effectiveClinicId = clinicIdCheck.value || Number(scopedClinicId) || null;

    if (effectiveClinicId) {
      query += ` AND vi.${inventoryFacilityColumn} = $${paramCount}`;
      params.push(effectiveClinicId);
      paramCount++;
    }

    if (normalizedPeriodStart) {
      query += ` AND vi.period_start >= $${paramCount}`;
      params.push(normalizedPeriodStart);
      paramCount++;
    }

    if (normalizedPeriodEnd) {
      query += ` AND vi.period_end <= $${paramCount}`;
      params.push(normalizedPeriodEnd);
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
    const { normalized, computed, errors } = sanitizeVaccineInventoryRecordPayload(req.body || {});

    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    // Validate vaccine is approved
    const vaccineValidation = await validateVaccineApproved(normalized.vaccine_id, res);
    if (!vaccineValidation.valid) {
      return res.status(400).json({ error: vaccineValidation.error });
    }

    // Get current user ID from JWT token
    const userId = req.user.id;

    const inventoryFacilityColumn = await getInventoryFacilityColumn();
    const stockAlertsFacilityColumn = await getStockAlertsFacilityColumn();

    const facilityId =
      normalized.clinic_id || req.user.clinic_id || req.user.facility_id || null;

    if (!facilityId) {
      return respondValidationError(res, {
        clinic_id: 'clinic_id is required',
      });
    }

    const duplicateCheck = await pool.query(
      `
        SELECT id
        FROM vaccine_inventory
        WHERE vaccine_id = $1
          AND ${inventoryFacilityColumn} = $2
          AND period_start = $3
          AND period_end = $4
        LIMIT 1
      `,
      [
        normalized.vaccine_id,
        facilityId,
        normalized.period_start,
        normalized.period_end,
      ],
    );

    if (duplicateCheck.rows.length > 0) {
      return respondValidationError(
        res,
        {
          vaccine_id:
            'A vaccine inventory record already exists for this facility and period',
        },
        'Duplicate inventory record detected',
        409,
      );
    }

    const result = await pool.query(
      `INSERT INTO vaccine_inventory (
        vaccine_id, ${inventoryFacilityColumn}, beginning_balance, received_during_period,
        lot_batch_number, transferred_in, transferred_out, expired_wasted,
        issuance, low_stock_threshold, critical_stock_threshold,
        is_low_stock, is_critical_stock, period_start, period_end, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16) RETURNING *`,
      [
        normalized.vaccine_id,
        facilityId,
        normalized.beginning_balance,
        normalized.received_during_period,
        normalized.lot_batch_number,
        normalized.transferred_in,
        normalized.transferred_out,
        normalized.expired_wasted,
        normalized.issuance,
        normalized.low_stock_threshold,
        normalized.critical_stock_threshold,
        computed.isLowStock,
        computed.isCriticalStock,
        normalized.period_start,
        normalized.period_end,
        userId,
      ],
    );

    // Create stock alert if needed
    if (computed.isCriticalStock || computed.isLowStock) {
      await pool.query(
        `INSERT INTO vaccine_stock_alerts (
          vaccine_inventory_id, vaccine_id, ${stockAlertsFacilityColumn}, alert_type, current_stock,
          threshold_value, status, message, priority
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          result.rows[0].id,
          normalized.vaccine_id,
          facilityId,
          computed.isCriticalStock ? 'CRITICAL_STOCK' : 'LOW_STOCK',
          computed.stockOnHand,
          computed.isCriticalStock
            ? normalized.critical_stock_threshold
            : normalized.low_stock_threshold,
          'ACTIVE',
          computed.isCriticalStock
            ? `Critical: ${computed.stockOnHand} units remaining`
            : `Low stock: ${computed.stockOnHand} units remaining`,
          computed.isCriticalStock ? 'URGENT' : 'HIGH',
        ],
      );
    }

    await safeTriggerStockNotification({
      vaccineName: vaccineValidation.vaccine.name,
      vaccineId: vaccineValidation.vaccine.id,
      currentStock: computed.stockOnHand,
      lotNumber: normalized.lot_batch_number,
      lowStockThreshold: normalized.low_stock_threshold,
    });

    socketService.broadcast('vaccine_inventory_created', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update vaccine inventory record
router.put('/vaccine-inventory/:id', async (req, res) => {
  try {
    const inventoryIdCheck = validateNumberRange(req.params.id, {
      label: 'id',
      required: true,
      min: 1,
      integer: true,
    });

    if (inventoryIdCheck.error) {
      return respondValidationError(res, { id: inventoryIdCheck.error });
    }

    const inventoryFacilityColumn = await getInventoryFacilityColumn();

    const existingResult = await pool.query('SELECT * FROM vaccine_inventory WHERE id = $1', [
      inventoryIdCheck.value,
    ]);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine inventory record not found' });
    }

    const existing = existingResult.rows[0];
    const mergedPayload = {
      vaccine_id: existing.vaccine_id,
      clinic_id: existing[inventoryFacilityColumn],
      beginning_balance: hasOwn(req.body, 'beginning_balance')
        ? req.body.beginning_balance
        : existing.beginning_balance,
      received_during_period: hasOwn(req.body, 'received_during_period')
        ? req.body.received_during_period
        : existing.received_during_period,
      lot_batch_number: hasOwn(req.body, 'lot_batch_number')
        ? req.body.lot_batch_number
        : existing.lot_batch_number,
      transferred_in: hasOwn(req.body, 'transferred_in')
        ? req.body.transferred_in
        : existing.transferred_in,
      transferred_out: hasOwn(req.body, 'transferred_out')
        ? req.body.transferred_out
        : existing.transferred_out,
      expired_wasted: hasOwn(req.body, 'expired_wasted')
        ? req.body.expired_wasted
        : existing.expired_wasted,
      issuance: hasOwn(req.body, 'issuance') ? req.body.issuance : existing.issuance,
      low_stock_threshold: hasOwn(req.body, 'low_stock_threshold')
        ? req.body.low_stock_threshold
        : existing.low_stock_threshold,
      critical_stock_threshold: hasOwn(req.body, 'critical_stock_threshold')
        ? req.body.critical_stock_threshold
        : existing.critical_stock_threshold,
      period_start: hasOwn(req.body, 'period_start')
        ? req.body.period_start
        : existing.period_start,
      period_end: hasOwn(req.body, 'period_end') ? req.body.period_end : existing.period_end,
    };

    const { normalized, computed, errors } = sanitizeVaccineInventoryRecordPayload(
      mergedPayload,
    );

    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    // Get current user ID from JWT token
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE vaccine_inventory SET
        beginning_balance = $1, received_during_period = $2, lot_batch_number = $3,
        transferred_in = $4, transferred_out = $5, expired_wasted = $6, issuance = $7,
        low_stock_threshold = $8, critical_stock_threshold = $9,
        is_low_stock = $10, is_critical_stock = $11, period_start = $12, period_end = $13,
        updated_by = $14, updated_at = CURRENT_TIMESTAMP
      WHERE id = $15 RETURNING *`,
      [
        normalized.beginning_balance,
        normalized.received_during_period,
        normalized.lot_batch_number,
        normalized.transferred_in,
        normalized.transferred_out,
        normalized.expired_wasted,
        normalized.issuance,
        normalized.low_stock_threshold,
        normalized.critical_stock_threshold,
        computed.isLowStock,
        computed.isCriticalStock,
        normalized.period_start,
        normalized.period_end,
        userId,
        inventoryIdCheck.value,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vaccine inventory record not found' });
    }

    const vaccineLookup = await pool.query('SELECT name FROM vaccines WHERE id = $1', [
      normalized.vaccine_id,
    ]);

    await safeTriggerStockNotification({
      vaccineName: vaccineLookup.rows[0]?.name || 'Vaccine',
      vaccineId: normalized.vaccine_id,
      currentStock: computed.stockOnHand,
      lotNumber: normalized.lot_batch_number,
      lowStockThreshold: normalized.low_stock_threshold,
    });

    socketService.broadcast('vaccine_inventory_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get vaccine inventory transactions
router.get('/vaccine-inventory-transactions', async (req, res) => {
  try {
    const { vaccine_id, clinic_id, transaction_type, limit = 100 } = req.query;

    const vaccineIdCheck = validateNumberRange(vaccine_id, {
      label: 'vaccine_id',
      required: false,
      min: 1,
      integer: true,
    });
    const clinicIdCheck = validateNumberRange(clinic_id, {
      label: 'clinic_id',
      required: false,
      min: 1,
      integer: true,
    });
    const limitCheck = validateNumberRange(limit, {
      label: 'limit',
      required: false,
      min: 1,
      max: 500,
      integer: true,
    });

    const normalizedTransactionTypeInput = sanitizeText(transaction_type).toUpperCase();
    const normalizedTransactionType = normalizedTransactionTypeInput
      ? normalizeEnumValue(
        normalizedTransactionTypeInput,
        VACCINE_INVENTORY_TRANSACTION_TYPES,
        '',
      )
      : '';

    const errors = {};
    if (vaccine_id && vaccineIdCheck.error) {
      errors.vaccine_id = vaccineIdCheck.error;
    }
    if (clinic_id && clinicIdCheck.error) {
      errors.clinic_id = clinicIdCheck.error;
    }
    if (limitCheck.error) {
      errors.limit = limitCheck.error;
    }
    if (transaction_type && !normalizedTransactionType) {
      errors.transaction_type =
        `transaction_type must be one of ${VACCINE_INVENTORY_TRANSACTION_TYPES.join(', ')}`;
    }

    if (hasFieldErrors(errors)) {
      return respondValidationError(res, errors);
    }

    const safeLimit = limitCheck.value || 100;
    const transactionFacilityColumn = await getInventoryTransactionsFacilityColumn();
    const performerJoinSpec = await getInventoryActorJoinSpec('vit.performed_by', 'performer');
    const approverJoinSpec = await getUserDisplayJoinSpec('vit.approved_by', 'approver');

    let query = `
      SELECT vit.*, v.name as vaccine_name, v.code as vaccine_code,
             ${performerJoinSpec.displayNameSql} as performed_by_name,
             ${performerJoinSpec.usernameSql} as performed_by_username,
             ${performerJoinSpec.roleSql} as performed_by_role,
             ${approverJoinSpec.displayNameSql} as approved_by_name
      FROM vaccine_inventory_transactions vit
      JOIN vaccines v ON vit.vaccine_id = v.id
      ${performerJoinSpec.joins.join('\n      ')}
      ${approverJoinSpec.joins.join('\n      ')}
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (vaccineIdCheck.value) {
      query += ` AND vit.vaccine_id = $${paramCount}`;
      params.push(vaccineIdCheck.value);
      paramCount++;
    }

    if (clinicIdCheck.value) {
      query += ` AND vit.${transactionFacilityColumn} = $${paramCount}`;
      params.push(clinicIdCheck.value);
      paramCount++;
    }

    if (normalizedTransactionType) {
      query += ` AND vit.transaction_type = $${paramCount}`;
      params.push(normalizedTransactionType);
      paramCount++;
    }

    query += ` ORDER BY vit.created_at DESC LIMIT $${paramCount}`;
    params.push(safeLimit);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create vaccine inventory transaction
router.post('/vaccine-inventory-transactions', async (req, res) => {
  let client = null;

  try {
    const fs = require('fs');
    const debugOutput = `
=== TRANSACTION REQUEST ===
Time: ${new Date().toISOString()}

Payload received:
${JSON.stringify(req.body, null, 2)}

`;
    fs.appendFileSync('transaction_debug.log', debugOutput);
    
    const { normalized, errors } = sanitizeInventoryTransactionPayload(req.body || {});
    
    const debugNormalized = `
Normalized:
${JSON.stringify(normalized, null, 2)}

Validation errors:
${JSON.stringify(errors, null, 2)}

`;
    fs.appendFileSync('transaction_debug.log', debugNormalized);
    
    if (hasFieldErrors(errors)) {
      fs.appendFileSync('transaction_debug.log', '❌ Validation failed!\n\n');
      return respondValidationError(res, errors);
    }

    // Validate vaccine is approved - this also resolves vaccine_id from name/code
    const vaccineValidation = await validateVaccineApproved(normalized.vaccine_id, res);
    if (!vaccineValidation.valid) {
      return res.status(400).json({ error: vaccineValidation.error });
    }

    // Use the resolved vaccine ID from validation
    const resolvedVaccineId = vaccineValidation.vaccine.id;

    // Get current user ID from JWT token
    const userId = req.user.id;

    const [
      transactionFacilityColumn,
      inventoryFacilityColumn,
      batchFacilityColumn,
      batchLotColumn,
      batchStorageColumn,
    ] = await Promise.all([
      getInventoryTransactionsFacilityColumn(),
      getInventoryFacilityColumn(),
      getVaccineBatchFacilityColumn(),
      getVaccineBatchLotColumn(),
      getVaccineBatchStorageColumn(),
    ]);

    client = await pool.connect();
    await client.query('BEGIN');

    // Get current inventory record to calculate balance
    let inventoryResult = { rows: [] };
    
    // Only query if we have a valid inventory ID
    if (normalized.vaccine_inventory_id > 0) {
      inventoryResult = await client.query(
        'SELECT * FROM vaccine_inventory WHERE id = $1 FOR UPDATE',
        [normalized.vaccine_inventory_id],
      );
    }

    let inventory = null;
    
    // If inventory record doesn't exist and this is a RECEIVE transaction, auto-create it
    if (inventoryResult.rows.length === 0 && normalized.transaction_type === 'RECEIVE') {
      const userId = req.user.id;
      const facilityId = normalized.clinic_id || req.user.clinic_id || req.user.facility_id;
      
      if (!facilityId) {
        await client.query('ROLLBACK');
        return respondValidationError(res, {
          clinic_id: 'clinic_id is required to create inventory record',
        });
      }
      
      // Auto-create inventory record for RECEIVE transactions
      const currentDate = new Date();
      const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      
      const createResult = await client.query(
        `INSERT INTO vaccine_inventory (
          vaccine_id, ${inventoryFacilityColumn}, beginning_balance, received_during_period,
          transferred_in, transferred_out, expired_wasted, issuance,
          low_stock_threshold, critical_stock_threshold,
          is_low_stock, is_critical_stock, period_start, period_end, created_by, updated_by
        ) VALUES ($1, $2, 0, 0, 0, 0, 0, 0, 10, 5, false, false, $3, $4, $5, $5) RETURNING *`,
        [resolvedVaccineId, facilityId, periodStart, periodEnd, userId]
      );
      
      inventory = createResult.rows[0];
      // Update the vaccine_inventory_id to the newly created record
      normalized.vaccine_inventory_id = inventory.id;
    } else if (inventoryResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Vaccine inventory record not found. Please save the inventory sheet first or use the Receive Stock button to auto-create the record.' });
    } else {
      inventory = inventoryResult.rows[0];
      
      if (Number(inventory.vaccine_id) !== Number(resolvedVaccineId)) {
        await client.query('ROLLBACK');
        return respondValidationError(res, {
          vaccine_id: 'vaccine_id does not match the selected inventory record',
        });
      }
    }

    const facilityId =
      normalized.clinic_id ||
      inventory?.[inventoryFacilityColumn] ||
      inventory?.clinic_id ||
      inventory?.facility_id ||
      req.user.clinic_id ||
      req.user.facility_id ||
      null;

    if (!facilityId) {
      await client.query('ROLLBACK');
      return respondValidationError(res, {
        clinic_id: 'clinic_id is required',
      });
    }

    let selectedBatchSummary = null;
    let effectiveLotNumber = normalized.batch_number || normalized.lot_number || null;
    let effectiveExpiryDate = normalized.expiry_date || null;

    if (['ISSUE', 'WASTE'].includes(normalized.transaction_type)) {
      const batchResult = await client.query(
        `
          SELECT
            vb.*,
            COALESCE(
              NULLIF(TRIM(vb.${batchLotColumn}), ''),
              'BATCH-' || vb.id::text
            ) AS resolved_lot_number,
            NULLIF(TRIM(vb.${batchStorageColumn}), '') AS resolved_storage_location
          FROM vaccine_batches vb
          WHERE vb.id = $1
          FOR UPDATE
        `,
        [normalized.batch_id],
      );

      if (batchResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return respondValidationError(res, {
          batch_id: 'The selected lot/batch could not be found.',
        });
      }

      const selectedBatch = batchResult.rows[0];
      const batchFacilityId =
        selectedBatch[batchFacilityColumn] ||
        selectedBatch.clinic_id ||
        selectedBatch.facility_id;
      const batchStatus = String(selectedBatch.status || 'active').trim().toLowerCase();
      const batchAvailableQuantity = Number(selectedBatch.qty_current || 0);
      const batchExpiryDate = selectedBatch.expiry_date
        ? new Date(selectedBatch.expiry_date)
        : null;

      if (Number(selectedBatch.vaccine_id) !== Number(resolvedVaccineId)) {
        await client.query('ROLLBACK');
        return respondValidationError(res, {
          batch_id: 'The selected lot/batch does not belong to this vaccine.',
        });
      }

      if (Number(batchFacilityId) !== Number(facilityId)) {
        await client.query('ROLLBACK');
        return respondValidationError(res, {
          batch_id: 'The selected lot/batch does not belong to the active facility.',
        });
      }

      if (!selectedBatch.is_active || batchStatus !== 'active') {
        await client.query('ROLLBACK');
        return respondValidationError(res, {
          batch_id: 'The selected lot/batch is inactive and cannot be used.',
        });
      }

      if (batchExpiryDate) {
        batchExpiryDate.setHours(0, 0, 0, 0);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (batchExpiryDate && batchExpiryDate < today) {
        await client.query('ROLLBACK');
        return respondValidationError(res, {
          batch_id: 'Expired lot/batch records cannot be selected for this transaction.',
        });
      }

      if (batchAvailableQuantity <= 0) {
        await client.query('ROLLBACK');
        return respondValidationError(res, {
          batch_id: 'The selected lot/batch has no available stock remaining.',
        });
      }

      if (normalized.quantity > batchAvailableQuantity) {
        await client.query('ROLLBACK');
        return respondValidationError(res, {
          quantity: `Only ${batchAvailableQuantity} units are available in the selected lot/batch.`,
        });
      }

      const updatedBatchResult = await client.query(
        `
          UPDATE vaccine_batches
          SET qty_current = qty_current - $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *
        `,
        [normalized.quantity, normalized.batch_id],
      );

      const updatedBatch = updatedBatchResult.rows[0];
      effectiveLotNumber = selectedBatch.resolved_lot_number;
      effectiveExpiryDate = selectedBatch.expiry_date || effectiveExpiryDate;
      selectedBatchSummary = {
        batch_id: selectedBatch.id,
        lot_number: selectedBatch.resolved_lot_number,
        batch_number: selectedBatch.resolved_lot_number,
        previous_quantity: batchAvailableQuantity,
        affected_quantity: normalized.quantity,
        remaining_quantity: Number(updatedBatch?.qty_current || 0),
        storage_location: selectedBatch.resolved_storage_location || null,
        expiry_date: selectedBatch.expiry_date || null,
      };
    }

    // Use stock_on_hand if available, otherwise calculate from components
    const previousBalance = inventory.stock_on_hand !== null && inventory.stock_on_hand !== undefined
      ? Number(inventory.stock_on_hand)
      : Number(inventory.beginning_balance || 0) +
        Number(inventory.received_during_period || 0) +
        Number(inventory.transferred_in || 0) -
        Number(inventory.transferred_out || 0) -
        Number(inventory.expired_wasted || 0) -
        Number(inventory.issuance || 0);
    let newBalance = previousBalance;

    // Calculate new balance based on transaction type
    switch (normalized.transaction_type) {
    case 'RECEIVE':
      newBalance += normalized.quantity;
      break;
    case 'TRANSFER_IN':
      newBalance += normalized.quantity;
      break;
    case 'TRANSFER_OUT':
      newBalance -= normalized.quantity;
      break;
    case 'ISSUE':
      newBalance -= normalized.quantity;
      break;
    case 'EXPIRE':
    case 'WASTE':
      newBalance -= normalized.quantity;
      break;
    case 'ADJUST':
      newBalance = normalized.quantity; // Direct adjustment
      break;
    }

    // Validate new balance
    if (newBalance < 0) {
      await client.query('ROLLBACK');
      return respondValidationError(res, {
        quantity: 'Transaction quantity results in a negative stock balance',
      });
    }

    const transactionResult = await client.query(
      `INSERT INTO vaccine_inventory_transactions (
        vaccine_inventory_id, vaccine_id, ${transactionFacilityColumn}, transaction_type, quantity,
        previous_balance, new_balance, lot_number, batch_number, expiry_date,
        supplier_name, reference_number, performed_by, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        normalized.vaccine_inventory_id,
        resolvedVaccineId,
        facilityId,
        normalized.transaction_type,
        normalized.quantity,
        previousBalance,
        newBalance,
        effectiveLotNumber,
        effectiveLotNumber,
        effectiveExpiryDate,
        normalized.supplier_name,
        normalized.reference_number,
        userId,
        normalized.notes,
      ],
    );

    const adjustmentDelta =
      normalized.transaction_type === 'ADJUST' ? newBalance - previousBalance : 0;

    // Update inventory record
    const updatedInventoryResult = await client.query(
      `UPDATE vaccine_inventory SET
        updated_by = $1,
        beginning_balance = CASE WHEN $2 = 'ADJUST' THEN beginning_balance + $4 ELSE beginning_balance END,
        received_during_period = CASE WHEN $2 = 'RECEIVE' THEN received_during_period + $3 ELSE received_during_period END,
        transferred_in = CASE WHEN $2 = 'TRANSFER_IN' THEN transferred_in + $3 ELSE transferred_in END,
        transferred_out = CASE WHEN $2 = 'TRANSFER_OUT' THEN transferred_out + $3 ELSE transferred_out END,
        issuance = CASE WHEN $2 = 'ISSUE' THEN issuance + $3 ELSE issuance END,
        expired_wasted = CASE WHEN $2 IN ('EXPIRE','WASTE') THEN expired_wasted + $3 ELSE expired_wasted END,
        stock_on_hand = $6,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *`,
      [
        userId,
        normalized.transaction_type,
        normalized.quantity,
        adjustmentDelta,
        normalized.vaccine_inventory_id,
        newBalance,
      ],
    );

    await client.query('COMMIT');

    await safeTriggerStockNotification({
      vaccineName: vaccineValidation.vaccine.name,
      vaccineId: resolvedVaccineId,
      currentStock: newBalance,
      lotNumber: effectiveLotNumber || inventory.lot_batch_number,
      lowStockThreshold:
        updatedInventoryResult.rows[0]?.low_stock_threshold || inventory.low_stock_threshold,
    });

    const transactionResponse = {
      ...transactionResult.rows[0],
      batch_id: normalized.batch_id || null,
      selected_batch: selectedBatchSummary,
      updated_inventory: updatedInventoryResult.rows[0] || inventory,
      performed_by_name:
        getAuthenticatedUserDisplayName(req.user) ||
        transactionResult.rows[0].performed_by_name ||
        null,
    };

    if (selectedBatchSummary) {
      socketService.broadcast('vaccine_batch_updated', {
        id: selectedBatchSummary.batch_id,
        vaccine_id: resolvedVaccineId,
        lot_no: selectedBatchSummary.lot_number,
        lot_number: selectedBatchSummary.lot_number,
        qty_current: selectedBatchSummary.remaining_quantity,
        expiry_date: selectedBatchSummary.expiry_date,
        storage_location: selectedBatchSummary.storage_location,
      });
    }
    socketService.broadcast('vaccine_inventory_updated', updatedInventoryResult.rows[0]);
    socketService.broadcast('vaccine_inventory_transaction_created', transactionResponse);
    res.status(201).json(transactionResponse);
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Ignore rollback errors and surface the original failure below.
      }
    }
    res.status(500).json({ error: error.message });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Get vaccine stock alerts
router.get('/vaccine-stock-alerts', canViewVaccineInventory, async (req, res) => {
  try {
    const { status, alert_type, priority, clinic_id } = req.query;

    const stockAlertsFacilityColumn = await getStockAlertsFacilityColumn();
    const facilityTableName = await getFacilityTableName();
    const acknowledgedByJoinSpec = await getUserDisplayJoinSpec(
      'vsa.acknowledged_by',
      'acknowledged_by_user',
    );
    const resolvedByJoinSpec = await getUserDisplayJoinSpec(
      'vsa.resolved_by',
      'resolved_by_user',
    );

    const normalizedStatus = sanitizeText(status, { maxLength: 50 });
    const normalizedAlertType = sanitizeText(alert_type, { maxLength: 50 });
    const normalizedPriority = sanitizeText(priority, { maxLength: 20 });
    const clinicIdCheck = validateNumberRange(clinic_id, {
      label: 'clinic_id',
      required: false,
      min: 1,
      integer: true,
    });

    if (clinic_id && clinicIdCheck.error) {
      return respondValidationError(res, {
        clinic_id: clinicIdCheck.error,
      });
    }

    let query = `
      SELECT vsa.*, v.name as vaccine_name, v.code as vaccine_code,
             hf.name as facility_name, ${acknowledgedByJoinSpec.displayNameSql} as acknowledged_by_name,
             ${resolvedByJoinSpec.displayNameSql} as resolved_by_name
      FROM vaccine_stock_alerts vsa
      JOIN vaccines v ON vsa.vaccine_id = v.id
      JOIN ${facilityTableName} hf ON vsa.${stockAlertsFacilityColumn} = hf.id
      ${acknowledgedByJoinSpec.joins.join('\n      ')}
      ${resolvedByJoinSpec.joins.join('\n      ')}
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (normalizedStatus) {
      query += ` AND vsa.status = $${paramCount}`;
      params.push(normalizedStatus);
      paramCount++;
    }

    if (normalizedAlertType) {
      query += ` AND vsa.alert_type = $${paramCount}`;
      params.push(normalizedAlertType);
      paramCount++;
    }

    if (normalizedPriority) {
      query += ` AND vsa.priority = $${paramCount}`;
      params.push(normalizedPriority);
      paramCount++;
    }

    if (clinicIdCheck.value) {
      query += ` AND vsa.${stockAlertsFacilityColumn} = $${paramCount}`;
      params.push(clinicIdCheck.value);
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

router.put('/vaccine-stock-alerts/acknowledge-all', canModifyVaccineInventory, async (req, res) => {
  try {
    const alertIds = normalizeIntegerArray(req.body?.alert_ids, { min: 1 });
    const clinicIdCheck = validateNumberRange(req.body?.clinic_id, {
      label: 'clinic_id',
      required: false,
      min: 1,
      integer: true,
    });

    if (!Array.isArray(req.body?.alert_ids) || alertIds.length === 0) {
      return respondValidationError(res, {
        alert_ids: 'alert_ids must contain at least one stock alert id',
      });
    }

    if (req.body?.clinic_id !== undefined && clinicIdCheck.error) {
      return respondValidationError(res, {
        clinic_id: clinicIdCheck.error,
      });
    }

    const stockAlertsFacilityColumn = await getStockAlertsFacilityColumn();
    const userId = req.user.id;
    const params = [userId, alertIds];

    let facilityClause = '';
    if (clinicIdCheck.value) {
      params.push(clinicIdCheck.value);
      facilityClause = ` AND ${stockAlertsFacilityColumn} = $${params.length}`;
    }

    const result = await pool.query(
      `UPDATE vaccine_stock_alerts
       SET status = 'ACKNOWLEDGED',
           acknowledged_by = $1,
           acknowledged_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($2::int[])
         AND status = 'ACTIVE'
         ${facilityClause}
       RETURNING *`,
      params,
    );

    result.rows.forEach((row) => {
      socketService.broadcast('vaccine_stock_alert_updated', row);
    });

    res.json({
      updated_count: result.rows.length,
      updated: result.rows,
      message:
        result.rows.length > 0
          ? `Acknowledged ${result.rows.length} stock alert${result.rows.length === 1 ? '' : 's'}.`
          : 'No pending stock alerts matched the request.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/vaccine-stock-alerts/resolve-all', canModifyVaccineInventory, async (req, res) => {
  try {
    const alertIds = normalizeIntegerArray(req.body?.alert_ids, { min: 1 });
    const clinicIdCheck = validateNumberRange(req.body?.clinic_id, {
      label: 'clinic_id',
      required: false,
      min: 1,
      integer: true,
    });
    const resolutionNotes = sanitizeText(req.body?.resolution_notes, {
      maxLength: 500,
      preserveNewLines: true,
    });

    if (!Array.isArray(req.body?.alert_ids) || alertIds.length === 0) {
      return respondValidationError(res, {
        alert_ids: 'alert_ids must contain at least one stock alert id',
      });
    }

    if (req.body?.clinic_id !== undefined && clinicIdCheck.error) {
      return respondValidationError(res, {
        clinic_id: clinicIdCheck.error,
      });
    }

    const stockAlertsFacilityColumn = await getStockAlertsFacilityColumn();
    const userId = req.user.id;
    const params = [userId, resolutionNotes || null, alertIds];

    let facilityClause = '';
    if (clinicIdCheck.value) {
      params.push(clinicIdCheck.value);
      facilityClause = ` AND ${stockAlertsFacilityColumn} = $${params.length}`;
    }

    const result = await pool.query(
      `UPDATE vaccine_stock_alerts
       SET status = 'RESOLVED',
           resolved_by = $1,
           resolved_at = CURRENT_TIMESTAMP,
           resolution_notes = COALESCE($2, resolution_notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($3::int[])
         AND status <> 'RESOLVED'
         ${facilityClause}
       RETURNING *`,
      params,
    );

    result.rows.forEach((row) => {
      socketService.broadcast('vaccine_stock_alert_updated', row);
    });

    res.json({
      updated_count: result.rows.length,
      updated: result.rows,
      message:
        result.rows.length > 0
          ? `Resolved ${result.rows.length} stock alert${result.rows.length === 1 ? '' : 's'}.`
          : 'No eligible stock alerts matched the request.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Acknowledge vaccine stock alert
router.put('/vaccine-stock-alerts/:id/acknowledge', canModifyVaccineInventory, async (req, res) => {
  try {
    const idCheck = validateNumberRange(req.params.id, {
      label: 'id',
      required: true,
      min: 1,
      integer: true,
    });

    if (idCheck.error) {
      return respondValidationError(res, { id: idCheck.error });
    }

    // Get current user ID from JWT token
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE vaccine_stock_alerts SET
        status = 'ACKNOWLEDGED', acknowledged_by = $1, acknowledged_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [userId, idCheck.value],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Stock alert not found' });
    }

    socketService.broadcast('vaccine_stock_alert_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resolve vaccine stock alert
router.put('/vaccine-stock-alerts/:id/resolve', canModifyVaccineInventory, async (req, res) => {
  try {
    const idCheck = validateNumberRange(req.params.id, {
      label: 'id',
      required: true,
      min: 1,
      integer: true,
    });

    if (idCheck.error) {
      return respondValidationError(res, { id: idCheck.error });
    }

    const resolutionNotes = sanitizeText(req.body?.resolution_notes, {
      maxLength: 500,
      preserveNewLines: true,
    });

    if (resolutionNotes.length > 500) {
      return respondValidationError(res, {
        resolution_notes: 'resolution_notes must not exceed 500 characters',
      });
    }

    // Get current user ID from JWT token
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE vaccine_stock_alerts SET
        status = 'RESOLVED', resolved_by = $1, resolved_at = CURRENT_TIMESTAMP,
        resolution_notes = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 RETURNING *`,
      [userId, resolutionNotes || null, idCheck.value],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Stock alert not found' });
    }

    socketService.broadcast('vaccine_stock_alert_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get vaccine inventory statistics
router.get('/vaccine-inventory/stats', async (req, res) => {
  try {
    const { clinic_id } = req.query;

    const clinicIdCheck = validateNumberRange(clinic_id, {
      label: 'clinic_id',
      required: false,
      min: 1,
      integer: true,
    });

    if (clinic_id && clinicIdCheck.error) {
      return respondValidationError(res, {
        clinic_id: clinicIdCheck.error,
      });
    }

    const inventoryFacilityColumn = await getInventoryFacilityColumn();
    const stockAlertsFacilityColumn = await getStockAlertsFacilityColumn();
    const transactionFacilityColumn = await getInventoryTransactionsFacilityColumn();

    let whereClause = '';
    const params = [];

    if (clinicIdCheck.value) {
      whereClause = `WHERE ${inventoryFacilityColumn} = $1`;
      params.push(clinicIdCheck.value);
    }

    const [totalInventory, lowStockAlerts, criticalStockAlerts, recentTransactions] =
      await Promise.all([
        // Total inventory records
        pool.query(`SELECT COUNT(*) as count FROM vaccine_inventory ${whereClause}`, params),

        // Low stock alerts
        pool.query(
          `SELECT COUNT(*) as count FROM vaccine_stock_alerts
           WHERE status = 'ACTIVE' AND alert_type = 'LOW_STOCK' ${
  clinicIdCheck.value ? `AND ${stockAlertsFacilityColumn} = $1` : ''
}`,
          params,
        ),

        // Critical stock alerts
        pool.query(
          `SELECT COUNT(*) as count FROM vaccine_stock_alerts
           WHERE status = 'ACTIVE' AND alert_type = 'CRITICAL_STOCK' ${
  clinicIdCheck.value ? `AND ${stockAlertsFacilityColumn} = $1` : ''
}`,
          params,
        ),

        // Recent transactions (last 30 days)
        pool.query(
          `SELECT COUNT(*) as count FROM vaccine_inventory_transactions
           WHERE created_at >= CURRENT_DATE - INTERVAL '30 days' ${
  clinicIdCheck.value ? `AND ${transactionFacilityColumn} = $1` : ''
}`,
          params,
        ),
      ]);

    res.json({
      totalInventory: parseInt(totalInventory.rows[0].count, 10),
      lowStockAlerts: parseInt(lowStockAlerts.rows[0].count, 10),
      criticalStockAlerts: parseInt(criticalStockAlerts.rows[0].count, 10),
      recentTransactions: parseInt(recentTransactions.rows[0].count, 10),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// UNIFIED INVENTORY SUMMARY ENDPOINT (Fix #2, #3, #6, #7)
// ============================================================================
const inventoryCalculationService = require('../services/inventoryCalculationService');

router.get('/summary', async (req, res) => {
  try {
    const clinicId = req.user.clinic_id || req.user.facility_id;
    
    if (!clinicId) {
      return res.status(400).json({ error: 'Clinic ID required' });
    }

    const summary = await inventoryCalculationService.getUnifiedSummary(clinicId);
    const alerts = await inventoryCalculationService.getStockAlerts(clinicId);

    res.json({
      success: true,
      data: {
        ...summary,
        alerts,
      },
    });
  } catch (error) {
    console.error('Error fetching inventory summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// AVAILABLE LOTS/BATCHES ENDPOINT (Fix #5)
// ============================================================================
router.get('/available-lots', async (req, res) => {
  try {
    const { vaccine_id } = req.query;
    const clinicId = req.user.clinic_id || req.user.facility_id;

    if (!vaccine_id) {
      return res.status(400).json({ error: 'vaccine_id is required' });
    }

    if (!clinicId) {
      return res.status(400).json({ error: 'Clinic ID required' });
    }

    const lots = await inventoryCalculationService.getAvailableLots(
      parseInt(vaccine_id),
      clinicId
    );

    res.json({
      success: true,
      data: lots,
    });
  } catch (error) {
    console.error('Error fetching available lots:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// STOCK MOVEMENTS WITH CORRECT PERFORMED BY (Fix #1)
// ============================================================================
router.get('/stock-movements', async (req, res) => {
  try {
    const { vaccine_id, limit = 250 } = req.query;
    const clinicId = req.user.clinic_id || req.user.facility_id;

    if (!clinicId) {
      return res.status(400).json({ error: 'Clinic ID required' });
    }

    const safeLimit = Math.min(parseInt(limit) || 250, 1000);
    const transactionFacilityColumn = await getInventoryTransactionsFacilityColumn();

    let query = `
      SELECT 
        vit.id,
        vit.transaction_type,
        vit.quantity,
        vit.previous_balance,
        vit.new_balance,
        vit.lot_number,
        vit.batch_number,
        vit.reference_number,
        vit.notes,
        vit.created_at,
        v.name as vaccine_name,
        v.code as vaccine_code,
        COALESCE(
          NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
          u.username,
          'System'
        ) as performed_by_name,
        u.role as performed_by_role
      FROM vaccine_inventory_transactions vit
      JOIN vaccines v ON vit.vaccine_id = v.id
      LEFT JOIN users u ON vit.performed_by = u.id
      WHERE vit.${transactionFacilityColumn} = $1
    `;

    const params = [clinicId];
    let paramCount = 2;

    if (vaccine_id) {
      query += ` AND vit.vaccine_id = $${paramCount}`;
      params.push(parseInt(vaccine_id));
      paramCount++;
    }

    query += ` ORDER BY vit.created_at DESC LIMIT $${paramCount}`;
    params.push(safeLimit);

    const result = await pool.query(query, params);
    const movements = await inventoryCalculationService.calculateStockMovements(clinicId);

    res.json({
      success: true,
      data: {
        movements: result.rows,
        summary: movements,
      },
    });
  } catch (error) {
    console.error('Error fetching stock movements:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
