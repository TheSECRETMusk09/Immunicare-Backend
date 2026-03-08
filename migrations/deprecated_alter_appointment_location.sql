-- ============================================================================
-- DEPRECATED MIGRATION FILE
-- ============================================================================
-- Status: DEPRECATED as of 2026-02-04
-- Reason: This structure is already included in backend/schema.sql
-- Canonical Source: backend/schema.sql
-- ============================================================================
-- 
-- Migration: Add location field to appointments table
-- Date: 2026-01-31
-- Description: Adds location field to appointments table to support displaying appointment locations
-- 
-- NOTE: This migration is deprecated. The location field is already defined
-- in the appointments table within backend/schema.sql.
-- 
-- DO NOT RUN THIS FILE. Use backend/schema.sql instead.
-- ============================================================================

-- Add location column to appointments table
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS location VARCHAR(255);

-- Add comment to the new column
COMMENT ON COLUMN appointments.location IS 'Physical location where the appointment will take place (e.g., Room 2, Health Center)';

-- Create index on location for faster queries
CREATE INDEX IF NOT EXISTS idx_appointments_location ON appointments(location);

-- Verify the column was added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'appointments' AND column_name = 'location';

-- ============================================================================
-- END OF DEPRECATED MIGRATION
-- ============================================================================
