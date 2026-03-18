-- ============================================================================
-- Database Schema Fix Migrations for Immunicare
-- Fixes missing columns and schema inconsistencies
-- ============================================================================

-- 1. Add age_in_days column to patient_growth table
-- This fixes the growth API errors
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patient_growth' AND column_name = 'age_in_days'
    ) THEN
        ALTER TABLE patient_growth ADD COLUMN age_in_days INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_patient_growth_age_in_days ON patient_growth(age_in_days);
        RAISE NOTICE 'Added age_in_days column to patient_growth table';
    ELSE
        RAISE NOTICE 'age_in_days column already exists in patient_growth table';
    END IF;
END $$;

-- 2. Add is_active column to patient_growth table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patient_growth' AND column_name = 'is_active'
    ) THEN
        ALTER TABLE patient_growth ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
        CREATE INDEX IF NOT EXISTS idx_patient_growth_is_active ON patient_growth(is_active);
        RAISE NOTICE 'Added is_active column to patient_growth table';
    ELSE
        RAISE NOTICE 'is_active column already exists in patient_growth table';
    END IF;
END $$;

-- 3. Add is_active column to vaccine_inventory table
-- This fixes the error: "column vi.is_active does not exist"
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vaccine_inventory' AND column_name = 'is_active'
    ) THEN
        ALTER TABLE vaccine_inventory ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
        RAISE NOTICE 'Added is_active column to vaccine_inventory table';
    ELSE
        RAISE NOTICE 'is_active column already exists in vaccine_inventory table';
    END IF;
END $$;

-- 4. Add guardian_id column to notifications table
-- This fixes the guardian notification queries
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications' AND column_name = 'guardian_id'
    ) THEN
        ALTER TABLE notifications ADD COLUMN guardian_id INTEGER REFERENCES guardians(id) ON DELETE CASCADE;
        CREATE INDEX IF NOT EXISTS idx_notifications_guardian_id ON notifications(guardian_id);
        RAISE NOTICE 'Added guardian_id column to notifications table';
    ELSE
        RAISE NOTICE 'guardian_id column already exists in notifications table';
    END IF;
END $$;

-- 5. Add target_role column to notifications for role-based filtering
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications' AND column_name = 'target_role'
    ) THEN
        ALTER TABLE notifications ADD COLUMN target_role VARCHAR(50) DEFAULT 'all';
        CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON notifications(target_role);
        RAISE NOTICE 'Added target_role column to notifications table';
    ELSE
        RAISE NOTICE 'target_role column already exists in notifications table';
    END IF;
END $$;

-- 6. Add is_read column to notifications if it doesn't exist
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications' AND column_name = 'is_read'
    ) THEN
        ALTER TABLE notifications ADD COLUMN is_read BOOLEAN DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
        RAISE NOTICE 'Added is_read column to notifications table';
    ELSE
        RAISE NOTICE 'is_read column already exists in notifications table';
    END IF;
END $$;

-- 7. Add priority column to notifications if it doesn't exist
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications' AND column_name = 'priority'
    ) THEN
        ALTER TABLE notifications ADD COLUMN priority VARCHAR(20) DEFAULT 'normal';
        CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
        RAISE NOTICE 'Added priority column to notifications table';
    ELSE
        RAISE NOTICE 'priority column already exists in notifications table';
    END IF;
END $$;

-- 8. Add clinic_id column to appointments if missing
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'clinic_id'
    ) THEN
        ALTER TABLE appointments ADD COLUMN clinic_id INTEGER REFERENCES healthcare_facilities(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added clinic_id column to appointments table';
    ELSE
        RAISE NOTICE 'clinic_id column already exists in appointments table';
    END IF;
END $$;

-- 9. Add stock_on_hand column to vaccine_inventory (common in inventory tracking)
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vaccine_inventory' AND column_name = 'stock_on_hand'
    ) THEN
        ALTER TABLE vaccine_inventory ADD COLUMN stock_on_hand INTEGER DEFAULT 0;
        RAISE NOTICE 'Added stock_on_hand column to vaccine_inventory table';
    ELSE
        RAISE NOTICE 'stock_on_hand column already exists in vaccine_inventory table';
    END IF;
END $$;

-- 10. Add infant_id column to appointments if it uses infant_id instead of patient_id
-- Check if infant_id exists or if we need to add it
DO $$
BEGIN
    -- Check if appointments has infant_id or patient_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'infant_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'patient_id'
    ) THEN
        ALTER TABLE appointments ADD COLUMN infant_id INTEGER REFERENCES patients(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added infant_id column to appointments table';
    ELSE
        RAISE NOTICE 'infant_id or patient_id column already exists in appointments table';
    END IF;
END $$;

-- 11. Add clinic_id column to infant_documents/documents if missing
-- This fixes the error: "column clinic_id does not exist" in infant documents
-- ============================================================================
DO $$
BEGIN
    -- Check for infant_documents table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'infant_documents') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'infant_documents' AND column_name = 'clinic_id') THEN
            ALTER TABLE infant_documents ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL;
            RAISE NOTICE 'Added clinic_id column to infant_documents table';
        END IF;
    END IF;

    -- Check for documents table (alternative naming)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'documents') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'clinic_id') THEN
            ALTER TABLE documents ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL;
            RAISE NOTICE 'Added clinic_id column to documents table';
        END IF;
    END IF;
END $$;

-- 12. Create blocked_dates table if missing
-- This fixes the "Error getting blocked dates" backend issue
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'blocked_dates') THEN
        CREATE TABLE blocked_dates (
            id SERIAL PRIMARY KEY,
            blocked_date DATE NOT NULL UNIQUE,
            is_blocked BOOLEAN NOT NULL DEFAULT TRUE,
            reason TEXT,
            blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            clinic_id INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_blocked_dates_date ON blocked_dates(blocked_date);
        CREATE INDEX idx_blocked_dates_clinic ON blocked_dates(clinic_id);
        RAISE NOTICE 'Created blocked_dates table';
    ELSE
        RAISE NOTICE 'blocked_dates table already exists';
    END IF;
END $$;

-- ============================================================================
-- Verification of tables
-- ============================================================================
SELECT 'Schema migrations completed' as status;

-- Check specific columns
SELECT
    'patient_growth' as table_name,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patient_growth' AND column_name = 'age_in_days'
    ) THEN 'OK' ELSE 'MISSING age_in_days' END as age_in_days_status,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patient_growth' AND column_name = 'is_active'
    ) THEN 'OK' ELSE 'MISSING is_active' END as is_active_status
UNION ALL
SELECT
    'vaccine_inventory',
    'N/A' as age_in_days_status,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vaccine_inventory' AND column_name = 'is_active'
    ) THEN 'OK' ELSE 'MISSING is_active' END
UNION ALL
SELECT
    'notifications',
    'N/A' as age_in_days_status,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications' AND column_name = 'guardian_id'
    ) THEN 'OK' ELSE 'MISSING guardian_id' END
UNION ALL
SELECT
    'infant_documents',
    'N/A' as age_in_days_status,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'infant_documents' AND column_name = 'clinic_id'
    ) THEN 'OK' ELSE 'MISSING clinic_id' END
UNION ALL
SELECT
    'blocked_dates',
    'N/A' as age_in_days_status,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'blocked_dates'
    ) THEN 'OK' ELSE 'MISSING table' END;
