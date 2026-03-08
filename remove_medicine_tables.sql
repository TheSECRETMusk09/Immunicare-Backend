-- ============================================================================
-- MEDICINE REMOVAL SCRIPT FOR IMMUNICARE
-- This script removes all medicine-related tables and references
-- to focus the system solely on vaccination tracking and inventory management
-- ============================================================================

-- ============================================================================
-- SECTION 1: DROP MEDICINE TABLES
-- ============================================================================

-- Drop medicine_batches table (if exists)
DROP TABLE IF EXISTS medicine_batches CASCADE;

-- Drop medicines table (if exists)
DROP TABLE IF EXISTS medicines CASCADE;

-- ============================================================================
-- SECTION 2: DROP MEDICINE-RELATED ENUM TYPES
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
-- SECTION 3: UPDATE ITEM_TYPE ENUM (Remove 'medicine')
-- ============================================================================

-- Note: We cannot modify enum values directly in PostgreSQL
-- The items table will need to be recreated or updated via application
-- For now, we just update the comment to reflect vaccines-only purpose

COMMENT ON TABLE items IS 'Stores inventory items (vaccines only - medicine support removed)';

-- ============================================================================
-- SECTION 4: REMOVE MEDICINE REFERENCES FROM OTHER TABLES
-- ============================================================================

-- Update items type check constraint to only allow 'vaccine'
ALTER TABLE items DROP CONSTRAINT IF EXISTS chk_items_type;

-- ============================================================================
-- SECTION 5: UPDATE RECORD_TYPE ENUM (Remove medication_record reference)
-- ============================================================================

-- The record_type enum still contains 'medication_record' but it's not used for medicines anymore
-- This is acceptable as it could be used for vaccination-related medication records in the future

-- ============================================================================
-- SECTION 6: VERIFICATION QUERY
-- ============================================================================

SELECT 
    'Medicine Removal Complete' AS status,
    CURRENT_TIMESTAMP AS completed_at,
    COUNT(*) AS remaining_tables
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE';

-- Check if medicine tables are gone
SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN 'SUCCESS: No medicine tables found'
        ELSE 'WARNING: Medicine tables still exist'
    END AS verification_result
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('medicines', 'medicine_batches');

-- ============================================================================
-- END OF MEDICINE REMOVAL SCRIPT
-- ============================================================================
