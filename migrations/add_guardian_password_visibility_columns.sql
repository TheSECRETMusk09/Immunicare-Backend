-- Migration: Add guardian password visibility encrypted payload columns
-- Purpose: Support admin/super_admin guarded password visibility workflow with auditability

ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS password_visibility_payload TEXT;

ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS password_visibility_updated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS password_visibility_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN guardians.password_visibility_payload IS 'Encrypted guardian password visibility payload (AES-GCM), never plain text';
COMMENT ON COLUMN guardians.password_visibility_updated_at IS 'Timestamp when password visibility payload was last refreshed';
COMMENT ON COLUMN guardians.password_visibility_updated_by IS 'System admin user id who last updated password visibility payload';

