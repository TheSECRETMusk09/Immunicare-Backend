/**
 * k6 Load Test Script for Immunicare System
 *
 * Target: 100,000 users and 10,000,000 transactions
 *
 * This is an alternative to the built-in loadtest package.
 * Requires k6 to be installed: https://k6.io/docs/getting-started/installation/
 *
 * Installation:
 * - Windows: choco install k6
 * - macOS: brew install k6
 * - Linux: sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
 *         echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
 *         sudo apt-get update && sudo apt-get install k6
 *
 * Usage:
 *   k6 run k6-load-test.js                    # Run all scenarios
 *   k6 run k6-load-test.js --vus 1000        # Run with 1000 VUs
 *   k6 run k6-load-test.js -e SCENARIO=load # Run specific scenario
 *   k6 run k6-load-test.js --out json=results.json  # Save results to JSON
 *   k6 run k6-load-test.js --out influxdb=http://localhost:8086/k6  # Send to InfluxDB
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Environment variables with defaults
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const SCENARIO = __ENV.SCENARIO || 'all'; // load, stress, spike, scalability, volume
const DURATION = __ENV.DURATION || '5m';
const VUS = parseInt(__ENV.VUS || '100');

// Custom metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');
const requestsCounter = new Counter('requests_total');
const transactionsCounter = new Counter('transactions_total');

// ============================================================================
// TEST SCENARIOS
// ============================================================================

// Load Test - Normal Peak (10K users)
export const loadOptions = {
  vus: 10000,
  duration: '30m',
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests should be under 2s
    http_req_failed: ['rate<0.01'], // Error rate should be less than 1%
    requests_total: ['count>100000'], // At least 100K requests
  },
};

// Stress Test - Breaking Point (up to 100K users)
export const stressOptions = {
  vus: 100000,
  duration: '1h',
  stages: [
    { duration: '10m', target: 10000 }, // Ramp up to 10K
    { duration: '10m', target: 25000 }, // Ramp up to 25K
    { duration: '10m', target: 50000 }, // Ramp up to 50K
    { duration: '10m', target: 75000 }, // Ramp up to 75K
    { duration: '10m', target: 100000 }, // Ramp up to 100K
    { duration: '30m', target: 100000 }, // Sustain at 100K
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'], // 95% under 5s
    http_req_failed: ['rate<0.05'], // Error rate < 5%
  },
};

// Spike Test - Sudden traffic increases
export const spikeOptions = {
  vus: 50000,
  duration: '15m',
  stages: [
    { duration: '2m', target: 5000 }, // Baseline
    { duration: '1m', target: 50000 }, // Spike to 50K
    { duration: '5m', target: 5000 }, // Recovery
    { duration: '1m', target: 50000 }, // Spike again
    { duration: '5m', target: 5000 }, // Recovery
    { duration: '1m', target: 50000 }, // Final spike
    { duration: '5m', target: 5000 }, // Final recovery
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.03'],
  },
};

// Scalability Test - 100K Users Target
export const scalabilityOptions = {
  vus: 100000,
  duration: '2h',
  stages: [
    { duration: '5m', target: 10000 }, // Phase 1: 10K
    { duration: '5m', target: 25000 }, // Phase 2: 25K
    { duration: '5m', target: 50000 }, // Phase 3: 50K
    { duration: '5m', target: 75000 }, // Phase 4: 75K
    { duration: '10m', target: 100000 }, // Phase 5: 100K
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.02'],
  },
};

// Volume Test - 10M Transactions
export const volumeOptions = {
  vus: 50000,
  duration: '30m',
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    requests_total: ['count>10000000'], // 10M requests
  },
};

// Endurance Test - 24 hours
export const enduranceOptions = {
  vus: 25000,
  duration: '24h',
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.005'], // Very strict - 0.5% max
  },
};

// ============================================================================
// OPTIONS - Select scenario based on environment
// ============================================================================

export const options = {
  scenarios: {},
};

// Select the appropriate scenario based on SCENARIO env var
switch (SCENARIO.toLowerCase()) {
  case 'load':
    Object.assign(options, loadOptions);
    break;
  case 'stress':
    Object.assign(options, stressOptions);
    break;
  case 'spike':
    Object.assign(options, spikeOptions);
    break;
  case 'scalability':
    Object.assign(options, scalabilityOptions);
    break;
  case 'volume':
    Object.assign(options, volumeOptions);
    break;
  case 'endurance':
    Object.assign(options, enduranceOptions);
    break;
  default:
    // Run all scenarios sequentially
    options.scenarios = {
      load_test: {
        executor: 'constant-vus',
        vus: 10000,
        duration: '5m',
        startTime: '0s',
      },
      scalability_test: {
        executor: 'ramping-vus',
        startTime: '5m',
        stages: [
          { duration: '5m', target: 25000 },
          { duration: '5m', target: 50000 },
          { duration: '5m', target: 75000 },
          { duration: '10m', target: 100000 },
        ],
      },
      volume_test: {
        executor: 'constant-vus',
        vus: 50000,
        duration: '30m',
        startTime: '30m',
      },
    };
    options.thresholds = {
      http_req_duration: ['p(95)<3000'],
      http_req_failed: ['rate<0.02'],
    };
}

// ============================================================================
// TEST DATA
// ============================================================================

// Generate test users ( guardians)
const testUsers = [];
for (let i = 0; i < 1000; i++) {
  testUsers.push({
    username: `guardian_${i}@test.com`,
    password: 'test123456',
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Make authenticated request
 */
function authenticatedRequest(method, url, body = null, token = null) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const params = { headers };

  let response;
  switch (method.toUpperCase()) {
    case 'GET':
      response = http.get(url, params);
      break;
    case 'POST':
      response = http.post(url, body ? JSON.stringify(body) : null, params);
      break;
    case 'PUT':
      response = http.put(url, body ? JSON.stringify(body) : null, params);
      break;
    case 'DELETE':
      response = http.del(url, null, params);
      break;
    default:
      throw new Error(`Unsupported method: ${method}`);
  }

  // Track metrics
  responseTime.add(response.timings.duration);
  requestsCounter.add(1);

  if (response.status >= 400) {
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }

  return response;
}

/**
 * Login and get token
 */
function login(username, password) {
  const url = `${BASE_URL}/api/auth/login`;
  const body = { username, password };

  const response = authenticatedRequest('POST', url, body);

  if (response.status === 200) {
    try {
      const data = JSON.parse(response.body);
      return data.token || data.accessToken;
    } catch (e) {
      return null;
    }
  }

  return null;
}

// ============================================================================
// TEST SCENARIOS
// ============================================================================

// Test 1: Health Check
export function testHealthCheck() {
  group('Health Check', () => {
    const response = authenticatedRequest('GET', `${BASE_URL}/api/health`);

    check(response, {
      'health check returns 200': (r) => r.status === 200,
      'health check has status': (r) => r.json('status') !== undefined,
    });
  });
}

// Test 2: User Login
export function testLogin() {
  group('Authentication', () => {
    // Random test user
    const user = testUsers[Math.floor(Math.random() * testUsers.length)];

    const response = authenticatedRequest('POST', `${BASE_URL}/api/auth/login`, {
      username: user.username,
      password: user.password,
    });

    check(response, {
      'login returns 200 or 401': (r) => r.status === 200 || r.status === 401,
    });

    if (response.status === 200) {
      transactionsCounter.add(1);
    }
  });
}

// Test 3: Dashboard
export function testDashboard(token) {
  group('Dashboard', () => {
    const response = authenticatedRequest('GET', `${BASE_URL}/api/dashboard/stats`, null, token);

    check(response, {
      'dashboard returns 200': (r) => r.status === 200,
    });
  });
}

// Test 4: Infants Management
export function testInfants(token) {
  group('Infants', () => {
    // List infants
    const listResponse = authenticatedRequest('GET', `${BASE_URL}/api/infants`, null, token);

    check(listResponse, {
      'infants list returns 200': (r) => r.status === 200,
    });
  });
}

// Test 5: Vaccinations
export function testVaccinations(token) {
  group('Vaccinations', () => {
    const response = authenticatedRequest('GET', `${BASE_URL}/api/vaccinations`, null, token);

    check(response, {
      'vaccinations returns 200': (r) => r.status === 200,
    });
  });
}

// Test 6: Inventory
export function testInventory(token) {
  group('Inventory', () => {
    const response = authenticatedRequest('GET', `${BASE_URL}/api/inventory`, null, token);

    check(response, {
      'inventory returns 200': (r) => r.status === 200,
    });
  });
}

// Test 7: Appointments
export function testAppointments(token) {
  group('Appointments', () => {
    const response = authenticatedRequest('GET', `${BASE_URL}/api/appointments`, null, token);

    check(response, {
      'appointments returns 200': (r) => r.status === 200,
    });
  });
}

// Test 8: Announcements
export function testAnnouncements(token) {
  group('Announcements', () => {
    const response = authenticatedRequest('GET', `${BASE_URL}/api/announcements`, null, token);

    check(response, {
      'announcements returns 200': (r) => r.status === 200,
    });
  });
}

// Test 9: Notifications
export function testNotifications(token) {
  group('Notifications', () => {
    const response = authenticatedRequest('GET', `${BASE_URL}/api/notifications`, null, token);

    check(response, {
      'notifications returns 200': (r) => r.status === 200,
    });
  });
}

// Test 10: Analytics
export function testAnalytics(token) {
  group('Analytics', () => {
    const response = authenticatedRequest(
      'GET',
      `${BASE_URL}/api/analytics/dashboard`,
      null,
      token
    );

    check(response, {
      'analytics returns 200': (r) => r.status === 200,
    });
  });
}

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

export default function () {
  // Test health check (no auth required)
  testHealthCheck();

  // Get a token (try with test user)
  const user = testUsers[Math.floor(Math.random() * testUsers.length)];
  const token = login(user.username, user.password);

  // Test authenticated endpoints
  if (token) {
    // Simulate user session - mix of operations
    const operations = [
      () => testDashboard(token),
      () => testInfants(token),
      () => testVaccinations(token),
      () => testInventory(token),
      () => testAppointments(token),
      () => testAnnouncements(token),
      () => testNotifications(token),
      () => testAnalytics(token),
    ];

    // Randomly select operations to perform
    const numOperations = Math.floor(Math.random() * 4) + 2; // 2-5 operations

    for (let i = 0; i < numOperations; i++) {
      const opIndex = Math.floor(Math.random() * operations.length);
      operations[opIndex]();
    }

    // Track transactions
    transactionsCounter.add(numOperations);
  }

  // Think time between requests
  sleep(Math.random() * 2 + 0.5); // 0.5-2.5 seconds
}

// ============================================================================
// SETUP AND TEARDOWN
// ============================================================================

export function setup() {
  console.log(`Starting k6 load test`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Scenario: ${SCENARIO}`);

  // Pre-warm the server
  console.log('Pre-warming server...');
  authenticatedRequest('GET', `${BASE_URL}/api/health`);

  return { startTime: new Date().toISOString() };
}

export function teardown(data) {
  console.log(`Test completed`);
  console.log(`Start time: ${data.startTime}`);
  console.log(`End time: ${new Date().toISOString()}`);
}
