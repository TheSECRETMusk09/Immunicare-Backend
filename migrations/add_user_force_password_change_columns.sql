-- ============================================================================
-- MIGRATION: Add force_password_change column to users table
-- Purpose: Track whether a user needs to change their password on first login
-- ============================================================================

-- Add force_password_change column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT false;

-- Add password_changed_at column to track when password was last changed
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster lookups on force_password_change
CREATE INDEX IF NOT EXISTS idx_users_force_password_change 
ON users(force_password_change) 
WHERE force_password_change = true;

-- Update existing guardian users who have never logged in to require password change
-- This sets force_password_change to true for guardians who have the default password
UPDATE users 
SET force_password_change = true
WHERE role_id IN (SELECT id FROM roles WHERE name = 'guardian')
  AND force_password_change = false
  AND password_changed_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.force_password_change IS 'Indicates if user must change password on next login (for new accounts or password resets)';
COMMENT ON COLUMN users.password_changed_at IS 'Timestamp when the user last changed their password';

-- Verify the migration
SELECT 
    column_name, 
    data_type, 
    column_default, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('force_password_change', 'password_changed_at');