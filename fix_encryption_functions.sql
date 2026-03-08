-- Fix encryption functions with proper parameter names
DROP FUNCTION IF EXISTS generate_encryption_key(VARCHAR, INTEGER) CASCADE;

CREATE OR REPLACE FUNCTION generate_encryption_key(p_key_name VARCHAR, p_key_length INTEGER DEFAULT 32)
RETURNS TEXT AS $$
DECLARE
    new_key TEXT;
    key_hash TEXT;
BEGIN
    new_key := encode(gen_random_bytes(p_key_length), 'hex');
    key_hash := encode(digest(new_key, 'sha256'), 'hex');
    
    INSERT INTO encryption_keys (key_name, encrypted_key, key_hash)
    VALUES (p_key_name, new_key, key_hash)
    ON CONFLICT (key_name) DO UPDATE SET
        encrypted_key = EXCLUDED.encrypted_key,
        key_hash = EXCLUDED.key_hash,
        updated_at = CURRENT_TIMESTAMP,
        is_active = true;
    
    RETURN new_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Generate encryption keys
SELECT generate_encryption_key('users_contact');
SELECT generate_encryption_key('users_email');
SELECT generate_encryption_key('guardians_phone');
SELECT generate_encryption_key('guardians_email');
SELECT generate_encryption_key('guardians_address');
SELECT generate_encryption_key('infants_national_id');

-- Verify keys
SELECT key_name, algorithm, is_active, created_at FROM encryption_keys ORDER BY key_name;
