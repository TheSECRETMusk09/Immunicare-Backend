const pool = require('../db');
const logger = require('../config/logger');

/**
 * Encryption Service
 * Provides methods for encrypting and decrypting sensitive data using pgcrypto
 */

/**
 * Encrypt data using pgcrypto
 * @param {string} data - The data to encrypt
 * @param {string} keyName - The name of the encryption key to use
 * @returns {Promise<string>} The encrypted data
 */
const encryptData = async (data, keyName) => {
  try {
    if (!data || !keyName) {
      throw new Error('Data and keyName are required for encryption');
    }

    const query = 'SELECT encrypt_data($1, $2) as encrypted_data';
    const result = await pool.query(query, [data, keyName]);

    if (result.rows.length === 0) {
      throw new Error('Encryption failed');
    }

    // Log encryption operation
    await logEncryptionOperation('encrypt', null, null, keyName);

    return result.rows[0].encrypted_data;
  } catch (error) {
    logger.error('Error encrypting data:', error);
    throw error;
  }
};

/**
 * Decrypt data using pgcrypto
 * @param {string} encryptedData - The encrypted data
 * @param {string} keyName - The name of the encryption key to use
 * @returns {Promise<string>} The decrypted data
 */
const decryptData = async (encryptedData, keyName) => {
  try {
    if (!encryptedData || !keyName) {
      throw new Error('Encrypted data and keyName are required for decryption');
    }

    const query = 'SELECT decrypt_data($1, $2) as decrypted_data';
    const result = await pool.query(query, [encryptedData, keyName]);

    if (result.rows.length === 0) {
      throw new Error('Decryption failed');
    }

    // Log decryption operation
    await logEncryptionOperation('decrypt', null, null, keyName);

    return result.rows[0].decrypted_data;
  } catch (error) {
    logger.error('Error decrypting data:', error);
    throw error;
  }
};

/**
 * Generate a new encryption key
 * @param {string} keyName - The name for the new encryption key
 * @param {number} keyLength - The length of the key in bytes (default: 32)
 * @returns {Promise<string>} The generated key
 */
const generateEncryptionKey = async (keyName, keyLength = 32) => {
  try {
    if (!keyName) {
      throw new Error('KeyName is required');
    }

    const query = 'SELECT generate_encryption_key($1, $2) as new_key';
    const result = await pool.query(query, [keyName, keyLength]);

    if (result.rows.length === 0) {
      throw new Error('Key generation failed');
    }

    // Log key generation operation
    await logEncryptionOperation('key_generation', null, null, keyName);

    logger.info(`Generated new encryption key: ${keyName}`);
    return result.rows[0].new_key;
  } catch (error) {
    logger.error('Error generating encryption key:', error);
    throw error;
  }
};

/**
 * Rotate an encryption key
 * @param {string} keyName - The name of the key to rotate
 * @returns {Promise<string>} The new key
 */
const rotateEncryptionKey = async (keyName) => {
  try {
    if (!keyName) {
      throw new Error('KeyName is required');
    }

    const query = 'SELECT rotate_encryption_key($1) as new_key';
    const result = await pool.query(query, [keyName]);

    if (result.rows.length === 0) {
      throw new Error('Key rotation failed');
    }

    // Log key rotation operation
    await logEncryptionOperation('key_rotation', null, null, keyName);

    logger.info(`Rotated encryption key: ${keyName}`);
    return result.rows[0].new_key;
  } catch (error) {
    logger.error('Error rotating encryption key:', error);
    throw error;
  }
};

/**
 * Log encryption operation
 * @param {string} operation - The operation performed (encrypt, decrypt, key_rotation, key_generation)
 * @param {string} tableName - The table name (optional)
 * @param {number} recordId - The record ID (optional)
 * @param {string} keyName - The key name used (optional)
 * @param {string} performedBy - Who performed the operation (optional)
 * @param {string} ipAddress - The IP address (optional)
 * @param {string} userAgent - The user agent (optional)
 */
const logEncryptionOperation = async (
  operation,
  tableName = null,
  recordId = null,
  keyName = null,
  performedBy = null,
  ipAddress = null,
  userAgent = null
) => {
  try {
    const query = `
      SELECT log_encryption_operation($1, $2, $3, $4, $5, $6, $7)
    `;
    await pool.query(query, [
      operation,
      tableName,
      recordId,
      keyName,
      performedBy,
      ipAddress,
      userAgent
    ]);
  } catch (error) {
    logger.error('Error logging encryption operation:', error);
    // Don't throw error for logging failures
  }
};

/**
 * Verify encryption integrity
 * @returns {Promise<Array>} Array of integrity check results
 */
const verifyEncryptionIntegrity = async () => {
  try {
    const query = 'SELECT * FROM verify_encryption_integrity()';
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    logger.error('Error verifying encryption integrity:', error);
    throw error;
  }
};

/**
 * Get encryption statistics
 * @returns {Promise<Array>} Array of encryption statistics
 */
const getEncryptionStatistics = async () => {
  try {
    const query = 'SELECT * FROM get_encryption_statistics()';
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    logger.error('Error getting encryption statistics:', error);
    throw error;
  }
};

/**
 * Backup encryption keys
 * @returns {Promise<string>} JSON string of backup data
 */
const backupEncryptionKeys = async () => {
  try {
    const query = 'SELECT backup_encryption_keys() as backup_data';
    const result = await pool.query(query);

    if (result.rows.length === 0) {
      throw new Error('Backup failed');
    }

    // Log backup operation
    await logEncryptionOperation('backup', 'encryption_keys', null, null);

    logger.info('Encryption keys backed up successfully');
    return result.rows[0].backup_data;
  } catch (error) {
    logger.error('Error backing up encryption keys:', error);
    throw error;
  }
};

/**
 * Restore encryption keys from backup
 * @param {string} backupData - JSON string of backup data
 * @returns {Promise<number>} Number of keys restored
 */
const restoreEncryptionKeys = async (backupData) => {
  try {
    if (!backupData) {
      throw new Error('Backup data is required');
    }

    const query = 'SELECT restore_encryption_keys($1::json) as restored_count';
    const result = await pool.query(query, [backupData]);

    if (result.rows.length === 0) {
      throw new Error('Restore failed');
    }

    const restoredCount = result.rows[0].restored_count;

    // Log restore operation
    await logEncryptionOperation('restore', 'encryption_keys', null, null);

    logger.info(`Restored ${restoredCount} encryption keys`);
    return restoredCount;
  } catch (error) {
    logger.error('Error restoring encryption keys:', error);
    throw error;
  }
};

/**
 * Check pgcrypto installation
 * @returns {Promise<Object>} Installation status
 */
const checkPgcryptoInstallation = async () => {
  try {
    const query = 'SELECT * FROM check_pgcrypto_installation()';
    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return {
        extension_name: 'pgcrypto',
        version: null,
        installed: false
      };
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error checking pgcrypto installation:', error);
    throw error;
  }
};

/**
 * Setup database encryption
 * @returns {Promise<string>} Setup result message
 */
const setupDatabaseEncryption = async () => {
  try {
    const query = 'SELECT setup_database_encryption() as result';
    const result = await pool.query(query);

    if (result.rows.length === 0) {
      throw new Error('Setup failed');
    }

    logger.info('Database encryption setup completed');
    return result.rows[0].result;
  } catch (error) {
    logger.error('Error setting up database encryption:', error);
    throw error;
  }
};

/**
 * Migrate existing data to encrypted columns
 * @returns {Promise<number>} Number of records migrated
 */
const migrateToEncryptedData = async () => {
  try {
    const query = 'SELECT migrate_to_encrypted_data() as migrated_count';
    const result = await pool.query(query);

    if (result.rows.length === 0) {
      throw new Error('Migration failed');
    }

    const migratedCount = result.rows[0].migrated_count;

    logger.info(`Migrated ${migratedCount} records to encrypted columns`);
    return migratedCount;
  } catch (error) {
    logger.error('Error migrating to encrypted data:', error);
    throw error;
  }
};

/**
 * Clean up old encryption audit logs
 * @param {number} daysToKeep - Number of days to keep logs (default: 90)
 * @returns {Promise<number>} Number of logs deleted
 */
const cleanupOldEncryptionLogs = async (daysToKeep = 90) => {
  try {
    const query = 'SELECT cleanup_old_encryption_logs($1) as deleted_count';
    const result = await pool.query(query, [daysToKeep]);

    if (result.rows.length === 0) {
      throw new Error('Cleanup failed');
    }

    const deletedCount = result.rows[0].deleted_count;

    logger.info(`Cleaned up ${deletedCount} old encryption audit logs`);
    return deletedCount;
  } catch (error) {
    logger.error('Error cleaning up old encryption logs:', error);
    throw error;
  }
};

/**
 * Encrypt user contact information
 * @param {number} userId - The user ID
 * @param {string} contact - The contact information to encrypt
 * @returns {Promise<void>}
 */
const encryptUserContact = async (userId, contact) => {
  try {
    if (!userId || !contact) {
      throw new Error('UserId and contact are required');
    }

    const encryptedContact = await encryptData(contact, 'users_contact');

    const query = 'UPDATE users SET encrypted_contact = $1 WHERE id = $2';
    await pool.query(query, [encryptedContact, userId]);

    await logEncryptionOperation('encrypt', 'users', userId, 'users_contact');

    logger.info(`Encrypted contact for user ${userId}`);
  } catch (error) {
    logger.error('Error encrypting user contact:', error);
    throw error;
  }
};

/**
 * Decrypt user contact information
 * @param {number} userId - The user ID
 * @returns {Promise<string>} The decrypted contact information
 */
const decryptUserContact = async (userId) => {
  try {
    if (!userId) {
      throw new Error('UserId is required');
    }

    const query = `
      SELECT encrypted_contact
      FROM users
      WHERE id = $1 AND encrypted_contact IS NOT NULL
    `;
    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return null;
    }

    const decryptedContact = await decryptData(result.rows[0].encrypted_contact, 'users_contact');

    await logEncryptionOperation('decrypt', 'users', userId, 'users_contact');

    return decryptedContact;
  } catch (error) {
    logger.error('Error decrypting user contact:', error);
    throw error;
  }
};

/**
 * Encrypt guardian phone number
 * @param {number} guardianId - The guardian ID
 * @param {string} phone - The phone number to encrypt
 * @returns {Promise<void>}
 */
const encryptGuardianPhone = async (guardianId, phone) => {
  try {
    if (!guardianId || !phone) {
      throw new Error('GuardianId and phone are required');
    }

    const encryptedPhone = await encryptData(phone, 'guardians_phone');

    const query = 'UPDATE guardians SET encrypted_phone = $1 WHERE id = $2';
    await pool.query(query, [encryptedPhone, guardianId]);

    await logEncryptionOperation('encrypt', 'guardians', guardianId, 'guardians_phone');

    logger.info(`Encrypted phone for guardian ${guardianId}`);
  } catch (error) {
    logger.error('Error encrypting guardian phone:', error);
    throw error;
  }
};

/**
 * Decrypt guardian phone number
 * @param {number} guardianId - The guardian ID
 * @returns {Promise<string>} The decrypted phone number
 */
const decryptGuardianPhone = async (guardianId) => {
  try {
    if (!guardianId) {
      throw new Error('GuardianId is required');
    }

    const query = `
      SELECT encrypted_phone
      FROM guardians
      WHERE id = $1 AND encrypted_phone IS NOT NULL
    `;
    const result = await pool.query(query, [guardianId]);

    if (result.rows.length === 0) {
      return null;
    }

    const decryptedPhone = await decryptData(result.rows[0].encrypted_phone, 'guardians_phone');

    await logEncryptionOperation('decrypt', 'guardians', guardianId, 'guardians_phone');

    return decryptedPhone;
  } catch (error) {
    logger.error('Error decrypting guardian phone:', error);
    throw error;
  }
};

/**
 * Encrypt infant birth certificate number
 * @param {number} infantId - The infant ID
 * @param {string} birthCertificateNumber - The birth certificate number to encrypt
 * @returns {Promise<void>}
 */
const encryptInfantBirthCertificate = async (infantId, birthCertificateNumber) => {
  try {
    if (!infantId || !birthCertificateNumber) {
      throw new Error('InfantId and birthCertificateNumber are required');
    }

    const encryptedBirthCertificate = await encryptData(
      birthCertificateNumber,
      'infants_birth_certificate'
    );

    const query = 'UPDATE infants SET encrypted_birth_certificate_number = $1 WHERE id = $2';
    await pool.query(query, [encryptedBirthCertificate, infantId]);

    await logEncryptionOperation('encrypt', 'infants', infantId, 'infants_birth_certificate');

    logger.info(`Encrypted birth certificate for infant ${infantId}`);
  } catch (error) {
    logger.error('Error encrypting infant birth certificate:', error);
    throw error;
  }
};

/**
 * Decrypt infant birth certificate number
 * @param {number} infantId - The infant ID
 * @returns {Promise<string>} The decrypted birth certificate number
 */
const decryptInfantBirthCertificate = async (infantId) => {
  try {
    if (!infantId) {
      throw new Error('InfantId is required');
    }

    const query = `
      SELECT encrypted_birth_certificate_number
      FROM infants
      WHERE id = $1 AND encrypted_birth_certificate_number IS NOT NULL
    `;
    const result = await pool.query(query, [infantId]);

    if (result.rows.length === 0) {
      return null;
    }

    const decryptedBirthCertificate = await decryptData(
      result.rows[0].encrypted_birth_certificate_number,
      'infants_birth_certificate'
    );

    await logEncryptionOperation('decrypt', 'infants', infantId, 'infants_birth_certificate');

    return decryptedBirthCertificate;
  } catch (error) {
    logger.error('Error decrypting infant birth certificate:', error);
    throw error;
  }
};

/**
 * Get encryption status
 * @returns {Promise<Array>} Array of encryption status information
 */
const getEncryptionStatus = async () => {
  try {
    const query = 'SELECT * FROM encryption_status';
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    logger.error('Error getting encryption status:', error);
    throw error;
  }
};

module.exports = {
  encryptData,
  decryptData,
  generateEncryptionKey,
  rotateEncryptionKey,
  logEncryptionOperation,
  verifyEncryptionIntegrity,
  getEncryptionStatistics,
  backupEncryptionKeys,
  restoreEncryptionKeys,
  checkPgcryptoInstallation,
  setupDatabaseEncryption,
  migrateToEncryptedData,
  cleanupOldEncryptionLogs,
  encryptUserContact,
  decryptUserContact,
  encryptGuardianPhone,
  decryptGuardianPhone,
  encryptInfantBirthCertificate,
  decryptInfantBirthCertificate,
  getEncryptionStatus
};
