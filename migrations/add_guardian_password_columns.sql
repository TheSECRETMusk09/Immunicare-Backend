-- Migration: Add password columns to guardians table
-- This allows guardians to login with their email and password

-- Add password_hash column if not exists
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Add is_password_set column if not exists
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS is_password_set BOOLEAN DEFAULT FALSE;

-- Add last_login column for tracking
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;

-- Add must_change_password column for force password change on first login
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_guardians_password_lookup ON guardians(email);

COMMENT ON COLUMN guardians.password_hash IS 'Hashed password for guardian login';
COMMENT ON COLUMN guardians.is_password_set IS 'Whether the guardian has set a password';
COMMENT ON COLUMN guardians.last_login IS 'Last login timestamp';
COMMENT ON COLUMN guardians.must_change_password IS 'Force password change on next login';
