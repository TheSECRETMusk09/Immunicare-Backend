-- Migration: Add clinic_id to infants table
-- Fixes error: column "p.clinic_id" does not exist in admin vaccination monitoring endpoint
-- Target Table: infants (aliased as 'p' in queries)

-- 1. Add the missing column
ALTER TABLE infants
ADD COLUMN IF NOT EXISTS clinic_id INTEGER REFERENCES clinics(id);

-- 2. Create index for performance on monitoring queries
CREATE INDEX IF NOT EXISTS idx_infants_clinic_id ON infants(clinic_id);

-- 3. Populate existing records based on guardian's user account
UPDATE infants i
SET clinic_id = u.clinic_id
FROM users u
WHERE i.guardian_id = u.guardian_id
AND i.clinic_id IS NULL;
