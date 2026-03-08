-- Database Encryption Setup using pgcrypto Extension
-- This script sets up encryption for sensitive data in the Immunicare database

-- Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create encryption key management table
CREATE TABLE IF NOT EXISTS encryption_keys (
    id SERIAL PRIMARY KEY,
    key_name VARCHAR(255) UNIQUE NOT NULL,
    encrypted_key TEXT NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    algorithm VARCHAR(50) DEFAULT 'aes256',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Create index on key_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_encryption_keys_key_name ON encryption_keys(key_name);
CREATE INDEX IF NOT EXISTS idx_encryption_keys_is_active ON encryption_keys(is_active);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_encryption_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for encryption_keys table
DROP TRIGGER IF EXISTS trigger_update_encryption_keys_updated_at ON encryption_keys;
CREATE TRIGGER trigger_update_encryption_keys_updated_at
    BEFORE UPDATE ON encryption_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_encryption_keys_updated_at();

-- Create encryption/decryption functions
-- Encrypt data using AES-256 with a key from the encryption_keys table
CREATE OR REPLACE FUNCTION encrypt_data(data TEXT, key_name VARCHAR)
RETURNS TEXT AS $$
DECLARE
    key_record RECORD;
    encrypted_data TEXT;
BEGIN
    -- Get the encryption key
    SELECT * INTO key_record
    FROM encryption_keys
    WHERE key_name = $2 AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Encryption key not found or inactive: %', key_name;
    END IF;

    -- Encrypt the data using AES-256
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

-- Decrypt data using AES-256 with a key from the encryption_keys table
CREATE OR REPLACE FUNCTION decrypt_data(encrypted_data TEXT, key_name VARCHAR)
RETURNS TEXT AS $$
DECLARE
    key_record RECORD;
    decrypted_data TEXT;
BEGIN
    -- Get the encryption key
    SELECT * INTO key_record
    FROM encryption_keys
    WHERE key_name = $2 AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Encryption key not found or inactive: %', key_name;
    END IF;

    -- Decrypt the data using AES-256
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

-- Create function to generate a new encryption key
CREATE OR REPLACE FUNCTION generate_encryption_key(key_name VARCHAR, key_length INTEGER DEFAULT 32)
RETURNS TEXT AS $$
DECLARE
    new_key TEXT;
    key_hash TEXT;
    encrypted_key TEXT;
BEGIN
    -- Generate a random key
    new_key := encode(gen_random_bytes(key_length), 'hex');

    -- Create a hash of the key for verification
    key_hash := encode(digest(new_key, 'sha256'), 'hex');

    -- Encrypt the key with a master key (in production, use a proper key management system)
    -- For now, we'll store it as-is (in production, use AWS KMS, HashiCorp Vault, etc.)
    encrypted_key := new_key;

    -- Insert the key into the database
    INSERT INTO encryption_keys (key_name, encrypted_key, key_hash)
    VALUES (key_name, encrypted_key, key_hash)
    ON CONFLICT (key_name) DO UPDATE SET
        encrypted_key = EXCLUDED.encrypted_key,
        key_hash = EXCLUDED.key_hash,
        updated_at = CURRENT_TIMESTAMP;

    RETURN new_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to rotate encryption keys
CREATE OR REPLACE FUNCTION rotate_encryption_key(key_name VARCHAR)
RETURNS TEXT AS $$
DECLARE
    old_key_record RECORD;
    new_key TEXT;
BEGIN
    -- Get the old key record
    SELECT * INTO old_key_record
    FROM encryption_keys
    WHERE key_name = key_name AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Encryption key not found or inactive: %', key_name;
    END IF;

    -- Deactivate the old key
    UPDATE encryption_keys
    SET is_active = false
    WHERE id = old_key_record.id;

    -- Generate a new key
    new_key := generate_encryption_key(key_name);

    RETURN new_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit log for encryption operations
CREATE TABLE IF NOT EXISTS encryption_audit_log (
    id SERIAL PRIMARY KEY,
    operation VARCHAR(50) NOT NULL, -- 'encrypt', 'decrypt', 'key_rotation', 'key_generation'
    table_name VARCHAR(255),
    record_id INTEGER,
    key_name VARCHAR(255),
    performed_by VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for audit log queries
CREATE INDEX IF NOT EXISTS idx_encryption_audit_log_operation ON encryption_audit_log(operation);
CREATE INDEX IF NOT EXISTS idx_encryption_audit_log_table_name ON encryption_audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_encryption_audit_log_created_at ON encryption_audit_log(created_at);

-- Create function to log encryption operations
CREATE OR REPLACE FUNCTION log_encryption_operation(
    operation VARCHAR,
    table_name VARCHAR DEFAULT NULL,
    record_id INTEGER DEFAULT NULL,
    key_name VARCHAR DEFAULT NULL,
    performed_by VARCHAR DEFAULT NULL,
    ip_address VARCHAR DEFAULT NULL,
    user_agent TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO encryption_audit_log (
        operation, table_name, record_id, key_name, performed_by, ip_address, user_agent
    ) VALUES (
        operation, table_name, record_id, key_name, performed_by, ip_address, user_agent
    );
END;
$$ LANGUAGE plpgsql;

-- Create encrypted columns for sensitive data
-- Add encrypted columns to users table for sensitive information
ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_contact TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_email TEXT;

-- Add encrypted columns to guardians table for sensitive information
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS encrypted_phone TEXT;
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS encrypted_email TEXT;
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS encrypted_address TEXT;

-- Add encrypted columns to infants table for sensitive information
ALTER TABLE infants ADD COLUMN IF NOT EXISTS encrypted_national_id TEXT;

-- Create views for decrypted data (for authorized access)
CREATE OR REPLACE VIEW users_decrypted AS
SELECT
    u.id,
    u.username,
    u.role,
    u.clinic_id,
    u.guardian_id,
    u.is_active,
    u.last_login,
    u.created_at,
    u.updated_at,
    CASE
        WHEN u.encrypted_contact IS NOT NULL THEN decrypt_data(u.encrypted_contact, 'users_contact')
        ELSE NULL
    END as contact,
    CASE
        WHEN u.encrypted_email IS NOT NULL THEN decrypt_data(u.encrypted_email, 'users_email')
        ELSE NULL
    END as email,
    c.name as clinic_name
FROM users u
LEFT JOIN clinics c ON u.clinic_id = c.id;

-- Create view for decrypted guardians data
CREATE OR REPLACE VIEW guardians_decrypted AS
SELECT
    g.id,
    g.first_name,
    g.last_name,
    g.middle_name,
    g.name,
    g.relationship,
    g.relationship_to_student,
    g.is_primary_guardian,
    g.created_at,
    g.updated_at,
    CASE
        WHEN g.encrypted_phone IS NOT NULL THEN decrypt_data(g.encrypted_phone, 'guardians_phone')
        ELSE NULL
    END as phone,
    CASE
        WHEN g.encrypted_email IS NOT NULL THEN decrypt_data(g.encrypted_email, 'guardians_email')
        ELSE NULL
    END as email,
    CASE
        WHEN g.encrypted_address IS NOT NULL THEN decrypt_data(g.encrypted_address, 'guardians_address')
        ELSE NULL
    END as address
FROM guardians g;

-- Create view for decrypted infants data
CREATE OR REPLACE VIEW infants_decrypted AS
SELECT
    i.id,
    i.first_name,
    i.last_name,
    i.middle_name,
    i.dob,
    i.sex,
    i.guardian_id,
    i.clinic_id,
    i.mother_name,
    i.father_name,
    i.place_of_birth,
    i.created_at,
    i.updated_at,
    CASE
        WHEN i.encrypted_national_id IS NOT NULL THEN decrypt_data(i.encrypted_national_id, 'infants_national_id')
        ELSE NULL
    END as national_id,
    g.first_name as guardian_first_name,
    g.last_name as guardian_last_name,
    c.name as clinic_name
FROM infants i
LEFT JOIN guardians g ON i.guardian_id = g.id
LEFT JOIN clinics c ON i.clinic_id = c.id;

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT EXECUTE ON FUNCTION encrypt_data TO immunicare_app;
-- GRANT EXECUTE ON FUNCTION decrypt_data TO immunicare_app;
-- GRANT EXECUTE ON FUNCTION generate_encryption_key TO immunicare_app;
-- GRANT EXECUTE ON FUNCTION rotate_encryption_key TO immunicare_app;
-- GRANT EXECUTE ON FUNCTION log_encryption_operation TO immunicare_app;
-- GRANT SELECT ON users_decrypted TO immunicare_app;
-- GRANT SELECT ON guardians_decrypted TO immunicare_app;
-- GRANT SELECT ON infants_decrypted TO immunicare_app;

-- Create a function to migrate existing data to encrypted columns
CREATE OR REPLACE FUNCTION migrate_to_encrypted_data()
RETURNS INTEGER AS $
DECLARE
    migrated_count INTEGER := 0;
    temp_count INTEGER;
BEGIN
    -- Generate encryption keys if they don't exist
    PERFORM generate_encryption_key('users_contact');
    PERFORM generate_encryption_key('users_email');
    PERFORM generate_encryption_key('guardians_phone');
    PERFORM generate_encryption_key('guardians_email');
    PERFORM generate_encryption_key('guardians_address');
    PERFORM generate_encryption_key('infants_national_id');

    -- Migrate users contact data
    UPDATE users
    SET encrypted_contact = encrypt_data(contact, 'users_contact')
    WHERE contact IS NOT NULL AND encrypted_contact IS NULL;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    migrated_count := migrated_count + temp_count;

    -- Migrate guardians phone data
    UPDATE guardians
    SET encrypted_phone = encrypt_data(phone, 'guardians_phone')
    WHERE phone IS NOT NULL AND encrypted_phone IS NULL;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    migrated_count := migrated_count + temp_count;

    -- Migrate guardians email data
    UPDATE guardians
    SET encrypted_email = encrypt_data(email, 'guardians_email')
    WHERE email IS NOT NULL AND encrypted_email IS NULL;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    migrated_count := migrated_count + temp_count;

    -- Migrate guardians address data
    UPDATE guardians
    SET encrypted_address = encrypt_data(address, 'guardians_address')
    WHERE address IS NOT NULL AND encrypted_address IS NULL;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    migrated_count := migrated_count + temp_count;

    -- Migrate infants national_id data
    UPDATE infants
    SET encrypted_national_id = encrypt_data(national_id, 'infants_national_id')
    WHERE national_id IS NOT NULL AND encrypted_national_id IS NULL;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    migrated_count := migrated_count + temp_count;

    RETURN migrated_count;
END;
$ LANGUAGE plpgsql;

-- Create a function to verify encryption integrity
CREATE OR REPLACE FUNCTION verify_encryption_integrity()
RETURNS TABLE(
    table_name VARCHAR,
    record_count INTEGER,
    encrypted_count INTEGER,
    integrity_check VARCHAR
) AS $$
BEGIN
    -- Check users table
    RETURN QUERY
    SELECT
        'users'::VARCHAR as table_name,
        COUNT(*) as record_count,
        COUNT(encrypted_contact) + COUNT(encrypted_email) as encrypted_count,
        CASE
            WHEN COUNT(*) = COUNT(encrypted_contact) + COUNT(encrypted_email) THEN 'OK'
            ELSE 'REVIEW NEEDED'
        END as integrity_check
    FROM users;

    -- Check guardians table
    RETURN QUERY
    SELECT
        'guardians'::VARCHAR as table_name,
        COUNT(*) as record_count,
        COUNT(encrypted_phone) + COUNT(encrypted_email) + COUNT(encrypted_address) as encrypted_count,
        CASE
            WHEN COUNT(*) = COUNT(encrypted_phone) + COUNT(encrypted_email) + COUNT(encrypted_address) THEN 'OK'
            ELSE 'REVIEW NEEDED'
        END as integrity_check
    FROM guardians;

    -- Check infants table
    RETURN QUERY
    SELECT
        'infants'::VARCHAR as table_name,
        COUNT(*) as record_count,
        COUNT(encrypted_birth_certificate_number) as encrypted_count,
        CASE
            WHEN COUNT(*) = COUNT(encrypted_birth_certificate_number) THEN 'OK'
            ELSE 'REVIEW NEEDED'
        END as integrity_check
    FROM infants;
END;
$$ LANGUAGE plpgsql;

-- Create a function to clean up old encryption audit logs
CREATE OR REPLACE FUNCTION cleanup_old_encryption_logs(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM encryption_audit_log
    WHERE created_at < CURRENT_TIMESTAMP - (days_to_keep || ' days')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to clean up old logs (requires pg_cron extension)
-- Uncomment if pg_cron is available
-- SELECT cron.schedule('cleanup-encryption-logs', '0 2 * * *', 'SELECT cleanup_old_encryption_logs(90);');

-- Create a summary view for encryption status
CREATE OR REPLACE VIEW encryption_status AS
SELECT
    'encryption_keys' as table_name,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE is_active = true) as active_records,
    COUNT(*) FILTER (WHERE is_active = false) as inactive_records
FROM encryption_keys
UNION ALL
SELECT
    'encryption_audit_log' as table_name,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '7 days') as active_records,
    COUNT(*) FILTER (WHERE created_at <= CURRENT_TIMESTAMP - INTERVAL '7 days') as inactive_records
FROM encryption_audit_log;

-- Create a function to get encryption statistics
CREATE OR REPLACE FUNCTION get_encryption_statistics()
RETURNS TABLE(
    metric VARCHAR,
    value BIGINT
) AS $$
BEGIN
    -- Total encryption keys
    RETURN QUERY
    SELECT 'total_encryption_keys'::VARCHAR, COUNT(*)::BIGINT
    FROM encryption_keys;

    -- Active encryption keys
    RETURN QUERY
    SELECT 'active_encryption_keys'::VARCHAR, COUNT(*)::BIGINT
    FROM encryption_keys
    WHERE is_active = true;

    -- Total audit logs
    RETURN QUERY
    SELECT 'total_audit_logs'::VARCHAR, COUNT(*)::BIGINT
    FROM encryption_audit_log;

    -- Audit logs in last 24 hours
    RETURN QUERY
    SELECT 'audit_logs_24h'::VARCHAR, COUNT(*)::BIGINT
    FROM encryption_audit_log
    WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours';

    -- Encrypted records in users table
    RETURN QUERY
    SELECT 'encrypted_users_records'::VARCHAR, COUNT(*)::BIGINT
    FROM users
    WHERE encrypted_contact IS NOT NULL OR encrypted_email IS NOT NULL;

    -- Encrypted records in guardians table
    RETURN QUERY
    SELECT 'encrypted_guardians_records'::VARCHAR, COUNT(*)::BIGINT
    FROM guardians
    WHERE encrypted_phone IS NOT NULL OR encrypted_email IS NOT NULL OR encrypted_address IS NOT NULL;

    -- Encrypted records in infants table
    RETURN QUERY
    SELECT 'encrypted_infants_records'::VARCHAR, COUNT(*)::BIGINT
    FROM infants
    WHERE encrypted_national_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Create a function to backup encryption keys (for disaster recovery)
CREATE OR REPLACE FUNCTION backup_encryption_keys()
RETURNS TEXT AS $$
DECLARE
    backup_data TEXT;
BEGIN
    -- Create a backup of all encryption keys (in production, encrypt this backup)
    SELECT json_agg(
        json_build_object(
            'key_name', key_name,
            'encrypted_key', encrypted_key,
            'key_hash', key_hash,
            'algorithm', algorithm,
            'created_at', created_at,
            'updated_at', updated_at,
            'is_active', is_active
        )
    ) INTO backup_data
    FROM encryption_keys;

    RETURN backup_data;
END;
$$ LANGUAGE plpgsql;

-- Create a function to restore encryption keys from backup
CREATE OR REPLACE FUNCTION restore_encryption_keys(backup_data JSON)
RETURNS INTEGER AS $$
DECLARE
    restored_count INTEGER := 0;
    key_record JSON;
BEGIN
    -- Restore encryption keys from backup
    FOR key_record IN SELECT * FROM json_array_elements(backup_data)
    LOOP
        INSERT INTO encryption_keys (
            key_name, encrypted_key, key_hash, algorithm, created_at, updated_at, is_active
        ) VALUES (
            key_record->>'key_name',
            key_record->>'encrypted_key',
            key_record->>'key_hash',
            key_record->>'algorithm',
            (key_record->>'created_at')::TIMESTAMP WITH TIME ZONE,
            (key_record->>'updated_at')::TIMESTAMP WITH TIME ZONE,
            (key_record->>'is_active')::BOOLEAN
        )
        ON CONFLICT (key_name) DO UPDATE SET
            encrypted_key = EXCLUDED.encrypted_key,
            key_hash = EXCLUDED.key_hash,
            algorithm = EXCLUDED.algorithm,
            updated_at = EXCLUDED.updated_at,
            is_active = EXCLUDED.is_active;

        restored_count := restored_count + 1;
    END LOOP;

    RETURN restored_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to check if pgcrypto is properly installed
CREATE OR REPLACE FUNCTION check_pgcrypto_installation()
RETURNS TABLE(
    extension_name VARCHAR,
    version VARCHAR,
    installed BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        'pgcrypto'::VARCHAR as extension_name,
        extversion::VARCHAR as version,
        true as installed
    FROM pg_extension
    WHERE extname = 'pgcrypto';

    -- If no row returned, pgcrypto is not installed
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 'pgcrypto'::VARCHAR, NULL::VARCHAR, false::BOOLEAN;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create a comprehensive setup function
CREATE OR REPLACE FUNCTION setup_database_encryption()
RETURNS TEXT AS $$
BEGIN
    -- Check pgcrypto installation
    PERFORM * FROM check_pgcrypto_installation();

    -- Generate default encryption keys
    PERFORM generate_encryption_key('users_contact');
    PERFORM generate_encryption_key('users_email');
    PERFORM generate_encryption_key('guardians_phone');
    PERFORM generate_encryption_key('guardians_email');
    PERFORM generate_encryption_key('guardians_address');
    PERFORM generate_encryption_key('infants_national_id');

    RETURN 'Database encryption setup completed successfully';
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions on setup function
-- GRANT EXECUTE ON FUNCTION setup_database_encryption TO immunicare_app;

-- Create a function to drop all encryption-related objects (for cleanup/testing)
CREATE OR REPLACE FUNCTION drop_database_encryption()
RETURNS TEXT AS $$
BEGIN
    -- Drop views
    DROP VIEW IF EXISTS encryption_status CASCADE;
    DROP VIEW IF EXISTS infants_decrypted CASCADE;
    DROP VIEW IF EXISTS guardians_decrypted CASCADE;
    DROP VIEW IF EXISTS users_decrypted CASCADE;

    -- Drop functions
    DROP FUNCTION IF EXISTS setup_database_encryption() CASCADE;
    DROP FUNCTION IF EXISTS check_pgcrypto_installation() CASCADE;
    DROP FUNCTION IF EXISTS restore_encryption_keys(JSON) CASCADE;
    DROP FUNCTION IF EXISTS backup_encryption_keys() CASCADE;
    DROP FUNCTION IF EXISTS get_encryption_statistics() CASCADE;
    DROP FUNCTION IF EXISTS cleanup_old_encryption_logs(INTEGER) CASCADE;
    DROP FUNCTION IF EXISTS verify_encryption_integrity() CASCADE;
    DROP FUNCTION IF EXISTS migrate_to_encrypted_data() CASCADE;
    DROP FUNCTION IF EXISTS log_encryption_operation(VARCHAR, VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, TEXT) CASCADE;
    DROP FUNCTION IF EXISTS rotate_encryption_key(VARCHAR) CASCADE;
    DROP FUNCTION IF EXISTS generate_encryption_key(VARCHAR, INTEGER) CASCADE;
    DROP FUNCTION IF EXISTS decrypt_data(TEXT, VARCHAR) CASCADE;
    DROP FUNCTION IF EXISTS encrypt_data(TEXT, VARCHAR) CASCADE;
    DROP FUNCTION IF EXISTS update_encryption_keys_updated_at() CASCADE;

    -- Drop tables
    DROP TABLE IF EXISTS encryption_audit_log CASCADE;
    DROP TABLE IF EXISTS encryption_keys CASCADE;

    -- Drop encrypted columns
    ALTER TABLE infants DROP COLUMN IF EXISTS encrypted_birth_certificate_number;
    ALTER TABLE guardians DROP COLUMN IF EXISTS encrypted_address;
    ALTER TABLE guardians DROP COLUMN IF EXISTS encrypted_email;
    ALTER TABLE guardians DROP COLUMN IF EXISTS encrypted_phone;
    ALTER TABLE users DROP COLUMN IF EXISTS encrypted_email;
    ALTER TABLE users DROP COLUMN IF EXISTS encrypted_contact;

    -- Drop pgcrypto extension (optional - comment out if you want to keep it)
    -- DROP EXTENSION IF EXISTS pgcrypto CASCADE;

    RETURN 'Database encryption objects dropped successfully';
END;
$$ LANGUAGE plpgsql;

-- Create a comprehensive documentation comment
COMMENT ON FUNCTION setup_database_encryption() IS 'Sets up database encryption using pgcrypto extension. Generates encryption keys and creates necessary tables, views, and functions for encrypting sensitive data.';

COMMENT ON FUNCTION migrate_to_encrypted_data() IS 'Migrates existing plaintext data to encrypted columns. Returns the number of records migrated.';

COMMENT ON FUNCTION verify_encryption_integrity() IS 'Verifies the integrity of encrypted data across all tables. Returns a table with integrity status for each table.';

COMMENT ON FUNCTION rotate_encryption_key(VARCHAR) IS 'Rotates an encryption key by deactivating the old key and generating a new one. Returns the new key.';

COMMENT ON FUNCTION backup_encryption_keys() IS 'Creates a backup of all encryption keys in JSON format. Returns the backup data.';

COMMENT ON FUNCTION restore_encryption_keys(JSON) IS 'Restores encryption keys from a JSON backup. Returns the number of keys restored.';

COMMENT ON FUNCTION get_encryption_statistics() IS 'Returns comprehensive statistics about encryption usage in the database.';

COMMENT ON FUNCTION cleanup_old_encryption_logs(INTEGER) IS 'Cleans up old encryption audit logs. Returns the number of logs deleted.';

COMMENT ON FUNCTION check_pgcrypto_installation() IS 'Checks if pgcrypto extension is properly installed and returns version information.';

COMMENT ON FUNCTION drop_database_encryption() IS 'Drops all encryption-related objects from the database. Use with caution!';

-- Initial setup - run this to initialize encryption
-- SELECT setup_database_encryption();

-- To migrate existing data:
-- SELECT migrate_to_encrypted_data();

-- To verify encryption integrity:
-- SELECT * FROM verify_encryption_integrity();

-- To get encryption statistics:
-- SELECT * FROM get_encryption_statistics();

-- To backup encryption keys:
-- SELECT backup_encryption_keys();

-- To rotate an encryption key:
-- SELECT rotate_encryption_key('users_contact');
