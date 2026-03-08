/**
 * Comprehensive Functional Testing Script
 * Tests: Login Auth, SMS, Email, Admin/Guardian Dashboards
 */

const axios = require('axios');
const BASE_URL = 'http://localhost:5000';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, type = 'info') {
  const color =
    type === 'pass'
      ? colors.green
      : type === 'fail'
        ? colors.red
        : type === 'warn'
          ? colors.yellow
          : colors.blue;
  console.log(`${color}${message}${colors.reset}`);
}

async function runTests() {
  const testResults = {
    passed: 0,
    failed: 0,
    warnings: [],
    issues: []
  };

  console.log('\n' + '='.repeat(60));
  console.log('IMMUNICARE COMPREHENSIVE FUNCTIONAL TESTING');
  console.log('='.repeat(60) + '\n');

  // ============================================
  // SECTION 1: AUTHENTICATION SYSTEM TESTS
  // ============================================
  log('SECTION 1: AUTHENTICATION SYSTEM TESTS', 'info');
  log('-'.repeat(50));

  // Test 1.1: API Health Check
  log('\n1.1 Testing API Health & Connectivity...', 'info');
  try {
    await axios.get(BASE_URL + '/api/auth/test', { timeout: 5000 });
    log('   ✓ PASS: Auth API is running', 'pass');
    testResults.passed++;
  } catch (e) {
    log('   ✗ FAIL: Auth API not reachable - ' + e.message, 'fail');
    testResults.failed++;
    testResults.issues.push({
      severity: 'critical',
      issue: 'Auth API not reachable',
      location: 'backend/routes/auth.js'
    });
  }

  // Test 1.2: Empty Field Validation
  log('\n1.2 Testing Empty Field Validation...', 'info');
  try {
    await axios.post(BASE_URL + '/api/auth/login', {});
    log('   ✗ FAIL: Empty fields not rejected', 'fail');
    testResults.failed++;
  } catch (e) {
    if (e.response && e.response.status === 400) {
      log('   ✓ PASS: Empty fields properly rejected - ' + e.response.data.error, 'pass');
      testResults.passed++;
    } else {
      log('   ✗ FAIL: Unexpected error - ' + e.message, 'fail');
      testResults.failed++;
    }
  }

  // Test 1.3: Missing Password Validation
  log('\n1.3 Testing Missing Password Validation...', 'info');
  try {
    await axios.post(BASE_URL + '/api/auth/login', { username: 'testuser' });
    log('   ✗ FAIL: Missing password not rejected', 'fail');
    testResults.failed++;
  } catch (e) {
    if (e.response && e.response.status === 400) {
      log('   ✓ PASS: Missing password properly rejected', 'pass');
      testResults.passed++;
    }
  }

  // Test 1.4: Invalid Credentials
  log('\n1.4 Testing Invalid Credentials Rejection...', 'info');
  try {
    await axios.post(BASE_URL + '/api/auth/login', {
      username: 'nonexistent_user_' + Date.now(),
      password: 'wrongpassword123'
    });
    log('   ✗ FAIL: Invalid credentials not rejected', 'fail');
    testResults.failed++;
  } catch (e) {
    if (e.response && e.response.status === 401) {
      log('   ✓ PASS: Invalid credentials properly rejected', 'pass');
      testResults.passed++;
    }
  }

  // Test 1.5: SQL Injection Prevention
  log('\n1.5 Testing SQL Injection Prevention...', 'info');
  const sqlInjectionAttempts = [
    { username: 'admin\' OR \'1\'=\'1', password: '\' OR \'1\'=\'1' },
    { username: 'admin\' UNION SELECT--', password: 'password' },
    { username: '\'; DROP TABLE users;--', password: 'test' }
  ];

  let sqlBlocked = 0;
  for (const attempt of sqlInjectionAttempts) {
    try {
      await axios.post(BASE_URL + '/api/auth/login', attempt);
    } catch (e) {
      if (e.response && e.response.status === 400) {
        sqlBlocked++;
      }
    }
  }

  if (sqlBlocked === sqlInjectionAttempts.length) {
    log('   ✓ PASS: All SQL injection attempts blocked', 'pass');
    testResults.passed++;
  } else {
    log('   ✗ FAIL: Some SQL injection attempts not blocked', 'fail');
    testResults.failed++;
    testResults.issues.push({
      severity: 'critical',
      issue: 'SQL Injection vulnerability in login',
      location: 'backend/routes/auth.js'
    });
  }

  // Test 1.6: Input Sanitization
  log('\n1.6 Testing Input Sanitization...', 'info');
  try {
    await axios.post(BASE_URL + '/api/auth/login', {
      username: '<script>alert("xss")</script>',
      password: 'test'
    });
    log('   ✗ FAIL: XSS input not sanitized', 'fail');
    testResults.failed++;
    testResults.issues.push({
      severity: 'high',
      issue: 'XSS input not properly sanitized',
      location: 'backend/routes/auth.js'
    });
  } catch (e) {
    if (e.response && e.response.status === 400) {
      log('   ✓ PASS: XSS input properly sanitized', 'pass');
      testResults.passed++;
    }
  }

  // ============================================
  // SECTION 2: SMS NOTIFICATION SYSTEM TESTS
  // ============================================
  log('\n\nSECTION 2: SMS NOTIFICATION SYSTEM TESTS', 'info');
  log('-'.repeat(50));

  // Test 2.1: SMS API Health
  log('\n2.1 Testing SMS API Endpoint...', 'info');
  try {
    const response = await axios.get(BASE_URL + '/api/sms');
    if (response.data.success) {
      log('   ✓ PASS: SMS API is accessible', 'pass');
      testResults.passed++;
    }
  } catch (e) {
    log('   ✗ FAIL: SMS API not accessible - ' + e.message, 'fail');
    testResults.failed++;
  }

  // Test 2.2: SMS Test Function
  log('\n2.2 Testing SMS Send Functionality...', 'info');
  try {
    const response = await axios.post(BASE_URL + '/api/sms/test', {
      phoneNumber: '+639123456789',
      message: 'Test SMS from Immunicare System'
    });
    log('   ✓ PASS: SMS Test endpoint works', 'pass');
    log('      Response: ' + JSON.stringify(response.data), 'info');
    testResults.passed++;

    // Check if SMS is actually configured
    if (response.data.testMode || response.data.provider === 'log') {
      testResults.warnings.push({
        severity: 'medium',
        issue: 'SMS running in TEST/LOG mode - not configured for production'
      });
      log('   ⚠ WARN: SMS is in TEST mode (logs only)', 'warn');
    }
  } catch (e) {
    log('   ✗ FAIL: SMS Test failed - ' + (e.response?.data?.error || e.message), 'fail');
    testResults.failed++;
  }

  // Test 2.3: SMS Verification Code
  log('\n2.3 Testing SMS Verification Code Generation...', 'info');
  try {
    const response = await axios.post(BASE_URL + '/api/sms/send-verification', {
      phoneNumber: '+639123456789',
      purpose: 'phone_verification'
    });
    if (response.data.code === 'VERIFICATION_SENT') {
      log('   ✓ PASS: SMS verification code endpoint works', 'pass');
      testResults.passed++;
    }
  } catch (e) {
    log('   ✗ FAIL: SMS verification failed - ' + (e.response?.data?.error || e.message), 'fail');
    testResults.failed++;
  }

  // Test 2.4: SMS Access Control
  log('\n2.4 Testing SMS Logs Access Control...', 'info');
  try {
    await axios.get(BASE_URL + '/api/sms/logs');
    log('   ✗ FAIL: SMS logs accessible without auth', 'fail');
    testResults.failed++;
    testResults.issues.push({
      severity: 'high',
      issue: 'SMS logs endpoint accessible without authentication',
      location: 'backend/routes/sms.js'
    });
  } catch (e) {
    if (e.response && e.response.status === 401) {
      log('   ✓ PASS: SMS logs properly protected (requires auth)', 'pass');
      testResults.passed++;
    } else {
      log('   ⚠ WARN: Unexpected response - ' + e.response?.status, 'warn');
    }
  }

  // ============================================
  // SECTION 3: EMAIL SYSTEM TESTS
  // ============================================
  log('\n\nSECTION 3: EMAIL COMMUNICATION SYSTEM TESTS', 'info');
  log('-'.repeat(50));

  // Test 3.1: Email Configuration Check
  log('\n3.1 Checking Email Configuration...', 'info');
  try {
    const response = await axios.post(BASE_URL + '/api/auth/forgot-password', {
      email: 'test@example.com'
    });
    // Should return success even if email doesn't exist (to prevent enumeration)
    if (response.data.code === 'RESET_LINK_SENT') {
      log('   ✓ PASS: Forgot password endpoint works', 'pass');
      testResults.passed++;
      testResults.warnings.push({
        severity: 'medium',
        issue: 'Email configured for localhost - may not send real emails in production'
      });
    }
  } catch (e) {
    if (e.response?.data?.code === 'RESET_LINK_SENT') {
      log('   ✓ PASS: Password reset flow works', 'pass');
      testResults.passed++;
    } else {
      log('   ⚠ WARN: Email service may not be properly configured', 'warn');
      testResults.warnings.push({
        severity: 'medium',
        issue: 'Email SMTP not properly configured',
        location: 'backend/.env'
      });
    }
  }

  // ============================================
  // SECTION 4: NOTIFICATION SYSTEM TESTS
  // ============================================
  log('\n\nSECTION 4: NOTIFICATION SYSTEM TESTS', 'info');
  log('-'.repeat(50));

  // Test 4.1: Notifications Access Control
  log('\n4.1 Testing Notifications Access Control...', 'info');
  try {
    await axios.get(BASE_URL + '/api/notifications');
    log('   ✗ FAIL: Notifications accessible without auth', 'fail');
    testResults.failed++;
    testResults.issues.push({
      severity: 'high',
      issue: 'Notifications endpoint accessible without authentication',
      location: 'backend/routes/notifications.js'
    });
  } catch (e) {
    if (e.response && e.response.status === 401) {
      log('   ✓ PASS: Notifications properly protected', 'pass');
      testResults.passed++;
    }
  }

  // ============================================
  // SECTION 5: PERMISSION BOUNDARY TESTS
  // ============================================
  log('\n\nSECTION 5: PERMISSION BOUNDARY TESTS', 'info');
  log('-'.repeat(50));

  // Test 5.1: Role-based Access
  log('\n5.1 Testing Role-Based Access Control...', 'info');
  const protectedEndpoints = [
    '/api/notifications',
    '/api/sms/logs',
    '/api/dashboard/stats',
    '/api/users'
  ];

  let protectedCount = 0;
  for (const endpoint of protectedEndpoints) {
    try {
      await axios.get(BASE_URL + endpoint);
    } catch (e) {
      if (e.response?.status === 401 || e.response?.status === 403) {
        protectedCount++;
      }
    }
  }

  if (protectedCount === protectedEndpoints.length) {
    log('   ✓ PASS: All protected endpoints require authentication', 'pass');
    testResults.passed++;
  } else {
    log('   ✗ FAIL: Some endpoints may be accessible without auth', 'fail');
    testResults.failed++;
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n' + '='.repeat(60));
  log('TEST SUMMARY', 'info');
  console.log('='.repeat(60));
  log(`✓ Passed: ${testResults.passed}`, 'pass');
  log(`✗ Failed: ${testResults.failed}`, 'fail');
  log(
    `⚠ Warnings: ${testResults.warnings.length}`,
    testResults.warnings.length > 0 ? 'warn' : 'pass'
  );

  if (testResults.issues.length > 0) {
    console.log('\n' + '-'.repeat(60));
    log('IDENTIFIED ISSUES', 'warn');
    console.log('-'.repeat(60));
    testResults.issues.forEach((issue, idx) => {
      console.log(`\n${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.issue}`);
      if (issue.location) {
        console.log(`   Location: ${issue.location}`);
      }
    });
  }

  if (testResults.warnings.length > 0) {
    console.log('\n' + '-'.repeat(60));
    log('WARNINGS & RECOMMENDATIONS', 'warn');
    console.log('-'.repeat(60));
    testResults.warnings.forEach((warning, idx) => {
      console.log(`\n${idx + 1}. [${warning.severity.toUpperCase()}] ${warning.issue}`);
      if (warning.location) {
        console.log(`   Location: ${warning.location}`);
      }
    });
  }

  console.log('\n' + '='.repeat(60));

  return testResults;
}

// Run tests
runTests()
  .then((results) => {
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
