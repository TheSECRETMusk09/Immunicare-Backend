-- This script temporarily drops NOT NULL constraints to allow seeding data
-- It will be reverted after seeding

-- Drop the NOT NULL constraint on infants.guardian_id
ALTER TABLE infants ALTER COLUMN guardian_id DROP NOT NULL;

-- Drop the NOT NULL constraint on parent_guardian.infant_id (if exists)
-- ALTER TABLE parent_guardian ALTER COLUMN infant_id DROP NOT NULL;
