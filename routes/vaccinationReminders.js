const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const VaccinationReminderService = require('../services/vaccinationReminderService');

const reminderService = new VaccinationReminderService();

// Middleware to authenticate all routes
router.use(authenticateToken);

// Get upcoming vaccination reminders
router.get('/upcoming', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const upcomingVaccines = await reminderService.getPatientsWithUpcomingVaccines(days);

    res.json({
      success: true,
      count: upcomingVaccines.length,
      data: upcomingVaccines
    });
  } catch (error) {
    console.error('Error getting upcoming reminders:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Send reminder for a specific patient
router.post('/send/:patientId', async (req, res) => {
  try {
    const patientId = parseInt(req.params.patientId);

    // Get patient and guardian information
    const result = await pool.query(
      `
      SELECT p.*, g.* 
      FROM patients p
      JOIN guardians g ON p.guardian_id = g.id
      WHERE p.id = $1
    `,
      [patientId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    const patient = result.rows[0];
    const nextVaccine = await reminderService.getNextScheduledVaccine(patientId);

    if (!nextVaccine) {
      return res.status(400).json({
        success: false,
        message: 'No upcoming vaccines scheduled'
      });
    }

    await reminderService.sendVaccineReminder(patient, patient, nextVaccine);

    res.json({
      success: true,
      message: 'Reminder sent successfully',
      data: {
        patientId: patientId,
        vaccine: nextVaccine.vaccine,
        dose: nextVaccine.dose,
        dueDate: nextVaccine.dueDate
      }
    });
  } catch (error) {
    console.error('Error sending reminder:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Check and send reminders for all patients
router.post('/check-and-send', async (req, res) => {
  try {
    // Only allow admin or staff to trigger this endpoint
    if (req.user.role !== 'admin' && req.user.role !== 'doctor' && req.user.role !== 'nurse') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const daysInAdvance = parseInt(req.body.daysInAdvance) || 7;
    const sentReminders = await reminderService.checkAndSendReminders(daysInAdvance);

    res.json({
      success: true,
      count: sentReminders.length,
      data: sentReminders
    });
  } catch (error) {
    console.error('Error checking and sending reminders:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get next scheduled vaccine for a patient
router.get('/next/:patientId', async (req, res) => {
  try {
    const patientId = parseInt(req.params.patientId);
    const nextVaccine = await reminderService.getNextScheduledVaccine(patientId);

    if (!nextVaccine) {
      return res.json({
        success: true,
        data: null,
        message: 'All vaccines completed'
      });
    }

    res.json({
      success: true,
      data: nextVaccine
    });
  } catch (error) {
    console.error('Error getting next vaccine:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Calculate due date for a specific vaccine and dose
router.post('/calculate-due-date', async (req, res) => {
  try {
    const { birthDate, vaccine, dose } = req.body;

    if (!birthDate || !vaccine || !dose) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const dueDate = reminderService.calculateNextVaccineDate(
      new Date(birthDate),
      vaccine,
      parseInt(dose)
    );

    res.json({
      success: true,
      data: {
        vaccine,
        dose: parseInt(dose),
        dueDate
      }
    });
  } catch (error) {
    console.error('Error calculating due date:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
