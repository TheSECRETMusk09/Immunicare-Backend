#!/usr/bin/env node

/**
 * Immunicare WebSocket/SocketContext Integration Tests
 * Tests real-time synchronization between Admin and Guardian Dashboards
 */

const http = require('http');
const io = require('socket.io-client');
const axios = require('axios').default;

const BASE_URL = 'http://localhost:5000';
const API_BASE = `${BASE_URL}/api`;

// Test configuration
const TEST_CONFIG = {
  adminCredentials: {
    username: 'admin',
    password: 'Immunicare2026!'
  },
  guardianCredentials: {
    email: 'maria.santos@email.com',
    password: 'guardian123'
  }
};

// Test results storage
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name, passed, details = '') {
  const status = passed ? '✓ PASS' : '✗ FAIL';
  const color = passed ? 'green' : 'red';
  log(`${status}: ${name}${details ? ` - ${details}` : ''}`, color);

  if (passed) {
    testResults.passed.push(name);
  } else {
    testResults.failed.push({ name, details });
  }
}

// HTTP request helper
async function makeRequest(method, path, data = null, headers = {}) {
  try {
    const response = await axios({
      method,
      url: `${API_BASE}${path}`,
      data,
      headers,
      timeout: 10000
    });
    return {
      status: response.status,
      data: response.data,
      headers: response.headers
    };
  } catch (error) {
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { error: error.message },
      headers: error.response?.headers || {}
    };
  }
}

// Authentication helper to get JWT tokens
async function getAuthTokens() {
  log('\n--- GETTING AUTHENTICATION TOKENS ---', 'cyan');

  // Get admin token
  const adminLogin = await makeRequest('POST', '/auth/login', TEST_CONFIG.adminCredentials);
  if (adminLogin.status !== 200) {
    logTest('Admin Authentication', false, `Status: ${adminLogin.status}`);
    return null;
  }
  const adminToken = adminLogin.data.token || adminLogin.data.accessToken;
  logTest('Admin Authentication', true, 'Token obtained');

  // Get guardian token
  const guardianLogin = await makeRequest('POST', '/auth/login', TEST_CONFIG.guardianCredentials);
  if (guardianLogin.status !== 200) {
    logTest('Guardian Authentication', false, `Status: ${guardianLogin.status}`);
    return null;
  }
  const guardianToken = guardianLogin.data.token || guardianLogin.data.accessToken;
  logTest('Guardian Authentication', true, 'Token obtained');

  return {
    adminToken,
    guardianToken
  };
}

// WebSocket connection test
async function testWebSocketConnection(token, role, expectedUserId) {
  return new Promise((resolve, reject) => {
    log(`\n--- TESTING WEBSOCKET CONNECTION (${role}) ---`, 'cyan');

    const socket = io(BASE_URL, {
      auth: {
        token: token
      },
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 5000
    });

    let connectionTimer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Connection timeout'));
    }, 5000);

    socket.on('connect', () => {
      clearTimeout(connectionTimer);
      logTest(`${role} WebSocket Connection`, true, `Socket ID: ${socket.id}`);
    });

    socket.on('connected', (data) => {
      log(`  Connection acknowledged: ${data.message}`, 'cyan');
      if (data.userId === expectedUserId) {
        logTest(`${role} Connection User ID Match`, true, `User ID: ${data.userId}`);
      } else {
        logTest(`${role} Connection User ID Match`, false, `Expected: ${expectedUserId}, Got: ${data.userId}`);
      }
    });

    socket.on('connect_error', (error) => {
      clearTimeout(connectionTimer);
      logTest(`${role} WebSocket Connection`, false, error.message);
      socket.disconnect();
      reject(error);
    });

    socket.on('disconnect', (reason) => {
      clearTimeout(connectionTimer);
      if (reason !== 'io client disconnect') {
        logTest(`${role} WebSocket Unexpected Disconnect`, false, reason);
        reject(new Error(reason));
      }
    });

    // Wait for connection to be fully established
    setTimeout(() => {
      resolve(socket);
    }, 2000);
  });
}

// Test real-time appointment synchronization
async function testAppointmentSync(adminToken, guardianToken) {
  log('\n--- TESTING APPOINTMENT SYNCHRONIZATION ---', 'cyan');

  // Create test appointment first
  const appointmentData = {
    infant_id: 1,
    vaccine_id: 1,
    scheduled_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    scheduled_time: '10:00',
    type: 'Vaccination',
    notes: 'Test appointment for synchronization'
  };

  const createResponse = await makeRequest('POST', '/appointments', appointmentData, {
    Authorization: `Bearer ${adminToken}`
  });

  if (createResponse.status !== 200 && createResponse.status !== 201) {
    logTest('Create Test Appointment', false, `Status: ${createResponse.status}`);
    return;
  }

  const appointmentId = createResponse.data.id;
  logTest('Create Test Appointment', true, `Appointment ID: ${appointmentId}`);

  // Test real-time synchronization
  return new Promise((resolve, reject) => {
    const adminSocket = io(BASE_URL, {
      auth: { token: adminToken }
    });

    const guardianSocket = io(BASE_URL, {
      auth: { token: guardianToken }
    });

    let adminReceived = false;
    let guardianReceived = false;
    let timeout = setTimeout(() => {
      adminSocket.disconnect();
      guardianSocket.disconnect();
      reject(new Error('Synchronization timeout'));
    }, 10000);

    // Listen for appointment events
    adminSocket.on('appointment-created', (data) => {
      if (data.appointment?.id === appointmentId) {
        adminReceived = true;
        logTest('Admin Dashboard Appointment Sync', true, 'Received appointment-created event');
        checkCompletion();
      }
    });

    guardianSocket.on('appointment-created', (data) => {
      if (data.appointment?.id === appointmentId) {
        guardianReceived = true;
        logTest('Guardian Dashboard Appointment Sync', true, 'Received appointment-created event');
        checkCompletion();
      }
    });

    function checkCompletion() {
      if (adminReceived && guardianReceived) {
        clearTimeout(timeout);
        adminSocket.disconnect();
        guardianSocket.disconnect();
        resolve();
      }
    }

    // Cleanup: Delete test appointment
    setTimeout(async () => {
      await makeRequest('DELETE', `/appointments/${appointmentId}`, null, {
        Authorization: `Bearer ${adminToken}`
      });
      logTest('Cleanup Test Appointment', true, 'Appointment deleted');
    }, 5000);
  });
}

// Test real-time vaccination record synchronization
async function testVaccinationSync(adminToken, guardianToken) {
  log('\n--- TESTING VACCINATION SYNCHRONIZATION ---', 'cyan');

  // Create test vaccination record
  const vaccinationData = {
    infant_id: 1,
    vaccine_id: 1,
    date_administered: new Date().toISOString().split('T')[0],
    dose: 1,
    batch_number: 'TEST123',
    administered_by: 'Dr. Test'
  };

  const createResponse = await makeRequest('POST', '/vaccinations', vaccinationData, {
    Authorization: `Bearer ${adminToken}`
  });

  if (createResponse.status !== 200 && createResponse.status !== 201) {
    logTest('Create Test Vaccination', false, `Status: ${createResponse.status}`);
    return;
  }

  const vaccinationId = createResponse.data.id;
  logTest('Create Test Vaccination', true, `Vaccination ID: ${vaccinationId}`);

  // Test real-time synchronization
  return new Promise((resolve, reject) => {
    const adminSocket = io(BASE_URL, {
      auth: { token: adminToken }
    });

    const guardianSocket = io(BASE_URL, {
      auth: { token: guardianToken }
    });

    let adminReceived = false;
    let guardianReceived = false;
    let timeout = setTimeout(() => {
      adminSocket.disconnect();
      guardianSocket.disconnect();
      reject(new Error('Synchronization timeout'));
    }, 10000);

    // Listen for vaccination events
    adminSocket.on('vaccination-recorded', (data) => {
      if (data.vaccination?.id === vaccinationId) {
        adminReceived = true;
        logTest('Admin Dashboard Vaccination Sync', true, 'Received vaccination-recorded event');
        checkCompletion();
      }
    });

    guardianSocket.on('vaccination-recorded', (data) => {
      if (data.vaccination?.id === vaccinationId) {
        guardianReceived = true;
        logTest('Guardian Dashboard Vaccination Sync', true, 'Received vaccination-recorded event');
        checkCompletion();
      }
    });

    function checkCompletion() {
      if (adminReceived && guardianReceived) {
        clearTimeout(timeout);
        adminSocket.disconnect();
        guardianSocket.disconnect();
        resolve();
      }
    }

    // Cleanup: Delete test vaccination
    setTimeout(async () => {
      await makeRequest('DELETE', `/vaccinations/${vaccinationId}`, null, {
        Authorization: `Bearer ${adminToken}`
      });
      logTest('Cleanup Test Vaccination', true, 'Vaccination deleted');
    }, 5000);
  });
}

// Test connection resilience and reconnection
async function testSocketResilience(token, role) {
  log(`\n--- TESTING SOCKET RESILIENCE (${role}) ---`, 'cyan');

  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000
    });

    let connectionCount = 0;
    let reconnectionTimer;

    socket.on('connect', () => {
      connectionCount++;
      log(`  Socket connected (${connectionCount})`, 'cyan');

      if (connectionCount === 1) {
        logTest(`${role} Initial Connection`, true, `Socket ID: ${socket.id}`);
        // Simulate disconnection
        reconnectionTimer = setTimeout(() => {
          socket.disconnect();
        }, 2000);
      } else {
        logTest(`${role} Reconnection`, true, `Socket ID: ${socket.id}`);
        clearTimeout(reconnectionTimer);
        socket.disconnect();
        resolve();
      }
    });

    socket.on('connect_error', (error) => {
      logTest(`${role} Connection Error`, false, error.message);
    });

    socket.on('disconnect', (reason) => {
      log(`  Socket disconnected: ${reason}`, 'yellow');
    });

    // Timeout for reconnection
    setTimeout(() => {
      socket.disconnect();
      reject(new Error('Reconnection timeout'));
    }, 10000);
  });
}

// Print test summary
function printSummary() {
  log('\n========================================', 'cyan');
  log('          SOCKET INTEGRATION TEST SUMMARY', 'cyan');
  log('========================================', 'cyan');

  log(`\n${colors.green}Passed: ${testResults.passed.length}${colors.reset}`);
  log(`${colors.red}Failed: ${testResults.failed.length}${colors.reset}`);
  log(`${colors.yellow}Warnings: ${testResults.warnings.length}${colors.reset}`);

  if (testResults.failed.length > 0) {
    log('\n--- FAILED TESTS ---', 'red');
    testResults.failed.forEach((test, index) => {
      log(`${index + 1}. ${test.name}: ${test.details}`, 'red');
    });
  }

  const passRate = (
    (testResults.passed.length / (testResults.passed.length + testResults.failed.length)) *
    100
  ).toFixed(2);
  log(`\nPass Rate: ${passRate}%`, passRate > 80 ? 'green' : 'red');
}

// Main test execution
async function runTests() {
  log('========================================', 'cyan');
  log('IMMUNICARE WEBSOCKET INTEGRATION TESTS', 'cyan');
  log('========================================', 'cyan');
  log(`API Base URL: ${API_BASE}`, 'blue');
  log(`Time: ${new Date().toISOString()}`, 'blue');

  try {
    // Check if server is running
    const healthCheck = await makeRequest('GET', '/health');
    if (healthCheck.status !== 200) {
      log('✗ Server health check failed', 'red');
      log(`  Status: ${healthCheck.status}`, 'yellow');
      log('  Make sure the server is running on http://localhost:5000', 'yellow');
      return;
    }
    log('✓ Server health check passed', 'green');

    // Get authentication tokens
    const tokens = await getAuthTokens();
    if (!tokens) {
      log('✗ Authentication failed. Cannot proceed with socket tests.', 'red');
      return;
    }

    // Test WebSocket connections
    const adminSocket = await testWebSocketConnection(tokens.adminToken, 'Admin', 'admin');
    const guardianSocket = await testWebSocketConnection(tokens.guardianToken, 'Guardian', '1');

    // Test connection resilience
    await testSocketResilience(tokens.adminToken, 'Admin');
    await testSocketResilience(tokens.guardianToken, 'Guardian');

    // Test real-time synchronization
    await testAppointmentSync(tokens.adminToken, tokens.guardianToken);
    await testVaccinationSync(tokens.adminToken, tokens.guardianToken);

    // Close sockets
    adminSocket.disconnect();
    guardianSocket.disconnect();

    // Print summary
    printSummary();

  } catch (error) {
    log(`\nFATAL ERROR: ${error.message}`, 'red');
    console.error(error);
  }
}

// Run tests
runTests().then(() => {
  process.exit(testResults.failed.length > 0 ? 1 : 0);
