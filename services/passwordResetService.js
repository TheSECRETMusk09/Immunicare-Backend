/**
 * Password reset flow helpers.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const emailService = require('./emailService');
const passwordHistoryService = require('./passwordHistoryService');
const securityEventService = require('./securityEventService');

// Token configuration
const RESET_TOKEN_EXPIRATION = 60 * 60 * 1000; // 1 hour in milliseconds
const VERIFICATION_TOKEN_EXPIRATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Generate a secure random token
 * @param {number} bytes - Number of bytes for token (default: 32)
 * @returns {string} Hex-encoded token
 */
const generateToken = (bytes = 32) => {
  return crypto.randomBytes(bytes).toString('hex');
};

/**
 * Hash a token for storage
 * @param {string} token - Plain token
 * @returns {string} SHA-256 hash
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Create a password reset token for a user
 * @param {number} userId - User ID
 * @param {string} email - User email
 * @param {string} ipAddress - IP address of request
 * @param {string} userAgent - Browser user agent
 * @returns {Promise<string>} The plain reset token
 */
const createPasswordResetToken = async (userId, email, ipAddress, userAgent) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Generate token
    const token = generateToken();
    const hashedToken = hashToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRATION);

    // Invalidate any existing tokens for this user
    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );

    // Store new token
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, hashedToken, expiresAt, ipAddress, userAgent]
    );

    await client.query('COMMIT');

    // Log the event
    await securityEventService.logEvent({
      userId,
      eventType: 'PASSWORD_RESET_REQUESTED',
      severity: 'INFO',
      ipAddress,
      userAgent,
      details: { email: email.substring(0, 3) + '***' }
    });

    return token;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating password reset token:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Request password reset for a user
 * @param {string} email - User email
 * @param {string} ipAddress - IP address of request
 * @param {string} userAgent - Browser user agent
 * @returns {Promise<Object>} Result with success status
 */
const requestPasswordReset = async (email, ipAddress, userAgent) => {
  try {
    // Find user by email
    const userResult = await pool.query(
      'SELECT id, username, email FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    );

    // Always return success to prevent email enumeration
    if (userResult.rows.length === 0) {
      return {
        success: true,
        message: 'If this email exists, a password reset link has been sent'
      };
    }

    const user = userResult.rows[0];

    // Create reset token
    const token = await createPasswordResetToken(user.id, user.email, ipAddress, userAgent);

    // Send reset email
    try {
      await emailService.sendPasswordResetEmail(user.email, token, user.username);
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError);
      // In development, log the link
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[DEV] Password reset link: ${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`
        );
      }
    }

    return {
      success: true,
      message: 'If this email exists, a password reset link has been sent'
    };
  } catch (error) {
    console.error('Error requesting password reset:', error);
    throw error;
  }
};

/**
 * Reset password using token
 * @param {string} token - Reset token
 * @param {string} newPassword - New password
 * @param {string} ipAddress - IP address of request
 * @param {string} userAgent - Browser user agent
 * @returns {Promise<Object>} Result with success status
 */
const resetPassword = async (token, newPassword, ipAddress, userAgent) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const hashedToken = hashToken(token);

    // Find valid token
    const tokenResult = await client.query(
      `SELECT prt.*, u.id as user_id, u.username, u.email, u.password_hash
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token = $1
       AND prt.expires_at > NOW()
       AND prt.used_at IS NULL`,
      [hashedToken]
    );

    if (tokenResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Invalid or expired reset token',
        code: 'INVALID_TOKEN'
      };
    }

    const resetRecord = tokenResult.rows[0];
    const userId = resetRecord.user_id;

    // Check password strength
    const passwordValidation = require('../utils/validation').validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Password does not meet requirements',
        code: 'WEAK_PASSWORD',
        details: passwordValidation.errors
      };
    }

    // Check password history
    const historyValidation = await passwordHistoryService.validatePasswordAgainstHistory(
      userId,
      newPassword
    );
    if (!historyValidation.isValid) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: historyValidation.error,
        code: 'PASSWORD_IN_HISTORY'
      };
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update user password
    await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      newPasswordHash,
      userId
    ]);

    // Add old password to history
    await passwordHistoryService.addToPasswordHistory(userId, resetRecord.password_hash);

    // Add new password to history
    await passwordHistoryService.addToPasswordHistory(userId, newPasswordHash);

    // Mark token as used
    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [
      resetRecord.id
    ]);

    // Invalidate all refresh tokens for this user
    const refreshTokenService = require('./refreshTokenService');
    await refreshTokenService.revokeAllUserTokens(userId);

    await client.query('COMMIT');

    // Log the event
    await securityEventService.logEvent({
      userId,
      eventType: 'PASSWORD_RESET_COMPLETED',
      severity: 'INFO',
      ipAddress,
      userAgent,
      details: { timestamp: new Date().toISOString() }
    });

    // Send confirmation email
    try {
      await emailService.sendPasswordResetConfirmationEmail(
        resetRecord.email,
        resetRecord.username,
        ipAddress,
        new Date().toLocaleString()
      );
    } catch (emailError) {
      console.error('Failed to send password reset confirmation:', emailError);
    }

    return {
      success: true,
      message: 'Password reset successfully'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error resetting password:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Create email verification token for a user
 * @param {number} userId - User ID
 * @param {string} ipAddress - IP address of request
 * @param {string} userAgent - Browser user agent
 * @returns {Promise<string>} The plain verification token
 */
const createEmailVerificationToken = async (userId, ipAddress, userAgent) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Generate token
    const token = generateToken();
    const hashedToken = hashToken(token);
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRATION);

    // Invalidate any existing tokens
    await client.query(
      'UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [userId]
    );

    // Store new token
    await client.query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, hashedToken, expiresAt, ipAddress, userAgent]
    );

    await client.query('COMMIT');

    return token;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating email verification token:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Verify email using token
 * @param {string} token - Verification token
 * @returns {Promise<Object>} Result with success status
 */
const verifyEmail = async (token) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const hashedToken = hashToken(token);

    // Find valid token
    const tokenResult = await client.query(
      `SELECT * FROM email_verification_tokens
       WHERE token = $1
       AND expires_at > NOW()
       AND used_at IS NULL`,
      [hashedToken]
    );

    if (tokenResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Invalid or expired verification token',
        code: 'INVALID_TOKEN'
      };
    }

    const verificationRecord = tokenResult.rows[0];
    const userId = verificationRecord.user_id;

    // Activate user
    await client.query('UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1', [
      userId
    ]);

    // Mark token as used
    await client.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [
      verificationRecord.id
    ]);

    await client.query('COMMIT');

    // Log the event
    await securityEventService.logEvent({
      userId,
      eventType: 'EMAIL_VERIFIED',
      severity: 'INFO',
      details: { timestamp: new Date().toISOString() }
    });

    return {
      success: true,
      message: 'Email verified successfully'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error verifying email:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Create required database tables
 */
const createTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
    `);

    console.log('Password reset and email verification tables created/verified');
    return true;
  } catch (error) {
    console.error('Error creating password reset tables:', error);
    throw error;
  }
};

/**
 * Clean up expired tokens
 */
const cleanupExpiredTokens = async () => {
  try {
    const passwordResetResult = await pool.query(
      'DELETE FROM password_reset_tokens WHERE expires_at < NOW()'
    );

    const emailVerificationResult = await pool.query(
      'DELETE FROM email_verification_tokens WHERE expires_at < NOW()'
    );

    console.log(`Cleaned up ${passwordResetResult.rowCount} expired password reset tokens`);
    console.log(`Cleaned up ${emailVerificationResult.rowCount} expired email verification tokens`);

    return {
      passwordResetTokens: passwordResetResult.rowCount,
      emailVerificationTokens: emailVerificationResult.rowCount
    };
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error);
    throw error;
  }
};

module.exports = {
  generateToken,
  hashToken,
  createPasswordResetToken,
  requestPasswordReset,
  resetPassword,
  createEmailVerificationToken,
  verifyEmail,
  createTables,
  cleanupExpiredTokens,
  RESET_TOKEN_EXPIRATION,
  VERIFICATION_TOKEN_EXPIRATION
};
