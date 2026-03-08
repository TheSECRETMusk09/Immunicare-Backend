-- ============================================================================
-- ADD PASSWORD COLUMNS TO GUARDIAN AND PARENT GUARDIAN TABLES
-- ============================================================================
-- This migration adds password_hash columns to tables that require authentication
-- ============================================================================

-- Add password_hash column to guardians table
ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255);

ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP WITH TIME ZONE;

ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- Add password-related columns to parent_guardian table
ALTER TABLE parent_guardian
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

ALTER TABLE parent_guardian
ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255);

ALTER TABLE parent_guardian
ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP WITH TIME ZONE;

ALTER TABLE parent_guardian
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- Add comments to document the columns
COMMENT ON COLUMN guardians.password_hash IS 'Hashed password for guardian login authentication';
COMMENT ON COLUMN guardians.password_reset_token IS 'Token for password reset functionality';
COMMENT ON COLUMN guardians.password_reset_expires IS 'Expiration time for password reset token';
COMMENT ON COLUMN guardians.must_change_password IS 'Force password change on next login';

COMMENT ON COLUMN parent_guardian.password_hash IS 'Hashed password for parent/guardian login authentication';
COMMENT ON COLUMN parent_guardian.password_reset_token IS 'Token for password reset functionality';
COMMENT ON COLUMN parent_guardian.password_reset_expires IS 'Expiration time for password reset token';
COMMENT ON COLUMN parent_guardian.must_change_password IS 'Force password change on next login';

-- ============================================================================
-- CREATE INDEXES FOR PASSWORD RESET
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_guardians_password_reset_token
ON guardians(password_reset_token) WHERE password_reset_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parent_guardian_password_reset_token
ON parent_guardian(password_reset_token) WHERE password_reset_token IS NOT NULL;

-- ============================================================================
-- VERIFICATION QUERY - Run this to verify password columns exist
-- ============================================================================
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name IN ('guardians', 'parent_guardian')
-- AND column_name LIKE '%password%'
-- ORDER BY table_name, column_name;
