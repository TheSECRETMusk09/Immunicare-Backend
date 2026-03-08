-- ============================================================================
-- DEPRECATED MIGRATION FILE
-- ============================================================================
-- Status: DEPRECATED as of 2026-02-04
-- Reason: This structure is already included in backend/schema.sql
-- Canonical Source: backend/schema.sql
-- ============================================================================
-- 
-- Migration: Add photo_url to patients table and location to appointments table
-- Date: 2026-01-31
-- Description: Add support for child photo uploads and appointment locations
-- 
-- NOTE: This migration is deprecated. These fields are already defined
-- in the main schema (backend/schema.sql).
-- 
-- DO NOT RUN THIS FILE. Use backend/schema.sql instead.
-- ============================================================================

-- Add photo_url column to patients table
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500);

-- Add location column to appointments table
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS location VARCHAR(255);

-- Add comments to document the new columns
COMMENT ON COLUMN patients.photo_url IS 'URL to the patient''s profile photo stored in uploads directory';
COMMENT ON COLUMN appointments.location IS 'Physical location of the appointment (e.g., Room 2, Health Center)';

-- Create index on photo_url for faster lookups
CREATE INDEX IF NOT EXISTS idx_patients_photo_url ON patients(photo_url);

-- Create index on location for filtering appointments by location
CREATE INDEX IF NOT EXISTS idx_appointments_location ON appointments(location);

-- Verify the columns were added successfully
SELECT 
    'patients' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'patients' AND column_name = 'photo_url'
UNION ALL
SELECT 
    'appointments' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'appointments' AND column_name = 'location';

-- ============================================================================
-- END OF DEPRECATED MIGRATION
-- ============================================================================
