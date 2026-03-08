/**
 * Minimal test server to diagnose startup issues
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 5000;

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Immunicare Backend API (Test)',
    port: PORT
  });
});

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Immunicare Backend API (Test Server)' });
});

// Start server
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
