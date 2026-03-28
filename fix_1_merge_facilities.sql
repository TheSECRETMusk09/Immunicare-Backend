-- ============================================================================
-- FIX #1: MERGE DUPLICATE FACILITY RECORDS
-- ============================================================================
-- Purpose: Merge facility ID 203 into ID 1 (San Nicolas Health Center)
-- Impact: 14,387 appointments, 522 inventory, 3,623 guardians, 3,636 users
-- ============================================================================

BEGIN;

-- Create backup timestamp
DO $$
BEGIN
    RAISE NOTICE 'Starting facility merge at %', NOW();
    RAISE NOTICE 'Merging facility ID 203 into ID 1';
END $$;

-- 1. Merge appointments (14,387 records)
UPDATE appointments 
SET clinic_id = 1 
WHERE clinic_id = 203;

-- Verify
DO $$
DECLARE
    count_moved INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_moved FROM appointments WHERE clinic_id = 1;
    RAISE NOTICE 'Appointments now in facility 1: %', count_moved;
END $$;

-- 2. Merge vaccine_inventory (522 records)
UPDATE vaccine_inventory 
SET clinic_id = 1 
WHERE clinic_id = 203;

-- Verify
DO $$
DECLARE
    count_moved INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_moved FROM vaccine_inventory WHERE clinic_id = 1;
    RAISE NOTICE 'Vaccine inventory now in facility 1: %', count_moved;
END $$;

-- 3. Merge guardians (3,623 records)
UPDATE guardians 
SET clinic_id = 1 
WHERE clinic_id = 203;

-- Verify
DO $$
DECLARE
    count_moved INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_moved FROM guardians WHERE clinic_id = 1;
    RAISE NOTICE 'Guardians now in facility 1: %', count_moved;
END $$;

-- 4. Merge users (3,636 records)
UPDATE users 
SET clinic_id = 1 
WHERE clinic_id = 203;

-- Verify
DO $$
DECLARE
    count_moved INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_moved FROM users WHERE clinic_id = 1;
    RAISE NOTICE 'Users now in facility 1: %', count_moved;
END $$;

-- 5. Merge blocked_dates (16 records)
UPDATE blocked_dates 
SET clinic_id = 1 
WHERE clinic_id = 203;

-- Verify
DO $$
DECLARE
    count_moved INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_moved FROM blocked_dates WHERE clinic_id = 1;
    RAISE NOTICE 'Blocked dates now in facility 1: %', count_moved;
END $$;

-- 6. Merge vaccine_inventory_transactions (8 records)
UPDATE vaccine_inventory_transactions 
SET clinic_id = 1 
WHERE clinic_id = 203;

-- Verify
DO $$
DECLARE
    count_moved INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_moved FROM vaccine_inventory_transactions WHERE clinic_id = 1;
    RAISE NOTICE 'Vaccine transactions now in facility 1: %', count_moved;
END $$;

-- 7. Check for any remaining records in facility 203
DO $$
DECLARE
    remaining_count INTEGER;
BEGIN
    SELECT 
        (SELECT COUNT(*) FROM appointments WHERE clinic_id = 203) +
        (SELECT COUNT(*) FROM vaccine_inventory WHERE clinic_id = 203) +
        (SELECT COUNT(*) FROM guardians WHERE clinic_id = 203) +
        (SELECT COUNT(*) FROM users WHERE clinic_id = 203) +
        (SELECT COUNT(*) FROM blocked_dates WHERE clinic_id = 203) +
        (SELECT COUNT(*) FROM vaccine_inventory_transactions WHERE clinic_id = 203)
    INTO remaining_count;
    
    IF remaining_count > 0 THEN
        RAISE EXCEPTION 'Still have % records in facility 203!', remaining_count;
    ELSE
        RAISE NOTICE 'All records successfully migrated from facility 203';
    END IF;
END $$;

-- 8. Delete the duplicate facility record
DELETE FROM clinics WHERE id = 203;

-- Verify deletion
DO $$
DECLARE
    facility_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO facility_count FROM clinics WHERE id = 203;
    IF facility_count = 0 THEN
        RAISE NOTICE 'Facility 203 successfully deleted';
    ELSE
        RAISE EXCEPTION 'Failed to delete facility 203';
    END IF;
END $$;

-- Final summary
DO $$
DECLARE
    total_appointments INTEGER;
    total_inventory INTEGER;
    total_guardians INTEGER;
    total_users INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_appointments FROM appointments WHERE clinic_id = 1;
    SELECT COUNT(*) INTO total_inventory FROM vaccine_inventory WHERE clinic_id = 1;
    SELECT COUNT(*) INTO total_guardians FROM guardians WHERE clinic_id = 1;
    SELECT COUNT(*) INTO total_users FROM users WHERE clinic_id = 1;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'MERGE COMPLETE - FACILITY 1 SUMMARY:';
    RAISE NOTICE 'Appointments: %', total_appointments;
    RAISE NOTICE 'Vaccine Inventory: %', total_inventory;
    RAISE NOTICE 'Guardians: %', total_guardians;
    RAISE NOTICE 'Users: %', total_users;
    RAISE NOTICE '========================================';
END $$;

COMMIT;

-- ============================================================================
-- END OF FACILITY MERGE
-- ============================================================================
