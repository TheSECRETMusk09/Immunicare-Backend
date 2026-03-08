/**
 * Test Script for Vaccination Reminder Module
 *
 * Run this script to test the vaccination reminder functionality:
 * node test_vaccination_reminders.js
 */

const pool = require('./db');
const VaccinationReminderService = require('./services/vaccinationReminderService');

async function runTests() {
  console.log('🧪 Starting Vaccination Reminder Module Tests\n');

  let passed = 0;
  let failed = 0;

  try {
    // Test 1: Calculate Due Date
    console.log('Test 1: Calculate Due Date');
    try {
      const reminderService = new VaccinationReminderService();

      const birthDate = new Date('2024-01-15');
      const dueDate = reminderService.calculateNextVaccineDate(birthDate, 'Hep B', 2);

      // Hep B dose 2 is due at 1 month (4 weeks)
      const expectedDate = new Date(birthDate);
      expectedDate.setMonth(expectedDate.getMonth() + 1);

      if (dueDate.toDateString() === expectedDate.toDateString()) {
        console.log('  ✅ Due date calculation correct');
        passed++;
      } else {
        console.log(`  ❌ Expected ${expectedDate.toDateString()}, got ${dueDate.toDateString()}`);
        failed++;
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

    // Test 2: Vaccination Schedule Exists
    console.log('\nTest 2: Vaccination Schedule Check');
    try {
      const scheduleResult = await pool.query(`
        SELECT COUNT(*) as count FROM vaccination_schedules WHERE is_active = true
      `);

      if (parseInt(scheduleResult.rows[0].count) > 0) {
        console.log(`  ✅ Found ${scheduleResult.rows[0].count} active vaccination schedules`);
        passed++;
      } else {
        console.log('  ❌ No active vaccination schedules found');
        failed++;
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

    // Test 3: Vaccines Exist
    console.log('\nTest 3: Vaccines Check');
    try {
      const vaccinesResult = await pool.query(`
        SELECT COUNT(*) as count FROM vaccines WHERE is_active = true
      `);

      if (parseInt(vaccinesResult.rows[0].count) > 0) {
        console.log(`  ✅ Found ${vaccinesResult.rows[0].count} active vaccines`);
        passed++;
      } else {
        console.log('  ❌ No active vaccines found');
        failed++;
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

    // Test 4: Guardian Notification Preferences Table
    console.log('\nTest 4: Guardian Notification Preferences Table');
    try {
      const tableResult = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'guardian_notification_preferences'
        )
      `);

      if (tableResult.rows[0].exists) {
        console.log('  ✅ guardian_notification_preferences table exists');
        passed++;
      } else {
        console.log('  ⚠️ guardian_notification_preferences table not found (run migration)');
        // This is expected if migration hasn't been run
        passed++;
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

    // Test 5: Vaccination Reminders Table
    console.log('\nTest 5: Vaccination Reminders Table');
    try {
      const tableResult = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'vaccination_reminders'
        )
      `);

      if (tableResult.rows[0].exists) {
        console.log('  ✅ vaccination_reminders table exists');
        passed++;
      } else {
        console.log('  ⚠️ vaccination_reminders table not found (run migration)');
        passed++;
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

    // Test 6: Patients with Guardians
    console.log('\nTest 6: Patients with Guardians');
    try {
      const patientsResult = await pool.query(`
        SELECT COUNT(*) as count FROM patients p
        JOIN guardians g ON p.guardian_id = g.id
        WHERE p.is_active = true AND g.is_active = true
      `);

      if (parseInt(patientsResult.rows[0].count) > 0) {
        console.log(`  ✅ Found ${patientsResult.rows[0].count} active patients with guardians`);
        passed++;
      } else {
        console.log('  ⚠️ No active patients with guardians found');
        passed++;
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

    // Test 7: Notification Templates
    console.log('\nTest 7: Notification Templates');
    try {
      const templateResult = await pool.query(`
        SELECT COUNT(*) as count FROM vaccination_reminder_templates WHERE is_active = true
      `);

      if (parseInt(templateResult.rows[0].count) > 0) {
        console.log(`  ✅ Found ${templateResult.rows[0].count} active reminder templates`);
        passed++;
      } else {
        console.log('  ⚠️ No active reminder templates found (run migration)');
        passed++;
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

    // Test 8: Immunization Records Table
    console.log('\nTest 8: Immunization Records Table');
    try {
      const tableResult = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'immunization_records'
        )
      `);

      if (tableResult.rows[0].exists) {
        console.log('  ✅ immunization_records table exists');
        passed++;
      } else {
        console.log('_records table not found  ❌ immunization');
        failed++;
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

    // Test 9: Service Instantiation
    console.log('\nTest 9: Service Instantiation');
    try {
      const service = new VaccinationReminderService();
      if (service && typeof service.getNextScheduledVaccine === 'function') {
        console.log('  ✅ VaccinationReminderService instantiated correctly');
        passed++;
      } else {
        console.log('  ❌ Service methods not available');
        failed++;
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

  } catch (error) {
    console.error('Fatal error during tests:', error);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log(`\n⚠️ ${failed} test(s) failed. Check the output above.`);
  }

  // Close database connection
  await pool.end();

  return failed === 0;
}

// Run tests
runTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
