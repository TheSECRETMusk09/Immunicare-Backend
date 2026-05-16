/**
 * Simplified Database Encryption Setup
 * Executes encryption setup in smaller, controlled steps
 */

require('fs');
require('path');
const pool = require('./db');

async function executeSQL(sql, description) {
  console.log(`   Executing: ${description}...`);
  try {
    await pool.query(sql);
    console.log(`   ✓ ${description} - SUCCESS`);
    return true;
  } catch (error) {
    console.error(`   ✗ ${description} - FAILED: ${error.message}`);
    return false;
  }
}

async function setupEncryption() {
  console.log('='.repeat(60));
  console.log('IMMUNICARE DATABASE ENCRYPTION SETUP');
  console.log('='.repeat(60));
  console.log();

  try {
    // Test connection
    console.log('1. Testing database connection...');
    const client = await pool.connect();
    console.log('   ✓ Database connection successful');
    client.release();
    console.log();

    // Step 1: Enable pgcrypto extension
    console.log('2. Enabling pgcrypto extension...');
    await executeSQL('CREATE EXTENSION IF NOT EXISTS pgcrypto', 'pgcrypto extension');
    console.log();

    // Step 2: Create encryption_keys table
    console.log('3. Creating encryption_keys table...');
    await executeSQL(
      `
      CREATE TABLE IF NOT EXISTS encryption_keys (
        id SERIAL PRIMARY KEY,
        key_name VARCHAR(255) UNIQUE NOT NULL,
        encrypted_key TEXT NOT NULL,
        key_hash VARCHAR(255) NOT NULL,
        algorithm VARCHAR(50) DEFAULT 'aes256',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `,
      'encryption_keys table'
    );

    // Create indexes
    await executeSQL(
      'CREATE INDEX IF NOT EXISTS idx_encryption_keys_key_name ON encryption_keys(key_name)',
      'key_name index'
    );
    await executeSQL(
      'CREATE INDEX IF NOT EXISTS idx_encryption_keys_is_active ON encryption_keys(is_active)',
      'is_active index'
    );
    console.log();

    // Step 3: Add encrypted columns to users table
    console.log('4. Adding encrypted columns to users table...');
    await executeSQL(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_contact TEXT',
      'users.encrypted_contact column'
    );
    await executeSQL(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_email TEXT',
      'users.encrypted_email column'
    );
    console.log();

    // Step 4: Add encrypted columns to guardians table
    console.log('5. Adding encrypted columns to guardians table...');
    await executeSQL(
      'ALTER TABLE guardians ADD COLUMN IF NOT EXISTS encrypted_phone TEXT',
      'guardians.encrypted_phone column'
    );
    await executeSQL(
      'ALTER TABLE guardians ADD COLUMN IF NOT EXISTS encrypted_email TEXT',
      'guardians.encrypted_email column'
    );
    await executeSQL(
      'ALTER TABLE guardians ADD COLUMN IF NOT EXISTS encrypted_address TEXT',
      'guardians.encrypted_address column'
    );
    console.log();

    // Step 5: Add encrypted columns to infants table
    console.log('6. Adding encrypted columns to infants table...');
    await executeSQL(
      'ALTER TABLE infants ADD COLUMN IF NOT EXISTS encrypted_national_id TEXT',
      'infants.encrypted_national_id column'
    );
    console.log();

    // Step 6: Create encrypt_data function
    console.log('7. Creating encrypt_data function...');
    await executeSQL(
      `
      CREATE OR REPLACE FUNCTION encrypt_data(data TEXT, key_name VARCHAR)
      RETURNS TEXT AS $$
      DECLARE
          key_record RECORD;
          encrypted_data TEXT;
      BEGIN
          SELECT * INTO key_record
          FROM encryption_keys
          WHERE key_name = $2 AND is_active = true
          LIMIT 1;
          
          IF NOT FOUND THEN
              RETURN encrypt(data::bytea, gen_random_bytes(32), 'aes')->encode('hex');
          END IF;
          
          encrypted_data := encode(
              encrypt(
                  convert_to(data, 'UTF8'),
                  decode(key_record.encrypted_key, 'hex'),
                  'aes'
              ),
              'hex'
          );
          
          RETURN encrypted_data;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `,
      'encrypt_data function'
    );
    console.log();

    // Step 7: Create decrypt_data function
    console.log('8. Creating decrypt_data function...');
    await executeSQL(
      `
      CREATE OR REPLACE FUNCTION decrypt_data(encrypted_data TEXT, key_name VARCHAR)
      RETURNS TEXT AS $$
      DECLARE
          key_record RECORD;
          decrypted_data TEXT;
      BEGIN
          SELECT * INTO key_record
          FROM encryption_keys
          WHERE key_name = $2 AND is_active = true
          LIMIT 1;
          
          IF NOT FOUND THEN
              RAISE EXCEPTION 'Encryption key not found: %', key_name;
          END IF;
          
          decrypted_data := convert_from(
              decrypt(
                  decode(encrypted_data, 'hex'),
                  decode(key_record.encrypted_key, 'hex'),
                  'aes'
              ),
              'UTF8'
          );
          
          RETURN decrypted_data;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `,
      'decrypt_data function'
    );
    console.log();

    // Step 8: Create generate_encryption_key function
    console.log('9. Creating generate_encryption_key function...');
    await executeSQL(
      `
      CREATE OR REPLACE FUNCTION generate_encryption_key(key_name VARCHAR, key_length INTEGER DEFAULT 32)
      RETURNS TEXT AS $$
      DECLARE
          new_key TEXT;
          key_hash TEXT;
          encrypted_key TEXT;
      BEGIN
          new_key := encode(gen_random_bytes(key_length), 'hex');
          key_hash := encode(digest(new_key, 'sha256'), 'hex');
          encrypted_key := new_key;
          
          INSERT INTO encryption_keys (key_name, encrypted_key, key_hash)
          VALUES (key_name, encrypted_key, key_hash)
          ON CONFLICT (key_name) DO UPDATE SET
              encrypted_key = EXCLUDED.encrypted_key,
              key_hash = EXCLUDED.key_hash,
              updated_at = CURRENT_TIMESTAMP,
              is_active = true;
          
          RETURN new_key;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `,
      'generate_encryption_key function'
    );
    console.log();

    // Step 9: Generate encryption keys
    console.log('10. Generating encryption keys...');
    const keys = [
      'users_contact',
      'users_email',
      'guardians_phone',
      'guardians_email',
      'guardians_address',
      'infants_national_id',
    ];

    for (const key of keys) {
      await executeSQL(`SELECT generate_encryption_key('${key}')`, `Key: ${key}`);
    }
    console.log();

    // Step 10: Create audit log table
    console.log('11. Creating encryption audit log table...');
    await executeSQL(
      `
      CREATE TABLE IF NOT EXISTS encryption_audit_log (
        id SERIAL PRIMARY KEY,
        operation VARCHAR(50) NOT NULL,
        table_name VARCHAR(255),
        record_id INTEGER,
        key_name VARCHAR(255),
        performed_by VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `,
      'encryption_audit_log table'
    );

    await executeSQL(
      'CREATE INDEX IF NOT EXISTS idx_encryption_audit_log_created_at ON encryption_audit_log(created_at)',
      'audit log index'
    );
    console.log();

    // Verify setup
    console.log('12. Verifying encryption setup...');
    const pgcryptoCheck = await pool.query(`
      SELECT extname, extversion FROM pg_extension WHERE extname = 'pgcrypto'
    `);
    console.log(
      `   - pgcrypto: ${pgcryptoCheck.rows.length > 0 ? '✓ INSTALLED' : '✗ NOT INSTALLED'}`
    );

    const keysCount = await pool.query('SELECT COUNT(*) as count FROM encryption_keys');
    console.log(`   - Encryption keys: ${keysCount.rows[0].count} generated`);

    const usersColumns = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name LIKE 'encrypted_%'
    `);
    console.log(`   - Users encrypted columns: ${usersColumns.rows.length}`);

    const guardiansColumns = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'guardians' AND column_name LIKE 'encrypted_%'
    `);
    console.log(`   - Guardians encrypted columns: ${guardiansColumns.rows.length}`);

    const infantsColumns = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'infants' AND column_name LIKE 'encrypted_%'
    `);
    console.log(`   - Infants encrypted columns: ${infantsColumns.rows.length}`);
    console.log();

    console.log('='.repeat(60));
    console.log('✓ DATABASE ENCRYPTION SETUP COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log();
    console.log('Next steps:');
    console.log('1. Run migration to encrypt existing data: node migrate_encrypted_data.js');
    console.log('2. To enable HTTPS: Edit .env and set ENABLE_HTTPS=true');
    console.log('3. Generate SSL certificates: node generate_ssl_certificates.js');
    console.log();

    return true;
  } catch (error) {
    console.error('='.repeat(60));
    console.error('✗ ENCRYPTION SETUP FAILED!');
    console.error('='.repeat(60));
    console.error('Error:', error.message);
    return false;
  } finally {
    await pool.end();
  }
}

// Run setup
setupEncryption()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
