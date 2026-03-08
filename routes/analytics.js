const express = require('express');

const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { requirePermission, requireHealthCenterAccess } = require('../middleware/rbac');
const analyticsController = require('../controllers/analyticsController');

const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};

router.use(noStore);

router.get('/', analyticsController.health);

router.get(
  '/filters',
  authenticateToken,
  requirePermission('dashboard:analytics'),
  requireHealthCenterAccess(),
  analyticsController.filters,
);

router.get(
  '/dashboard',
  authenticateToken,
  requirePermission('dashboard:analytics'),
  requireHealthCenterAccess(),
  analyticsController.dashboard,
);

router.get(
  '/dashboard-summary',
  authenticateToken,
  requirePermission('dashboard:analytics'),
  requireHealthCenterAccess(),
  analyticsController.dashboardSummary,
);

router.get(
  '/vaccinations',
  authenticateToken,
  requirePermission('dashboard:analytics'),
  requireHealthCenterAccess(),
  analyticsController.vaccinations,
);

router.get(
  '/appointments',
  authenticateToken,
  requirePermission('dashboard:analytics'),
  requireHealthCenterAccess(),
  analyticsController.appointments,
);

router.get(
  '/inventory',
  authenticateToken,
  requirePermission('dashboard:analytics'),
  requireHealthCenterAccess(),
  analyticsController.inventory,
);

router.get(
  '/trends',
  authenticateToken,
  requirePermission('dashboard:analytics'),
  requireHealthCenterAccess(),
  analyticsController.trends,
);

router.get(
  '/demographics',
  authenticateToken,
  requirePermission('dashboard:analytics'),
  requireHealthCenterAccess(),
  analyticsController.demographics,
);

module.exports = router;
