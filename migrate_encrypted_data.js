/**
 * Migrate Existing Data to Encrypted Columns
 * This script migrates existing plaintext data to encrypted columns
 */

const pool = require('./db');
const encryptionService = require('./services/encryptionService');

/**
 * Migrate users contact data
 */
const migrateUsersContact = async () => {
  try {
    console.log('Migrating users contact data...');

    const query = `
      SELECT id, contact
      FROM users
      WHERE contact IS NOT NULL
        AND encrypted_contact IS NULL
    `;
    const result = await pool.query(query);

    console.log(`Found ${result.rows.length} users with contact data to encrypt`);

    let migratedCount = 0;
    for (const user of result.rows) {
      try {
        await encryptionService.encryptUserContact(user.id, user.contact);
        migratedCount++;
        console.log(`✓ Encrypted contact for user ${user.id}`);
      } catch (error) {
        console.error(`✗ Failed to encrypt contact for user ${user.id}:`, error.message);
      }
    }

    console.log(`Migrated ${migratedCount} user contacts`);
    return migratedCount;
  } catch (error) {
    console.error('Error migrating users contact data:', error);
    throw error;
  }
};

/**
 * Migrate guardians phone data
 */
const migrateGuardiansPhone = async () => {
  try {
    console.log('Migrating guardians phone data...');

    const query = `
      SELECT id, phone
      FROM guardians
      WHERE phone IS NOT NULL
        AND encrypted_phone IS NULL
    `;
    const result = await pool.query(query);

    console.log(`Found ${result.rows.length} guardians with phone data to encrypt`);

    let migratedCount = 0;
    for (const guardian of result.rows) {
      try {
        await encryptionService.encryptGuardianPhone(guardian.id, guardian.phone);
        migratedCount++;
        console.log(`✓ Encrypted phone for guardian ${guardian.id}`);
      } catch (error) {
        console.error(`✗ Failed to encrypt phone for guardian ${guardian.id}:`, error.message);
      }
    }

    console.log(`Migrated ${migratedCount} guardian phones`);
    return migratedCount;
  } catch (error) {
    console.error('Error migrating guardians phone data:', error);
    throw error;
  }
};

/**
 * Migrate guardians email data
 */
const migrateGuardiansEmail = async () => {
  try {
    console.log('Migrating guardians email data...');

    const query = `
      SELECT id, email
      FROM guardians
      WHERE email IS NOT NULL
        AND encrypted_email IS NULL
    `;
    const result = await pool.query(query);

    console.log(`Found ${result.rows.length} guardians with email data to encrypt`);

    let migratedCount = 0;
    for (const guardian of result.rows) {
      try {
        const encryptedEmail = await encryptionService.encryptData(
          guardian.email,
          'guardians_email'
        );
        await pool.query('UPDATE guardians SET encrypted_email = $1 WHERE id = $2', [
          encryptedEmail,
          guardian.id
        ]);
        migratedCount++;
        console.log(`✓ Encrypted email for guardian ${guardian.id}`);
      } catch (error) {
        console.error(`✗ Failed to encrypt email for guardian ${guardian.id}:`, error.message);
      }
    }

    console.log(`Migrated ${migratedCount} guardian emails`);
    return migratedCount;
  } catch (error) {
    console.error('Error migrating guardians email data:', error);
    throw error;
  }
};

/**
 * Migrate guardians address data
 */
const migrateGuardiansAddress = async () => {
  try {
    console.log('Migrating guardians address data...');

    const query = `
      SELECT id, address
      FROM guardians
      WHERE address IS NOT NULL
        AND encrypted_address IS NULL
    `;
    const result = await pool.query(query);

    console.log(`Found ${result.rows.length} guardians with address data to encrypt`);

    let migratedCount = 0;
    for (const guardian of result.rows) {
      try {
        const encryptedAddress = await encryptionService.encryptData(
          guardian.address,
          'guardians_address'
        );
        await pool.query('UPDATE guardians SET encrypted_address = $1 WHERE id = $2', [
          encryptedAddress,
          guardian.id
        ]);
        migratedCount++;
        console.log(`✓ Encrypted address for guardian ${guardian.id}`);
      } catch (error) {
        console.error(`✗ Failed to encrypt address for guardian ${guardian.id}:`, error.message);
      }
    }

    console.log(`Migrated ${migratedCount} guardian addresses`);
    return migratedCount;
  } catch (error) {
    console.error('Error migrating guardians address data:', error);
    throw error;
  }
};

/**
 * Migrate infants birth certificate data
 */
const migrateInfantsBirthCertificate = async () => {
  try {
    console.log('Migrating infants birth certificate data...');

    const query = `
      SELECT id, birth_certificate_number
      FROM infants
      WHERE birth_certificate_number IS NOT NULL
        AND encrypted_birth_certificate_number IS NULL
    `;
    const result = await pool.query(query);

    console.log(`Found ${result.rows.length} infants with birth certificate data to encrypt`);

    let migratedCount = 0;
    for (const infant of result.rows) {
      try {
        await encryptionService.encryptInfantBirthCertificate(
          infant.id,
          infant.birth_certificate_number
        );
        migratedCount++;
        console.log(`✓ Encrypted birth certificate for infant ${infant.id}`);
      } catch (error) {
        console.error(
          `✗ Failed to encrypt birth certificate for infant ${infant.id}:`,
          error.message
        );
      }
    }

    console.log(`Migrated ${migratedCount} infant birth certificates`);
    return migratedCount;
  } catch (error) {
    console.error('Error migrating infants birth certificate data:', error);
    throw error;
  }
};

/**
 * Run migration
 */
const runMigration = async () => {
  console.log('='.repeat(60));
  console.log('Data Migration to Encrypted Columns');
  console.log('='.repeat(60));
  console.log();

  try {
    // Check database connection
    console.log('1. Checking database connection...');
    const client = await pool.connect();
    console.log('✓ Database connection successful');
    client.release();
    console.log();

    // Check pgcrypto installation
    console.log('2. Checking pgcrypto installation...');
    const pgcryptoCheck = await pool.query('SELECT * FROM check_pgcrypto_installation()');
    if (!pgcryptoCheck.rows[0].installed) {
      throw new Error('pgcrypto extension is not installed. Run setup_encryption.js first.');
    }
    console.log('✓ pgcrypto is installed');
    console.log();

    // Get initial statistics
    console.log('3. Getting initial encryption statistics...');
    const initialStats = await pool.query('SELECT * FROM get_encryption_statistics()');
    console.log('✓ Initial Statistics:');
    initialStats.rows.forEach((row) => {
      console.log(`  - ${row.metric}: ${row.value}`);
    });
    console.log();

    // Migrate data
    console.log('4. Migrating data to encrypted columns...');
    console.log();

    let totalMigrated = 0;

    // Migrate users contact
    const usersContactCount = await migrateUsersContact();
    totalMigrated += usersContactCount;
    console.log();

    // Migrate guardians phone
    const guardiansPhoneCount = await migrateGuardiansPhone();
    totalMigrated += guardiansPhoneCount;
    console.log();

    // Migrate guardians email
    const guardiansEmailCount = await migrateGuardiansEmail();
    totalMigrated += guardiansEmailCount;
    console.log();

    // Migrate guardians address
    const guardiansAddressCount = await migrateGuardiansAddress();
    totalMigrated += guardiansAddressCount;
    console.log();

    // Migrate infants birth certificate
    const infantsBirthCertificateCount = await migrateInfantsBirthCertificate();
    totalMigrated += infantsBirthCertificateCount;
    console.log();

    // Get final statistics
    console.log('5. Getting final encryption statistics...');
    const finalStats = await pool.query('SELECT * FROM get_encryption_statistics()');
    console.log('✓ Final Statistics:');
    finalStats.rows.forEach((row) => {
      console.log(`  - ${row.metric}: ${row.value}`);
    });
    console.log();

    // Verify encryption integrity
    console.log('6. Verifying encryption integrity...');
    const integrity = await pool.query('SELECT * FROM verify_encryption_integrity()');
    console.log('✓ Encryption Integrity:');
    integrity.rows.forEach((row) => {
      console.log(`  - Table: ${row.table_name}`);
      console.log(`    - Total Records: ${row.record_count}`);
      console.log(`    - Encrypted Records: ${row.encrypted_count}`);
      console.log(`    - Status: ${row.integrity_check}`);
    });
    console.log();

    console.log('='.repeat(60));
    console.log('✓ Migration completed successfully!');
    console.log(`  Total records migrated: ${totalMigrated}`);
    console.log('='.repeat(60));
    console.log();
    console.log('Next steps:');
    console.log('1. Review the encryption integrity report above');
    console.log('2. Test decryption to ensure data can be retrieved correctly');
    console.log('3. Update application code to use encrypted columns');
    console.log('4. Consider removing plaintext columns after verification');
    console.log('5. Configure TLS/SSL for HTTPS server');
    console.log();

    return true;
  } catch (error) {
    console.error('='.repeat(60));
    console.error('✗ Migration failed!');
    console.error('='.repeat(60));
    console.error();
    console.error('Error:', error.message);
    console.error();

    if (error.message.includes('pgcrypto')) {
      console.error('Troubleshooting:');
      console.error('1. Run setup_encryption.js to install pgcrypto and set up encryption');
      console.error('2. Verify database credentials in .env file');
      console.error('3. Ensure you have necessary permissions');
    }

    return false;
  } finally {
    await pool.end();
  }
};

// Run migration
runMigration()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
