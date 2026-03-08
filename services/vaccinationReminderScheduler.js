/**
 * Vaccination Reminder Scheduler Service
 *
 * This service runs periodically to check for upcoming vaccinations
 * and sends automatic reminders to guardians.
 *
 * Schedule: Runs daily at 8:00 AM to check for upcoming vaccines in the next 7 days
 */

const VaccinationReminderService = require('./vaccinationReminderService');
const logger = require('../config/logger');

class VaccinationReminderScheduler {
  constructor() {
    this.reminderService = new VaccinationReminderService();
    this.isRunning = false;
    this.intervalId = null;
  }

  /**
   * Start the scheduler
   * @param {number} intervalMinutes - How often to run the check (default: 1440 = 24 hours)
   * @param {number} reminderDaysInAdvance - Days in advance to send reminders (default: 7)
   */
  start(intervalMinutes = 1440, reminderDaysInAdvance = 7) {
    if (this.isRunning) {
      logger.warn('Vaccination reminder scheduler is already running');
      return;
    }

    logger.info('Starting vaccination reminder scheduler...');
    this.isRunning = true;
    this.reminderDaysInAdvance = reminderDaysInAdvance;

    // Run immediately on start
    this.runChecks().catch((err) => {
      logger.error('Error running initial vaccination reminder checks:', err);
    });

    // Schedule periodic runs
    this.intervalId = setInterval(
      async () => {
        try {
          await this.runChecks();
        } catch (err) {
          logger.error('Error in scheduled vaccination reminder check:', err);
        }
      },
      intervalMinutes * 60 * 1000
    );

    logger.info(
      `Vaccination reminder scheduler started. Will run every ${intervalMinutes} minutes`
    );
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Vaccination reminder scheduler stopped');
  }

  /**
   * Run the reminder checks
   */
  async runChecks() {
    const startTime = new Date();
    logger.info(`Starting vaccination reminder check at ${startTime.toISOString()}`);

    try {
      const reminders = await this.reminderService.checkAndSendReminders(
        this.reminderDaysInAdvance
      );

      const endTime = new Date();
      const duration = (endTime - startTime) / 1000;

      logger.info(
        `Vaccination reminder check completed in ${duration}s. Sent ${reminders.length} reminders.`
      );

      return {
        success: true,
        sentCount: reminders.length,
        duration: `${duration}s`,
        reminders
      };
    } catch (error) {
      logger.error('Error running vaccination reminder checks:', error);
      throw error;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMinutes: this.intervalId ? 'active' : 'stopped',
      reminderDaysInAdvance: this.reminderDaysInAdvance
    };
  }
}

// Export singleton instance
const scheduler = new VaccinationReminderScheduler();

// Auto-start scheduler if enabled in environment
if (process.env.AUTO_START_VACCINATION_REMINDERS === 'true') {
  const intervalMinutes = parseInt(process.env.VACCINATION_REMINDER_INTERVAL_MINUTES) || 1440;
  const reminderDays = parseInt(process.env.VACCINATION_REMINDER_DAYS_ADVANCE) || 7;

  scheduler.start(intervalMinutes, reminderDays);
}

module.exports = scheduler;
