-- ============================================================================
-- COMPREHENSIVE SCHEMA UPDATE FOR IMMUNICARE
-- Adds control numbers, allergy information, and configures critical levels
-- ============================================================================

-- ============================================================================
-- 1. ADD CONTROL NUMBER COLUMN TO PATIENTS TABLE
-- ============================================================================
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS control_number VARCHAR(50) UNIQUE;

-- Create index for control_number for faster lookups
CREATE INDEX IF NOT EXISTS idx_patients_control_number ON patients(control_number);

-- ============================================================================
-- 2. CREATE INFANT ALLERGIES TABLE (if not exists)
-- ============================================================================
CREATE TABLE IF NOT EXISTS infant_allergies (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    allergy_type VARCHAR(50) NOT NULL,
    allergen VARCHAR(255) NOT NULL,
    severity VARCHAR(50) NOT NULL DEFAULT 'mild',
    reaction_description TEXT,
    onset_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES admin(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE infant_allergies IS 'Stores infant/patient allergy information';

-- Create indexes for infant_allergies
CREATE INDEX IF NOT EXISTS idx_infant_allergies_infant_id ON infant_allergies(infant_id);
CREATE INDEX IF NOT EXISTS idx_infant_allergies_allergy_type ON infant_allergies(allergy_type);
CREATE INDEX IF NOT EXISTS idx_infant_allergies_severity ON infant_allergies(severity);

-- Add trigger for timestamp update
CREATE OR REPLACE FUNCTION fn_update_infant_allergies_timestamp()
RETURNS TRIGGER AS $
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

CREATE TRIGGER trg_infant_allergies_update_timestamp
    BEFORE UPDATE ON infant_allergies
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_infant_allergies_timestamp();

-- ============================================================================
-- 3. SMS LOGS TABLE (for tracking all SMS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sms_logs (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    message_type VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    provider VARCHAR(50),
    message_id VARCHAR(255),
    metadata JSONB,
    attempts JSONB,
    sent_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_phone_number ON sms_logs(phone_number);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_message_type ON sms_logs(message_type);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON sms_logs(created_at);

COMMENT ON TABLE sms_logs IS 'Tracks all SMS sent through the system';

-- ============================================================================
-- 4. APPOINTMENT CONFIRMATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointment_confirmations (
    id SERIAL PRIMARY KEY,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON UPDATE CASCADE ON DELETE CASCADE,
    guardian_id INTEGER REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE SET NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointment_confirmations_appointment_id ON appointment_confirmations(appointment_id);

-- ============================================================================
-- 5. INCOMING SMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS incoming_sms (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    keyword VARCHAR(50),
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP WITH TIME ZONE,
    related_appointment_id INTEGER REFERENCES appointments(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_incoming_sms_phone_number ON incoming_sms(phone_number);
CREATE INDEX IF NOT EXISTS idx_incoming_sms_keyword ON incoming_sms(keyword);

COMMENT ON TABLE incoming_sms IS 'Stores incoming SMS responses from guardians';

-- ============================================================================
-- 6. CRITICAL STOCK ALERTS NOTIFICATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS critical_alert_notifications (
    id SERIAL PRIMARY KEY,
    alert_id INTEGER,
    notification_type VARCHAR(50) NOT NULL,
    recipient_phone VARCHAR(20),
    message TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_critical_alert_notifications_status ON critical_alert_notifications(status);

-- ============================================================================
-- 7. ADD CRITICAL STOCK CONFIGURATION TO SYSTEM CONFIG
-- ============================================================================
INSERT INTO system_config (config_key, config_value, description) VALUES
    ('critical_stock_threshold_default', '5', 'Default critical stock threshold for vaccines'),
    ('low_stock_threshold_default', '10', 'Default low stock threshold for vaccines'),
    ('critical_alert_sms_enabled', 'true', 'Enable SMS alerts for critical stock levels'),
    ('low_stock_alert_enabled', 'true', 'Enable SMS alerts for low stock levels'),
    ('expiry_alert_enabled', 'true', 'Enable alerts for expiring vaccines'),
    ('expiry_warning_days', '30', 'Days before expiry to start warning alerts'),
    ('critical_alert_recipients', '[]', 'Phone numbers to receive critical stock SMS alerts'),
    ('expiry_alert_recipients', '[]', 'Phone numbers to receive expiry SMS alerts')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================================
-- 8. ADD SMS CONFIGURATION TO SYSTEM CONFIG
-- ============================================================================
INSERT INTO system_config (config_key, config_value, description) VALUES
    ('sms_api_key', '', 'SMS API key for sending notifications (configure in production)'),
    ('sms_api_secret', '', 'SMS API secret for authentication'),
    ('sms_sender_id', 'IMMUNICARE', 'SMS sender ID'),
    ('sms_enabled', 'true', 'Enable SMS functionality'),
    ('appointment_confirmation_sms', 'true', 'Send SMS for appointment confirmations'),
    ('vaccine_unavailability_sms', 'true', 'Send SMS for vaccine unavailability alerts'),
    ('vaccine_expiry_sms', 'true', 'Send SMS for vaccine expiry warnings'),
    ('inventory_alert_sms', 'true', 'Send SMS for inventory alerts')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================================
-- 9. ADD VACCINE WAITLIST TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS vaccine_waitlist (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    guardian_id INTEGER REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE CASCADE,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    preferred_date DATE,
    preferred_time TIME,
    notification_preference VARCHAR(20) DEFAULT 'sms',
    status VARCHAR(50) NOT NULL DEFAULT 'waiting',
    notified_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_by INTEGER REFERENCES admin(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_patient_id ON vaccine_waitlist(patient_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_vaccine_id ON vaccine_waitlist(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_status ON vaccine_waitlist(status);

-- ============================================================================
-- 10. UPDATE VACCINE_INVENTORY TABLE WITH PROPER CRITICAL LEVEL FIELDS
-- ============================================================================
-- Add missing columns if they don't exist
ALTER TABLE vaccine_inventory 
ADD COLUMN IF NOT EXISTS stock_on_hand INTEGER NOT NULL DEFAULT 0;

ALTER TABLE vaccine_inventory 
ADD COLUMN IF NOT EXISTS clinic_id INTEGER REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Note: The schema already has:
-- - low_stock_threshold (default 10)
-- - critical_stock_threshold (default 5)
-- - is_low_stock (boolean)
-- - is_critical_stock (boolean)

-- ============================================================================
-- 11. ADD VACCINE UNAVAILABILITY NOTIFICATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS vaccine_unavailability_notifications (
    id SERIAL PRIMARY KEY,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    patient_id INTEGER REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    guardian_id INTEGER REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    phone_number VARCHAR(20),
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vaccine_unavailability_notifications_vaccine_id ON vaccine_unavailability_notifications(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_unavailability_notifications_status ON vaccine_unavailability_notifications(status);

-- ============================================================================
-- 12. ADD APPOINTMENT CONFIRMATION TRACKING COLUMNS
-- ============================================================================
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS confirmation_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS confirmation_method VARCHAR(20),
ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS sms_confirmation_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sms_confirmation_sent_at TIMESTAMP WITH TIME ZONE;

-- ============================================================================
-- 13. ADD GUARDIAN PREFERENCE FOR SMS NOTIFICATIONS
-- ============================================================================
ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10) DEFAULT 'en';

-- ============================================================================
-- 14. ADD SYSTEM CONFIG FOR SMS API PROVIDER SETTINGS
-- ============================================================================
INSERT INTO system_config (config_key, config_value, description) VALUES
    ('sms_provider', 'twilio', 'SMS provider: twilio, semaphore, or log'),
    ('twilio_account_sid', '', 'Twilio Account SID'),
    ('twilio_auth_token', '', 'Twilio Auth Token'),
    ('twilio_phone_number', '', 'Twilio Phone Number'),
    ('semaphore_api_key', '', 'Semaphore API Key'),
    ('semaphore_sender_name', 'IMMUNICARE', 'Semaphore Sender Name')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================================
-- 15. FIX APPOINTMENTS TABLE - USE PATIENTS INSTEAD OF INFANTS
-- ============================================================================
-- Update the appointments table to reference patients instead of infants
-- (This is already done in the schema as patient_id)

-- ============================================================================
-- 16. SEED SAMPLE CONTROL NUMBERS FOR EXISTING PATIENTS
-- ============================================================================
DO $
DECLARE
    rec RECORD;
    counter INTEGER;
    year_str TEXT;
BEGIN
    year_str := TO_CHAR(CURRENT_DATE, 'YYYY');
    
    -- Only assign control numbers to patients who don't have one
    counter := 1;
    FOR rec IN 
        SELECT id FROM patients 
        WHERE control_number IS NULL 
        ORDER BY id
    LOOP
        UPDATE patients 
        SET control_number = year_str || '-' || LPAD(counter::TEXT, 6, '0')
        WHERE id = rec.id;
        counter := counter + 1;
    END LOOP;
    
    RAISE NOTICE 'Control numbers assigned to % patients', counter - 1;
END $;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 
    'Schema Updates Complete' AS status,
    CURRENT_TIMESTAMP AS completed_at;

-- Verify tables exist
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = c.table_name) as column_count
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name
WHERE t.table_schema = 'public'
AND t.table_type = 'BASE TABLE'
AND t.table_name IN ('patients', 'infant_allergies', 'vaccine_waitlist', 'vaccine_unavailability_notifications', 'vaccine_inventory', 'sms_logs', 'incoming_sms', 'appointment_confirmations', 'critical_alert_notifications')
GROUP BY table_name
ORDER BY table_name;
