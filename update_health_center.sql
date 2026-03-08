-- ============================================================================
-- UPDATE HEALTH CENTER INFORMATION
-- Script to update San Nicolas Health Center details
-- Date: 2026-02-25
-- ============================================================================

-- Health Center Details:
-- - Name: San Nicolas Health Center
-- - Region: NCR
-- - Province: Metro Manila
-- - City: Pasig City
-- - Barangay: San Nicolas
-- - Street: M.H. Del Pilar Street
-- - Zip code: 1600-1612

-- Check current clinics
SELECT id, name, region, address, contact FROM clinics ORDER BY id;

-- Update the San Nicolas Health Center (id=1)
UPDATE clinics 
SET 
    name = 'San Nicolas Health Center',
    region = 'NCR',
    address = 'M.H. Del Pilar Street, San Nicolas, Pasig City, Metro Manila, 1600-1612',
    contact = '(02) 643-1111',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- Verify the update
SELECT 
    id, 
    name, 
    region, 
    address, 
    contact,
    updated_at
FROM clinics 
WHERE id = 1;

-- ============================================================================
-- END OF UPDATE SCRIPT
-- ============================================================================
