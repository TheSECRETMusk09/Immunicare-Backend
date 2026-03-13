-- Database schema for infant vaccine readiness tracking
-- This tracks when an admin has confirmed that an infant is ready to receive specific vaccines

-- Create infant_vaccine_readiness table to track per-vaccine readiness
CREATE TABLE IF NOT EXISTS infant_vaccine_readiness (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON DELETE CASCADE,
    is_ready BOOLEAN NOT NULL DEFAULT false,
    ready_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ready_confirmed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Unique constraint to ensure one readiness record per infant per vaccine
    CONSTRAINT unique_infant_vaccine_readiness UNIQUE (infant_id, vaccine_id, is_active)
);

-- Create indexes for infant_vaccine_readiness table
CREATE INDEX IF NOT EXISTS idx_infant_vaccine_readiness_infant_id
ON infant_vaccine_readiness(infant_id)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_infant_vaccine_readiness_vaccine_id
ON infant_vaccine_readiness(vaccine_id)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_infant_vaccine_readiness_is_ready
ON infant_vaccine_readiness(is_ready)
WHERE is_active = true AND is_ready = true;

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trg_infant_vaccine_readiness_update_timestamp
    BEFORE UPDATE ON infant_vaccine_readiness
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment to explain the table purpose
COMMENT ON TABLE infant_vaccine_readiness IS 'Tracks per-vaccine readiness confirmation for infants. Admin must explicitly confirm infant is ready before vaccination can be marked complete.';
COMMENT ON COLUMN infant_vaccine_readiness.is_ready IS 'Whether the infant is confirmed ready to receive this vaccine by an administrator';
COMMENT ON COLUMN infant_vaccine_readiness.ready_confirmed_by IS 'User ID of the administrator who confirmed the infant is ready';
COMMENT ON COLUMN infant_vaccine_readiness.ready_confirmed_at IS 'Timestamp when readiness was confirmed';

-- Add is_ready column to immunization_records table if it doesn't exist
-- This allows tracking whether a vaccination was administered after admin confirmation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'immunization_records'
        AND column_name = 'ready_confirmed'
    ) THEN
        ALTER TABLE immunization_records ADD COLUMN is_ready_confirmed BOOLEAN DEFAULT false;
        ALTER TABLE immunization_records ADD COLUMN ready_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE immunization_records ADD COLUMN ready_confirmed_at TIMESTAMP WITH TIME ZONE;

        COMMENT ON COLUMN immunization_records.is_ready_confirmed IS 'Whether admin confirmed infant was ready before vaccination was administered';
        COMMENT ON COLUMN immunization_records.ready_confirmed_by IS 'User ID of admin who confirmed readiness';
        COMMENT ON COLUMN immunization_records.ready_confirmed_at IS 'Timestamp when readiness was confirmed';
    END IF;
END $$;

-- Add status column to track vaccination record completion status
-- pending = not yet administered
-- ready = infant is ready, awaiting administration
-- completed = vaccination has been administered
-- missed = vaccination was missed/overdue
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'immunization_records'
        AND column_name = 'vaccination_status'
    ) THEN
        ALTER TABLE immunization_records ADD COLUMN vaccination_status VARCHAR(20) DEFAULT 'pending';

        COMMENT ON COLUMN immunization_records.vaccination_status IS 'Status of vaccination: pending, ready, completed, missed';
    END IF;
END $$;

-- Create audit log table for vaccination transactions
CREATE TABLE IF NOT EXISTS vaccination_audit_log (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,
    previous_status VARCHAR(50),
    new_status VARCHAR(50),
    inventory_deducted BOOLEAN DEFAULT false,
    inventory_transaction_id INTEGER,
    performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vaccination_audit_log_infant_id
ON vaccination_audit_log(infant_id);

CREATE INDEX IF NOT EXISTS idx_vaccination_audit_log_created_at
ON vaccination_audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_vaccination_audit_log_action_type
ON vaccination_audit_log(action_type);

-- Add is_ready column to vaccination_schedules table for schedule-based readiness calculation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vaccination_schedules'
        AND column_name = 'minimum_age_days'
    ) THEN
        ALTER TABLE vaccination_schedules ADD COLUMN minimum_age_days INTEGER;
        ALTER TABLE vaccination_schedules ADD COLUMN grace_period_days INTEGER DEFAULT 7;

        -- Update minimum_age_days based on existing age_months
        UPDATE vaccination_schedules SET minimum_age_days = age_in_months * 30 WHERE minimum_age_days IS NULL;

        COMMENT ON COLUMN vaccination_schedules.minimum_age_days IS 'Minimum age in days before infant is eligible for this vaccine';
        COMMENT ON COLUMN vaccination_schedules.grace_period_days IS 'Grace period in days after minimum age before vaccine becomes overdue';
    END IF;
END $$;

-- Insert default vaccination schedules with minimum age if not already set
INSERT INTO vaccination_schedules (vaccine_name, dose_number, dose_name, age_months, age_description, description, minimum_age_days, grace_period_days) VALUES
    ('BCG Vaccine', 1, 'BCG', 0, 'At Birth', 'Tuberculosis vaccine given at birth', 0, 14),
    ('Hepatitis B', 1, 'HepB Dose 1', 0, 'At Birth', 'First dose of Hepatitis B vaccine', 0, 14),
    ('Hepatitis B', 2, 'HepB Dose 2', 1, '1 Month', 'Second dose of Hepatitis B vaccine', 30, 14),
    ('Pentavalent Vaccine', 1, 'Penta 1', 1.5, '6 Weeks', 'First dose of pentavalent vaccine (DPT-HepB-Hib)', 42, 14),
    ('Pentavalent Vaccine', 2, 'Penta 2', 2.5, '10 Weeks', 'Second dose of pentavalent vaccine', 70, 14),
    ('Pentavalent Vaccine', 3, 'Penta 3', 3.5, '14 Weeks', 'Third dose of pentavalent vaccine', 98, 14),
    ('Oral Polio Vaccine', 1, 'OPV 1', 1.5, '6 Weeks', 'First dose of oral polio vaccine', 42, 14),
    ('Oral Polio Vaccine', 2, 'OPV 2', 2.5, '10 Weeks', 'Second dose of oral polio vaccine', 70, 14),
    ('Oral Polio Vaccine', 3, 'OPV 3', 3.5, '14 Weeks', 'Third dose of oral polio vaccine', 98, 14),
    ('Inactivated Polio Vaccine', 1, 'IPV 1', 3.5, '14 Weeks', 'First dose of inactivated polio vaccine', 98, 14),
    ('Inactivated Polio Vaccine', 2, 'IPV 2', 9, '9 Months', 'Second dose of inactivated polio vaccine', 270, 14),
    ('Pneumococcal Conjugate Vaccine', 1, 'PCV 1', 1.5, '6 Weeks', 'First dose of PCV', 42, 14),
    ('Pneumococcal Conjugate Vaccine', 2, 'PCV 2', 2.5, '10 Weeks', 'Second dose of PCV', 70, 14),
    ('Pneumococcal Conjugate Vaccine', 3, 'PCV 3', 3.5, '14 Weeks', 'Third dose of PCV', 98, 14),
    ('Rotavirus Vaccine', 1, 'Rota 1', 1.5, '6 Weeks', 'First dose of rotavirus vaccine', 42, 14),
    ('Rotavirus Vaccine', 2, 'Rota 2', 2.5, '10 Weeks', 'Second dose of rotavirus vaccine', 70, 14),
    ('Rotavirus Vaccine', 3, 'Rota 3', 3.5, '14 Weeks', 'Third dose of rotavirus vaccine', 98, 14),
    ('Measles Vaccine', 1, 'Measles 1', 9, '9 Months', 'First dose of measles vaccine', 270, 30),
    ('Vitamin A', 1, 'Vitamin A', 6, '6 Months', 'First dose of Vitamin A supplement', 180, 30),
    ('Vitamin A', 2, 'Vitamin A', 12, '12 Months', 'Second dose of Vitamin A supplement', 365, 30)
ON CONFLICT DO NOTHING;
