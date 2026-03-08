/**
 * Minimal Test Server
 * Tests CORS configuration and basic connectivity without complex middleware
 */

const express = require('express');
const http = require('http');
const cors = require('cors');

const app = express();
const PORT = 5000;

// Simple CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];

    // Allow requests with no origin
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};

// Apply CORS first
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Immunicare Minimal Test Server',
    version: '1.0.0'
  });
});

// Auth verify endpoint (simplified)
app.get('/api/auth/verify', (req, res) => {
  res.json({
    authenticated: false,
    error: 'No token provided',
    code: 'NO_TOKEN'
  });
});

// Auth test endpoint
app.get('/api/auth/test', (req, res) => {
  res.json({
    message: 'Auth route is working',
    timestamp: new Date().toISOString()
  });
});

// Login endpoint (simplified)
app.post('/api/auth/login', (req, res) => {
  res.json({
    message: 'Login endpoint is accessible',
    timestamp: new Date().toISOString()
  });
});

// Start server
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('MINIMAL TEST SERVER');
  console.log('='.repeat(60));
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('CORS enabled for: http://localhost:3000');
  console.log('');
  console.log('Available endpoints:');
  console.log(`  GET  http://localhost:${PORT}/api/health`);
  console.log(`  GET  http://localhost:${PORT}/api/auth/verify`);
  console.log(`  GET  http://localhost:${PORT}/api/auth/test`);
  console.log(`  POST http://localhost:${PORT}/api/auth/login`);
  console.log('');
  console.log('Test CORS with:');
  console.log(
    `  curl -v -X OPTIONS http://localhost:${PORT}/api/health -H "Origin: http://localhost:3000"`
  );
  console.log(`  curl -v http://localhost:${PORT}/api/health`);
  console.log('='.repeat(60));
});

// Handle server errors
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: Port ${PORT} is already in use`);
    console.error('Please stop any existing servers or use a different port');
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server };
