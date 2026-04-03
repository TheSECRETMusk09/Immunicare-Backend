const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../config/logger');
const db = require('../db');
const { normalizeRole, CANONICAL_ROLES, getRolePermissions } = require('../middleware/rbac');

const FATAL_DB_CONFIG_ERROR_CODES = new Set([
  '28P01',
  '28000',
  '3D000',
  '3F000',
  '42501',
]);

const isFatalDbConfigError = (code) => FATAL_DB_CONFIG_ERROR_CODES.has(code);
let refreshTokensPersistenceDisabled = false;
const allowRuntimeSchemaMutations =
  String(process.env.ALLOW_RUNTIME_SCHEMA_MUTATIONS || 'false').toLowerCase() === 'true';

const BARANGAY_SCOPE = Object.freeze({
  barangay_code: 'SAN_NICOLAS_PASIG',
  barangay_name: 'Barangay San Nicolas, Pasig City',
});

const resolveCanonicalRole = (role) => {
  const normalized = normalizeRole(role);
  return normalized || CANONICAL_ROLES.GUARDIAN;
};

// Token configuration
const ACCESS_TOKEN_EXPIRATION = process.env.JWT_ACCESS_EXPIRATION || '15m';
const REFRESH_TOKEN_EXPIRATION = process.env.JWT_REFRESH_EXPIRATION || '7d';

/**
 * Generate access token
 */
const generateAccessToken = (user) => {
  const canonicalRole = resolveCanonicalRole(user.role);

  return jwt.sign(
    {
      id: user.id,
      username: user.username || null,
      email: user.email || user.username || null,
      role: canonicalRole,
      role_type: canonicalRole,
      runtime_role: canonicalRole,
      legacy_role: user.role,
      clinic_id: user.clinic_id,
      facility_id: user.facility_id || user.clinic_id || null,
      guardian_id: user.guardian_id || null,
      permissions: getRolePermissions(canonicalRole),
      ...BARANGAY_SCOPE,
      type: 'access',
    },
    process.env.JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRATION,
      issuer: 'immunicare-system',
      audience: 'immunicare-users',
    },
  );
};

/**
 * Generate refresh token
 */
const generateRefreshToken = (user) => {
  const canonicalRole = resolveCanonicalRole(user.role);

  return jwt.sign(
    {
      id: user.id,
      email: user.email || user.username || null,
      role: canonicalRole,
      role_type: canonicalRole,
      runtime_role: canonicalRole,
      legacy_role: user.role,
      clinic_id: user.clinic_id || null,
      guardian_id: user.guardian_id || null,
      ...BARANGAY_SCOPE,
      type: 'refresh',
    },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: REFRESH_TOKEN_EXPIRATION,
      jwtid: crypto.randomBytes(16).toString('hex'), // Unique token ID
    },
  );
};

/**
 * Decode refresh token to get expiration
 */
const decodeRefreshToken = (token) => {
  try {
    // Decode without verification to get expiration
    const decoded = jwt.decode(token);
    return decoded;
  } catch {
    return null;
  }
};

/**
 * Store refresh token in database
 */
const storeRefreshToken = async (userId, refreshToken, userAgent, ipAddress) => {
  if (refreshTokensPersistenceDisabled) {
    return null;
  }

  try {
    // Decode token to get expiration
    const decoded = decodeRefreshToken(refreshToken);
    let expiresAt;

    if (decoded && decoded.exp) {
      // Convert Unix timestamp to PostgreSQL timestamp
      expiresAt = new Date(decoded.exp * 1000).toISOString();
    } else {
      // Fallback to default 7 days
      expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    // First, check if a token with the same jti already exists
    const checkQuery = `
      SELECT id FROM refresh_tokens
      WHERE user_id = $1 AND token = $2
    `;
    const checkResult = await db.query(checkQuery, [userId, refreshToken]);

    if (checkResult.rows.length > 0) {
      // Token already exists, update it instead of inserting
      const updateQuery = `
        UPDATE refresh_tokens
        SET is_revoked = false,
            revoked_at = NULL,
            expires_at = $3,
            user_agent = $4,
            ip_address = $5,
            updated_at = NOW()
        WHERE user_id = $1 AND token = $2
        RETURNING id
      `;
      const result = await db.query(updateQuery, [
        userId,
        refreshToken,
        expiresAt,
        userAgent,
        ipAddress,
      ]);
      return result.rows[0].id;
    }

    // Insert new token
    const query = `
      INSERT INTO refresh_tokens (user_id, token, user_agent, ip_address, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    const result = await db.query(query, [userId, refreshToken, userAgent, ipAddress, expiresAt]);
    return result.rows[0].id;
  } catch (error) {
    if (isFatalDbConfigError(error?.code)) {
      refreshTokensPersistenceDisabled = true;
      logger.error('Disabling refresh token persistence due to DB authentication/configuration failure.', {
        code: error.code,
        message: error.message,
      });
      return null;
    }

    // If duplicate key, just ignore (token already exists)
    if (error.code === '23505') {
      logger.warn('Refresh token already exists, skipping insert');
      return null;
    }
    logger.error('Error storing refresh token:', error);
    throw error;
  }
};

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    // Ensure it's a refresh token
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.error('Refresh token verification error:', error);
    throw error;
  }
};

/**
 * Get refresh token from database
 */
const getRefreshToken = async (token) => {
  if (refreshTokensPersistenceDisabled) {
    return null;
  }

  try {
    // First try exact match
    let query = `
      SELECT rt.*, u.id, u.email, u.username, r.name as role, u.clinic_id
      FROM refresh_tokens rt
      JOIN users u ON rt.user_id = u.id
      JOIN roles r ON u.role_id = r.id
      WHERE rt.token = $1
        AND rt.is_revoked = false
        AND (rt.expires_at IS NULL OR rt.expires_at > NOW())
      LIMIT 1
    `;
    let result = await db.query(query, [token]);

    // If not found, try to find by user_id and recent token
    if (result.rows.length === 0) {
      // Try to decode token to get user id for fallback lookup
      const decoded = decodeRefreshToken(token);
      if (decoded && decoded.id) {
        // Look for any valid (non-revoked, non-expired) token for this user
        query = `
          SELECT rt.*, u.id, u.email, u.username, r.name as role, u.clinic_id
          FROM refresh_tokens rt
          JOIN users u ON rt.user_id = u.id
          JOIN roles r ON u.role_id = r.id
          WHERE rt.user_id = $1
            AND rt.is_revoked = false
            AND (rt.expires_at IS NULL OR rt.expires_at > NOW())
          ORDER BY rt.created_at DESC
          LIMIT 1
        `;
        result = await db.query(query, [decoded.id]);
      }
    }

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    if (isFatalDbConfigError(error?.code)) {
      refreshTokensPersistenceDisabled = true;
      logger.error('Disabling refresh token lookup due to DB authentication/configuration failure.', {
        code: error.code,
        message: error.message,
      });
      return null;
    }

    logger.error('Error getting refresh token:', error);
    throw error;
  }
};

/**
 * Revoke refresh token
 */
const revokeRefreshToken = async (token) => {
  if (refreshTokensPersistenceDisabled) {
    return false;
  }

  try {
    const query = `
      UPDATE refresh_tokens
      SET is_revoked = true, revoked_at = NOW()
      WHERE token = $1
    `;
    await db.query(query, [token]);
    return true;
  } catch (error) {
    if (isFatalDbConfigError(error?.code)) {
      refreshTokensPersistenceDisabled = true;
      logger.error('Disabling refresh token revoke due to DB authentication/configuration failure.', {
        code: error.code,
        message: error.message,
      });
      return false;
    }

    logger.error('Error revoking refresh token:', error);
    throw error;
  }
};

/**
 * Revoke all refresh tokens for a user
 */
const revokeAllUserTokens = async (userId) => {
  if (refreshTokensPersistenceDisabled) {
    return 0;
  }

  try {
    const query = `
      UPDATE refresh_tokens
      SET is_revoked = true, revoked_at = NOW()
      WHERE user_id = $1 AND is_revoked = false
    `;
    const result = await db.query(query, [userId]);
    return result.rowCount;
  } catch (error) {
    if (isFatalDbConfigError(error?.code)) {
      refreshTokensPersistenceDisabled = true;
      logger.error('Disabling bulk refresh token revoke due to DB authentication/configuration failure.', {
        code: error.code,
        message: error.message,
      });
      return 0;
    }

    logger.error('Error revoking all user tokens:', error);
    throw error;
  }
};

/**
 * Clean up expired refresh tokens
 */
const cleanupExpiredTokens = async () => {
  if (refreshTokensPersistenceDisabled) {
    return 0;
  }

  try {
    const query = `
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW()
    `;
    const result = await db.query(query);
    logger.info(`Cleaned up ${result.rowCount} expired refresh tokens`);
    return result.rowCount;
  } catch (error) {
    if (isFatalDbConfigError(error?.code)) {
      refreshTokensPersistenceDisabled = true;
      logger.error('Disabling refresh token cleanup due to DB authentication/configuration failure.', {
        code: error.code,
        message: error.message,
      });
      return 0;
    }

    logger.error('Error cleaning up expired tokens:', error);
    throw error;
  }
};

/**
 * Refresh access token
 */
const refreshAccessToken = async (refreshToken, userAgent, ipAddress) => {
  if (refreshTokensPersistenceDisabled) {
    throw new Error('Refresh token service unavailable due to database authentication/configuration failure');
  }

  let decoded;

  try {
    // First verify the JWT itself
    decoded = verifyRefreshToken(refreshToken);
  } catch (jwtError) {
    logger.error('JWT verification failed:', jwtError.message);

    // If JWT is expired, try to decode it to get user info anyway
    if (jwtError.name === 'TokenExpiredError') {
      try {
        decoded = decodeRefreshToken(refreshToken);
        if (!decoded || !decoded.id) {
          throw new Error('Refresh token expired and could not decode user info');
        }
        logger.info('JWT expired but decoded user info for refresh', { userId: decoded.id });
      } catch {
        throw new Error('Refresh token not found or expired');
      }
    } else {
      throw new Error('Invalid refresh token');
    }
  }

  // Get refresh token from database
  const tokenRecord = await getRefreshToken(refreshToken);

  if (!tokenRecord) {
    // If no record in DB but JWT is valid, try to create a new session
    if (decoded && decoded.id) {
      logger.info('Token not in DB but JWT valid, creating new session', { userId: decoded.id });

      // Verify user still exists and is active
      const userQuery = `
        SELECT u.id, u.email, u.username, r.name as role, u.clinic_id, u.facility_id, u.guardian_id, u.is_active
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1 AND u.is_active = true
      `;
      const userResult = await db.query(userQuery, [decoded.id]);

      if (userResult.rows.length === 0) {
        throw new Error('User not found or inactive');
      }

      const user = userResult.rows[0];

      // Generate new tokens
      const newAccessToken = generateAccessToken(user);
      const newRefreshToken = generateRefreshToken(user);

      // Store new refresh token
      await storeRefreshToken(user.id, newRefreshToken, userAgent, ipAddress);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          email: user.email || user.username || null,
          role: resolveCanonicalRole(user.role),
          legacy_role: user.role,
          clinic_id: user.clinic_id,
          facility_id: user.facility_id || user.clinic_id || null,
          permissions: getRolePermissions(resolveCanonicalRole(user.role)),
        },
      };
    }
    throw new Error('Refresh token not found or expired');
  }

  // Check if token is revoked
  if (tokenRecord.is_revoked) {
    throw new Error('Refresh token has been revoked');
  }

  // Verify user still exists and is active
  const userQuery = `
    SELECT u.id, u.email, u.username, r.name as role, u.clinic_id, u.facility_id, u.guardian_id, u.is_active
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.id = $1 AND u.is_active = true
  `;
  const userResult = await db.query(userQuery, [decoded.id]);

  if (userResult.rows.length === 0) {
    throw new Error('User not found or inactive');
  }

  const user = userResult.rows[0];

  // Generate new access token
  const newAccessToken = generateAccessToken(user);

  // Generate new refresh token (rotate)
  const newRefreshToken = generateRefreshToken(user);

  // Store new refresh token FIRST, then revoke old one (to prevent token loss)
  await storeRefreshToken(user.id, newRefreshToken, userAgent, ipAddress);

  // Revoke old token (but don't fail if this errors)
  try {
    await revokeRefreshToken(refreshToken);
  } catch (revokeError) {
    logger.warn('Failed to revoke old refresh token:', revokeError.message);
  }

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      email: user.email || user.username || null,
      role: resolveCanonicalRole(user.role),
      legacy_role: user.role,
      clinic_id: user.clinic_id,
      facility_id: user.facility_id || user.clinic_id || null,
      permissions: getRolePermissions(resolveCanonicalRole(user.role)),
    },
  };
};

/**
 * Create refresh tokens table if it doesn't exist
 */
const createRefreshTokensTable = async () => {
  if (refreshTokensPersistenceDisabled) {
    return false;
  }

  try {
    const existingTableResult = await db.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'refresh_tokens') AS exists",
    );

    if (existingTableResult.rows[0]?.exists) {
      logger.info('Refresh tokens table already present; skipping runtime schema mutation.');
      return true;
    }

    if (!allowRuntimeSchemaMutations) {
      logger.error(
        'Refresh tokens table is missing. Run the database migrations before starting the application or set ALLOW_RUNTIME_SCHEMA_MUTATIONS=true for one-time legacy bootstrap.',
      );
      return false;
    }

    const query = `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        user_agent TEXT,
        ip_address VARCHAR(45),
        is_revoked BOOLEAN DEFAULT false,
        revoked_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, token)
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

      -- Backward-compatible schema healing for existing environments.
      -- Older deployments used VARCHAR(500), which is too short for current JWT payload lengths.
      ALTER TABLE refresh_tokens
      ALTER COLUMN token TYPE TEXT;

      CREATE OR REPLACE FUNCTION update_refresh_token_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trigger_update_refresh_token_updated_at ON refresh_tokens;
      CREATE TRIGGER trigger_update_refresh_token_updated_at
        BEFORE UPDATE ON refresh_tokens
        FOR EACH ROW
        EXECUTE FUNCTION update_refresh_token_updated_at();
    `;

    await db.query(query);
    logger.info('Refresh tokens table created/verified');
    return true;
  } catch (error) {
    if (isFatalDbConfigError(error?.code)) {
      refreshTokensPersistenceDisabled = true;
      logger.error('Disabling refresh tokens table initialization due to DB authentication/configuration failure.', {
        code: error.code,
        message: error.message,
      });
      return false;
    }

    logger.error('Error creating refresh tokens table:', error);
    throw error;
  }
};

if (process.env.NODE_ENV !== 'test') {
  createRefreshTokensTable().catch((error) => {
    logger.error('Failed to initialize refresh tokens table:', error);
  });

  // Schedule periodic cleanup of expired tokens (every hour)
  setInterval(
    () => {
      cleanupExpiredTokens();
    },
    60 * 60 * 1000,
  );
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  verifyRefreshToken,
  getRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  cleanupExpiredTokens,
  refreshAccessToken,
  createRefreshTokensTable,
};
