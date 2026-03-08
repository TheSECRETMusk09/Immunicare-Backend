/**
 * Database Encryption Setup Script
 * This script initializes database encryption using pgcrypto extension
 */

const pool = require('./db');
const fs = require('fs');
const path = require('path');

/**
 * Read and execute SQL file
 */
const executeSqlFile = async (filePath) => {
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Executing SQL file: ${filePath}`);
    await pool.query(sql);
    console.log(`✓ Successfully executed: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`✗ Error executing ${filePath}:`, error.message);
    return false;
  }
};

/**
 * Setup database encryption
 */
const setupEncryption = async () => {
  console.log('='.repeat(60));
  console.log('Database Encryption Setup');
  console.log('='.repeat(60));
  console.log();

  try {
    // Check database connection
    console.log('1. Checking database connection...');
    const client = await pool.connect();
    console.log('✓ Database connection successful');
    client.release();
    console.log();

    // Execute encryption setup SQL
    console.log('2. Executing encryption setup SQL...');
    const sqlFilePath = path.join(__dirname, 'database_encryption_setup.sql');
    const sqlSuccess = await executeSqlFile(sqlFilePath);

    if (!sqlSuccess) {
      throw new Error('Failed to execute encryption setup SQL');
    }
    console.log();

    // Check pgcrypto installation
    console.log('3. Checking pgcrypto installation...');
    const pgcryptoCheck = await pool.query('SELECT * FROM check_pgcrypto_installation()');
    console.log('✓ pgcrypto Status:');
    console.log(`  - Extension: ${pgcryptoCheck.rows[0].extension_name}`);
    console.log(`  - Version: ${pgcryptoCheck.rows[0].version || 'N/A'}`);
    console.log(`  - Installed: ${pgcryptoCheck.rows[0].installed ? 'Yes' : 'No'}`);
    console.log();

    // Setup encryption
    console.log('4. Setting up database encryption...');
    const setupResult = await pool.query('SELECT setup_database_encryption() as result');
    console.log(`✓ ${setupResult.rows[0].result}`);
    console.log();

    // Get encryption statistics
    console.log('5. Getting encryption statistics...');
    const stats = await pool.query('SELECT * FROM get_encryption_statistics()');
    console.log('✓ Encryption Statistics:');
    stats.rows.forEach((row) => {
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

    // Get encryption status
    console.log('7. Getting encryption status...');
    const status = await pool.query('SELECT * FROM encryption_status');
    console.log('✓ Encryption Status:');
    status.rows.forEach((row) => {
      console.log(`  - Table: ${row.table_name}`);
      console.log(`    - Total Records: ${row.total_records}`);
      console.log(`    - Active Records: ${row.active_records}`);
      console.log(`    - Inactive Records: ${row.inactive_records}`);
    });
    console.log();

    // Backup encryption keys
    console.log('8. Creating backup of encryption keys...');
    const backup = await pool.query('SELECT backup_encryption_keys() as backup_data');
    const backupData = backup.rows[0].backup_data;

    // Save backup to file
    const backupFilePath = path.join(__dirname, 'encryption_keys_backup.json');
    fs.writeFileSync(backupFilePath, JSON.stringify(JSON.parse(backupData), null, 2));
    console.log(`✓ Encryption keys backed up to: ${backupFilePath}`);
    console.log();

    console.log('='.repeat(60));
    console.log('✓ Database encryption setup completed successfully!');
    console.log('='.repeat(60));
    console.log();
    console.log('Next steps:');
    console.log('1. Review the encryption keys backup file');
    console.log('2. Store the backup file securely (e.g., in a password manager or secure vault)');
    console.log('3. Run migration to encrypt existing data:');
    console.log('   node migrate_encrypted_data.js');
    console.log('4. Update application code to use encryption service');
    console.log('5. Configure TLS/SSL for HTTPS server');
    console.log();

    return true;
  } catch (error) {
    console.error('='.repeat(60));
    console.error('✗ Database encryption setup failed!');
    console.error('='.repeat(60));
    console.error();
    console.error('Error:', error.message);
    console.error();
    console.error('Troubleshooting:');
    console.error('1. Ensure PostgreSQL is running');
    console.error('2. Verify database credentials in .env file');
    console.error('3. Check if pgcrypto extension is available in your PostgreSQL installation');
    console.error('4. Ensure you have necessary permissions to create extensions and tables');
    console.error();

    return false;
  } finally {
    await pool.end();
  }
};

// Run setup
setupEncryption()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
