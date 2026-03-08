/**
 * Test script to verify Resend email service is working
 */
require('dotenv').config({ path: __dirname + '/.env' });

const resendEmailService = require('./services/resendEmailService');

async function testEmail() {
  console.log('Testing Resend Email Service...\n');

  // Check configuration status
  const config = resendEmailService.getConfigStatus();
  console.log('Configuration:');
  console.log(`  Provider: ${config.provider}`);
  console.log(`  Configured: ${config.configured}`);
  console.log(`  API Key: ${config.apiKeyPrefix}`);
  console.log(`  From Email: ${config.fromEmail}\n`);

  // Test sending an OTP email
  try {
    console.log('Sending test OTP email...');
    const result = await resendEmailService.sendOTPEmail(
      'test@example.com', // Replace with a real email to test
      '123456',
      'password_reset'
    );

    if (result.success) {
      console.log('✅ Email sent successfully!');
      console.log(`   Message ID: ${result.messageId || 'N/A'}`);
      if (result.devMode) {
        console.log('   (Dev mode - email logged)');
      }
    } else {
      console.log('❌ Failed to send email');
      console.log(`   Error: ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testEmail();
