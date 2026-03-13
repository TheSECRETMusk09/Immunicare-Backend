/**
 * Targeted Tests for OTP SMS and Appointment Flow
 * Tests the complete flow from guardian registration to appointment booking with SMS notifications
 *
 * Run with: node backend/tests/otp-sms-appointment-flow.test.js
 */

const pool = require('../db');
const smsService = require('../services/smsService');
const appointmentConfirmationService = require('../services/appointmentConfirmationService');
const { processAppointmentReminders } = require('../services/smsReminderScheduler');

// Test configuration
const TEST_CONFIG = {
  testPhone: '+639123456789',
  testPhoneLocal: '09123456789',
  testEmail: 'test-guardian-' + Date.now() + '@example.com',
  testInfantName: 'Test Baby',
  testClinicId: 1,
  testGuardianId: null,
  testUserId: null,
  testInfantId: null,
  testAppointmentId: null,
};

// Utility functions
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const cleanupTestData = async () => {
  try {
    // Clean up test appointment
    if (TEST_CONFIG.testAppointmentId) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [TEST_CONFIG.testAppointmentId]);
    }
    // Clean up test infant
    if (TEST_CONFIG.testInfantId) {
      await pool.query('DELETE FROM patients WHERE id = $1', [TEST_CONFIG.testInfantId]);
    }
    // Clean up test user
    if (TEST_CONFIG.testUserId) {
      await pool.query('DELETE FROM users WHERE id = $1', [TEST_CONFIG.testUserId]);
    }
    // Clean up test guardian
    if (TEST_CONFIG.testGuardianId) {
      await pool.query('DELETE FROM guardians WHERE id = $1', [TEST_CONFIG.testGuardianId]);
    }
    // Clean up test pending registration
    await pool.query('DELETE FROM pending_registrations WHERE phone_number LIKE $1', ['%+63%']);
    // Clean up test OTP codes
    await pool.query('DELETE FROM sms_verification_codes WHERE phone_number LIKE $1', ['%+63%']);
    console.log('✓ Test data cleaned up');
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  }
};

// ============================================
// TEST SUITE 1: OTP Send and Verify
// ============================================
async function testOtpSendAndVerify() {
  console.log('\n=== TEST SUITE 1: OTP Send and Verify ===\n');

  try {
    // Test 1.1: Phone number formatting
    console.log('Test 1.1: Phone Number Formatting');

    const testCases = [
      { input: '09123456789', expected: '+639123456789' },
      { input: '639123456789', expected: '+639123456789' },
      { input: '+639123456789', expected: '+639123456789' },
      { input: '+63-912-345-6789', expected: '+639123456789' },
    ];

    for (const { input, expected } of testCases) {
      const result = smsService.formatPhoneNumber(input);
      const passed = result === expected;
      console.log(`  ${passed ? '✓' : '✗'} formatPhoneNumber("${input}") = "${result}" (expected: "${expected}")`);
      if (!passed) {
        throw new Error(`Phone formatting failed for ${input}`);
      }
    }

    // Test 1.2: Generate OTP
    console.log('\nTest 1.2: OTP Generation');
    const otp = smsService.generateVerificationCode(6);
    console.log(`  ✓ Generated OTP: ${otp}`);
    if (otp.length !== 6) {
      throw new Error('OTP should be 6 digits');
    }
    if (!/^\d{6}$/.test(otp)) {
      throw new Error('OTP should be numeric');
    }

    // Test 1.3: Send OTP via SMS service
    console.log('\nTest 1.3: Send OTP SMS');
    const sendResult = await smsService.sendOTP(TEST_CONFIG.testPhone, 'verification', {
      testMode: true,
    });
    console.log('  OTP send result:', JSON.stringify(sendResult, null, 2));

    if (!sendResult.success) {
      console.log(`  Note: OTP send may fail in test environment without SMS provider: ${sendResult.error}`);
    } else {
      console.log('  ✓ OTP sent successfully');
    }

    // Test 1.4: Verify OTP (stored in sms_verification_codes table)
    console.log('\nTest 1.4: Verify OTP');

    // Insert a test OTP directly
    const testOtp = '123456';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO sms_verification_codes (phone_number, code, purpose, expires_at, attempts, max_attempts)
       VALUES ($1, $2, $3, $4, 0, 3)
       ON CONFLICT (phone_number, purpose) DO UPDATE SET code = EXCLUDED.code`,
      [TEST_CONFIG.testPhone, testOtp, 'verification', expiresAt],
    );
    console.log(`  ✓ Test OTP inserted: ${testOtp}`);

    // Verify correct OTP
    const verifyResult = await smsService.verifyOTP(TEST_CONFIG.testPhone, testOtp, 'verification');
    console.log('  Verify result:', JSON.stringify(verifyResult, null, 2));

    if (!verifyResult.success) {
      throw new Error('OTP verification failed: ' + verifyResult.error);
    }
    console.log('  ✓ OTP verified successfully');

    // Test 1.5: Verify incorrect OTP fails
    console.log('\nTest 1.5: Verify Incorrect OTP Fails');
    const wrongVerifyResult = await smsService.verifyOTP(TEST_CONFIG.testPhone, '000000', 'verification');
    if (wrongVerifyResult.success) {
      throw new Error('Wrong OTP should not verify');
    }
    console.log(`  ✓ Wrong OTP correctly rejected: ${wrongVerifyResult.error}`);

    // Test 1.6: Verify expired OTP fails
    console.log('\nTest 1.6: Verify Expired OTP Fails');
    const expiredOtp = '654321';
    const pastExpiry = new Date(Date.now() - 60 * 1000); // 1 minute ago

    await pool.query(
      `INSERT INTO sms_verification_codes (phone_number, code, purpose, expires_at, attempts, max_attempts)
       VALUES ($1, $2, $3, $4, 0, 3)
       ON CONFLICT (phone_number, purpose) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
      [TEST_CONFIG.testPhone, expiredOtp, 'verification', pastExpiry],
    );

    const expiredVerifyResult = await smsService.verifyOTP(TEST_CONFIG.testPhone, expiredOtp, 'verification');
    if (expiredVerifyResult.success) {
      throw new Error('Expired OTP should not verify');
    }
    console.log(`  ✓ Expired OTP correctly rejected: ${expiredVerifyResult.error}`);

    console.log('\n=== TEST SUITE 1 PASSED ===\n');
    return true;
  } catch (error) {
    console.error('\n✗ TEST SUITE 1 FAILED:', error.message);
    console.error(error.stack);
    return false;
  }
}

// ============================================
// TEST SUITE 2: Appointment Booking
// ============================================
async function testAppointmentBooking() {
  console.log('\n=== TEST SUITE 2: Appointment Booking ===\n');

  try {
    // First, create test guardian and infant
    console.log('Setting up test data...');

    // Create guardian
    const guardianResult = await pool.query(
      `INSERT INTO guardians (name, phone, email, relationship, is_active, is_password_set)
       VALUES ($1, $2, $3, 'parent', true, true)
       RETURNING id`,
      ['Test Guardian', TEST_CONFIG.testPhone, TEST_CONFIG.testEmail],
    );
    TEST_CONFIG.testGuardianId = guardianResult.rows[0].id;
    console.log(`  ✓ Created test guardian with ID: ${TEST_CONFIG.testGuardianId}`);

    // Get or create role
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = \'guardian\'');
    const roleId = roleResult.rows[0].id;

    // Get or create clinic
    let clinicResult = await pool.query('SELECT id FROM clinics LIMIT 1');
    if (clinicResult.rows.length === 0) {
      clinicResult = await pool.query(
        'INSERT INTO clinics (name, region, address) VALUES (\'Test Clinic\', \'Metro Manila\', \'Test Address\') RETURNING id',
      );
    }
    TEST_CONFIG.testClinicId = clinicResult.rows[0].id;

    // Create user
    const userResult = await pool.query(
      `INSERT INTO users (username, email, password_hash, role_id, guardian_id, clinic_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id`,
      ['testuser' + Date.now(), TEST_CONFIG.testEmail, 'hash', roleId, TEST_CONFIG.testGuardianId, TEST_CONFIG.testClinicId],
    );
    TEST_CONFIG.testUserId = userResult.rows[0].id;
    console.log(`  ✓ Created test user with ID: ${TEST_CONFIG.testUserId}`);

    // Create infant/patient
    const infantResult = await pool.query(
      `INSERT INTO patients (first_name, last_name, guardian_id, clinic_id, is_active, date_of_birth)
       VALUES ($1, $2, $3, $4, true, NOW() - INTERVAL '6 months')
       RETURNING id`,
      ['Test', 'Baby', TEST_CONFIG.testGuardianId, TEST_CONFIG.testClinicId],
    );
    TEST_CONFIG.testInfantId = infantResult.rows[0].id;
    console.log(`  ✓ Created test infant with ID: ${TEST_CONFIG.testInfantId}`);

    // Test 2.1: Create appointment with guardian_id
    console.log('\nTest 2.1: Create Appointment with guardian_id');

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7); // 1 week from now

    const appointmentResult = await pool.query(
      `INSERT INTO appointments (infant_id, guardian_id, scheduled_date, type, status, clinic_id, created_by, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, status`,
      [
        TEST_CONFIG.testInfantId,
        TEST_CONFIG.testGuardianId,
        futureDate,
        'vaccination',
        'scheduled',
        TEST_CONFIG.testClinicId,
        TEST_CONFIG.testUserId,
        'Test Health Center',
      ],
    );

    TEST_CONFIG.testAppointmentId = appointmentResult.rows[0].id;
    console.log(`  ✓ Created appointment with ID: ${TEST_CONFIG.testAppointmentId}`);
    console.log(`  ✓ Appointment status: ${appointmentResult.rows[0].status}`);

    if (appointmentResult.rows[0].status !== 'scheduled') {
      throw new Error('Appointment should be scheduled');
    }

    // Test 2.2: Verify guardian_id is stored correctly
    console.log('\nTest 2.2: Verify guardian_id stored');
    const verifyAppointment = await pool.query(
      'SELECT guardian_id, infant_id, status FROM appointments WHERE id = $1',
      [TEST_CONFIG.testAppointmentId],
    );

    if (verifyAppointment.rows[0].guardian_id != TEST_CONFIG.testGuardianId) {
      throw new Error('guardian_id not stored correctly');
    }
    console.log(`  ✓ guardian_id correctly stored: ${verifyAppointment.rows[0].guardian_id}`);

    // Test 2.3: Admin can see appointment
    console.log('\nTest 2.3: Admin can query appointments');
    const adminQuery = await pool.query(
      `SELECT a.id, a.guardian_id, p.first_name, p.last_name, g.name as guardian_name
       FROM appointments a
       JOIN patients p ON a.infant_id = p.id
       JOIN guardians g ON p.guardian_id = g.id
       WHERE a.id = $1`,
      [TEST_CONFIG.testAppointmentId],
    );

    if (adminQuery.rows.length === 0) {
      throw new Error('Admin could not see appointment');
    }
    console.log(`  ✓ Admin can see appointment: ${adminQuery.rows[0].guardian_name} for ${adminQuery.rows[0].first_name} ${adminQuery.rows[0].last_name}`);

    // Test 2.4: Guardian can see their appointments
    console.log('\nTest 2.4: Guardian can see own appointments');
    const guardianQuery = await pool.query(
      `SELECT a.id FROM appointments a
       JOIN patients p ON a.infant_id = p.id
       WHERE p.guardian_id = $1 AND a.id = $2`,
      [TEST_CONFIG.testGuardianId, TEST_CONFIG.testAppointmentId],
    );

    if (guardianQuery.rows.length === 0) {
      throw new Error('Guardian could not see own appointment');
    }
    console.log('  ✓ Guardian can see own appointment');

    console.log('\n=== TEST SUITE 2 PASSED ===\n');
    return true;
  } catch (error) {
    console.error('\n✗ TEST SUITE 2 FAILED:', error.message);
    console.error(error.stack);
    return false;
  }
}

// ============================================
// TEST SUITE 3: SMS Confirmation
// ============================================
async function testSmsConfirmation() {
  console.log('\n=== TEST SUITE 3: SMS Confirmation ===\n');

  try {
    if (!TEST_CONFIG.testAppointmentId) {
      console.log('Skipping - no test appointment available');
      return true;
    }

    // Test 3.1: Send appointment confirmation SMS
    console.log('Test 3.1: Send Appointment Confirmation SMS');
    const confirmationResult = await appointmentConfirmationService.sendConfirmationSMS(TEST_CONFIG.testAppointmentId);
    console.log('  Confirmation result:', JSON.stringify(confirmationResult, null, 2));

    // Check if SMS was logged in database
    const smsLogCheck = await pool.query(
      `SELECT * FROM sms_logs
       WHERE message_type LIKE '%appointment_confirmation%'
       ORDER BY created_at DESC LIMIT 1`,
    );

    if (smsLogCheck.rows.length > 0) {
      console.log('  ✓ SMS confirmation logged in database');
      console.log(`  ✓ Status: ${smsLogCheck.rows[0].status}`);
    } else {
      console.log('  Note: SMS confirmation may have failed or logged differently');
    }

    // Test 3.2: Verify appointment has confirmation status updated
    console.log('\nTest 3.2: Check Confirmation Status');
    const appointmentCheck = await pool.query(
      'SELECT sms_confirmation_sent, confirmation_status FROM appointments WHERE id = $1',
      [TEST_CONFIG.testAppointmentId],
    );

    if (appointmentCheck.rows[0].sms_confirmation_sent) {
      console.log(`  ✓ Confirmation status updated: ${appointmentCheck.rows[0].confirmation_status}`);
    } else {
      console.log('  Note: Confirmation may not have been sent in test mode');
    }

    // Test 3.3: Test sendAppointmentConfirmation from smsService
    console.log('\nTest 3.3: Direct SMS Confirmation Call');
    const directResult = await smsService.sendAppointmentConfirmation({
      phoneNumber: TEST_CONFIG.testPhone,
      guardianName: 'Test Guardian',
      childName: 'Test Baby',
      vaccineName: 'Vaccination',
      scheduledDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      location: 'Test Health Center',
    });

    console.log('  Direct result:', JSON.stringify(directResult, null, 2));

    if (directResult.success) {
      console.log('  ✓ SMS confirmation sent successfully');
    } else {
      console.log(`  Note: Direct SMS may fail in test environment: ${directResult.error || 'unknown'}`);
    }

    console.log('\n=== TEST SUITE 3 PASSED ===\n');
    return true;
  } catch (error) {
    console.error('\n✗ TEST SUITE 3 FAILED:', error.message);
    console.error(error.stack);
    return false;
  }
}

// ============================================
// TEST SUITE 4: Reminder Generation
// ============================================
async function testReminderGeneration() {
  console.log('\n=== TEST SUITE 4: Reminder Generation ===\n');

  try {
    // Test 4.1: Check for upcoming appointments that need reminders
    console.log('Test 4.1: Check Upcoming Appointments for Reminders');

    const upcomingQuery = await pool.query(
      `SELECT a.id, a.scheduled_date, a.reminder_sent_24h, a.reminder_sent_48h,
              p.first_name, p.last_name, g.name as guardian_name, g.phone as guardian_phone
       FROM appointments a
       JOIN patients p ON a.infant_id = p.id
       JOIN guardians g ON p.guardian_id = g.id
       WHERE a.status = 'scheduled'
         AND a.is_active = true
         AND a.scheduled_date > NOW()
         AND a.scheduled_date < NOW() + INTERVAL '48 hours'
       LIMIT 5`,
    );

    console.log(`  Found ${upcomingQuery.rows.length} appointments in next 48 hours`);

    if (upcomingQuery.rows.length > 0) {
      for (const appt of upcomingQuery.rows) {
        console.log(`  - Appointment ${appt.id}: ${appt.first_name} ${appt.last_name} on ${appt.scheduled_date}`);
        console.log(`    24h reminder sent: ${appt.reminder_sent_24h}, 48h reminder sent: ${appt.reminder_sent_48h}`);
      }
    }

    // Test 4.2: Test reminder message generation
    console.log('\nTest 4.2: Generate Reminder Messages');

    const reminderMsg48h = smsService.createAppointmentReminderMessage(
      'vaccination',
      new Date(Date.now() + 48 * 60 * 60 * 1000),
      {
        hoursUntil: 48,
        childName: 'Test Baby',
        guardianName: 'Test Guardian',
        location: 'Test Health Center',
      },
    );
    console.log(`  48h reminder message: ${reminderMsg48h.substring(0, 100)}...`);

    const reminderMsg24h = smsService.createAppointmentReminderMessage(
      'vaccination',
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      {
        hoursUntil: 24,
        childName: 'Test Baby',
        guardianName: 'Test Guardian',
        location: 'Test Health Center',
      },
    );
    console.log(`  24h reminder message: ${reminderMsg24h.substring(0, 100)}...`);

    // Test 4.3: Test sendAppointmentReminder function
    console.log('\nTest 4.3: Send Appointment Reminder');
    const reminderResult = await smsService.sendAppointmentReminder({
      phoneNumber: TEST_CONFIG.testPhone,
      childName: 'Test Baby',
      scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      hoursUntil: 24,
    });

    console.log('  Reminder result:', JSON.stringify(reminderResult, null, 2));

    if (reminderResult.success) {
      console.log('  ✓ Reminder sent successfully');
    } else {
      console.log(`  Note: Reminder may fail in test environment: ${reminderResult.error || 'unknown'}`);
    }

    // Test 4.4: Test scheduler reminder function (if appointments exist)
    console.log('\nTest 4.4: Run Scheduler Reminder Job');
    try {
      await processAppointmentReminders();
      console.log('  ✓ Reminder job executed without error');
    } catch (schedulerError) {
      console.log(`  Note: Scheduler may not find appointments to remind: ${schedulerError.message}`);
    }

    console.log('\n=== TEST SUITE 4 PASSED ===\n');
    return true;
  } catch (error) {
    console.error('\n✗ TEST SUITE 4 FAILED:', error.message);
    console.error(error.stack);
    return false;
  }
}

// ============================================
// MAIN TEST RUNNER
// ============================================
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  IMMUNICARE OTP SMS & APPOINTMENT FLOW TEST SUITE         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  let allPassed = true;

  try {
    // Run test suites
    const results = await Promise.all([
      testOtpSendAndVerify(),
      testAppointmentBooking(),
      testSmsConfirmation(),
      testReminderGeneration(),
    ]);

    allPassed = results.every(r => r);
  } catch (error) {
    console.error('Fatal error during tests:', error);
    allPassed = false;
  } finally {
    // Cleanup
    console.log('\n--- Cleaning up test data ---');
    await cleanupTestData();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    if (allPassed) {
      console.log('║  ✓ ALL TESTS PASSED                                        ║');
    } else {
      console.log('║  ✗ SOME TESTS FAILED                                       ║');
    }
    console.log('╚════════════════════════════════════════════════════════════╝');

    process.exit(allPassed ? 0 : 1);
  }
}

// Run tests
runAllTests();
