const pool = require('../db');
const NotificationService = require('./notificationService');
const logger = require('../config/logger');

// Vaccination schedule based on standard infant immunization chart
const VACCINATION_SCHEDULE = [
  {
    vaccine: 'BCG',
    dose: 1,
    ageWeeks: 0,
    ageMonths: 0,
    description: 'BCG vaccine for tuberculosis prevention',
  },
  {
    vaccine: 'Hep B',
    dose: 1,
    ageWeeks: 0,
    ageMonths: 0,
    description: 'Hepatitis B birth dose',
  },
  {
    vaccine: 'Hep B',
    dose: 2,
    ageWeeks: 4,
    ageMonths: 1,
    description: 'Second dose of Hepatitis B vaccine',
  },
  {
    vaccine: 'Pentavalent (DPT-HepB-Hib)',
    dose: 1,
    ageWeeks: 6,
    ageMonths: 1.5,
    description: 'First dose of Pentavalent vaccine',
  },
  {
    vaccine: 'OPV (Oral Polio)',
    dose: 1,
    ageWeeks: 6,
    ageMonths: 1.5,
    description: 'First dose of Oral Polio vaccine',
  },
  {
    vaccine: 'PCV (Pneumococcal)',
    dose: 1,
    ageWeeks: 6,
    ageMonths: 1.5,
    description: 'First dose of Pneumococcal Conjugate vaccine',
  },
  {
    vaccine: 'Pentavalent (DPT-HepB-Hib)',
    dose: 2,
    ageWeeks: 10,
    ageMonths: 2.5,
    description: 'Second dose of Pentavalent vaccine',
  },
  {
    vaccine: 'OPV (Oral Polio)',
    dose: 2,
    ageWeeks: 10,
    ageMonths: 2.5,
    description: 'Second dose of Oral Polio vaccine',
  },
  {
    vaccine: 'PCV (Pneumococcal)',
    dose: 2,
    ageWeeks: 10,
    ageMonths: 2.5,
    description: 'Second dose of Pneumococcal Conjugate vaccine',
  },
  {
    vaccine: 'Pentavalent (DPT-HepB-Hib)',
    dose: 3,
    ageWeeks: 14,
    ageMonths: 3.5,
    description: 'Third dose of Pentavalent vaccine',
  },
  {
    vaccine: 'OPV (Oral Polio)',
    dose: 3,
    ageWeeks: 14,
    ageMonths: 3.5,
    description: 'Third dose of Oral Polio vaccine',
  },
  {
    vaccine: 'PCV (Pneumococcal)',
    dose: 3,
    ageWeeks: 14,
    ageMonths: 3.5,
    description: 'Third dose of Pneumococcal Conjugate vaccine',
  },
  {
    vaccine: 'IPV (Inactivated Polio)',
    dose: 1,
    ageWeeks: 14,
    ageMonths: 3.5,
    description: 'First dose of Inactivated Polio vaccine',
  },
  {
    vaccine: 'MMR (Measles, Mumps, Rubella)',
    dose: 1,
    ageWeeks: 36,
    ageMonths: 9,
    description: 'First dose of MMR vaccine',
  },
  {
    vaccine: 'IPV (Inactivated Polio)',
    dose: 2,
    ageWeeks: 36,
    ageMonths: 9,
    description: 'Second dose of Inactivated Polio vaccine',
  },
  {
    vaccine: 'MMR (Measles, Mumps, Rubella)',
    dose: 2,
    ageWeeks: 48,
    ageMonths: 12,
    description: 'Second dose of MMR vaccine',
  },
];

class VaccinationReminderService {
  constructor() {
    this.notificationService = new NotificationService();
  }

  // Calculate next due date based on birth date and vaccine schedule
  calculateNextVaccineDate(birthDate, vaccine, dose) {
    const schedule = VACCINATION_SCHEDULE.find((v) => v.vaccine === vaccine && v.dose === dose);

    if (!schedule) {
      throw new Error(`Invalid vaccine ${vaccine} or dose ${dose}`);
    }

    const dueDate = new Date(birthDate);

    if (schedule.ageWeeks > 0) {
      dueDate.setDate(dueDate.getDate() + schedule.ageWeeks * 7);
    }
    if (schedule.ageMonths > 0) {
      dueDate.setMonth(dueDate.getMonth() + schedule.ageMonths);
    }

    return dueDate;
  }

  // Get next scheduled vaccine for a patient
  async getNextScheduledVaccine(patientId) {
    try {
      // Get patient information
      const patientResult = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);

      if (patientResult.rows.length === 0) {
        throw new Error(`Patient not found with id ${patientId}`);
      }

      const patient = patientResult.rows[0];

      // Get all completed immunization records for the patient
      const immunizationResult = await pool.query(
        `SELECT * FROM immunization_records
         WHERE patient_id = $1 AND is_active = true
         ORDER BY dose_no ASC`,
        [patientId],
      );

      const completedVaccines = immunizationResult.rows.reduce((acc, record) => {
        const vaccineKey = record.vaccine_id;
        if (!acc[vaccineKey] || record.dose_no > acc[vaccineKey]) {
          acc[vaccineKey] = record.dose_no;
        }
        return acc;
      }, {});

      // Get vaccine details
      const vaccinesResult = await pool.query('SELECT * FROM vaccines');
      const vaccines = vaccinesResult.rows;

      // Find next vaccine to administer
      for (const schedule of VACCINATION_SCHEDULE) {
        // Find the vaccine in our database
        const vaccine = vaccines.find((v) =>
          v.name.toLowerCase().includes(schedule.vaccine.toLowerCase()),
        );

        if (vaccine) {
          const lastDose = completedVaccines[vaccine.id] || 0;

          if (lastDose < schedule.dose) {
            const dueDate = this.calculateNextVaccineDate(
              patient.dob,
              schedule.vaccine,
              schedule.dose,
            );

            return {
              vaccine: schedule.vaccine,
              dose: schedule.dose,
              dueDate,
              description: schedule.description,
              vaccineId: vaccine.id,
            };
          }
        }
      }

      return null; // All vaccines completed
    } catch (error) {
      logger.error('Error getting next scheduled vaccine:', error);
      throw error;
    }
  }

  // Generate reminder message
  generateReminderMessage(patient, vaccineInfo) {
    const patientName = `${patient.first_name} ${patient.last_name}`;
    const dueDate = new Date(vaccineInfo.dueDate);
    const dueDateStr = dueDate.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return {
      subject: `Vaccination Reminder for ${patientName}`,
      message: `This is a reminder that ${patientName} is due for the ${vaccineInfo.vaccine} (Dose ${vaccineInfo.dose}) on ${dueDateStr}. Please ensure your child receives this important vaccination to maintain their immunization schedule.`,
    };
  }

  // Send reminder to guardian
  async sendVaccineReminder(guardian, patient, vaccineInfo) {
    try {
      const reminder = this.generateReminderMessage(patient, vaccineInfo);

      // Send notification
      await this.notificationService.sendNotification({
        notification_type: 'vaccination_reminder',
        target_type: 'guardian',
        target_id: guardian.id,
        recipient_name: guardian.name,
        recipient_email: guardian.email,
        recipient_phone: guardian.phone,
        channel: 'both', // Send both email and SMS
        priority: 'high',
        subject: reminder.subject,
        message: reminder.message,
        template_data: {
          patient_name: `${patient.first_name} ${patient.last_name}`,
          vaccine: vaccineInfo.vaccine,
          dose: vaccineInfo.dose,
          due_date: vaccineInfo.dueDate.toLocaleDateString('en-PH'),
          description: vaccineInfo.description,
        },
      });

      logger.info(`Reminder sent to guardian ${guardian.id} for patient ${patient.id}`);
      return { success: true };
    } catch (error) {
      logger.error('Error sending vaccine reminder:', error);
      throw error;
    }
  }

  // Check and send reminders for all patients
  async checkAndSendReminders(daysInAdvance = 7) {
    try {
      logger.info('Checking for upcoming vaccination reminders...');

      // Get all active patients with guardians
      const patientsResult = await pool.query(`
        SELECT p.*, g.*
        FROM patients p
        JOIN guardians g ON p.guardian_id = g.id
        WHERE p.is_active = true AND g.is_active = true
      `);

      const patients = patientsResult.rows;

      const sentReminders = [];

      for (const patient of patients) {
        try {
          const nextVaccine = await this.getNextScheduledVaccine(patient.id);

          if (nextVaccine) {
            const dueDate = new Date(nextVaccine.dueDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const reminderDate = new Date(dueDate);
            reminderDate.setDate(dueDate.getDate() - daysInAdvance);
            reminderDate.setHours(0, 0, 0, 0);

            if (reminderDate.getTime() === today.getTime()) {
              // Send reminder
              await this.sendVaccineReminder(patient, patient, nextVaccine);
              sentReminders.push({
                patientId: patient.id,
                patientName: `${patient.first_name} ${patient.last_name}`,
                vaccine: nextVaccine.vaccine,
                dose: nextVaccine.dose,
                dueDate: nextVaccine.dueDate,
              });
            }
          }
        } catch (error) {
          logger.error(`Error processing patient ${patient.id}:`, error);
        }
      }

      logger.info(`Sent ${sentReminders.length} vaccination reminders`);
      return sentReminders;
    } catch (error) {
      logger.error('Error checking and sending reminders:', error);
      throw error;
    }
  }

  // Send notification when first vaccine is administered
  async sendFirstVaccineNotification(patientId, vaccineId, adminDate) {
    try {
      // Get patient and guardian information
      const patientResult = await pool.query(
        `
        SELECT p.*, g.*
        FROM patients p
        JOIN guardians g ON p.guardian_id = g.id
        WHERE p.id = $1
      `,
        [patientId],
      );

      if (patientResult.rows.length === 0) {
        throw new Error(`Patient not found with id ${patientId}`);
      }

      const patient = patientResult.rows[0];

      // Get vaccine information
      const vaccineResult = await pool.query('SELECT * FROM vaccines WHERE id = $1', [vaccineId]);

      if (vaccineResult.rows.length === 0) {
        throw new Error(`Vaccine not found with id ${vaccineId}`);
      }

      const vaccine = vaccineResult.rows[0];

      // Get next vaccine
      const nextVaccine = await this.getNextScheduledVaccine(patientId);

      // Generate notification
      const notificationData = {
        notification_type: 'vaccine_administered',
        target_type: 'guardian',
        target_id: patient.guardian_id,
        recipient_name: patient.name,
        recipient_email: patient.email,
        recipient_phone: patient.phone,
        channel: 'both',
        priority: 'normal',
        subject: `Vaccine Administered - ${patient.first_name} ${patient.last_name}`,
        message: `Your child ${patient.first_name} ${patient.last_name} has received the ${vaccine.name} vaccine.`,
        template_data: {
          patient_name: `${patient.first_name} ${patient.last_name}`,
          vaccine: vaccine.name,
          admin_date: new Date(adminDate).toLocaleDateString('en-PH'),
          next_vaccine: nextVaccine ? nextVaccine.vaccine : null,
          next_dose: nextVaccine ? nextVaccine.dose : null,
          next_due_date: nextVaccine ? nextVaccine.dueDate.toLocaleDateString('en-PH') : null,
        },
      };

      if (nextVaccine) {
        notificationData.message += ` The next scheduled vaccine is ${nextVaccine.vaccine} (Dose ${nextVaccine.dose}) on ${nextVaccine.dueDate.toLocaleDateString('en-PH')}.`;
      }

      await this.notificationService.sendNotification(notificationData);

      logger.info(`Notification sent for first vaccine to guardian ${patient.guardian_id}`);
      return { success: true };
    } catch (error) {
      logger.error('Error sending first vaccine notification:', error);
      throw error;
    }
  }

  // Get all patients with upcoming vaccines
  async getPatientsWithUpcomingVaccines(days = 30) {
    try {
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + days);

      const patientsResult = await pool.query(`
        SELECT p.*, g.*
        FROM patients p
        JOIN guardians g ON p.guardian_id = g.id
        WHERE p.is_active = true AND g.is_active = true
      `);

      const patients = patientsResult.rows;
      const upcomingVaccines = [];

      for (const patient of patients) {
        try {
          const nextVaccine = await this.getNextScheduledVaccine(patient.id);

          if (nextVaccine) {
            const dueDate = new Date(nextVaccine.dueDate);

            if (dueDate >= today && dueDate <= futureDate) {
              upcomingVaccines.push({
                patientId: patient.id,
                patientName: `${patient.first_name} ${patient.last_name}`,
                guardianName: patient.name,
                guardianPhone: patient.phone,
                guardianEmail: patient.email,
                vaccine: nextVaccine.vaccine,
                dose: nextVaccine.dose,
                dueDate: nextVaccine.dueDate,
                description: nextVaccine.description,
              });
            }
          }
        } catch (error) {
          logger.error(`Error checking patient ${patient.id}:`, error);
        }
      }

      return upcomingVaccines;
    } catch (error) {
      logger.error('Error getting patients with upcoming vaccines:', error);
      throw error;
    }
  }
}

module.exports = VaccinationReminderService;
