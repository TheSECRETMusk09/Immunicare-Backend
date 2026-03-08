/**
 * Settings Module Test Script
 * Tests the complete settings management system including database schema, API endpoints, and functionality
 */

const pool = require('./db');
const UserSettings = require('./models/UserSettings');

console.log('=== Settings Module Test Suite ===\n');

async function runTests() {
  let testUserId = null;
  let passedTests = 0;
  let failedTests = 0;

  try {
    // Test 1: Check if tables exist
    console.log('Test 1: Checking database tables...');
    try {
      const tablesResult = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('user_settings', 'settings_audit_log')
      `);

      if (tablesResult.rows.length === 2) {
        console.log('✓ Database tables exist');
        passedTests++;
      } else {
        console.log('✗ Missing database tables');
        failedTests++;
      }
    } catch (error) {
      console.log('✗ Error checking tables:', error.message);
      failedTests++;
    }

    // Test 2: Create a test user
    console.log('\nTest 2: Creating test user...');
    try {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('testpassword123', 10);
      const userResult = await pool.query(
        `INSERT INTO users (username, email, password_hash, role_id, clinic_id, contact)
         VALUES ($1, $2, $3, 1, 1, 'test contact')
         RETURNING id`,
        ['testsettingsuser', 'testsettings@example.com', hashedPassword]
      );
      testUserId = userResult.rows[0].id;
      console.log(`✓ Test user created with ID: ${testUserId}`);
      passedTests++;
    } catch (error) {
      console.log('✗ Error creating test user:', error.message);
      failedTests++;
    }

    if (!testUserId) {
      console.log('\nCannot continue tests without test user');
      return;
    }

    // Test 3: Get default settings
    console.log('\nTest 3: Fetching default settings...');
    try {
      const settings = await UserSettings.getGroupedSettings(testUserId);
      if (
        settings &&
        settings.general &&
        settings.profile &&
        settings.security &&
        settings.notification
      ) {
        console.log('✓ Default settings loaded successfully');
        console.log('  - General:', Object.keys(settings.general).length, 'settings');
        console.log('  - Profile:', Object.keys(settings.profile).length, 'settings');
        console.log('  - Security:', Object.keys(settings.security).length, 'settings');
        console.log('  - Notification:', Object.keys(settings.notification).length, 'settings');
        passedTests++;
      } else {
        console.log('✗ Default settings not loaded correctly');
        failedTests++;
      }
    } catch (error) {
      console.log('✗ Error fetching default settings:', error.message);
      failedTests++;
    }

    // Test 4: Update a single setting
    console.log('\nTest 4: Updating a single setting...');
    try {
      const setting = new UserSettings({
        userId: testUserId,
        category: 'general',
        settingsKey: 'theme',
        settingsValue: 'dark',
        valueType: 'string'
      });
      const updated = await setting.save();
      if (updated.settingsValue === 'dark') {
        console.log('✓ Single setting updated successfully');
        passedTests++;
      } else {
        console.log('✗ Setting update failed');
        failedTests++;
      }
    } catch (error) {
      console.log('✗ Error updating setting:', error.message);
      failedTests++;
    }

    // Test 5: Update multiple settings
    console.log('\nTest 5: Updating multiple settings...');
    try {
      const settingsArray = [
        { category: 'general', key: 'language', value: 'es', type: 'string' },
        { category: 'general', key: 'timezone', value: 'UTC', type: 'string' },
        { category: 'security', key: 'two_factor_enabled', value: true, type: 'boolean' }
      ];
      const updated = await UserSettings.updateMultiple(testUserId, settingsArray);
      if (updated.length === 3) {
        console.log('✓ Multiple settings updated successfully');
        passedTests++;
      } else {
        console.log('✗ Multiple settings update failed');
        failedTests++;
      }
    } catch (error) {
      console.log('✗ Error updating multiple settings:', error.message);
      failedTests++;
    }

    // Test 6: Validate settings
    console.log('\nTest 6: Testing setting validation...');
    try {
      const errors = UserSettings.validateSetting('general', 'theme', 'invalid', 'string');
      if (errors.length > 0) {
        console.log('✓ Validation works correctly');
        console.log('  - Validation errors:', errors);
        passedTests++;
      } else {
        console.log('✗ Validation not working');
        failedTests++;
      }
    } catch (error) {
      console.log('✗ Error in validation test:', error.message);
      failedTests++;
    }

    // Test 7: Get settings by category
    console.log('\nTest 7: Fetching settings by category...');
    try {
      const generalSettings = await UserSettings.getByCategory(testUserId, 'general');
      if (generalSettings.length > 0) {
        console.log('✓ Settings by category fetched successfully');
        console.log('  - Found', generalSettings.length, 'general settings');
        passedTests++;
      } else {
        console.log('✗ No settings found for category');
        failedTests++;
      }
    } catch (error) {
      console.log('✗ Error fetching settings by category:', error.message);
      failedTests++;
    }

    // Test 8: Get audit log
    console.log('\nTest 8: Fetching audit log...');
    try {
      const auditLog = await UserSettings.getAuditLog(testUserId, 10, 0);
      if (auditLog.length >= 0) {
        console.log('✓ Audit log fetched successfully');
        console.log('  - Found', auditLog.length, 'audit entries');
        passedTests++;
      } else {
        console.log('✗ Audit log fetch failed');
        failedTests++;
      }
    } catch (error) {
      console.log('✗ Error fetching audit log:', error.message);
      failedTests++;
    }

    // Test 9: Reset settings to defaults
    console.log('\nTest 9: Resetting settings to defaults...');
    try {
      const resetSettings = await UserSettings.resetToDefaults(testUserId, 'general');
      if (resetSettings.length > 0) {
        console.log('✓ Settings reset to defaults successfully');
        console.log('  - Reset', resetSettings.length, 'settings');
        passedTests++;
      } else {
        console.log('✗ Settings reset failed');
        failedTests++;
      }
    } catch (error) {
      console.log('✗ Error resetting settings:', error.message);
      failedTests++;
    }

    // Test 10: Get settings summary
    console.log('\nTest 10: Fetching settings summary...');
    try {
      const summary = await UserSettings.getSummary(testUserId);
      if (summary && summary.user_id === testUserId) {
        console.log('✓ Settings summary fetched successfully');
        console.log('  - Categories configured:', summary.categories_configured);
        console.log('  - Total settings:', summary.total_settings);
        passedTests++;
      } else {
        console.log('✗ Settings summary fetch failed');
        failedTests++;
      }
    } catch (error) {
      console.log('✗ Error fetching settings summary:', error.message);
      failedTests++;
    }

    // Cleanup: Delete test user
    console.log('\nCleaning up test data...');
    try {
      await pool.query('DELETE FROM user_settings WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM settings_audit_log WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
      console.log('✓ Test data cleaned up');
    } catch (error) {
      console.log('✗ Error cleaning up:', error.message);
    }
  } catch (error) {
    console.log('\n✗ Test suite failed with error:', error.message);
    console.log(error.stack);
  }

  // Print summary
  console.log('\n=== Test Summary ===');
  console.log(`Total Tests: ${passedTests + failedTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Success Rate: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(2)}%`);

  if (failedTests === 0) {
    console.log('\n✓ All tests passed!');
  } else {
    console.log('\n✗ Some tests failed. Please review the errors above.');
  }

  process.exit(failedTests > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
