/**
 * Incoming SMS webhook handler.
 */

const express = require('express');
const router = express.Router();
const appointmentConfirmationService = require('../services/appointmentConfirmationService');
const pool = require('../db');

// This route is public - no authentication required
// It's called by the SMS provider's webhook

/**
 * POST /api/incoming/sms
 * Receive incoming SMS from webhook
 */
router.post('/sms', async (req, res) => {
  try {
    const { from, message } = req.body;

    console.log(`Received incoming SMS from ${from}: ${message}`);

    if (!from || !message) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: from, message',
      });
    }

    // Process the SMS
    const result = await appointmentConfirmationService.handleIncomingSMS(from, message);

    res.json({
      success: true,
      result: result,
    });
  } catch (error) {
    console.error('Error processing incoming SMS:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process SMS',
    });
  }
});

/**
 * GET /api/incoming/sms/logs
 * Get incoming SMS logs (admin only)
 */
router.get('/sms/logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, processed } = req.query;
    const offset = (page - 1) * limit;

    let query = `
            SELECT
                id,
                phone_number,
                message,
                keyword,
                related_appointment_id,
                processed,
                processed_at,
                created_at
            FROM incoming_sms
            WHERE 1=1
        `;

    const queryParams = [];
    let paramCount = 1;

    if (processed !== undefined) {
      query += ` AND processed = $${paramCount++}`;
      queryParams.push(processed === 'true');
    }

    // Get total count
    const countQuery = query.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    queryParams.push(parseInt(limit), offset);

    const result = await pool.query(query, queryParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching SMS logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch logs',
    });
  }
});

/**
 * POST /api/incoming/sms/test
 * Test endpoint to simulate incoming SMS
 */
router.post('/sms/test', async (req, res) => {
  try {
    const { phone_number, message } = req.body;

    if (!phone_number || !message) {
      return res.status(400).json({
        success: false,
        message: 'phone_number and message are required',
      });
    }

    const result = await appointmentConfirmationService.handleIncomingSMS(phone_number, message);

    res.json({
      success: true,
      result: result,
    });
  } catch (error) {
    console.error('Error testing incoming SMS:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test SMS',
    });
  }
});

module.exports = router;
