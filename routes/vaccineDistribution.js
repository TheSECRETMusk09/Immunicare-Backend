/**
 * Vaccine Distribution Routes
 * City → Barangay Distribution Flow
 * Barangay → City Feedback Loop
 */

const express = require('express');
const router = express.Router();
const { authenticateToken: auth } = require('../middleware/auth');
const distributionController = require('../controllers/vaccineDistributionController');

// Root route - return API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Vaccine Distribution API',
    endpoints: [
      '/distribution/requests',
      '/distribution',
      '/reports/periodic',
      '/inventory/export',
      '/schedules'
    ]
  });
});

// ===========================================
// DISTRIBUTION REQUESTS (Barangay → City)
// ===========================================

// Create distribution request (BHC requests from City)
router.post('/distribution/requests', auth, distributionController.createDistributionRequest);

// Get distribution requests
router.get('/distribution/requests', auth, distributionController.getDistributionRequests);

// Approve/Reject distribution request (City level)
router.put(
  '/distribution/requests/:id/approve',
  auth,
  distributionController.approveDistributionRequest
);

// ===========================================
// DISTRIBUTIONS (City → Barangay)
// ===========================================

// Create and dispatch distribution (City sends to BHC)
router.post('/distribution/dispatch', auth, distributionController.createDistribution);

// Receive distribution (BHC receives)
router.put('/distribution/:id/receive', auth, distributionController.receiveDistribution);

// Get distributions
router.get('/distribution', auth, distributionController.getDistributions);

// ===========================================
// COLD CHAIN MONITORING
// ===========================================

// Record temperature reading during transport
router.post('/distribution/:id/temperature', auth, distributionController.recordTemperatureReading);

// ===========================================
// BHC PERIODIC REPORTS (Barangay → City)
// ===========================================

// Submit periodic report (BHC submits to City)
router.post('/reports/periodic', auth, distributionController.createPeriodicReport);

// Get periodic reports
router.get('/reports/periodic', auth, distributionController.getPeriodicReports);

// Review report (City level)
router.put('/reports/periodic/:id/review', auth, distributionController.reviewPeriodicReport);

// ===========================================
// EXCEL IMPORT/EXPORT
// ===========================================

// Export inventory to Excel
router.get('/inventory/export', auth, distributionController.exportInventoryToExcel);

// Import inventory from Excel
router.post('/inventory/import', auth, distributionController.importInventoryFromExcel);

// ===========================================
// INFANT VACCINATION SCHEDULES
// ===========================================

// Generate schedule for infant
router.post('/schedules/generate', auth, distributionController.generateInfantSchedule);

// Get infant schedule
router.get('/schedules/:infantId', auth, distributionController.getInfantSchedule);

// Update schedule status
router.put('/schedules/:id', auth, distributionController.updateScheduleStatus);

// Get overdue schedules
router.get('/schedules/overdue', auth, distributionController.getOverdueSchedules);

// Create reminder
router.post('/schedules/:id/reminder', auth, distributionController.createScheduleReminder);

module.exports = router;
