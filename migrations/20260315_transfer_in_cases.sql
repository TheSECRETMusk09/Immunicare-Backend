-- Transfer-in cases table for Guardian Dashboard automation
CREATE TABLE IF NOT EXISTS transfer_in_cases (
    id SERIAL PRIMARY KEY,
    guardian_id INTEGER NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
    infant_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
    source_facility VARCHAR(255) NOT NULL,
    submitted_vaccines JSONB NOT NULL DEFAULT '[]'::jsonb,
    vaccination_card_url TEXT,
    remarks TEXT,
    next_recommended_vaccine VARCHAR(100),
    auto_computed_next_vaccine VARCHAR(100),
    validation_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'for_validation', 'approved', 'rejected', 'needs_clarification')),
    validation_notes TEXT,
    validation_priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (validation_priority IN ('normal', 'high', 'urgent')),
    triage_category VARCHAR(50) NOT NULL DEFAULT 'needs_record_verification' CHECK (triage_category IN ('ready_for_scheduling', 'needs_record_verification', 'needs_missing_information', 'not_yet_due', 'overdue_priority_followup')),
    auto_approved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    validated_at TIMESTAMP WITH TIME ZONE,
    validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Add columns to patients table for transfer-in tracking
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS transfer_in_source VARCHAR(255),
ADD COLUMN IF NOT EXISTS validation_status VARCHAR(50) DEFAULT 'none' CHECK (validation_status IN ('none', 'pending', 'for_validation', 'approved', 'rejected')),
ADD COLUMN IF NOT EXISTS auto_computed_next_vaccine VARCHAR(100);

-- Add indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_transfer_in_cases_guardian_id ON transfer_in_cases(guardian_id);
CREATE INDEX IF NOT EXISTS idx_transfer_in_cases_infant_id ON transfer_in_cases(infant_id);
CREATE INDEX IF NOT EXISTS idx_transfer_in_cases_validation_status ON transfer_in_cases(validation_status);
CREATE INDEX IF NOT EXISTS idx_transfer_in_cases_triage_category ON transfer_in_cases(triage_category);
CREATE INDEX IF NOT EXISTS idx_transfer_in_cases_created_at ON transfer_in_cases(created_at);
CREATE INDEX IF NOT EXISTS idx_patients_transfer_in_source ON patients(transfer_in_source);
CREATE INDEX IF NOT EXISTS idx_patients_validation_status ON patients(validation_status);

-- Add helpful comments
COMMENT ON TABLE transfer_in_cases IS 'Records of vaccine transfers from other health centers';
COMMENT ON COLUMN transfer_in_cases.submitted_vaccines IS 'JSON array of submitted vaccines with details';
COMMENT ON COLUMN transfer_in_cases.validation_status IS 'Current validation status of the transfer-in case';
COMMENT ON COLUMN transfer_in_cases.triage_category IS 'Auto-assigned triage category for admin workflow';
COMMENT ON COLUMN transfer_in_cases.auto_approved IS 'Whether case was auto-approved based on complete data';
COMMENT ON COLUMN patients.transfer_in_source IS 'Source facility for transferred-in vaccine records';
COMMENT ON COLUMN patients.validation_status IS 'Validation status of patient vaccine records';
COMMENT ON COLUMN patients.auto_computed_next_vaccine IS 'System-calculated next recommended vaccine';
