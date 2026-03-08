/**
 * Appointment Email Service
 * Handles email notifications for appointments and vaccinations
 *
 * @module services/appointmentEmailService
 * @version 2.0
 * @since 2026-03-01
 */

const nodemailer = require('nodemailer');
const logger = require('../config/logger');

// Email transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
  timeout: 10000,
  connectionTimeout: 10000,
});

// Email from address
const EMAIL_FROM = process.env.EMAIL_FROM || 'Immunicare <notifications@immunicare.com>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Get HTML email template with common styling
 * @param {string} content - Main content HTML
 * @param {Object} options - Template options
 * @returns {string} Complete HTML email
 */
const getEmailTemplate = (content, options = {}) => {
  const { title = 'Immunicare Notification', preheader = '' } = options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
  <style>
    /* Reset styles */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }

    /* Responsive styles */
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
      .mobile-font { font-size: 16px !important; }
      .mobile-hide { display: none !important; }
      .mobile-center { text-align: center !important; }
    }

    /* Dark mode support */
    @media (prefers-color-scheme: dark) {
      .dark-bg { background-color: #1f2937 !important; }
      .dark-text { color: #e5e7eb !important; }
      .dark-border { border-color: #374151 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden;">${preheader}</div>

  <!-- Email Container -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td style="padding: 20px 0;">
        <table class="email-container dark-bg" role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 30px 40px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px 12px 0 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <img src="${FRONTEND_URL}/logo.png" alt="Immunicare" width="120" style="display: block; margin: 0 auto;" onerror="this.style.display='none'">
                    <h1 style="margin: 10px 0 0; color: #ffffff; font-size: 24px; font-weight: 700;">Immunicare</h1>
                    <p style="margin: 5px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Vaccination Management System</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td class="mobile-padding dark-bg dark-text" style="padding: 40px; background-color: #ffffff;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="dark-bg dark-border" style="padding: 30px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; border-radius: 0 0 12px 12px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center; color: #6b7280; font-size: 12px; line-height: 1.6;">
                    <p style="margin: 0 0 10px;">This is an automated message from Immunicare.</p>
                    <p style="margin: 0 0 10px;">Please do not reply to this email.</p>
                    <p style="margin: 20px 0 0;">
                      <a href="${FRONTEND_URL}" style="color: #10b981; text-decoration: none;">Visit Immunicare</a> |
                      <a href="${FRONTEND_URL}/privacy" style="color: #6b7280; text-decoration: none;">Privacy Policy</a>
                    </p>
                    <p style="margin: 20px 0 0; color: #9ca3af;">
                      © ${new Date().getFullYear()} Immunicare. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Send appointment confirmation email
 * @param {Object} appointment - Appointment details
 * @param {string} appointment.email - Guardian email
 * @param {string} appointment.guardianName - Guardian name
 * @param {string} appointment.childName - Child name
 * @param {string} appointment.vaccineName - Vaccine name
 * @param {Date} appointment.scheduledDate - Scheduled date
 * @param {string} appointment.location - Health center location
 * @param {string} appointment.reference - Appointment reference number
 * @returns {Promise<Object>} Send result
 */
const sendAppointmentConfirmationEmail = async (appointment) => {
  try {
    const {
      email,
      guardianName,
      childName,
      controlNumber,
      vaccineName,
      scheduledDate,
      location,
      reference,
    } = appointment;

    const formattedDate = new Date(scheduledDate).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const formattedTime = new Date(scheduledDate).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const content = `
      <h2 style="color: #111827; font-size: 22px; margin: 0 0 20px;">Appointment Confirmed!</h2>

      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        Hi ${guardianName},
      </p>

      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        Your appointment for <strong>${childName}</strong>'s vaccination has been confirmed.
      </p>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f0fdf4; border-radius: 8px; margin: 20px 0;">
        <tr>
          <td style="padding: 20px;">
            <h3 style="color: #065f46; font-size: 16px; margin: 0 0 15px;">Appointment Details</h3>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px; width: 120px;">Child:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${childName}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Control No:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${controlNumber || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Vaccine:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${vaccineName}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Date:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Time:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${formattedTime}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Location:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${location}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Reference:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">#${reference || 'N/A'}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">
          <strong>⚠️ Important:</strong> Please arrive 15 minutes early and bring your child's vaccination card.
        </p>
      </div>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 30px 0;">
        <tr>
          <td style="text-align: center;">
            <a href="${FRONTEND_URL}/guardian/appointments"
               style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                      color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              View My Appointments
            </a>
          </td>
        </tr>
      </table>

      <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
        Need to reschedule? <a href="${FRONTEND_URL}/guardian/appointments" style="color: #10b981; text-decoration: none;">Click here</a> to manage your appointments.
      </p>
    `;

    const htmlContent = getEmailTemplate(content, {
      title: 'Appointment Confirmed - Immunicare',
      preheader: `Your appointment for ${childName}'s vaccination is confirmed for ${formattedDate}`,
    });

    const textContent = `
Appointment Confirmed!

Hi ${guardianName},

Your appointment for ${childName}'s vaccination has been confirmed.

Appointment Details:
- Child: ${childName}
- Control No: ${controlNumber || 'N/A'}
- Vaccine: ${vaccineName}
- Date: ${formattedDate}
- Time: ${formattedTime}
- Location: ${location}
- Reference: #${reference || 'N/A'}

Important: Please arrive 15 minutes early and bring your child's vaccination card.

View your appointments: ${FRONTEND_URL}/guardian/appointments

© ${new Date().getFullYear()} Immunicare
    `;

    const result = await transporter.sendMail({
      from: EMAIL_FROM,
      to: email,
      subject: `Appointment Confirmed - ${childName}'s Vaccination`,
      html: htmlContent,
      text: textContent,
    });

    logger.info(`Appointment confirmation email sent to ${email}`);

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    logger.error('Error sending appointment confirmation email:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send appointment reminder email (24 hours before)
 * @param {Object} appointment - Appointment details
 * @returns {Promise<Object>} Send result
 */
const sendAppointmentReminderEmail = async (appointment) => {
  try {
    const {
      email,
      guardianName,
      childName,
      controlNumber,
      vaccineName,
      scheduledDate,
      location,
      reference: _reference,
    } = appointment;

    const formattedDate = new Date(scheduledDate).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    const formattedTime = new Date(scheduledDate).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const content = `
      <h2 style="color: #111827; font-size: 22px; margin: 0 0 20px;">Appointment Reminder</h2>

      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        Hi ${guardianName},
      </p>

      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        This is a friendly reminder that <strong>${childName}</strong> has a vaccination appointment tomorrow.
      </p>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #eff6ff; border-radius: 8px; margin: 20px 0;">
        <tr>
          <td style="padding: 20px;">
            <h3 style="color: #1e40af; font-size: 16px; margin: 0 0 15px;">Tomorrow's Appointment</h3>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px; width: 120px;">Child:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${childName}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Control No:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${controlNumber || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Vaccine:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${vaccineName}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Date:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Time:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${formattedTime}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Location:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${location}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">
          <strong>📋 Don't Forget:</strong> Please bring your child's vaccination card and arrive 15 minutes early.
        </p>
      </div>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 30px 0;">
        <tr>
          <td style="text-align: center;">
            <a href="${FRONTEND_URL}/guardian/appointments"
               style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                      color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              View Appointment Details
            </a>
          </td>
        </tr>
      </table>

      <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
        Questions? Contact your health center or reply to this email.
      </p>
    `;

    const htmlContent = getEmailTemplate(content, {
      title: 'Appointment Reminder - Immunicare',
      preheader: `Reminder: ${childName}'s vaccination appointment is tomorrow at ${formattedTime}`,
    });

    const textContent = `
Appointment Reminder

Hi ${guardianName},

This is a friendly reminder that ${childName} has a vaccination appointment tomorrow.

Appointment Details:
- Child: ${childName}
- Control No: ${controlNumber || 'N/A'}
- Vaccine: ${vaccineName}
- Date: ${formattedDate}
- Time: ${formattedTime}
- Location: ${location}

Don't Forget: Please bring your child's vaccination card and arrive 15 minutes early.

View appointment details: ${FRONTEND_URL}/guardian/appointments

© ${new Date().getFullYear()} Immunicare
    `;

    const result = await transporter.sendMail({
      from: EMAIL_FROM,
      to: email,
      subject: `Reminder: ${childName}'s Vaccination Appointment Tomorrow`,
      html: htmlContent,
      text: textContent,
    });

    logger.info(`Appointment reminder email sent to ${email}`);

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    logger.error('Error sending appointment reminder email:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send vaccination due reminder email
 * @param {Object} data - Vaccination due data
 * @returns {Promise<Object>} Send result
 */
const sendVaccinationDueEmail = async (data) => {
  try {
    const {
      email,
      guardianName,
      childName,
      controlNumber,
      vaccineName,
      dueDate,
      doseNumber,
    } = data;

    const formattedDueDate = new Date(dueDate).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    const content = `
      <h2 style="color: #111827; font-size: 22px; margin: 0 0 20px;">Vaccination Due</h2>

      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        Hi ${guardianName},
      </p>

      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        <strong>${childName}</strong> is due for their vaccination. Please schedule an appointment to ensure they stay protected.
      </p>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #fef3c7; border-radius: 8px; margin: 20px 0;">
        <tr>
          <td style="padding: 20px;">
            <h3 style="color: #92400e; font-size: 16px; margin: 0 0 15px;">Vaccination Due</h3>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px; width: 120px;">Child:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${childName}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Control No:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${controlNumber || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Vaccine:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${vaccineName}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Dose:</td>
                <td style="padding: 5px 0; color: #111827; font-size: 14px; font-weight: 600;">${doseNumber || 'Scheduled'}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #6b7280; font-size: 14px;">Due Date:</td>
                <td style="padding: 5px 0; color: #dc2626; font-size: 14px; font-weight: 600;">${formattedDueDate}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 30px 0;">
        <tr>
          <td style="text-align: center;">
            <a href="${FRONTEND_URL}/guardian/appointments/schedule"
               style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                      color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Schedule Appointment
            </a>
          </td>
        </tr>
      </table>

      <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
        Keeping vaccinations up to date is important for your child's health and protection against diseases.
      </p>
    `;

    const htmlContent = getEmailTemplate(content, {
      title: 'Vaccination Due - Immunicare',
      preheader: `${childName} is due for ${vaccineName} vaccination on ${formattedDueDate}`,
    });

    const textContent = `
Vaccination Due

Hi ${guardianName},

${childName} is due for their vaccination. Please schedule an appointment to ensure they stay protected.

Vaccination Details:
- Child: ${childName}
- Control No: ${controlNumber || 'N/A'}
- Vaccine: ${vaccineName}
- Dose: ${doseNumber || 'Scheduled'}
- Due Date: ${formattedDueDate}

Schedule appointment: ${FRONTEND_URL}/guardian/appointments/schedule

© ${new Date().getFullYear()} Immunicare
    `;

    const result = await transporter.sendMail({
      from: EMAIL_FROM,
      to: email,
      subject: `Vaccination Due: ${childName}'s ${vaccineName}`,
      html: htmlContent,
      text: textContent,
    });

    logger.info(`Vaccination due email sent to ${email}`);

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    logger.error('Error sending vaccination due email:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Verify email service connection
 * @returns {Promise<boolean>} Connection status
 */
const verifyConnection = async () => {
  try {
    await transporter.verify();
    logger.info('Email service connection verified');
    return true;
  } catch (error) {
    logger.error('Email service connection failed:', error.message);
    return false;
  }
};

module.exports = {
  sendAppointmentConfirmationEmail,
  sendAppointmentReminderEmail,
  sendVaccinationDueEmail,
  verifyConnection,
  EMAIL_FROM,
  FRONTEND_URL,
};
