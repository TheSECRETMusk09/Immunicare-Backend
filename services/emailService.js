/**
 * Transactional email helpers.
 */

const logger = require('../config/logger');
const emailConfig = require('../config/email');

// Email from address
const EMAIL_FROM = emailConfig.EMAIL_CONFIG.from.address;
const FRONTEND_URL = emailConfig.EMAIL_CONFIG.frontend.url;

/**
 * Send verification email with OTP code
 * @param {string} email - Recipient email
 * @param {string} code - Verification code
 */
const sendVerificationEmail = async (email, code) => {
  const html = `
    <h2>Immunicare Verification Code</h2>
    <p>Your verification code is:</p>
    <h1>${code}</h1>
    <p>This code will expire in 10 minutes.</p>
  `;

  await sendEmail(email, 'Email Verification', html);
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
 * Send welcome email to new guardian
 * @param {string} email - Recipient email
 * @param {string} name - Guardian name
 */
const sendWelcomeEmail = async (email, name) => {
  const loginLink = `${FRONTEND_URL}/login`;

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
          <h1>Welcome to Immunicare!</h1>
        </div>
        <div class="content">
          <p>Hi ${name},</p>
          <p>Your account has been successfully verified. Welcome to the Immunicare family!</p>
          <p>You can now log in to manage your child's vaccination schedule, book appointments, and track their growth.</p>
          <p style="text-align: center;">
            <a href="${loginLink}" class="button">Log In to Your Account</a>
          </p>
        </div>
        <div class="footer">
          <p>This is an automated message from Immunicare.</p>
          <p>© ${new Date().getFullYear()} Immunicare. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: 'Welcome to Immunicare!',
    html: htmlContent,
    text: `Welcome to Immunicare, ${name}! Your account has been verified. Log in at ${loginLink}`,
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
 * Send admin login notification
 * @param {string} email - Admin email
 * @param {string} username - Admin username
 * @param {string} ipAddress - IP address of login
 * @param {string} userAgent - Browser user agent
 */
const sendAdminLoginNotification = async (email, username, ipAddress, userAgent) => {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #6f42c1; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .info-box { background: #e7f3ff; border: 1px solid #0066cc; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Admin Login Alert</h1>
        </div>
        <div class="content">
          <p>Administrator login detected:</p>
          <div class="info-box">
            <strong>Username:</strong> ${username}<br>
            <strong>IP Address:</strong> ${ipAddress}<br>
            <strong>Browser:</strong> ${userAgent || 'Unknown'}<br>
            <strong>Time:</strong> ${new Date().toLocaleString()}
          </div>
          <div class="warning">
            <strong>⚠️ Security Notice:</strong> If you did not login to this account, please secure your account immediately by changing your password and reviewing recent activity.
          </div>
        </div>
        <div class="footer">
          <p>This is an automated security notification from Immunicare.</p>
          <p>© ${new Date().getFullYear()} Immunicare. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: '⚠️ Admin Login Detected - Immunicare',
    html: htmlContent,
  });
};

/**
 * Send failed login attempt notification
 * @param {string} email - User email
 * @param {string} username - Username
 * @param {string} ipAddress - IP address of attempt
 * @param {string} timestamp - Time of attempt
 */
const sendFailedLoginNotification = async (email, username, ipAddress, timestamp) => {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #fd7e14; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Failed Login Attempt</h1>
        </div>
        <div class="content">
          <p>Hi ${username},</p>
          <p>We detected a failed login attempt on your account:</p>
          <div class="warning">
            <strong>Details:</strong><br>
            Time: ${timestamp}<br>
            IP Address: ${ipAddress}<br>
            Status: Invalid password
          </div>
          <p>If this was you, you can ignore this message. If you don't recognize this attempt, please change your password immediately.</p>
        </div>
        <div class="footer">
          <p>This is an automated security notification from Immunicare.</p>
          <p>© ${new Date().getFullYear()} Immunicare. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: 'Failed Login Attempt Detected - Immunicare',
    html: htmlContent,
  });
};

/**
 * Core email sending function
 * @param {string|Object} to - Recipient email or options object
 * @param {string} [subject] - Email subject (if first arg is email)
 * @param {string} [html] - Email HTML content (if first arg is email)
 */
const sendEmail = async (to, subject, html) => {
  let options = {};
  if (typeof to === 'object' && to !== null && to.to) {
    options = to;
  } else {
    options = { to, subject, html };
  }

  const mailOptions = {
    from: EMAIL_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text || options.html.replace(/<[^>]*>/g, ''), // Strip HTML for plain text
  };

  try {
    const transporter = await emailConfig.getTransporter();
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent to ${options.to}: ${info.messageId}`);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    logger.error(`Failed to send email to ${options.to}:`, error);

    // In development, log the email content
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV EMAIL] To: ${options.to}`);
      logger.info(`[DEV EMAIL] Subject: ${options.subject}`);
      logger.info(`[DEV EMAIL] Content: ${options.text || options.html}`);
    }

    // Don't throw error in development if email fails
    if (process.env.NODE_ENV === 'development') {
      return {
        success: false,
        error: error.message,
        devMode: true,
        content: {
          to: options.to,
          subject: options.subject,
          text: options.text,
        },
      };
    }

    throw error;
  }
};

/**
 * Verify SMTP connection
 */
const verifyConnection = async () => {
  try {
    const transporter = await emailConfig.getTransporter();
    await transporter.verify();
    console.log('Email server connection verified');
    return true;
  } catch (error) {
    console.error('Email server connection failed:', error.message);
    return false;
  }
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmationEmail,
  sendAdminLoginNotification,
  sendFailedLoginNotification,
  verifyConnection,
  EMAIL_FROM,
  FRONTEND_URL,
};
