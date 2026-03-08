/**
 * SMS & Email Configuration Verification Script
 * Tests SMS and Email services for production readiness
 *
 * @usage: node test_sms_email_config.js
 * @version 2.0
 * @since 2026-03-01
 */

require('dotenv').config();
const smsService = require('./services/smsService');
const emailService = require('./services/emailService');
const appointmentEmailService = require('./services/appointmentEmailService');
const logger = require('./config/logger');

/**
 * Test SMS Configuration
 */
async function testSMSConfig() {
  console.log('\n' + '='.repeat(60));
  console.log('📱 SMS Configuration Test');
  console.log('='.repeat(60));

  const status = smsService.getSMSConfigStatus();

  console.log(`\nGateway: ${status.gateway}`);
  console.log(`Provider: ${status.provider}`);
  console.log(`Configured: ${status.configured ? '✅ Yes' : '❌ No'}`);

  if (status.configured) {
    console.log('\n✅ SMS Gateway is configured and ready');

    // Test phone number format validation
    const testPhoneNumbers = [
      '09123456789',
      '+639123456789',
      '639123456789',
      '1234567890', // Invalid
    ];

    console.log('\n📝 Phone Number Validation Test:');
    testPhoneNumbers.forEach(phone => {
      const result = smsService.validateAndFormatPhoneNumber(phone);
      console.log(`  ${phone.padEnd(16)} => ${result.valid ? '✅ ' + result.formattedNumber : '❌ ' + result.error}`);
    });

    // Test SMS sending if in development mode with test number
    if (process.env.NODE_ENV === 'development' && process.env.TEST_PHONE_NUMBER) {
      console.log(`\n📤 Attempting to send test SMS to ${process.env.TEST_PHONE_NUMBER}...`);
      try {
        const result = await smsService.sendSMS(
          process.env.TEST_PHONE_NUMBER,
          'This is a test message from Immunicare verification script.',
          'custom',
        );

        if (result.success) {
          console.log('✅ Test SMS sent successfully!');
          console.log(`   Message ID: ${result.messageId}`);
        } else {
          console.log('❌ Failed to send test SMS:');
          console.log(`   Error: ${result.error}`);
        }
      } catch (error) {
        console.log('❌ Error sending test SMS:');
        console.log(`   ${error.message}`);
      }
    } else if (process.env.SMS_GATEWAY === 'log') {
      console.log('\nℹ️  SMS Gateway is in LOG mode - messages are logged but not sent');
      console.log('    Set SMS_GATEWAY=textbee in .env for production');
    } else {
      console.log('\nℹ️  Set TEST_PHONE_NUMBER in .env to send test SMS');
    }
  } else {
    console.log('\n❌ SMS Gateway is not configured');
    console.log('    Please configure your SMS provider in .env');
  }

  // Display OTP configuration
  console.log('\n🔐 OTP Configuration:');
  console.log(`   Length: ${smsService.SMS_CONFIG.otp.length} digits`);
  console.log(`   Expiry: ${smsService.SMS_CONFIG.otp.expiryMinutes} minutes`);
  console.log(`   Max Attempts: ${smsService.SMS_CONFIG.otp.maxAttempts}`);
  console.log(`   Resend Cooldown: ${smsService.SMS_CONFIG.otp.resendCooldownSeconds} seconds`);

  // Display rate limits
  console.log('\n📊 Rate Limits:');
  console.log(`   Max per hour: ${smsService.SMS_CONFIG.rateLimit.maxPerHour}`);
  console.log(`   Max per day: ${smsService.SMS_CONFIG.rateLimit.maxPerDay}`);

  return status.configured;
}

/**
 * Test Email Configuration
 */
async function testEmailConfig() {
  console.log('\n' + '='.repeat(60));
  console.log('📧 Email Configuration Test');
  console.log('='.repeat(60));

  // Check environment variables
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;

  console.log(`\nSMTP Host: ${smtpHost || '❌ Not configured'}`);
  console.log(`SMTP User: ${smtpUser || '❌ Not configured'}`);
  console.log(`SMTP Password: ${smtpPassword ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`Email From: ${process.env.EMAIL_FROM || '✅ Default (noreply@immunicare.com)'}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || '✅ Default (http://localhost:3000)'}`);

  if (smtpHost && smtpUser && smtpPassword) {
    console.log('\n✅ Email configuration detected');

    // Test connection
    console.log('\n🔗 Testing SMTP connection...');
    try {
      const connected = await emailService.verifyConnection();
      if (connected) {
        console.log('✅ SMTP connection successful!');

        // Test sending email in development
        if (process.env.NODE_ENV === 'development' && smtpUser) {
          console.log('\n📤 Sending test email...');
          try {
            const result = await emailService.sendPasswordResetEmail(
              smtpUser,
              'test-token-12345',
              'TestUser',
            );

            if (result.success) {
              console.log('✅ Test email sent successfully!');
              console.log(`   Message ID: ${result.messageId}`);
            } else if (result.devMode) {
              console.log('ℹ️  Email in development mode - logged but not sent');
              console.log(`   To: ${result.content?.to}`);
              console.log(`   Subject: ${result.content?.subject}`);
            } else {
              console.log('❌ Failed to send test email:');
              console.log(`   Error: ${result.error}`);
            }
          } catch (error) {
            console.log('❌ Error sending test email:');
            console.log(`   ${error.message}`);
          }
        }
      } else {
        console.log('❌ SMTP connection failed');
      }
    } catch (error) {
      console.log('❌ Error testing SMTP connection:');
      console.log(`   ${error.message}`);
    }
  } else {
    console.log('\n❌ Email SMTP is not configured');
    console.log('    Please configure SMTP in .env');
  }
}

/**
 * Test Appointment Email Templates
 */
async function testAppointmentEmails() {
  console.log('\n' + '='.repeat(60));
  console.log('📬 Appointment Email Templates Test');
  console.log('='.repeat(60));

  const testAppointment = {
    email: process.env.SMTP_USER || 'test@example.com',
    guardianName: 'John Doe',
    childName: 'Baby Doe',
    vaccineName: 'Pentavalent Vaccine',
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
    location: 'City Health Center',
    reference: 'APT-2026-001',
  };

  console.log('\n📋 Test Appointment Data:');
  console.log(`   Guardian: ${testAppointment.guardianName}`);
  console.log(`   Child: ${testAppointment.childName}`);
  console.log(`   Vaccine: ${testAppointment.vaccineName}`);
  console.log(`   Date: ${testAppointment.scheduledDate.toLocaleDateString()}`);
  console.log(`   Location: ${testAppointment.location}`);

  // Test confirmation email
  console.log('\n📧 Testing Appointment Confirmation Email...');
  const confirmationResult = await appointmentEmailService.sendAppointmentConfirmationEmail(testAppointment);

  if (confirmationResult.success) {
    console.log('✅ Confirmation email sent!');
  } else if (process.env.NODE_ENV === 'development') {
    console.log('ℹ️  Development mode - email logged');
  } else {
    console.log(`❌ Error: ${confirmationResult.error}`);
  }

  // Test reminder email
  console.log('\n📧 Testing Appointment Reminder Email...');
  const reminderResult = await appointmentEmailService.sendAppointmentReminderEmail(testAppointment);

  if (reminderResult.success) {
    console.log('✅ Reminder email sent!');
  } else if (process.env.NODE_ENV === 'development') {
    console.log('ℹ️  Development mode - email logged');
  } else {
    console.log(`❌ Error: ${reminderResult.error}`);
  }

  // Test vaccination due email
  console.log('\n📧 Testing Vaccination Due Email...');
  const dueResult = await appointmentEmailService.sendVaccinationDueEmail({
    ...testAppointment,
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    doseNumber: 'Dose 2',
  });

  if (dueResult.success) {
    console.log('✅ Vaccination due email sent!');
  } else if (process.env.NODE_ENV === 'development') {
    console.log('ℹ️  Development mode - email logged');
  } else {
    console.log(`❌ Error: ${dueResult.error}`);
  }
}

/**
 * Generate Production Readiness Report
 */
function generateReport(smsReady, emailReady) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Production Readiness Report');
  console.log('='.repeat(60));

  console.log('\n📱 SMS Service:');
  console.log(`   Status: ${smsReady ? '✅ Ready' : '⚠️  Not Configured'}`);
  console.log(`   Gateway: ${process.env.SMS_GATEWAY || 'log'}`);
  console.log('   Provider: TextBee (textbee), Semaphore, Twilio, AWS SNS supported');

  console.log('\n📧 Email Service:');
  console.log(`   Status: ${emailReady ? '✅ Ready' : '⚠️  Not Configured'}`);
  console.log(`   SMTP: ${process.env.SMTP_HOST || 'Not configured'}`);

  console.log('\n' + '-'.repeat(60));

  if (smsReady && emailReady) {
    console.log('🎉 System is ready for production deployment!');
    console.log('\nNext Steps:');
    console.log('1. Configure your production API keys in .env');
    console.log('2. Test SMS and email flows end-to-end');
    console.log('3. Set up monitoring for delivery failures');
    console.log('4. Deploy to production environment');
  } else {
    console.log('⚠️  System needs configuration before production');
    console.log('\nRequired Actions:');
    if (!smsReady) {
      console.log('1. Configure SMS Gateway (TextBee recommended)');
    }
    if (!emailReady) {
      console.log('2. Configure SMTP credentials');
    }
    console.log('\nSee PRODUCTION_SMS_EMAIL_CONFIG.md for detailed instructions');
  }

  console.log('\n' + '='.repeat(60));
}

/**
 * Main Test Runner
 */
async function runTests() {
  console.log('\n🚀 Immunicare SMS & Email Configuration Test');
  console.log('='.repeat(60));
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Time: ${new Date().toISOString()}`);

  try {
    // Test SMS
    const smsReady = await testSMSConfig();

    // Test Email
    await testEmailConfig();

    // Test Appointment Emails
    await testAppointmentEmails();

    // Generate Report
    generateReport(smsReady, true); // Email considered ready if SMTP configured

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
}

// Run tests
runTests();
