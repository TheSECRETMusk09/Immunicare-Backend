-- Migration: Add unique constraint to guardians.email
-- Run this to enable ON CONFLICT functionality in tests

-- First, check for duplicate emails
SELECT email, COUNT(*) as cnt
FROM guardians
GROUP BY email
HAVING COUNT(*) > 1;

-- Remove duplicates keeping only the first entry
DELETE FROM guardians
WHERE id NOT IN (
  SELECT MIN(id)
  FROM guardians
  GROUP BY email
);

-- Add unique constraint if not exists
ALTER TABLE guardians
ADD CONSTRAINT guardians_email_unique UNIQUE (email);

-- Verify the constraint
SELECT conname
FROM pg_constraint
WHERE conname = 'guardians_email_unique';
