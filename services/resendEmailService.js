/**
 * Resend Email Service
 * Handles sending transactional emails using Resend API
 * API Key: re_AKwnFd6N_LjNQ3NDzjicCW18zddC2Bkk2
 */

const { Resend } = require('resend');
const logger = require('../config/logger');

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Email from address
const EMAIL_FROM = process.env.RESEND_EMAIL_FROM || 'Immunicare <onboarding@resend.dev>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Send email using Resend API
 * @param {Object} options - Email options
 */
const sendEmail = async (options) => {
  const { to, subject, html, text, cc, bcc, replyTo } = options;

  try {
    const data = await resend.emails.send({
      from: EMAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      html: html,
      text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for plain text
      cc: cc,
      bcc: bcc,
      reply_to: replyTo,
    });

    logger.info(`Resend email sent to ${to}: ${data.data?.id || 'success'}`);
    return {
      success: true,
      messageId: data.data?.id,
      data: data.data,
    };
  } catch (error) {
    logger.error(`Failed to send email to ${to}:`, error.message);

    // In development mode, log the email content instead of failing
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV EMAIL] To: ${to}`);
      logger.info(`[DEV EMAIL] Subject: ${subject}`);
      logger.info(`[DEV EMAIL] Content: ${text || html}`);
      return {
        success: true,
        devMode: true,
        content: { to, subject, text, html },
      };
    }

    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send email verification email
 * @param {string} email - Recipient email
 * @param {string} token - Verification token
 * @param {string} firstName - User's first name
 */
const sendEmailVerificationEmail = async (email, token, firstName) => {
  const verificationLink = `${FRONTEND_URL}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #0066cc; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .button { display: inline-block; padding: 12px 24px; background: #0066cc; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Verify Your Email</h1>
        </div>
        <div class="content">
          <p>Hi ${firstName},</p>
          <p>Thank you for registering with Immunicare. Please verify your email address to complete your registration.</p>
          <p style="text-align: center;">
            <a href="${verificationLink}" class="button">Verify Email Address</a>
          </p>
          <p>This link will expire in 24 hours. If you did not register for an Immunicare account, please ignore this email.</p>
          <p>If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${verificationLink}">${verificationLink}</a></p>
        </div>
        <div class="footer">
          <p>This is an automated message from Immunicare.</p>
          <p>© ${new Date().getFullYear()} Immunicare. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Hi ${firstName},

    Thank you for registering with Immunicare. Please verify your email address to complete your registration.

    Click the following link to verify your email:
    ${verificationLink}

    This link will expire in 24 hours. If you did not register for an Immunicare account, please ignore this email.
  `;

  return sendEmail({
    to: email,
    subject: 'Verify Your Email - Immunicare',
    html: htmlContent,
    text: textContent,
  });
};

/**
 * Send OTP code via email
 * @param {string} email - Recipient email
 * @param {string} otp - OTP code
 * @param {string} purpose - Purpose of the OTP (login, password_reset, etc.)
 */
const sendOTPEmail = async (email, otp, purpose = 'verification') => {
  const purposeText = {
    login: 'login',
    password_reset: 'password reset',
    phone_verification: 'phone verification',
    verification: 'account verification',
  };

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #0066cc; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .otp-code { font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #fff; border: 2px dashed #0066cc; margin: 20px 0; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Your OTP Code</h1>
        </div>
        <div class="content">
          <p>Your one-time password (OTP) for ${purposeText[purpose] || purpose} is:</p>
          <div class="otp-code">${otp}</div>
          <p>This code will expire in 10 minutes.</p>
          <div class="warning">
            <strong>⚠️ Security Notice:</strong> Do not share this code with anyone. Immunicare staff will never ask for your OTP code.
          </div>
        </div>
        <div class="footer">
          <p>This is an automated message from Immunicare.</p>
          <p>© ${new Date().getFullYear()} Immunicare. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Your one-time password (OTP) for ${purposeText[purpose] || purpose} is: ${otp}

    This code will expire in 10 minutes.

    ⚠️ Security Notice: Do not share this code with anyone. Immunicare staff will never ask for your OTP code.
  `;

  return sendEmail({
    to: email,
    subject: 'Your OTP Code - Immunicare',
    html: htmlContent,
    text: textContent,
  });
};

/**
 * Send password reset email
 * @param {string} email - Recipient email
 * @param {string} token - Reset token
 * @param {string} username - Username
 */
const sendPasswordResetEmail = async (email, token, username) => {
  const resetLink = `${FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc3545; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .button { display: inline-block; padding: 12px 24px; background: #dc3545; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Reset Request</h1>
        </div>
        <div class="content">
          <p>Hi ${username},</p>
          <p>We received a request to reset your password. Click the button below to create a new password.</p>
          <div class="warning">
            <strong>⚠️ Security Notice:</strong> This link will expire in 1 hour for your security. If you did not request this password reset, please ignore this email.
          </div>
          <p style="text-align: center;">
            <a href="${resetLink}" class="button">Reset Password</a>
          </p>
          <p>If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${resetLink}">${resetLink}</a></p>
        </div>
        <div class="footer">
          <p>This is an automated message from Immunicare.</p>
          <p>© ${new Date().getFullYear()} Immunicare. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Hi ${username},

    We received a request to reset your password. Click the following link to create a new password:
    ${resetLink}

    ⚠️ Security Notice: This link will expire in 1 hour for your security.

    If you did not request this password reset, please ignore this email.
  `;

  return sendEmail({
    to: email,
    subject: 'Password Reset Request - Immunicare',
    html: htmlContent,
    text: textContent,
  });
};

/**
 * Send password reset confirmation email
 * @param {string} email - Recipient email
 * @param {string} username - Username
 * @param {string} ipAddress - IP address of the request
 * @param {string} timestamp - Time of the password change
 */
const sendPasswordResetConfirmationEmail = async (email, username, ipAddress, timestamp) => {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #28a745; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .info-box { background: #e7f3ff; border: 1px solid #0066cc; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Changed Successfully</h1>
        </div>
        <div class="content">
          <p>Hi ${username},</p>
          <p>Your password has been changed successfully.</p>
          <div class="info-box">
            <strong>Change Details:</strong><br>
            Time: ${timestamp}<br>
            IP Address: ${ipAddress}
          </div>
          <div class="warning">
            <strong>⚠️ Didn't make this change?</strong> If you did not change your password, please contact our support team immediately and consider changing your password for other accounts.
          </div>
        </div>
        <div class="footer">
          <p>This is an automated message from Immunicare.</p>
          <p>© ${new Date().getFullYear()} Immunicare. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Hi ${username},

    Your password has been changed successfully.

    Change Details:
    Time: ${timestamp}
    IP Address: ${ipAddress}

    ⚠️ Didn't make this change? If you did not change your password, please contact our support team immediately.
  `;

  return sendEmail({
    to: email,
    subject: 'Password Changed Successfully - Immunicare',
    html: htmlContent,
    text: textContent,
  });
};

/**
 * Send appointment confirmation email
 * @param {string} email - Recipient email
 * @param {Object} appointment - Appointment details
 * @param {Object} infant - Infant details
 */
const sendAppointmentConfirmationEmail = async (email, appointment, infant) => {
  const appointmentDate = new Date(appointment.scheduled_date).toLocaleDateString('en-PH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const appointmentTime = appointment.scheduled_time || 'Not specified';

  const resolvedInfantControlNumber =
    infant.control_number || 'N/A';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #28a745; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .info-box { background: #e7f3ff; border: 1px solid #0066cc; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .checklist { background: #fff; border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 4px; }
        .checklist-item { margin: 5px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Appointment Confirmed!</h1>
        </div>
        <div class="content">
          <p>Your vaccination appointment has been confirmed.</p>
          <div class="info-box">
            <strong>Appointment Details:</strong><br>
            Date: ${appointmentDate}<br>
            Time: ${appointmentTime}<br>
            Location: San Nicolas Health Center
          </div>
          <div class="info-box">
            <strong>Child Information:</strong><br>
            Name: ${infant.first_name} ${infant.last_name}<br>
            Control Number: ${resolvedInfantControlNumber}
          </div>
          <p><strong>Please bring the following documents:</strong></p>
          <div class="checklist">
            <div class="checklist-item">☐ Birth certificate (original + photocopy)</div>
            <div class="checklist-item">☐ Parent/Guardian valid ID</div>
            <div class="checklist-item">☐ Vaccination record book (if any)</div>
            <div class="checklist-item">☐ PhilHealth membership card (if applicable)</div>
          </div>
        </div>
        <div class="footer">
          <p>This is an automated message from Immunicare.</p>
          <p>© ${new Date().getFullYear()} Immunicare. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Your vaccination appointment has been confirmed!

    Appointment Details:
    Date: ${appointmentDate}
    Time: ${appointmentTime}
    Location: San Nicolas Health Center

    Child Information:
    Name: ${infant.first_name} ${infant.last_name}
    Control Number: ${resolvedInfantControlNumber}

    Please bring the following documents:
    - Birth certificate (original + photocopy)
    - Parent/Guardian valid ID
    - Vaccination record book (if any)
    - PhilHealth membership card (if applicable)
  `;

  return sendEmail({
    to: email,
    subject: 'Appointment Confirmed - Immunicare',
    html: htmlContent,
    text: textContent,
  });
};

/**
 * Verify Resend API connection
 */
const verifyConnection = async () => {
  try {
    // Try to send a test email to verify connection
    await resend.emails.send({
      from: EMAIL_FROM,
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    });
    console.log('Resend API connection verified');
    return { success: true };
  } catch (error) {
    console.error('Resend API connection failed:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Get service configuration status
 */
const getConfigStatus = () => {
  return {
    configured: !!process.env.RESEND_API_KEY,
    apiKeyPrefix: process.env.RESEND_API_KEY
      ? process.env.RESEND_API_KEY.substring(0, 10) + '...'
      : null,
    fromEmail: EMAIL_FROM,
    provider: 'resend',
  };
};

module.exports = {
  sendEmail,
  sendEmailVerificationEmail,
  sendOTPEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmationEmail,
  sendAppointmentConfirmationEmail,
  verifyConnection,
  getConfigStatus,
  EMAIL_FROM,
  FRONTEND_URL,
};
