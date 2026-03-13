const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const loadBackendEnv = require('./config/loadEnv');
loadBackendEnv();
const { validateEnv } = require('./utils/envValidator');
validateEnv(true);

// Import auth middleware
const { preventGuardianAccess, requestIdMiddleware } = require('./middleware/auth');

// Create rate limiter for auth endpoints
const authRateLimitMaxFromEnv = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || '', 10);
const authRateLimitMax =
  Number.isFinite(authRateLimitMaxFromEnv) && authRateLimitMaxFromEnv > 0
    ? authRateLimitMaxFromEnv
    : process.env.NODE_ENV === 'production'
      ? 10
      : 200;

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  // Do not count CORS preflight requests, which can inflate auth request counts in development.
  skip: (req) => req.method === 'OPTIONS',
  handler: (req, res, _next, options) => {
    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(options.windowMs / 1000),
    });
  },
});

// Initialize monitoring and logging
const { register } = require('./config/monitoring');
const logger = require('./config/logger');
const WebSocketMetrics = require('./monitoring/websocketMetrics');

// Initialize Socket.io service
const socketService = require('./services/socketService');
let redisClient;
try {
  redisClient = require('./config/redis');
} catch (err) {
  console.warn('Redis not available, using mock client');
  // Create a mockRedis client for development
  redisClient = {
    on: () => {},
    get: async () => null,
    set: async () => {},
    del: async () => {},
    keys: async () => [],
    quit: async () => {},
  };
}

const app = express();
const server = http.createServer(app);

// Fix for "read ECONNRESET" errors causing server crash
server.on('clientError', (err, socket) => {
  if (err.code === 'ECONNRESET' || !socket.writable) {
    return;
  }
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

const PORT = process.env.PORT || 5000;
const HTTPS_PORT = process.env.HTTPS_PORT || 5443;
const ENABLE_HTTPS = process.env.ENABLE_HTTPS === 'true';
const runtimeStateDir = path.join(__dirname, '.runtime');
const runtimePortStateFile = path.join(runtimeStateDir, 'active-port.json');

const writeRuntimePortState = (port, status = 'running') => {
  try {
    fs.mkdirSync(runtimeStateDir, { recursive: true });
    fs.writeFileSync(
      runtimePortStateFile,
      JSON.stringify(
        {
          port,
          status,
          pid: process.pid,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (error) {
    console.warn('Failed to write backend runtime port state:', error.message);
  }
};

const clearRuntimePortState = () => {
  try {
    if (fs.existsSync(runtimePortStateFile)) {
      fs.unlinkSync(runtimePortStateFile);
    }
  } catch (error) {
    console.warn('Failed to clear backend runtime port state:', error.message);
  }
};

// HTTPS server (optional)
let httpsServer = null;

// Initialize Socket.io with HTTP server
console.log('About to initialize Socket.io...');
socketService.initialize(server);
console.log('Socket.io initialized successfully');

// Initialize WebSocket Metrics
const wsMetrics = new WebSocketMetrics();
if (socketService.io) {
  console.log('Attaching WebSocket metrics...');
  socketService.io.on('connection', (socket) => {
    const metadata = {
      userAgent: socket.handshake.headers['user-agent'],
      ip: socket.handshake.address,
      connectTime: Date.now(),
    };
    wsMetrics.trackConnection(socket.id, metadata);

    socket.on('disconnect', (reason) => {
      wsMetrics.trackDisconnection(socket.id, reason);
    });

    socket.on('error', (err) => {
      wsMetrics.trackError('socket_error', socket.id, { message: err.message });
    });
  });
}

// CORS configuration - environment-driven allowlist
const configuredOrigins = [process.env.CORS_ORIGIN, process.env.FRONTEND_URL]
  .filter(Boolean)
  .flatMap((value) => value.split(','))
  .map((value) => value.trim())
  .filter(Boolean);

const defaultDevOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://localhost:3000',
  'https://127.0.0.1:3000',
];

// In production, only allow production domains
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? Array.from(new Set(configuredOrigins))
  : Array.from(new Set([...configuredOrigins, ...defaultDevOrigins]));

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (
      process.env.NODE_ENV !== 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ) {
      callback(null, true);
    } else if (
      process.env.NODE_ENV !== 'production' &&
      /^https?:\/\/192\.168\.\d+\.\d+(\:\d+)?$/i.test(origin)
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'Cache-Control', 'Pragma'],
  optionsSuccessStatus: 204,
};

// Apply CORS middleware FIRST (before all other middleware)
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Helmet security headers - provides important security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ['\'self\''],
        scriptSrc: ['\'self\'', '\'unsafe-inline\''],
        styleSrc: ['\'self\'', '\'unsafe-inline\''],
        imgSrc: ['\'self\'', 'data:'],
        connectSrc: ['\'self\''],
        fontSrc: ['\'self\''],
        objectSrc: ['\'none\''],
        mediaSrc: ['\'self\''],
        frameSrc: ['\'none\''],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  }),
);

// Request timeout middleware - prevent requests from hanging
app.use((req, res, next) => {
  // Set timeout to 25 seconds (less than frontend timeout of 30s)
  req.setTimeout(25000, () => {
    if (!res.headersSent) {
      res.status(408).json({
        error: 'Request timeout',
        code: 'REQUEST_TIMEOUT',
        message: 'The request took too long to process. Please try again.',
      });
    }
  });

  // Set socket timeout
  res.setTimeout(25000, () => {
    if (!res.headersSent) {
      res.status(408).json({
        error: 'Response timeout',
        code: 'RESPONSE_TIMEOUT',
        message: 'The response took too long to generate. Please try again.',
      });
    }
  });

  next();
});

// JSON parsing error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.type === 'entity.parse.failed') {
    console.error('JSON parsing error:', err);
    return res.status(400).json({
      error: 'Invalid JSON format',
      code: 'INVALID_JSON',
      message: 'The request body contains invalid JSON syntax',
    });
  }
  next();
});
app.use(
  express.json({
    limit: '10mb', // Increase limit for larger requests
    verify: (req, res, buf) => {
      try {
        if (buf.length > 0) {
          JSON.parse(buf);
        }
      } catch (err) {
        console.error('JSON verification error:', err);
        const error = new SyntaxError('Invalid JSON format');
        error.type = 'entity.parse.failed';
        throw error;
      }
    },
  }),
);

// Cookie parser middleware
const cookieParser = require('cookie-parser');
app.use(cookieParser());

// Global input sanitization middleware - prevents XSS and injection attacks
console.log('Loading input sanitization middleware...');
const { createSanitizationMiddleware, preventPrototypePollution } = require('./middleware/sanitization');

// Apply sanitization to all API routes
// Exclude sensitive fields that should not be sanitized (passwords, tokens, etc.)
app.use('/api', preventPrototypePollution);
app.use('/api', createSanitizationMiddleware());
console.log('Input sanitization middleware applied');

// Global middleware to prevent caching for all API routes
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Request ID tracking middleware for distributed tracing
app.use(requestIdMiddleware);
console.log('Request ID middleware loaded');

// Monitoring middleware
console.log('Loading monitoring middleware...');
const monitoringMiddleware = require('./middleware/monitoring');
app.use(monitoringMiddleware);
console.log('Monitoring middleware loaded');

// Apply rate limiting to auth endpoints
console.log('Loading auth rate limiter...');
app.use('/api/auth/login', authRateLimiter);
app.use('/api/auth/register', authRateLimiter);
app.use('/api/auth/refresh', authRateLimiter);
app.use('/api/auth/forgot-password', authRateLimiter);
console.log('Auth rate limiting applied');

// Apply guardian access prevention to admin routes
console.log('Loading guardian access prevention...');
const { authenticateToken } = require('./middleware/auth');
app.use('/api/admin', authenticateToken, preventGuardianAccess);
console.log('Guardian access prevention applied to /api/admin routes');

// Swagger documentation
console.log('Setting up Swagger...');
const setupSwagger = require('./swagger');
setupSwagger(app);
console.log('Swagger setup complete');

// Replace console with logger
console.log('Replacing console with logger...');
console.log = logger.info.bind(logger);
console.error = logger.error.bind(logger);
console.warn = logger.warn.bind(logger);
console.log('Console replaced with logger successfully');

// CSRF protection middleware - DEPRECATED: csurf package has been removed due to security vulnerabilities
// For production CSRF protection, consider using helmet-csrf or @ Mazzard/csurf-sync
// Currently, CSRF protection is disabled
const csrfDisabled = true;

if (!csrfDisabled) {
  console.log('Loading CSRF protection...');
  const csrf = require('csurf');
  const csrfProtection = csrf({ cookie: true });
  // Apply CSRF protection to all routes except health check, metrics, auth, and user endpoints
  app.use((req, res, next) => {
    if (
      req.path === '/api/health' ||
      req.path === '/metrics' ||
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/users')
    ) {
      return next();
    }
    csrfProtection(req, res, next);
  });
  console.log('CSRF protection loaded and applied.');
} else {
  console.warn('CSRF protection is disabled. The deprecated csurf package has been removed.');
}

// Routes
console.log('Loading routes...');
app.use('/api', require('./routes/api'));
console.log('Routes loaded successfully');

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Immunicare Backend API' });
});

// Serve favicon.ico from frontend public folder
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/favicon.ico'));
});

// Health check endpoint - enhanced with proper CORS and caching headers
app.get('/api/health', async (req, res) => {
  // Set cache control headers to prevent caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const healthResult = await healthCheck();

  res.status(healthResult.healthy ? 200 : 503).json({
    status: healthResult.healthy ? 'OK' : 'UNHEALTHY',
    timestamp: new Date().toISOString(),
    service: 'Immunicare Backend API',
    version: '1.0.0',
    database: {
      healthy: healthResult.healthy,
      latency: healthResult.latency,
      error: healthResult.error,
    },
    environment: process.env.NODE_ENV || 'development',
  });
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (err) {
    res.status(500).end(err);
  }
});

// WebSocket Health Check Endpoint
app.get('/api/ws-health', (req, res) => {
  const metrics = wsMetrics.getMetrics();
  const status = metrics.computed.healthScore > 70 ? 'healthy' : 'degraded';

  res.json({
    status,
    connections: metrics.connections.active,
    healthScore: metrics.computed.healthScore,
    reconnectionRate: metrics.computed.reconnectionRate,
    timestamp: new Date().toISOString(),
  });
});

// Global error handler - using centralized error handling middleware
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server with database connection verification
const pool = require('./db');
const { healthCheck } = require('./db');

// Fix for unexpected errors on idle clients
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit process
});

// Configuration for port handling
const BASE_PORT = parseInt(process.env.PORT, 10) || 5000;
const MAX_PORT_ATTEMPTS = 10;
const PORT_INCREMENT = 1;

/**
 * Check if a port is available
 * @param {number} port - Port number to check
 * @returns {Promise<boolean>} - True if port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const testServer = require('http').createServer();
    testServer.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    testServer.once('listening', () => {
      testServer.close(() => resolve(true));
    });
    testServer.listen(port, '0.0.0.0');
  });
}

/**
 * Find an available port starting from basePort
 * @param {number} basePort - Starting port number
 * @param {number} maxAttempts - Maximum number of ports to try
 * @returns {Promise<number|null>} - Available port or null
 */
async function findAvailablePort(basePort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
    console.warn(`Port ${port} is in use, trying next port...`);
  }
  return null;
}

/**
 * Start HTTP server with error handling
 * @param {number} port - Port to listen on
 * @returns {Promise<void>}
 */
function startHTTPServer(port) {
  return new Promise((resolve, reject) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`HTTP Server running on port ${port}`);
      resolve();
    });

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });
  });
}

async function startServer() {
  let currentPort = BASE_PORT;

  try {
    console.log('Starting Immunicare API Server...');
    console.log(`Base port configured: ${BASE_PORT}`);

    // Test database connection with timeout and structured health check
    console.log('Testing database connection...');
    try {
      const dbPromise = healthCheck();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Database connection timeout')), 10000),
      );
      const health = await Promise.race([dbPromise, timeoutPromise]);

      if (health.healthy) {
        console.log(`Database connection successful (latency: ${health.latency}ms)`);
      } else {
        console.error('Database health check failed:', health.error);
        const isAuthOrConfigDbError = ['28P01', '28000', '3D000', '3F000', '42501'].includes(
          health.code,
        );

        const isScramPasswordTypeError =
          typeof health.error === 'string' &&
          health.error.toLowerCase().includes('sasl') &&
          health.error.toLowerCase().includes('client password must be a string');

        if (isAuthOrConfigDbError || isScramPasswordTypeError) {
          console.error(
            'Detected database authentication/configuration error. Check DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD in the active production environment file (.env.production, .env.hostinger, or .env).',
          );

          if (isScramPasswordTypeError) {
            console.error(
              'Detected invalid DB_PASSWORD type/value for PostgreSQL SCRAM auth. Ensure DB_PASSWORD is a plain non-empty string when the DB user requires password authentication.',
            );
          }
        }

        if (process.env.NODE_ENV === 'production') {
          logger.error('CRITICAL: Database connection is required for production. Exiting.');
          process.exit(1);
        } else {
          logger.warn('Server will start without database - some features may not work');
        }
      }
    } catch (dbError) {
      logger.error('Database connection failed:', dbError.message);
      if (process.env.NODE_ENV === 'production') {
        logger.error('CRITICAL: Database connection is required for production. Exiting.');
        process.exit(1);
      } else {
        logger.warn('Server will start without database - some features may not work');
      }
    }

    // Check if base port is available, find alternative if not
    console.log('Checking port availability...');
    const portAvailable = await isPortAvailable(BASE_PORT);
    if (!portAvailable) {
      console.warn(`Port ${BASE_PORT} is already in use`);

      // Try to find an available port
      const availablePort = await findAvailablePort(BASE_PORT + 1, MAX_PORT_ATTEMPTS);

      if (availablePort) {
        currentPort = availablePort;
        console.log(`Found available port: ${currentPort}`);
      } else {
        console.error('\n=================================================');
        console.error('ERROR: Could not find an available port');
        console.error(`Ports ${BASE_PORT} to ${BASE_PORT + MAX_PORT_ATTEMPTS} are all in use`);
        console.error('=================================================\n');
        console.error('To resolve this issue:');
        console.error('1. Kill the process using port 5000:');
        console.error('   - Windows CMD: netstat -ano | findstr :5000');
        console.error('   - Then: taskkill /PID <PID> /F');
        console.error('2. Or set a different PORT in your .env file');
        console.error('3. Or wait a moment and try again\n');
        process.exit(1);
      }
    }

    // Start HTTP server
    try {
      await startHTTPServer(currentPort);
    } catch (serverError) {
      console.error('Failed to start HTTP server:', serverError.message);
      process.exit(1);
    }

    console.log('Socket.io server initialized');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Start background monitoring services
    // We isolate each service in its own try-catch block to prevent cascading failures
    try {
      const criticalStockMonitor = require('./services/criticalStockMonitor');
      criticalStockMonitor.start();
      console.log('Critical stock monitor started');
    } catch (err) {
      console.warn('Warning: Could not start Critical Stock Monitor:', err.message);
    }

    try {
      const expiryMonitor = require('./services/expiryMonitor');
      expiryMonitor.start();
      console.log('Expiry monitor started');
    } catch (err) {
      console.warn('Warning: Could not start Expiry Monitor:', err.message);
    }

    try {
      // Initialize scheduler for cleanup jobs
      const initScheduler = require('./jobs/scheduler');
      initScheduler();
      console.log('Scheduler initialized');
    } catch (err) {
      console.warn('Warning: Could not initialize Scheduler:', err.message);
    }

    // Export the actual port being used
    process.env.ACTUAL_PORT = currentPort;
    writeRuntimePortState(currentPort, 'running');

    // Start HTTPS server if enabled
    if (ENABLE_HTTPS) {
      try {
        const sslKeyPath = process.env.SSL_KEY_PATH || './ssl/server.key';
        const sslCertPath = process.env.SSL_CERT_PATH || './ssl/server.crt';

        const sslOptions = {
          key: fs.readFileSync(path.join(__dirname, sslKeyPath)),
          cert: fs.readFileSync(path.join(__dirname, sslCertPath)),
          minVersion: 'TLSv1.2',
          ciphers: [
            'ECDHE-ECDSA-AES128-GCM-SHA256',
            'ECDHE-RSA-AES128-GCM-SHA256',
            'ECDHE-ECDSA-AES256-GCM-SHA384',
            'ECDHE-RSA-AES256-GCM-SHA384',
            'ECDHE-ECDSA-CHACHA20-POLY1305',
            'ECDHE-RSA-CHACHA20-POLY1305',
          ],
          honorCipherOrder: true,
        };

        httpsServer = https.createServer(sslOptions, app);
        httpsServer.listen(HTTPS_PORT, () => {
          console.log(`HTTPS Server running on port ${HTTPS_PORT}`);
          console.log('SSL/TLS enabled with TLSv1.2+');
        });

        // Initialize Socket.io with HTTPS server as well
        socketService.initialize(httpsServer);
      } catch (error) {
        console.error('Failed to start HTTPS server:', error.message);
        console.error('  Please run: node generate_ssl_certificates.js');
        console.error('  Or set ENABLE_HTTPS=false in .env');
        console.error('  Continuing with HTTP only...');
      }
    } else {
      console.log('HTTPS is disabled. Set ENABLE_HTTPS=true in .env to enable.');
    }
  } catch (error) {
    console.error('Fatal error starting server:', error);
    process.exit(1);
  }
}

// Graceful shutdown handler with Socket.io cleanup
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received, initiating graceful shutdown...`);
  writeRuntimePortState(process.env.ACTUAL_PORT || BASE_PORT, 'stopping');

  // Close all Socket.io connections first
  try {
    if (socketService && socketService.io) {
      console.log('Closing all Socket.io connections...');
      const connectedSockets = socketService.io.sockets.sockets;
      wsMetrics.shutdown();
      if (connectedSockets) {
        connectedSockets.forEach((socket) => {
          socket.disconnect(true);
        });
      }
      // Close the Socket.io server
      await new Promise((resolve) => {
        socketService.io.close(() => {
          console.log('Socket.io server closed');
          resolve();
        });
      });
    }
  } catch (err) {
    console.error('Error closing Socket.io:', err.message);
  }

  // Close HTTP server
  const closeHttpServer = () => {
    return new Promise((resolve) => {
      if (server && server.listening) {
        server.close(() => {
          console.log('HTTP server closed');
          resolve();
        });
      } else {
        resolve();
      }
    });
  };

  // Close HTTPS server
  const closeHttpsServer = () => {
    return new Promise((resolve) => {
      if (httpsServer && httpsServer.listening) {
        httpsServer.close(() => {
          console.log('HTTPS server closed');
          resolve();
        });
      } else {
        resolve();
      }
    });
  };

  try {
    await Promise.all([closeHttpServer(), closeHttpsServer()]);
    console.log('All servers closed gracefully');

    // Close database pool
    try {
      await pool.end();
      console.log('Database pool closed');
    } catch (err) {
      console.error('Error closing database pool:', err.message);
    }

    clearRuntimePortState();

    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    clearRuntimePortState();
    process.exit(1);
  }
}

// Export app and server for testing
module.exports = { app, server, httpsServer, startServer, gracefulShutdown };

// Only start server if this file is run directly (not required as module)
if (require.main === module) {
  startServer();
}

// Graceful shutdown handling - SIGTERM (e.g., from process manager like PM2, nodemon)
process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});

// Graceful shutdown handling - SIGINT (e.g., Ctrl+C)
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.error('Error stack:', err.stack);
  writeRuntimePortState(process.env.ACTUAL_PORT || BASE_PORT, 'crashed');
  // Attempt graceful shutdown
  const closeServers = () => {
    let serversClosed = 0;
    const totalServers = httpsServer ? 2 : 1;

    server.close(() => {
      serversClosed++;
      if (serversClosed === totalServers) {
        console.error('Servers closed due to uncaught exception');
        clearRuntimePortState();
        process.exit(1);
      }
    });

    if (httpsServer) {
      httpsServer.close(() => {
        serversClosed++;
        if (serversClosed === totalServers) {
          console.error('Servers closed due to uncaught exception');
          clearRuntimePortState();
          process.exit(1);
        }
      });
    }
  };

  closeServers();
});
