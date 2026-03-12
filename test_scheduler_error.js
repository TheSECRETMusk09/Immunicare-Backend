#!/usr/bin/env node

/**
 * Test script to run the appointment reminder scheduler manually
 * and see the actual error details
 */

require('dotenv').config({ path: '.env.development' });

const scheduler = require('./jobs/scheduler');
const logger = require('./config/logger');

async function testScheduler() {
  logger.info('=== Starting manual appointment reminders test ===');

  try {
    logger.debug('Calling sendAppointmentReminders function...');
    await scheduler.sendAppointmentReminders();
    logger.info('=== Scheduler test completed successfully ===');
  } catch (error) {
    logger.error('=== Scheduler test failed ===');
    logger.error('Error sending appointment reminders:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall
    });
  }
}

// Run the test
testScheduler().catch(error => {
  logger.error('=== Test execution failed ===');
  logger.error('Unexpected error:', {
    message: error.message,
    stack: error.stack
  });
});
