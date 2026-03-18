-- ============================================================================
-- Database Migration: Add age_months column and automatic update trigger
--
-- This migration:
-- 1. Adds age_months column to patients table
-- 2. Creates a trigger function to auto-update age when dob changes
-- 3. Backfills existing records with calculated age
-- ============================================================================

-- Step 1: Add age_months column if it doesn't exist
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS age_months INTEGER;

-- Step 2: Create trigger function to auto-update age_months
CREATE OR REPLACE FUNCTION fn_auto_update_age_months()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate age in months from the new dob
    IF NEW.dob IS NOT NULL THEN
        NEW.age_months := EXTRACT(YEAR FROM AGE(CURRENT_DATE, NEW.dob)) * 12
                        + EXTRACT(MONTH FROM AGE(CURRENT_DATE, NEW.dob));
    ELSE
        NEW.age_months := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_auto_update_age_months() IS 'Automatically updates age_months when dob changes';

-- Step 3: Create trigger
DROP TRIGGER IF EXISTS trg_patients_auto_age ON patients;

CREATE TRIGGER trg_patients_auto_age
    BEFORE INSERT OR UPDATE OF dob ON patients
    FOR EACH ROW
    EXECUTE FUNCTION fn_auto_update_age_months();

-- Step 4: Create index for faster age-based queries
CREATE INDEX IF NOT EXISTS idx_patients_age_months ON patients(age_months);

-- Step 5: Backfill existing records with age calculation
UPDATE patients
SET age_months = EXTRACT(YEAR FROM AGE(CURRENT_DATE, dob)) * 12
               + EXTRACT(MONTH FROM AGE(CURRENT_DATE, dob))
WHERE is_active = true
  AND dob IS NOT NULL
  AND age_months IS NULL;

-- Verification
SELECT
    'Patients table migration complete' AS status,
    COUNT(*) AS total_records,
    COUNT(age_months) AS records_with_age
FROM patients
WHERE is_active = true;
