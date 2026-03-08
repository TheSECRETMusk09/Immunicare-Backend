// Performance Optimization Configuration for 10,000+ Concurrent Users

const cluster = require('cluster');
const os = require('os');

// Performance configuration
const performanceConfig = {
  // Server Configuration
  server: {
    port: process.env.PORT || 5000,
    host: process.env.HOST || '0.0.0.0',
    maxConnections: 10000,
    keepAliveTimeout: 5000,
    headersTimeout: 6000
  },

  // Cluster Configuration
  cluster: {
    enabled: process.env.NODE_ENV === 'production',
    workers: process.env.CLUSTER_WORKERS || Math.min(os.cpus().length, 4),
    gracefulShutdownTimeout: 10000
  },

  // Database Configuration
  database: {
    connectionLimit: 100,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    ssl: process.env.DATABASE_SSL === 'true',
    pool: {
      min: 10,
      max: 100,
      idle: 10000,
      acquire: 60000,
      evict: 1000
    }
  },

  // Caching Configuration
  cache: {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      keyPrefix: 'immunicare:',
      ttl: 3600 // 1 hour default TTL
    },
    memory: {
      max: 100, // Maximum number of items in memory cache
      ttl: 300 // 5 minutes default TTL
    }
  },

  // Rate Limiting Configuration
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests from this IP, please try again later.',
      success: false
    }
  },

  // Compression Configuration
  compression: {
    level: 6, // Compression level (1-9)
    threshold: 1024, // Only compress responses larger than 1KB
    filter: (req, res) => {
      // Don't compress responses if the request includes a cache-control header with no-transform
      if (
        req.headers['cache-control'] &&
        req.headers['cache-control'].includes('no-transform')
      ) {
        return false;
      }
      // Use compression filter function
      return require('compression').filter(req, res);
    }
  },

  // Static File Configuration
  static: {
    maxAge: 86400000, // 1 day
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  },

  // Security Configuration
  security: {
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ['\'self\''],
          styleSrc: ['\'self\'', '\'unsafe-inline\''],
          scriptSrc: ['\'self\''],
          imgSrc: ['\'self\'', 'data:', 'https:'],
          connectSrc: ['\'self\''],
          fontSrc: ['\'self\''],
          objectSrc: ['\'none\''],
          mediaSrc: ['\'self\''],
          frameSrc: ['\'none\'']
        }
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json',
    transports: {
      console: {
        level: process.env.LOG_LEVEL || 'info',
        format: require('winston').format.combine(
          require('winston').format.timestamp(),
          require('winston').format.errors({ stack: true }),
          require('winston').format.json()
        )
      },
      file: {
        level: 'error',
        filename: 'logs/error.log',
        format: require('winston').format.combine(
          require('winston').format.timestamp(),
          require('winston').format.errors({ stack: true }),
          require('winston').format.json()
        )
      }
    }
  },

  // Monitoring Configuration
  monitoring: {
    metrics: {
      enabled: true,
      interval: 60000, // 1 minute
      endpoints: {
        '/metrics': true,
        '/health': true,
        '/ready': true
      }
    },
    apm: {
      enabled: process.env.APM_ENABLED === 'true',
      serviceName: 'immunicare-vaccination-management',
      serverUrl: process.env.APM_SERVER_URL
    }
  },

  // Error Handling Configuration
  errorHandling: {
    logErrors: true,
    returnErrors: process.env.NODE_ENV !== 'production',
    errorResponse: {
      message: 'Something went wrong. Please try again later.',
      success: false
    }
  }
};

// Performance middleware functions
const performanceMiddleware = {
  // Request timing middleware
  requestTimer: (req, res, next) => {
    const startTime = process.hrtime.bigint();

    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const responseTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds

      // Log slow requests
      if (responseTime > 1000) {
        console.warn(
          `Slow request: ${req.method} ${req.url} - ${responseTime.toFixed(
            2
          )}ms`
        );
      }
    });

    next();
  },

  // Memory usage monitoring
  memoryMonitor: (req, res, next) => {
    const memUsage = process.memoryUsage();

    // Log high memory usage
    if (memUsage.heapUsed > 500 * 1024 * 1024) {
      // 500MB
      console.warn(
        `High memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`
      );
    }

    next();
  },

  // Database query optimization
  queryOptimizer: {
    slowQueryThreshold: 1000, // 1 second
    logSlowQueries: true,

    optimizeQuery: (query) => {
      // Add query optimization logic here
      return query;
    }
  },

  // Connection pooling optimization
  connectionPool: {
    acquire: 30000,
    idle: 10000,
    evict: 1000,
    max: 100,
    min: 0
  }
};

// Database optimization queries
const databaseOptimizations = {
  // Index creation queries for performance
  indexes: [
    'CREATE INDEX IF NOT EXISTS idx_patients_health_center ON patients(health_center_id);',
    'CREATE INDEX IF NOT EXISTS idx_patients_date_of_birth ON patients(date_of_birth);',
    'CREATE INDEX IF NOT EXISTS idx_vaccinations_patient_status ON vaccinations(patient_id, status);',
    'CREATE INDEX IF NOT EXISTS idx_vaccinations_date_given ON vaccinations(date_given);',
    'CREATE INDEX IF NOT EXISTS idx_inventory_expiry_date ON inventory(expiry_date);',
    'CREATE INDEX IF NOT EXISTS idx_inventory_quantity ON inventory(quantity);',
    'CREATE INDEX IF NOT EXISTS idx_appointments_patient_status ON appointments(patient_id, status);',
    'CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);',
    'CREATE INDEX IF NOT EXISTS idx_certificates_patient_id ON certificates(patient_id);',
    'CREATE INDEX IF NOT EXISTS idx_stock_transactions_inventory_id ON stock_transactions(inventory_id);'
  ],

  // Query optimization views
  views: [
    `CREATE OR REPLACE VIEW patient_vaccination_summary AS
     SELECT 
       p.id as patient_id,
       p.name as patient_name,
       p.date_of_birth,
       p.sex,
       p.contact_number,
       COUNT(v.id) as total_vaccinations_scheduled,
       COUNT(CASE WHEN v.status = 'completed' THEN 1 END) as completed_vaccinations,
       COUNT(CASE WHEN v.status = 'overdue' THEN 1 END) as overdue_vaccinations,
       ROUND(
         (COUNT(CASE WHEN v.status = 'completed' THEN 1 END) * 100.0 / NULLIF(COUNT(v.id), 0)), 2
       ) as vaccination_coverage_rate,
       MAX(v.date_given) as last_vaccination_date,
       p.health_center_id
     FROM patients p
     LEFT JOIN vaccinations v ON p.id = v.patient_id
     GROUP BY p.id, p.name, p.date_of_birth, p.sex, p.contact_number, p.health_center_id;`
  ]
};

// Cache configuration for different data types
const cacheConfig = {
  patients: {
    ttl: 300, // 5 minutes
    keyPrefix: 'patient:',
    serialize: (data) => JSON.stringify(data),
    deserialize: (data) => JSON.parse(data)
  },

  vaccinations: {
    ttl: 600, // 10 minutes
    keyPrefix: 'vaccination:',
    serialize: (data) => JSON.stringify(data),
    deserialize: (data) => JSON.parse(data)
  },

  inventory: {
    ttl: 180, // 3 minutes
    keyPrefix: 'inventory:',
    serialize: (data) => JSON.stringify(data),
    deserialize: (data) => JSON.parse(data)
  },

  dashboard: {
    ttl: 120, // 2 minutes
    keyPrefix: 'dashboard:',
    serialize: (data) => JSON.stringify(data),
    deserialize: (data) => JSON.parse(data)
  }
};

// Export configuration
module.exports = {
  performanceConfig,
  performanceMiddleware,
  databaseOptimizations,
  cacheConfig
};
