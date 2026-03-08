-- ===========================================
-- IMMUNICARE COMPREHENSIVE FEATURES MIGRATION
-- Implements: Patient Control Numbers, Allergy Info, SMS Notifications
-- Target: February 25, 2026
-- ===========================================

-- Enable necessary extensionsupda
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================================
-- PART 1: PATIENT CONTROL NUMBERS
-- ===========================================

-- Add patient_control_number column to infants table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'infants' AND column_name = 'patient_control_number'
    ) THEN
        ALTER TABLE infants ADD COLUMN patient_control_number VARCHAR(20) UNIQUE;
    END IF;
END $$;

-- Create sequence for auto-generating control numbers
CREATE SEQUENCE IF NOT EXISTS patient_control_seq 
START WITH 100001 
INCREMENT BY 1;

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_infants_control_number ON infants(patient_control_number);

-- Function to generate patient control number
CREATE OR REPLACE FUNCTION generate_patient_control_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.patient_control_number IS NULL OR NEW.patient_control_number = '' THEN
        NEW.patient_control_number := 'INF-' || LPAD(NEXTVAL('patient_control_seq')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate control number on insert
DROP TRIGGER IF EXISTS trigger_generate_patient_control_number ON infants;
CREATE TRIGGER trigger_generate_patient_control_number
    BEFORE INSERT ON infants
    FOR EACH ROW
    EXECUTE FUNCTION generate_patient_control_number();

-- ===========================================
-- PART 2: ALLERGY INFORMATION SYSTEM
-- ===========================================

-- Create allergy types enum
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'allergy_type') THEN
        CREATE TYPE allergy_type AS ENUM (
            'vaccine', 
            'food', 
            'medication', 
            'environmental',
            'other'
        );
    END IF;
END $$;

-- Create allergy severity enum
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'allergy_severity') THEN
        CREATE TYPE allergy_severity AS ENUM (
            'mild',
            'moderate',
            'severe',
            'life_threatening'
        );
    END IF;
END $$;

-- Create infant allergies table
CREATE TABLE IF NOT EXISTS infant_allergies (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) 
        ON UPDATE CASCADE ON DELETE CASCADE,
    allergy_type allergy_type NOT NULL,
    allergen VARCHAR(255) NOT NULL,
    severity allergy_severity NOT NULL DEFAULT 'mild',
    reaction_description TEXT,
    onset_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for infant allergies
CREATE INDEX IF NOT EXISTS idx_infant_allergies_infant_id ON infant_allergies(infant_id);
CREATE INDEX IF NOT EXISTS idx_infant_allergies_type ON infant_allergies(allergy_type);
CREATE INDEX IF NOT EXISTS idx_infant_allergies_severity ON infant_allergies(severity);
CREATE INDEX IF NOT EXISTS idx_infant_allergies_active ON infant_allergies(is_active);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_allergy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_infant_allergies_updated_at ON infant_allergies;
CREATE TRIGGER update_infant_allergies_updated_at
    BEFORE UPDATE ON infant_allergies
    FOR EACH ROW
    EXECUTE FUNCTION update_allergy_updated_at();

-- ===========================================
-- PART 3: VACCINE WAITLIST SYSTEM
-- ===========================================

-- Create vaccine waitlist table
CREATE TABLE IF NOT EXISTS vaccine_waitlist (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) 
        ON UPDATE CASCADE ON DELETE CASCADE,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) 
        ON UPDATE CASCADE ON DELETE CASCADE,
    guardian_id INTEGER NOT NULL REFERENCES guardians(id) 
        ON UPDATE CASCADE ON DELETE CASCADE,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) 
        ON UPDATE CASCADE ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting',
    notified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(infant_id, vaccine_id, clinic_id)
);

-- Create waitlist notifications table
CREATE TABLE IF NOT EXISTS vaccine_availability_notifications (
    id SERIAL PRIMARY KEY,
    waitlist_id INTEGER REFERENCES vaccine_waitlist(id),
    infant_id INTEGER NOT NULL REFERENCES infants(id),
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id),
    guardian_id INTEGER NOT NULL REFERENCES guardians(id),
    notification_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for waitlist
CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_infant_id ON vaccine_waitlist(infant_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_vaccine_id ON vaccine_waitlist(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_status ON vaccine_waitlist(status);

-- ===========================================
-- PART 4: CRITICAL ALERT NOTIFICATIONS
-- ===========================================

-- Add notification settings to system config
ALTER TABLE system_config 
ADD COLUMN IF NOT EXISTS critical_alert_sms_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS critical_alert_recipients TEXT,
ADD COLUMN IF NOT EXISTS expiry_warning_days INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS expiry_alert_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS expiry_alert_recipients TEXT;

-- Create critical alert notification log
CREATE TABLE IF NOT EXISTS critical_alert_notifications (
    id SERIAL PRIMARY KEY,
    alert_id INTEGER REFERENCES vaccine_stock_alerts(id),
    notification_type VARCHAR(50) NOT NULL,
    recipient_phone VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for critical alerts
CREATE INDEX IF NOT EXISTS idx_critical_alert_notifications_status ON critical_alert_notifications(status);
CREATE INDEX IF NOT EXISTS idx_critical_alert_notifications_created ON critical_alert_notifications(created_at);

-- ===========================================
-- PART 5: APPOINTMENT CONFIRMATION SYSTEM
-- ===========================================

-- Add confirmation fields to appointments
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS confirmation_method VARCHAR(20),
ADD COLUMN IF NOT EXISTS sms_confirmation_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sms_confirmation_sent_at TIMESTAMP;

-- Create appointment confirmation notifications table
CREATE TABLE IF NOT EXISTS appointment_confirmations (
    id SERIAL PRIMARY KEY,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) 
        ON UPDATE CASCADE ON DELETE CASCADE,
    guardian_id INTEGER NOT NULL REFERENCES guardians(id),
    message TEXT NOT NULL,
    response_received BOOLEAN DEFAULT FALSE,
    response_type VARCHAR(20),
    response_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for confirmations
CREATE INDEX IF NOT EXISTS idx_appointment_confirmations_appointment_id ON appointment_confirmations(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_confirmations_guardian_id ON appointment_confirmations(guardian_id);

-- ===========================================
-- PART 6: INCOMING SMS HANDLING
-- ===========================================

-- Create table for incoming SMS (for CONFIRM/CANCEL responses)
CREATE TABLE IF NOT EXISTS incoming_sms (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    keyword VARCHAR(20),
    related_appointment_id INTEGER REFERENCES appointments(id),
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for incoming SMS
CREATE INDEX IF NOT EXISTS idx_incoming_sms_phone ON incoming_sms(phone_number);
CREATE INDEX IF NOT EXISTS idx_incoming_sms_processed ON incoming_sms(processed);

-- ===========================================
-- VERIFICATION QUERIES
-- ===========================================

-- Check if all tables were created
SELECT 
    'Tables Created Successfully' as status,
    COUNT(*) as table_count
FROM information_schema.tables 
WHERE table_schema = 'public'
AND table_name IN (
    'infant_allergies',
    'vaccine_waitlist', 
    'vaccine_availability_notifications',
    'critical_alert_notifications',
    'appointment_confirmations',
    'incoming_sms'
);

-- Check if columns were added
SELECT 
    column_name,
    table_name
FROM information_schema.columns
WHERE table_name = 'infants'
AND column_name = 'patient_control_number';

SELECT 
    column_name,
    table_name
FROM information_schema.columns
WHERE table_name = 'appointments'
AND column_name IN ('confirmation_status', 'sms_confirmation_sent');

-- ===========================================
-- END OF MIGRATION
-- ===========================================
