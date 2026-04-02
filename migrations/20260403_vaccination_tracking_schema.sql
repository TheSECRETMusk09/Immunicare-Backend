-- Migration: Vaccination Tracking Schema Enhancement
-- Date: 2026-04-03
-- Description: Move vaccination tracking schema changes from request-time to migration
-- This prevents DDL operations from running on every vaccination request

-- Add vaccination tracking columns to immunization_records
ALTER TABLE immunization_records
ADD COLUMN IF NOT EXISTS lot_number VARCHAR(255),
ADD COLUMN IF NOT EXISTS batch_number VARCHAR(255),
ADD COLUMN IF NOT EXISTS health_care_provider VARCHAR(255),
ADD COLUMN IF NOT EXISTS site_of_injection VARCHAR(255),
ADD COLUMN IF NOT EXISTS reactions TEXT,
ADD COLUMN IF NOT EXISTS next_due_date DATE;

-- Add vaccination schedule metadata columns
ALTER TABLE vaccination_schedules
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS age_description VARCHAR(255),
ADD COLUMN IF NOT EXISTS age_months NUMERIC;

-- Backfill vaccination schedule metadata
UPDATE vaccination_schedules
SET description = COALESCE(
      description,
      CONCAT(COALESCE(vaccine_name, 'Vaccine'), ' dose ', COALESCE(dose_number, 1))
    ),
    age_description = COALESCE(
      age_description,
      CASE
        WHEN age_in_months IS NOT NULL THEN CONCAT(age_in_months, ' month schedule')
        ELSE description
      END
    ),
    age_months = COALESCE(age_months, age_in_months)
WHERE description IS NULL
   OR age_description IS NULL
   OR age_months IS NULL;

-- Add vaccine batch tracking columns
ALTER TABLE vaccine_batches
ADD COLUMN IF NOT EXISTS lot_no VARCHAR(255),
ADD COLUMN IF NOT EXISTS lot_number VARCHAR(255),
ADD COLUMN IF NOT EXISTS supplier_id INTEGER,
ADD COLUMN IF NOT EXISTS manufacture_date DATE,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Normalize lot_no field
UPDATE vaccine_batches
SET lot_no = COALESCE(NULLIF(TRIM(lot_no), ''), NULLIF(TRIM(lot_number), ''))
WHERE lot_no IS NULL
   OR TRIM(lot_no) = '';

-- Create suppliers table if not exists
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed default vaccination schedules if table is empty
DO $$
DECLARE
  schedule_count INTEGER;
BEGIN
  SELECT COUNT(*)::INT INTO schedule_count
  FROM vaccination_schedules
  WHERE is_active = true;

  IF schedule_count = 0 THEN
    -- BCG at birth
    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 1, 1, 0, 0, 0, 'At birth', 'BCG at birth', true
    FROM vaccines v
    WHERE v.name = 'BCG'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 1
      );

    -- Hepa B at birth
    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 1, 1, 0, 0, 0, 'At birth', 'Hepa B at birth', true
    FROM vaccines v
    WHERE v.name = 'Hepa B'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 1
      );

    -- Penta Valent doses
    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 1, 3, 2, 60, 2, '2 months', 'Penta dose 1', true
    FROM vaccines v
    WHERE v.name = 'Penta Valent'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 1
      );

    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 2, 3, 3, 90, 3, '3 months', 'Penta dose 2', true
    FROM vaccines v
    WHERE v.name = 'Penta Valent'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 2
      );

    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 3, 3, 4, 120, 4, '4 months', 'Penta dose 3', true
    FROM vaccines v
    WHERE v.name = 'Penta Valent'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 3
      );

    -- OPV doses
    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 1, 3, 2, 60, 2, '2 months', 'OPV dose 1', true
    FROM vaccines v
    WHERE v.name = 'OPV 20-doses'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 1
      );

    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 2, 3, 3, 90, 3, '3 months', 'OPV dose 2', true
    FROM vaccines v
    WHERE v.name = 'OPV 20-doses'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 2
      );

    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 3, 3, 4, 120, 4, '4 months', 'OPV dose 3', true
    FROM vaccines v
    WHERE v.name = 'OPV 20-doses'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 3
      );

    -- PCV 13 doses
    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 1, 3, 2, 60, 2, '2 months', 'PCV 13 dose 1', true
    FROM vaccines v
    WHERE v.name = 'PCV 13'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 1
      );

    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 2, 3, 3, 90, 3, '3 months', 'PCV 13 dose 2', true
    FROM vaccines v
    WHERE v.name = 'PCV 13'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 2
      );

    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 3, 3, 4, 120, 4, '4 months', 'PCV 13 dose 3', true
    FROM vaccines v
    WHERE v.name = 'PCV 13'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 3
      );

    -- PCV 10 doses
    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 1, 3, 2, 60, 2, '2 months', 'PCV 10 dose 1', true
    FROM vaccines v
    WHERE v.name = 'PCV 10'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 1
      );

    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 2, 3, 3, 90, 3, '3 months', 'PCV 10 dose 2', true
    FROM vaccines v
    WHERE v.name = 'PCV 10'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 2
      );

    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 3, 3, 4, 120, 4, '4 months', 'PCV 10 dose 3', true
    FROM vaccines v
    WHERE v.name = 'PCV 10'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 3
      );

    -- IPV doses
    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 1, 2, 3, 90, 3, '3 months', 'IPV dose 1', true
    FROM vaccines v
    WHERE v.name = 'IPV multi dose'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 1
      );

    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 2, 2, 9, 270, 9, '9 months', 'IPV dose 2', true
    FROM vaccines v
    WHERE v.name = 'IPV multi dose'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 2
      );

    -- Measles & Rubella
    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 1, 1, 9, 270, 9, '9 months', 'Measles and Rubella dose', true
    FROM vaccines v
    WHERE v.name = 'Measles & Rubella (MR)'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 1
      );

    -- MMR
    INSERT INTO vaccination_schedules (
      vaccine_id, vaccine_name, vaccine_code, dose_number, total_doses,
      age_in_months, minimum_age_days, age_months, age_description, description, is_active
    )
    SELECT v.id, v.name, v.code, 1, 1, 12, 365, 12, '12 months', 'MMR dose', true
    FROM vaccines v
    WHERE v.name = 'MMR'
      AND NOT EXISTS (
        SELECT 1 FROM vaccination_schedules existing_schedule
        WHERE existing_schedule.vaccine_id = v.id AND existing_schedule.dose_number = 1
      );
  END IF;
END $$;
