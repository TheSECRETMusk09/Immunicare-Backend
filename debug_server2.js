const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

console.log('[1] Express app created');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

console.log('[2] Middleware configured');

// Test pool connection
console.log('[3] About to require pool...');
const pool = require('./db');
console.log('[4] Pool loaded:', typeof pool);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
console.log('[5] Health endpoint registered');

// Load routes one by one
console.log('[6] About to load auth routes...');
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);
console.log('[7] Auth routes loaded');

console.log('[8] About to load dashboard routes...');
const dashboardRoutes = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRoutes);
console.log('[9] Dashboard routes loaded');

console.log('[10] About to load user routes...');
const userRoutes = require('./routes/users');
app.use('/api/users', userRoutes);
console.log('[11] User routes loaded');

console.log('[12] About to load notification routes...');
const notificationRoutes = require('./routes/notifications');
app.use('/api/notifications', notificationRoutes);
console.log('[13] Notification routes loaded');

console.log('[14] About to load infant routes...');
const infantRoutes = require('./routes/infants');
app.use('/api/infants', infantRoutes);
console.log('[15] Infant routes loaded');

console.log('[16] About to load vaccination routes...');
const vaccinationRoutes = require('./routes/vaccinations');
app.use('/api/vaccinations', vaccinationRoutes);
console.log('[17] Vaccination routes loaded');

console.log('[18] About to load appointment routes...');
const appointmentRoutes = require('./routes/appointments');
app.use('/api/appointments', appointmentRoutes);
console.log('[19] Appointment routes loaded');

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[20] Server running on port ${PORT}`);
});
