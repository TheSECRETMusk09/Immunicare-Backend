-- Fix database schema issues for Guardian Dashboard
-- Run this SQL to fix enum and column issues

-- 1. Add 'confirmed' status to appointment_status enum if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status' 
                   AND EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'appointment_status') AND enumlabel = 'confirmed')) THEN
        ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'confirmed';
        RAISE NOTICE 'Added confirmed status to appointment_status enum';
    ELSE
        RAISE NOTICE 'confirmed status already exists in appointment_status enum';
    END IF;
END $$;

-- 2. Check if infant_id column exists in appointments table, if not add it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'appointments' AND column_name = 'infant_id') THEN
        -- First check if patient_id exists
        IF EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'appointments' AND column_name = 'patient_id') THEN
            -- Rename patient_id to infant_id
            ALTER TABLE appointments RENAME COLUMN patient_id TO infant_id;
            RAISE NOTICE 'Renamed patient_id to infant_id in appointments table';
        ELSE
            -- Add infant_id column
            ALTER TABLE appointments ADD COLUMN infant_id INTEGER REFERENCES patients(id);
            RAISE NOTICE 'Added infant_id column to appointments table';
        END IF;
    ELSE
        RAISE NOTICE 'infant_id column already exists in appointments table';
    END IF;
END $$;

-- 3. Add guardian_id to patients table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'patients' AND column_name = 'guardian_id') THEN
        ALTER TABLE patients ADD COLUMN guardian_id INTEGER REFERENCES guardians(id);
        RAISE NOTICE 'Added guardian_id column to patients table';
    ELSE
        RAISE NOTICE 'guardian_id column already exists in patients table';
    END IF;
END $$;

-- 4. Add age_months column alias for age_in_months in vaccination_schedules
-- (This is handled in the code by using the correct column name)

-- 5. Add number_of_doses column to vaccines table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vaccines' AND column_name = 'number_of_doses') THEN
        -- Check if doses_required exists
        IF EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vaccines' AND column_name = 'doses_required') THEN
            ALTER TABLE vaccines RENAME COLUMN doses_required TO number_of_doses;
            RAISE NOTICE 'Renamed doses_required to number_of_doses in vaccines table';
        ELSE
            ALTER TABLE vaccines ADD COLUMN number_of_doses INTEGER;
            RAISE NOTICE 'Added number_of_doses column to vaccines table';
        END IF;
    ELSE
        RAISE NOTICE 'number_of_doses column already exists in vaccines table';
    END IF;
END $$;

-- 6. Create alias view for infants table pointing to patients
CREATE OR REPLACE VIEW infants AS 
SELECT * FROM patients;

-- 7. Fix notification_priority type issue
-- The priority column should be text or use the correct type
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'notifications' AND column_name = 'priority') THEN
        -- Check if priority is using the enum type
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_priority') THEN
            RAISE NOTICE 'notification_priority enum exists, will use proper casting in queries';
        END IF;
    END IF;
END $$;

-- Verify the fixes
SELECT 'Appointment Status Values:' as info;
SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'appointment_status') ORDER BY enumlabel;

SELECT 'Appointments Table Columns:' as info;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'appointments' ORDER BY ordinal_position;

SELECT 'Vaccines Table Columns:' as info;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'vaccines' ORDER BY ordinal_position;
