/**
 * Authentication Test Script
 * Tests admin and guardian login endpoints with proper role-based access
 */

const axios = require('axios');
const chalk = require('chalk') || { green: s => s, red: s => s, yellow: s => s, blue: s => s, cyan: s => s };

const API_BASE_URL = process.env.API_URL || 'http://localhost:5000/api';
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'Admin2024!',
};

const GUARDIAN_CREDENTIALS = {
  username: 'maria.santos@email.com',
  password: 'guardian123',
};

class AuthTester {
  constructor() {
    this.results = [];
    this.tokens = {};
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }

  async testAdminLogin() {
    this.log('\n=== Testing Admin Login ===', 'header');
    try {
      // Test admin login via dedicated endpoint
      const response = await axios.post(`${API_BASE_URL}/auth/admin/login`, ADMIN_CREDENTIALS, {
        withCredentials: true,
        timeout: 10000,
      });

      this.validateAdminResponse(response);
      this.tokens.admin = {
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
      };

      this.results.push({ test: 'Admin Login', status: 'PASSED', details: 'Admin login successful' });
      return true;
    } catch (error) {
      this.results.push({
        test: 'Admin Login',
        status: 'FAILED',
        details: error.response?.data?.error || error.message,
      });
      return false;
    }
  }

  validateAdminResponse(response) {
    const { data } = response;

    // Check response structure
    console.log('✓ Response status:', response.status);
    console.log('✓ User role:', data.user?.role);
    console.log('✓ User role_type:', data.user?.role_type);
    console.log('✓ Layout:', data.user?.layout || data.layout);
    console.log('✓ Dashboard Route:', data.user?.dashboardRoute || data.dashboardRoute);

    // Validate permissions array
    const permissions = data.user?.permissions || data.permissions;
    console.log('✓ Permissions count:', permissions?.length || 0);

    // Assert values
    if (data.user?.role !== 'SYSTEM_ADMIN') {
      throw new Error(`Expected role SYSTEM_ADMIN, got ${data.user?.role}`);
    }

    if ((data.user?.layout || data.layout) !== 'AdminLayout') {
      throw new Error(`Expected layout AdminLayout, got ${data.user?.layout || data.layout}`);
    }

    if (!Array.isArray(permissions) || permissions.length === 0) {
      throw new Error('Permissions array should not be empty');
    }

    // Check for expected admin permissions
    const expectedAdminPermissions = ['dashboard:view', 'dashboard:analytics'];
    const hasExpectedPermissions = expectedAdminPermissions.every(p => permissions.includes(p));
    if (!hasExpectedPermissions) {
      console.log('  ⚠ Warning: Some expected permissions may be missing');
    }
  }

  async testGuardianLogin() {
    this.log('\n=== Testing Guardian Login ===', 'header');
    try {
      // Test guardian login via dedicated endpoint
      const response = await axios.post(`${API_BASE_URL}/auth/guardian/login`, GUARDIAN_CREDENTIALS, {
        withCredentials: true,
        timeout: 10000,
      });

      this.validateGuardianResponse(response);
      this.tokens.guardian = {
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
      };

      this.results.push({ test: 'Guardian Login', status: 'PASSED', details: 'Guardian login successful' });
      return true;
    } catch (error) {
      this.results.push({
        test: 'Guardian Login',
        status: 'FAILED',
        details: error.response?.data?.error || error.message,
      });
      return false;
    }
  }

  validateGuardianResponse(response) {
    const { data } = response;

    // Check response structure
    console.log('✓ Response status:', response.status);
    console.log('✓ User role:', data.user?.role);
    console.log('✓ User role_type:', data.user?.role_type);
    console.log('✓ Layout:', data.user?.layout || data.layout);
    console.log('✓ Dashboard Route:', data.user?.dashboardRoute || data.dashboardRoute);

    // Validate permissions array
    const permissions = data.user?.permissions || data.permissions;
    console.log('✓ Permissions count:', permissions?.length || 0);

    // Assert values
    if (data.user?.role !== 'GUARDIAN') {
      throw new Error(`Expected role GUARDIAN, got ${data.user?.role}`);
    }

    if ((data.user?.layout || data.layout) !== 'GuardianLayout') {
      throw new Error(`Expected layout GuardianLayout, got ${data.user?.layout || data.layout}`);
    }

    if (!Array.isArray(permissions) || permissions.length === 0) {
      throw new Error('Permissions array should not be empty');
    }

    // Check for expected guardian permissions
    const expectedGuardianPermissions = ['dashboard:view', 'patient:view:own'];
    const hasExpectedPermissions = expectedGuardianPermissions.every(p => permissions.includes(p));
    if (!hasExpectedPermissions) {
      console.log('  ⚠ Warning: Some expected permissions may be missing');
    }
  }

  async testUnifiedLogin() {
    this.log('\n=== Testing Unified Login (role detection) ===', 'header');
    try {
      // Test with admin credentials via unified endpoint
      const adminResponse = await axios.post(`${API_BASE_URL}/auth/login`, ADMIN_CREDENTIALS, {
        withCredentials: true,
        timeout: 10000,
      });

      console.log('Admin via unified endpoint:');
      console.log('  Role:', adminResponse.data.user?.role);
      console.log('  Layout:', adminResponse.data.layout);

      if (adminResponse.data.user?.role !== 'SYSTEM_ADMIN') {
        throw new Error('Unified login should detect admin role');
      }

      // Test with guardian credentials via unified endpoint
      const guardianResponse = await axios.post(`${API_BASE_URL}/auth/login`, GUARDIAN_CREDENTIALS, {
        withCredentials: true,
        timeout: 10000,
      });

      console.log('Guardian via unified endpoint:');
      console.log('  Role:', guardianResponse.data.user?.role);
      console.log('  Layout:', guardianResponse.data.layout);

      if (guardianResponse.data.user?.role !== 'GUARDIAN') {
        throw new Error('Unified login should detect guardian role');
      }

      this.results.push({ test: 'Unified Login', status: 'PASSED', details: 'Role detection working correctly' });
      return true;
    } catch (error) {
      this.results.push({
        test: 'Unified Login',
        status: 'FAILED',
        details: error.response?.data?.error || error.message,
      });
      return false;
    }
  }

  async testTokenRefresh() {
    this.log('\n=== Testing Token Refresh ===', 'header');
    try {
      if (!this.tokens.admin) {
        console.log('Skipping token refresh test - no admin token available');
        return false;
      }

      const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, {
        headers: {
          'Cookie': `refreshToken=${this.tokens.admin.refreshToken}`,
        },
        withCredentials: true,
        timeout: 10000,
      });

      console.log('✓ Token refresh successful');
      console.log('✓ New access token received:', !!response.data.accessToken);
      console.log('✓ New refresh token received:', !!response.data.refreshToken);

      if (!response.data.accessToken) {
        throw new Error('No new access token in refresh response');
      }

      this.results.push({ test: 'Token Refresh', status: 'PASSED', details: 'Token rotation working' });
      return true;
    } catch (error) {
      this.results.push({
        test: 'Token Refresh',
        status: 'FAILED',
        details: error.response?.data?.error || error.message,
      });
      return false;
    }
  }

  async testSessionVerification() {
    this.log('\n=== Testing Session Verification ===', 'header');
    try {
      if (!this.tokens.admin) {
        console.log('Skipping session verification test - no admin token available');
        return false;
      }

      const response = await axios.get(`${API_BASE_URL}/auth/verify`, {
        headers: {
          'Authorization': `Bearer ${this.tokens.admin.accessToken}`,
        },
        withCredentials: true,
        timeout: 10000,
      });

      console.log('✓ Session verification successful');
      console.log('✓ Authenticated:', response.data.authenticated);
      console.log('✓ User role:', response.data.user?.role);

      if (!response.data.authenticated) {
        throw new Error('Session should be authenticated');
      }

      this.results.push({ test: 'Session Verification', status: 'PASSED', details: 'Session verification working' });
      return true;
    } catch (error) {
      this.results.push({
        test: 'Session Verification',
        status: 'FAILED',
        details: error.response?.data?.error || error.message,
      });
      return false;
    }
  }

  async testInvalidCredentials() {
    this.log('\n=== Testing Invalid Credentials ===', 'header');
    try {
      const response = await axios.post(`${API_BASE_URL}/auth/login`, {
        username: 'invalid_user',
        password: 'wrong_password',
      }, {
        withCredentials: true,
        timeout: 10000,
        validateStatus: () => true, // Don't throw on error status
      });

      if (response.status !== 401) {
        throw new Error(`Expected 401 status, got ${response.status}`);
      }

      console.log('✓ Invalid credentials rejected with 401');
      console.log('✓ Error code:', response.data?.code);

      this.results.push({ test: 'Invalid Credentials', status: 'PASSED', details: 'Proper 401 error returned' });
      return true;
    } catch (error) {
      this.results.push({
        test: 'Invalid Credentials',
        status: 'FAILED',
        details: error.message,
      });
      return false;
    }
  }

  async runAllTests() {
    this.log('\n' + '='.repeat(60));
    this.log('IMMUNICARE AUTHENTICATION TEST SUITE');
    this.log('='.repeat(60));

    // Run tests sequentially
    await this.testAdminLogin();
    await this.testGuardianLogin();
    await this.testUnifiedLogin();
    await this.testTokenRefresh();
    await this.testSessionVerification();
    await this.testInvalidCredentials();

    this.printSummary();
  }

  printSummary() {
    this.log('\n' + '='.repeat(60));
    this.log('TEST SUMMARY');
    this.log('='.repeat(60));

    const passed = this.results.filter(r => r.status === 'PASSED').length;
    const failed = this.results.filter(r => r.status === 'FAILED').length;

    this.results.forEach(result => {
      const status = result.status === 'PASSED' ? '✓' : '✗';
      console.log(`${status} ${result.test}: ${result.status}`);
      if (result.status === 'FAILED') {
        console.log(`  Error: ${result.details}`);
      }
    });

    this.log('\n' + '-'.repeat(60));
    this.log(`Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed}`);
    this.log('='.repeat(60));

    process.exit(failed > 0 ? 1 : 0);
  }
}

// Run tests
const tester = new AuthTester();
tester.runAllTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
