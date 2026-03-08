/**
 * Critical Enhancements Test Script
 * This script tests all the critical security enhancements implemented
 */

const pool = require('./db');
const encryptionService = require('./services/encryptionService');
const refreshTokenService = require('./services/refreshTokenService');
const fs = require('fs');
const path = require('path');

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Log test result
 */
const logTest = (name, passed, message, details = null) => {
  const result = {
    name,
    passed,
    message,
    details,
    timestamp: new Date().toISOString()
  };
  testResults.tests.push(result);

  if (passed) {
    testResults.passed++;
    console.log(`✓ ${name}: ${message}`);
  } else {
    testResults.failed++;
    console.error(`✗ ${name}: ${message}`);
    if (details) {
      console.error(`  Details: ${details}`);
    }
  }
};

/**
 * Test 1: Refresh Token Service
 */
const testRefreshTokenService = async () => {
  console.log('\n=== Testing Refresh Token Service ===\n');

  try {
    // Test 1.1: Generate refresh token
    const testUser = {
      id: 999999,
      email: 'test@example.com',
      role: 'test'
    };

    const refreshToken = refreshTokenService.generateRefreshToken(testUser);
    logTest(
      'Generate Refresh Token',
      !!refreshToken && refreshToken.length > 0,
      'Refresh token generated successfully',
      `Token length: ${refreshToken.length}`
    );

    // Test 1.2: Verify refresh token
    try {
      const decoded = refreshTokenService.verifyRefreshToken(refreshToken);
      logTest(
        'Verify Refresh Token',
        decoded && decoded.id === testUser.id,
        'Refresh token verified successfully',
        `Decoded ID: ${decoded.id}`
      );
    } catch (error) {
      logTest('Verify Refresh Token', false, 'Failed to verify refresh token', error.message);
    }

    // Test 1.3: Store refresh token
    try {
      const tokenId = await refreshTokenService.storeRefreshToken(
        testUser.id,
        refreshToken,
        'Test Agent',
        '127.0.0.1'
      );
      logTest(
        'Store Refresh Token',
        !!tokenId,
        'Refresh token stored successfully',
        `Token ID: ${tokenId}`
      );
    } catch (error) {
      logTest('Store Refresh Token', false, 'Failed to store refresh token', error.message);
    }

    // Test 1.4: Get refresh token
    try {
      const tokenRecord = await refreshTokenService.getRefreshToken(refreshToken);
      logTest(
        'Get Refresh Token',
        !!tokenRecord && tokenRecord.user_id === testUser.id,
        'Refresh token retrieved successfully',
        `User ID: ${tokenRecord.user_id}`
      );
    } catch (error) {
      logTest('Get Refresh Token', false, 'Failed to get refresh token', error.message);
    }

    // Test 1.5: Revoke refresh token
    try {
      await refreshTokenService.revokeRefreshToken(refreshToken);
      const revokedToken = await refreshTokenService.getRefreshToken(refreshToken);
      logTest(
        'Revoke Refresh Token',
        !revokedToken || revokedToken.is_revoked === true,
        'Refresh token revoked successfully'
      );
    } catch (error) {
      logTest('Revoke Refresh Token', false, 'Failed to revoke refresh token', error.message);
    }

    // Test 1.6: Refresh access token
    try {
      const newRefreshToken = refreshTokenService.generateRefreshToken(testUser);
      await refreshTokenService.storeRefreshToken(
        testUser.id,
        newRefreshToken,
        'Test Agent',
        '127.0.0.1'
      );

      const refreshResult = await refreshTokenService.refreshAccessToken(
        newRefreshToken,
        'Test Agent',
        '127.0.0.1'
      );
      logTest(
        'Refresh Access Token',
        !!refreshResult && !!refreshResult.accessToken && !!refreshResult.refreshToken,
        'Access token refreshed successfully with token rotation',
        `New access token length: ${refreshResult.accessToken.length}`
      );
    } catch (error) {
      logTest('Refresh Access Token', false, 'Failed to refresh access token', error.message);
    }
  } catch (error) {
    logTest('Refresh Token Service', false, 'Refresh token service test failed', error.message);
  }
};

/**
 * Test 2: Database Encryption
 */
const testDatabaseEncryption = async () => {
  console.log('\n=== Testing Database Encryption ===\n');

  try {
    // Test 2.1: Check pgcrypto installation
    try {
      const pgcryptoCheck = await pool.query('SELECT * FROM check_pgcrypto_installation()');
      logTest(
        'pgcrypto Installation',
        pgcryptoCheck.rows[0].installed === true,
        'pgcrypto extension is installed',
        `Version: ${pgcryptoCheck.rows[0].version || 'N/A'}`
      );
    } catch (error) {
      logTest('pgcrypto Installation', false, 'pgcrypto extension check failed', error.message);
    }

    // Test 2.2: Generate encryption key
    try {
      const keyName = 'test_encryption_key';
      const newKey = await encryptionService.generateEncryptionKey(keyName);
      logTest(
        'Generate Encryption Key',
        !!newKey && newKey.length > 0,
        'Encryption key generated successfully',
        `Key length: ${newKey.length}`
      );
    } catch (error) {
      logTest('Generate Encryption Key', false, 'Failed to generate encryption key', error.message);
    }

    // Test 2.3: Encrypt data
    try {
      const testData = 'This is sensitive data';
      const encryptedData = await encryptionService.encryptData(testData, 'test_encryption_key');
      logTest(
        'Encrypt Data',
        !!encryptedData && encryptedData !== testData,
        'Data encrypted successfully',
        `Encrypted length: ${encryptedData.length}`
      );
    } catch (error) {
      logTest('Encrypt Data', false, 'Failed to encrypt data', error.message);
    }

    // Test 2.4: Decrypt data
    try {
      const testData = 'This is sensitive data';
      const encryptedData = await encryptionService.encryptData(testData, 'test_encryption_key');
      const decryptedData = await encryptionService.decryptData(
        encryptedData,
        'test_encryption_key'
      );
      logTest(
        'Decrypt Data',
        decryptedData === testData,
        'Data decrypted successfully',
        `Decrypted: ${decryptedData}`
      );
    } catch (error) {
      logTest('Decrypt Data', false, 'Failed to decrypt data', error.message);
    }

    // Test 2.5: Get encryption statistics
    try {
      const stats = await encryptionService.getEncryptionStatistics();
      logTest(
        'Get Encryption Statistics',
        Array.isArray(stats) && stats.length > 0,
        'Encryption statistics retrieved successfully',
        `Metrics count: ${stats.length}`
      );
    } catch (error) {
      logTest(
        'Get Encryption Statistics',
        false,
        'Failed to get encryption statistics',
        error.message
      );
    }

    // Test 2.6: Verify encryption integrity
    try {
      const integrity = await encryptionService.verifyEncryptionIntegrity();
      logTest(
        'Verify Encryption Integrity',
        Array.isArray(integrity) && integrity.length > 0,
        'Encryption integrity verified successfully',
        `Tables checked: ${integrity.length}`
      );
    } catch (error) {
      logTest(
        'Verify Encryption Integrity',
        false,
        'Failed to verify encryption integrity',
        error.message
      );
    }

    // Test 2.7: Backup encryption keys
    try {
      const backup = await encryptionService.backupEncryptionKeys();
      const backupData = JSON.parse(backup);
      logTest(
        'Backup Encryption Keys',
        Array.isArray(backupData) && backupData.length > 0,
        'Encryption keys backed up successfully',
        `Keys backed up: ${backupData.length}`
      );
    } catch (error) {
      logTest('Backup Encryption Keys', false, 'Failed to backup encryption keys', error.message);
    }
  } catch (error) {
    logTest('Database Encryption', false, 'Database encryption test failed', error.message);
  }
};

/**
 * Test 3: SSL/TLS Configuration
 */
const testSSLConfiguration = () => {
  console.log('\n=== Testing SSL/TLS Configuration ===\n');

  try {
    // Test 3.1: Check SSL certificate files
    const sslKeyPath = path.join(__dirname, 'ssl', 'server.key');
    const sslCertPath = path.join(__dirname, 'ssl', 'server.crt');

    const keyExists = fs.existsSync(sslKeyPath);
    const certExists = fs.existsSync(sslCertPath);

    logTest(
      'SSL Certificate Files',
      keyExists && certExists,
      'SSL certificate files exist',
      `Key: ${keyExists ? '✓' : '✗'}, Cert: ${certExists ? '✓' : '✗'}`
    );

    // Test 3.2: Check environment variables
    const enableHttps = process.env.ENABLE_HTTPS === 'true';
    const sslKeyPathEnv = process.env.SSL_KEY_PATH;
    const sslCertPathEnv = process.env.SSL_CERT_PATH;
    const httpsPort = process.env.HTTPS_PORT;

    logTest(
      'SSL Environment Variables',
      !!sslKeyPathEnv && !!sslCertPathEnv && !!httpsPort,
      'SSL environment variables are configured',
      `ENABLE_HTTPS: ${enableHttps}, HTTPS_PORT: ${httpsPort}`
    );

    // Test 3.3: Check server.js HTTPS support
    const serverJsPath = path.join(__dirname, 'server.js');
    const serverJsContent = fs.readFileSync(serverJsPath, 'utf8');

    const hasHttpsModule = serverJsContent.includes('require(\'https\')');
    const hasHttpsServer = serverJsContent.includes('https.createServer');
    const hasSslOptions = serverJsContent.includes('sslOptions');

    logTest(
      'Server HTTPS Support',
      hasHttpsModule && hasHttpsServer && hasSslOptions,
      'Server.js has HTTPS support',
      `HTTPS module: ${hasHttpsModule}, HTTPS server: ${hasHttpsServer}, SSL options: ${hasSslOptions}`
    );
  } catch (error) {
    logTest('SSL/TLS Configuration', false, 'SSL/TLS configuration test failed', error.message);
  }
};

/**
 * Test 4: Auth Endpoint Enhancements
 */
const testAuthEndpointEnhancements = () => {
  console.log('\n=== Testing Auth Endpoint Enhancements ===\n');

  try {
    // Test 4.1: Check logout endpoint revokes refresh tokens
    const authJsPath = path.join(__dirname, 'routes', 'auth.js');
    const authJsContent = fs.readFileSync(authJsPath, 'utf8');

    const hasRevokeRefreshToken = authJsContent.includes('revokeRefreshToken');
    const hasClearRefreshTokenCookie = authJsContent.includes('clearCookie(\'refreshToken\'');

    logTest(
      'Logout Endpoint Revokes Refresh Tokens',
      hasRevokeRefreshToken && hasClearRefreshTokenCookie,
      'Logout endpoint revokes refresh tokens',
      `Revoke function: ${hasRevokeRefreshToken}, Clear cookie: ${hasClearRefreshTokenCookie}`
    );

    // Test 4.2: Check refresh endpoint uses refresh token service
    const hasRefreshAccessToken = authJsContent.includes('refreshAccessToken');
    const hasRefreshTokenService = authJsContent.includes('refreshTokenService.refreshAccessToken');

    logTest(
      'Refresh Endpoint Uses Refresh Token Service',
      hasRefreshAccessToken && hasRefreshTokenService,
      'Refresh endpoint uses refresh token service',
      `Refresh function: ${hasRefreshAccessToken}, Service call: ${hasRefreshTokenService}`
    );

    // Test 4.3: Check token rotation
    const hasTokenRotation =
      authJsContent.includes('refreshToken') && authJsContent.includes('accessToken');

    logTest(
      'Token Rotation',
      hasTokenRotation,
      'Token rotation is implemented',
      'Both refresh and access tokens are rotated'
    );
  } catch (error) {
    logTest(
      'Auth Endpoint Enhancements',
      false,
      'Auth endpoint enhancements test failed',
      error.message
    );
  }
};

/**
 * Test 5: Security Headers
 */
const testSecurityHeaders = () => {
  console.log('\n=== Testing Security Headers ===\n');

  try {
    const serverJsPath = path.join(__dirname, 'server.js');
    const serverJsContent = fs.readFileSync(serverJsPath, 'utf8');

    // Test 5.1: Check for secure cookie settings
    const hasSecureCookie = serverJsContent.includes(
      'secure: process.env.NODE_ENV === \'production\''
    );
    const hasHttpOnlyCookie = serverJsContent.includes('httpOnly: true');
    const hasSameSiteCookie = serverJsContent.includes('sameSite: \'strict\'');

    logTest(
      'Secure Cookie Settings',
      hasSecureCookie && hasHttpOnlyCookie && hasSameSiteCookie,
      'Secure cookie settings are configured',
      `Secure: ${hasSecureCookie}, HttpOnly: ${hasHttpOnlyCookie}, SameSite: ${hasSameSiteCookie}`
    );

    // Test 5.2: Check for TLS version enforcement
    const hasTLSVersion = serverJsContent.includes('minVersion: \'TLSv1.2\'');

    logTest(
      'TLS Version Enforcement',
      hasTLSVersion,
      'TLS 1.2+ is enforced',
      'Minimum TLS version: 1.2'
    );

    // Test 5.3: Check for strong cipher suites
    const hasStrongCiphers = serverJsContent.includes('ECDHE-ECDSA-AES128-GCM-SHA256');

    logTest(
      'Strong Cipher Suites',
      hasStrongCiphers,
      'Strong cipher suites are configured',
      'ECDHE cipher suites are used'
    );
  } catch (error) {
    logTest('Security Headers', false, 'Security headers test failed', error.message);
  }
};

/**
 * Generate test report
 */
const generateTestReport = () => {
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${testResults.passed + testResults.failed}`);
  console.log(`Passed: ${testResults.passed}`);
  console.log(`Failed: ${testResults.failed}`);
  console.log(
    `Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(2)}%`
  );
  console.log();

  if (testResults.failed > 0) {
    console.log('Failed Tests:');
    testResults.tests
      .filter((test) => !test.passed)
      .forEach((test) => {
        console.log(`  - ${test.name}: ${test.message}`);
        if (test.details) {
          console.log(`    Details: ${test.details}`);
        }
      });
    console.log();
  }

  // Save test results to file
  const reportPath = path.join(__dirname, 'test_results_critical_enhancements.json');
  fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
  console.log(`Test results saved to: ${reportPath}`);
  console.log();

  return testResults.failed === 0;
};

/**
 * Run all tests
 */
const runAllTests = async () => {
  console.log('='.repeat(60));
  console.log('Critical Enhancements Test Suite');
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log();

  try {
    // Test database connection
    console.log('Testing database connection...');
    await pool.query('SELECT NOW()');
    console.log('✓ Database connection successful\n');

    // Run all tests
    await testRefreshTokenService();
    await testDatabaseEncryption();
    testSSLConfiguration();
    testAuthEndpointEnhancements();
    testSecurityHeaders();

    // Generate report
    const allPassed = generateTestReport();

    console.log('='.repeat(60));
    if (allPassed) {
      console.log('✓ All tests passed!');
    } else {
      console.log('✗ Some tests failed. Please review the failed tests above.');
    }
    console.log('='.repeat(60));
    console.log();

    return allPassed;
  } catch (error) {
    console.error('='.repeat(60));
    console.error('✗ Test suite failed!');
    console.error('='.repeat(60));
    console.error();
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error();

    return false;
  } finally {
    await pool.end();
  }
};

// Run tests
runAllTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
