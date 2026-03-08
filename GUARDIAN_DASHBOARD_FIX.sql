-- ============================================================================
// COMPREHENSIVE GUARDIAN DASHBOARD FIX
// Fixes for Backend API and Database Schema Issues
// ============================================================================

-- FIX 1: Add missing columns to immunization_records table if they don't exist
-- This fixes the "column ir.dose_no does not exist" error

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'immunization_records' 
        AND column_name = 'dose_no'
    ) THEN
        ALTER TABLE immunization_records ADD COLUMN dose_no INTEGER NOT NULL DEFAULT 1;
        RAISE NOTICE 'Added dose_no column to immunization_records';
    ELSE
        RAISE NOTICE 'dose_no column already exists in immunization_records';
    END IF;
END $$;

-- FIX 2: Ensure vaccines table has doses_required column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'vaccines' 
        AND column_name = 'doses_required'
    ) THEN
        ALTER TABLE vaccines ADD COLUMN doses_required INTEGER NOT NULL DEFAULT 1;
        RAISE NOTICE 'Added doses_required column to vaccines';
    ELSE
        RAISE NOTICE 'doses_required column already exists in vaccines';
    END IF;
END $$;

-- FIX 3: Add missing status column to immunization_records
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'immunization_records' 
        AND column_name = 'status'
    ) THEN
        ALTER TABLE immunization_records ADD COLUMN status VARCHAR(20) DEFAULT 'completed';
        RAISE NOTICE 'Added status column to immunization_records';
    ELSE
        RAISE NOTICE 'status column already exists in immunization_records';
    END IF;
END $$;

-- ============================================================================
// FIX 4: Update the Notification Model to handle ENUM priority properly
// ============================================================================

-- The priority column is ENUM type: 'low', 'normal', 'high', 'urgent'
-- We need to update queries to use string comparisons instead of integer

-- ============================================================================
// FIX 5: Create a view to simplify guardian dashboard queries
-- ============================================================================

-- Create a comprehensive guardian dashboard view
CREATE OR REPLACE VIEW guardian_dashboard_view AS
SELECT 
    g.id as guardian_id,
    g.name as guardian_name,
    g.phone as guardian_phone,
    g.email as guardian_email,
    COUNT(DISTINCT i.id) as children_count,
    COUNT(DISTINCT ir.id) as total_vaccinations,
    COUNT(DISTINCT CASE WHEN ir.status = 'completed' THEN ir.id END) as completed_vaccinations,
    COUNT(DISTINCT CASE WHEN ir.status = 'scheduled' OR ir.status = 'overdue' THEN ir.id END) as pending_vaccinations,
    COUNT(DISTINCT CASE WHEN ir.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' THEN ir.id END) as upcoming_vaccinations_30_days,
    COUNT(DISTINCT a.id) as total_appointments,
    COUNT(DISTINCT CASE WHEN a.scheduled_date >= CURRENT_DATE AND a.status IN ('scheduled', 'rescheduled') THEN a.id END) as upcoming_appointments,
    COUNT(DISTINCT CASE WHEN a.scheduled_date >= CURRENT_DATE AND a.status IN ('scheduled', 'rescheduled') THEN a.id END) as next_appointment_date,
    MIN(a.scheduled_date) as next_appointment_datetime
FROM guardians g
LEFT JOIN infants i ON i.guardian_id = g.id
LEFT JOIN immunization_records ir ON ir.patient_id = i.id AND ir.is_active = true
LEFT JOIN appointments a ON a.infant_id = i.id AND a.is_active = true
WHERE g.is_active = true
GROUP BY g.id, g.name, g.phone, g.email;

-- ============================================================================
// FIX 6: Update dashboard routes to be more robust
-- ============================================================================

-- The following fixes should be applied to the backend routes
-- See the JavaScript fixes below
