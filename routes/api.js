const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth'));
// Role-specific auth endpoints
router.use('/auth/admin', require('./auth/admin'));
router.use('/auth/guardian', require('./auth/guardian'));
router.use('/dashboard', require('./dashboard'));
router.use('/analytics', require('./analytics'));
router.use('/users', require('./users'));
router.use('/infants', require('./infants'));
router.use('/vaccinations', require('./vaccinations'));
router.use('/inventory', require('./inventory'));
router.use('/appointments', require('./appointments'));
router.use('/announcements', require('./announcements'));
router.use('/growth', require('./growth'));
router.use('/paper-templates', require('./paper-templates'));
router.use('/documents', require('./documents'));
router.use('/notifications', require('./notifications'));
router.use('/notifications-enhanced', require('./notifications-enhanced'));
router.use('/reports', require('./reports'));
router.use('/reports-enhanced', require('./reports-enhanced'));
router.use('/monitoring', require('./monitoring'));
router.use('/vaccination-management', require('./vaccination-management'));
router.use('/vaccination-reminders', require('./vaccinationReminders'));
router.use('/vaccine-supply', require('./vaccine-supply'));
router.use('/vaccine-distribution', require('./vaccineDistribution'));
router.use('/uploads', require('./uploads'));
router.use('/messages', require('./messages'));
router.use('/settings', require('./settings'));
router.use('/admin', require('./admin'));
router.use('/guardian/notifications', require('./guardianNotifications'));
router.use('/sms', require('./sms'));
router.use('/infant-allergies', require('./infantAllergies'));
router.use('/vaccine-waitlist', require('./vaccineWaitlist'));
router.use('/incoming', require('./incomingSms'));

module.exports = router;
