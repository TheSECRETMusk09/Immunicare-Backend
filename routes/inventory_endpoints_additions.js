/**
 * Additional Inventory Endpoints for Refactored Module
 * Add these to the main inventory.js routes file
 */

const inventoryCalculationService = require('../services/inventoryCalculationService');

// ============================================================================
// UNIFIED INVENTORY SUMMARY ENDPOINT
// ============================================================================
/**
 * GET /api/inventory/summary
 * Returns unified inventory summary with all calculations
 * Replaces separate Stock Alerts and Vaccine Monitoring endpoints
 */
router.get('/summary', authenticateToken, async (req, res) => {
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
// AVAILABLE LOTS/BATCHES ENDPOINT
// ============================================================================
/**
 * GET /api/inventory/available-lots
 * Returns available lots/batches for a vaccine (for waste transaction dropdown)
 */
router.get('/available-lots', authenticateToken, async (req, res) => {
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
// STOCK MOVEMENTS WITH CORRECT PERFORMED BY
// ============================================================================
/**
 * GET /api/inventory/stock-movements
 * Returns stock movement history with correct performer names
 */
router.get('/stock-movements', authenticateToken, async (req, res) => {
  try {
    const { vaccine_id, limit = 100 } = req.query;
    const clinicId = req.user.clinic_id || req.user.facility_id;

    if (!clinicId) {
      return res.status(400).json({ error: 'Clinic ID required' });
    }

    const safeLimit = Math.min(parseInt(limit) || 100, 1000);

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
        -- Get actual user name from users table
        COALESCE(
          NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
          u.username,
          'System'
        ) as performed_by_name,
        u.role as performed_by_role
      FROM vaccine_inventory_transactions vit
      JOIN vaccines v ON vit.vaccine_id = v.id
      LEFT JOIN users u ON vit.performed_by = u.id
      WHERE vit.clinic_id = $1
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

    // Calculate summary statistics
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
