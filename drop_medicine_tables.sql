-- ============================================================================
-- MEDICINE REMOVAL SCRIPT FOR IMMUNICARE
-- Run this script in pgAdmin 4 to remove medicine tables from the database
-- This focuses the system solely on vaccination tracking and inventory management
-- ============================================================================

-- ============================================================================
-- SECTION 1: DROP MEDICINE BATCHES TABLE
-- ============================================================================

-- Drop medicine_batches table (if exists)
DROP TABLE IF EXISTS medicine_batches CASCADE;

-- ============================================================================
-- SECTION 2: DROP MEDICINES TABLE
-- ============================================================================

-- Drop medicines table (if exists)
DROP TABLE IF EXISTS medicines CASCADE;

-- ============================================================================
-- SECTION 3: DROP MEDICINE ENUM TYPES
-- ============================================================================

-- Drop medicine_type enum (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medicine_type') THEN
        DROP TYPE medicine_type;
    END IF;
END $$;

-- Drop medicine_form enum (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medicine_form') THEN
        DROP TYPE medicine_form;
    END IF;
END $$;

-- ============================================================================
-- SECTION 4: VERIFY REMOVAL
-- ============================================================================

-- Check if medicine tables are gone
SELECT 
    CASE
        WHEN COUNT(*) = 0 THEN 'SUCCESS: No medicine tables found'
        ELSE 'WARNING: Medicine tables still exist'
    END AS result
FROM information_schema.tables 
WHERE table_schema = 'public'
AND table_name IN ('medicines', 'medicine_batches');

-- List remaining tables to confirm
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;
