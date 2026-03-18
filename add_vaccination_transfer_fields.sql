-- Migration: Add vaccination transfer fields to immunization_records
-- This adds tracking fields for imported vaccination records from other health centers

-- Add source_facility column to track the health center where vaccine was administered
ALTER TABLE immunization_records
ADD COLUMN IF NOT EXISTS source_facility VARCHAR(255);

-- Add is_imported column to mark records that were imported from other facilities
ALTER TABLE immunization_records
ADD COLUMN IF NOT EXISTS is_imported BOOLEAN DEFAULT false;

-- Add transfer_case_id column to link to transfer_in_cases table
ALTER TABLE immunization_records
ADD COLUMN IF NOT EXISTS transfer_case_id INTEGER REFERENCES transfer_in_cases(id) ON DELETE SET NULL;

-- Create index for faster queries on imported records
CREATE INDEX IF NOT EXISTS idx_immunization_records_is_imported
ON immunization_records(is_imported);

-- Create index for faster queries by transfer_case_id
CREATE INDEX IF NOT EXISTS idx_immunization_records_transfer_case_id
ON immunization_records(transfer_case_id);

-- Create index for source_facility lookups
CREATE INDEX IF NOT EXISTS idx_immunization_records_source_facility
ON immunization_records(source_facility);

-- Add a column to store approved vaccines in transfer_in_cases for admin review
ALTER TABLE transfer_in_cases
ADD COLUMN IF NOT EXISTS approved_vaccines JSONB DEFAULT '[]'::jsonb;

-- Add column to track import status
ALTER TABLE transfer_in_cases
ADD COLUMN IF NOT EXISTS vaccines_imported BOOLEAN DEFAULT false;

-- Add column to track import date
ALTER TABLE transfer_in_cases
ADD COLUMN IF NOT EXISTS vaccines_imported_at TIMESTAMP;

-- Comment for documentation
COMMENT ON COLUMN immunization_records.source_facility IS 'Name of the health facility where the vaccine was administered (for imported records)';
COMMENT ON COLUMN immunization_records.is_imported IS 'Boolean flag indicating if this record was imported from another health center';
COMMENT ON COLUMN immunization_records.transfer_case_id IS 'Foreign key linking to transfer_in_cases table for imported records';
