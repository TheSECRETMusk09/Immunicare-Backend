/**
 * Load Testing Configuration for Immunicare System
 *
 * Target: 100,000 users and 10,000,000 transactions
 *
 * This configuration file defines all load testing scenarios
 * and parameters for stress testing the Immunicare backend.
 */

module.exports = {
  // Base URL for the API
  baseUrl: process.env.LOAD_TEST_URL || 'http://localhost:5000',

  // Test Results Directory
  resultsDir: './load-test-results',

  // ============================================================================
  // LOAD TEST CONFIGURATION - Normal operating conditions
  // Simulates expected daily peak traffic
  // ============================================================================
  loadTest: {
    name: 'Load Test - Normal Peak',
    description: 'Simulates normal peak load with 10,000 concurrent users',
    duration: 300, // 5 minutes
    concurrency: 10000,
    requestsPerSecond: 5000,
    totalRequests: 1500000, // 1.5M requests over 5 minutes

    // Request distribution by endpoint
    endpoints: [
      { path: '/api/health', weight: 20, method: 'GET' },
      { path: '/api/auth/login', weight: 15, method: 'POST' },
      { path: '/api/dashboard/stats', weight: 15, method: 'GET' },
      { path: '/api/infants', weight: 10, method: 'GET' },
      { path: '/api/vaccinations', weight: 10, method: 'GET' },
      { path: '/api/inventory', weight: 8, method: 'GET' },
      { path: '/api/appointments', weight: 7, method: 'GET' },
      { path: '/api/announcements', weight: 5, method: 'GET' },
      { path: '/api/notifications', weight: 5, method: 'GET' },
      { path: '/api/analytics/dashboard', weight: 5, method: 'GET' }
    ],

    // Success criteria
    thresholds: {
      maxResponseTime: 2000, // 2 seconds
      maxErrorRate: 1, // 1%
      minRequestsPerSecond: 4000
    }
  },

  // ============================================================================
  // STRESS TEST CONFIGURATION - Beyond normal capacity
  // Pushes system to breaking point to find limits
  // ============================================================================
  stressTest: {
    name: 'Stress Test - Breaking Point',
    description: 'Gradually increases load to find system breaking point',
    initialUsers: 10000,
    maxUsers: 100000,
    rampUpTime: 600, // 10 minutes gradual increase
    sustainTime: 1800, // 30 minutes at peak
    stepSize: 10000, // Increase by 10k users every minute

    // For 10M transactions: at 10k RPS = 1000 seconds = ~17 minutes
    targetTransactions: 10000000,
    estimatedRPS: 10000,

    endpoints: [
      { path: '/api/health', weight: 15, method: 'GET' },
      { path: '/api/auth/login', weight: 10, method: 'POST' },
      { path: '/api/auth/verify', weight: 10, method: 'GET' },
      { path: '/api/dashboard/stats', weight: 12, method: 'GET' },
      { path: '/api/dashboard/recent-activities', weight: 8, method: 'GET' },
      { path: '/api/infants', weight: 10, method: 'GET' },
      { path: '/api/infants/:id', weight: 5, method: 'GET' },
      { path: '/api/vaccinations', weight: 8, method: 'GET' },
      { path: '/api/vaccinations/schedule', weight: 5, method: 'GET' },
      { path: '/api/inventory', weight: 5, method: 'GET' },
      { path: '/api/appointments', weight: 5, method: 'GET' },
      { path: '/api/announcements', weight: 3, method: 'GET' },
      { path: '/api/notifications', weight: 2, method: 'GET' },
      { path: '/api/analytics/dashboard', weight: 2, method: 'GET' }
    ],

    thresholds: {
      maxResponseTime: 5000, // 5 seconds
      maxErrorRate: 5, // 5%
      minThroughput: 8000
    }
  },

  // ============================================================================
  // SPIKE TEST CONFIGURATION - Sudden traffic increases
  // Tests system response to sudden spikes in traffic
  // ============================================================================
  spikeTest: {
    name: 'Spike Test - Sudden Traffic',
    description: 'Tests system response to sudden traffic spikes',
    baselineUsers: 5000,
    spikeUsers: 50000,
    spikeDuration: 60, // 1 minute of high traffic
    recoveryTime: 300, // 5 minutes to recover
    spikes: 3, // Number of spike cycles

    endpoints: [
      { path: '/api/health', weight: 25, method: 'GET' },
      { path: '/api/auth/login', weight: 20, method: 'POST' },
      { path: '/api/dashboard/stats', weight: 20, method: 'GET' },
      { path: '/api/infants', weight: 15, method: 'GET' },
      { path: '/api/vaccinations', weight: 10, method: 'GET' },
      { path: '/api/inventory', weight: 5, method: 'GET' },
      { path: '/api/appointments', weight: 5, method: 'GET' }
    ],

    thresholds: {
      maxResponseTime: 3000,
      maxErrorRate: 3,
      recoveryTime: 120 // Should recover within 2 minutes
    }
  },

  // ============================================================================
  // ENDURANCE TEST CONFIGURATION - Long duration stress
  // Tests system stability over extended periods
  // ============================================================================
  enduranceTest: {
    name: 'Endurance Test - Extended Load',
    description: 'Tests system stability under sustained load over extended period',
    duration: 86400, // 24 hours
    concurrentUsers: 25000,
    requestsPerSecond: 12000,

    endpoints: [
      { path: '/api/health', weight: 30, method: 'GET' },
      { path: '/api/auth/verify', weight: 15, method: 'GET' },
      { path: '/api/dashboard/stats', weight: 15, method: 'GET' },
      { path: '/api/infants', weight: 10, method: 'GET' },
      { path: '/api/vaccinations', weight: 10, method: 'GET' },
      { path: '/api/inventory', weight: 5, method: 'GET' },
      { path: '/api/notifications', weight: 5, method: 'GET' },
      { path: '/api/appointments', weight: 5, method: 'GET' },
      { path: '/api/announcements', weight: 5, method: 'GET' }
    ],

    // Memory leak detection
    memoryThreshold: 1024, // MB - alert if memory exceeds this

    thresholds: {
      maxResponseTime: 2000,
      maxErrorRate: 0.5, // Very strict for endurance
      minRequestsPerSecond: 10000
    }
  },

  // ============================================================================
  // SCALABILITY TEST - 100K Users Target
  // Tests horizontal and vertical scalability
  // ============================================================================
  scalabilityTest: {
    name: 'Scalability Test - 100K Users',
    description: 'Tests system ability to handle 100,000 concurrent users',
    phases: [
      { users: 10000, duration: 300, name: 'Phase 1: 10K Users' },
      { users: 25000, duration: 300, name: 'Phase 2: 25K Users' },
      { users: 50000, duration: 300, name: 'Phase 3: 50K Users' },
      { users: 75000, duration: 300, name: 'Phase 4: 75K Users' },
      { users: 100000, duration: 600, name: 'Phase 5: 100K Users' }
    ],

    endpoints: [
      { path: '/api/health', weight: 20, method: 'GET' },
      { path: '/api/auth/verify', weight: 15, method: 'GET' },
      { path: '/api/dashboard/stats', weight: 15, method: 'GET' },
      { path: '/api/infants', weight: 12, method: 'GET' },
      { path: '/api/vaccinations', weight: 12, method: 'GET' },
      { path: '/api/inventory', weight: 8, method: 'GET' },
      { path: '/api/appointments', weight: 6, method: 'GET' },
      { path: '/api/notifications', weight: 6, method: 'GET' },
      { path: '/api/announcements', weight: 3, method: 'GET' },
      { path: '/api/analytics/dashboard', weight: 3, method: 'GET' }
    ],

    thresholds: {
      maxResponseTime: 3000,
      maxErrorRate: 2,
      minThroughputPerUser: 100 // requests per second per user
    }
  },

  // ============================================================================
  // TRANSACTION VOLUME TEST - 10M Transactions
  // Tests system ability to handle high transaction volume
  // ============================================================================
  volumeTest: {
    name: 'Volume Test - 10M Transactions',
    description: 'Tests system ability to handle 10 million transactions',
    targetTransactions: 10000000,
    estimatedDuration: 1000, // seconds (~17 minutes at 10k RPS)
    concurrentWriters: 500, // Simulate multiple write operations

    // Transaction types distribution
    transactions: [
      { type: 'login', weight: 20 },
      { type: 'read_infant', weight: 15 },
      { type: 'read_vaccination', weight: 15 },
      { type: 'create_appointment', weight: 10 },
      { type: 'update_inventory', weight: 10 },
      { type: 'record_vaccination', weight: 10 },
      { type: 'send_notification', weight: 10 },
      { type: 'update_dashboard', weight: 10 }
    ],

    thresholds: {
      maxResponseTime: 2000,
      maxErrorRate: 1,
      minTransactionRate: 8000 // transactions per second
    }
  },

  // ============================================================================
  // DATABASE STRESS TEST
  // Specific tests for database performance under load
  // ============================================================================
  databaseTest: {
    name: 'Database Stress Test',
    description: 'Tests database performance under concurrent load',

    // Connection pool settings to test
    poolSizes: [10, 25, 50, 100, 200],

    // Query types to test
    queries: [
      { name: 'simple_select', weight: 30 },
      { name: 'join_query', weight: 25 },
      { name: 'aggregation', weight: 20 },
      { name: 'insert', weight: 15 },
      { name: 'update', weight: 10 }
    ],

    thresholds: {
      maxQueryTime: 500, // ms
      maxConnectionErrors: 10,
      minThroughput: 5000 // queries per second
    }
  },

  // ============================================================================
  // TEST USERS - Simulated user credentials
  // ============================================================================
  testUsers: {
    // Number of unique test users to generate
    count: 100000,

    // User types distribution
    types: {
      admin: 100,
      healthWorker: 500,
      guardian: 99400 // 99.4% guardians
    },

    // Sample credentials for testing
    sample: {
      admin: { username: 'admin', password: 'admin123' },
      healthWorker: { username: 'healthworker1', password: 'hw123456' },
      guardian: { username: 'guardian_test', password: 'guardian123' }
    }
  },

  // ============================================================================
  // REPORTING SETTINGS
  // ============================================================================
  reporting: {
    // Generate detailed JSON report
    jsonReport: true,

    // Generate HTML report
    htmlReport: true,

    // Generate CSV for analysis
    csvReport: true,

    // Real-time dashboard update interval (ms)
    dashboardInterval: 5000,

    // Metrics to collect
    metrics: [
      'responseTime',
      'requestsPerSecond',
      'errorRate',
      'throughput',
      'cpuUsage',
      'memoryUsage',
      'databaseConnections',
      'activeUsers'
    ]
  },

  // ============================================================================
  // SERVER MONITORING
  // ============================================================================
  monitoring: {
    // Enable server-side metrics collection
    enableServerMetrics: true,

    // Prometheus metrics endpoint
    prometheusEndpoint: '/metrics',

    // Custom metrics to track
    customMetrics: [
      'http_requests_total',
      'http_request_duration_seconds',
      'database_query_duration_seconds',
      'active_connections',
      'queue_depth'
    ]
  }
};
