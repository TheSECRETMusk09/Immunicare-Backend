-- SMS Logs Table Schema for Immunicare Vaccination Management System
-- This table stores all SMS delivery logs for tracking and debugging
-- Requirements: id, phone_number, message_type, message_content, status, external_message_id, created_at, updated_at, error_details

-- Drop existing sms_logs table if exists to apply new schema
DROP TABLE IF EXISTS sms_logs CASCADE;

-- Create SMS logs table with required columns
CREATE TABLE IF NOT EXISTS sms_logs (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    message_type VARCHAR(50) NOT NULL,
    message_content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    external_message_id VARCHAR(100),
    provider VARCHAR(20) NOT NULL DEFAULT 'log',
    metadata JSONB,
    attempts JSONB,
    sent_at TIMESTAMP,
    failed_at TIMESTAMP,
    error_details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for SMS logs (as per requirements: phone_number, status, created_at)
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone ON sms_logs(phone_number);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created ON sms_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_message_type ON sms_logs(message_type);
CREATE INDEX IF NOT EXISTS idx_sms_logs_external_message_id ON sms_logs(external_message_id);

-- Composite indexes for query optimization
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone_status ON sms_logs(phone_number, status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone_created ON sms_logs(phone_number, created_at DESC);

-- SMS Verification Codes Table
-- Stores time-limited verification codes for password reset and phone verification
CREATE TABLE IF NOT EXISTS sms_verification_codes (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    purpose VARCHAR(50) NOT NULL,
    user_id INTEGER,
    guardian_id INTEGER,
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (phone_number, purpose)
);

-- Create indexes for verification codes
CREATE INDEX IF NOT EXISTS idx_sms_verification_phone ON sms_verification_codes(phone_number);
CREATE INDEX IF NOT EXISTS idx_sms_verification_expires ON sms_verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_sms_verification_user ON sms_verification_codes(user_id);

-- Guardian Phone Numbers Table
-- Stores phone numbers with verification status for guardians
CREATE TABLE IF NOT EXISTS guardian_phone_numbers (
    id SERIAL PRIMARY KEY,
    guardian_id INTEGER NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    is_primary BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP,
    verification_code_id INTEGER,
    sms_preferences JSONB DEFAULT '{"appointment_reminders": true, "password_reset": true, "account_alerts": true}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guardian_id, phone_number)
);

-- Create indexes for guardian phone numbers
CREATE INDEX IF NOT EXISTS idx_guardian_phone_guardian ON guardian_phone_numbers(guardian_id);
CREATE INDEX IF NOT EXISTS idx_guardian_phone_number ON guardian_phone_numbers(phone_number);

-- Appointment Reminder Settings Table
-- Stores reminder preferences per guardian/child
CREATE TABLE IF NOT EXISTS appointment_reminder_settings (
    id SERIAL PRIMARY KEY,
    guardian_id INTEGER NOT NULL,
    infant_id INTEGER,
    reminder_enabled BOOLEAN DEFAULT true,
    reminder_hours_before INTEGER DEFAULT 24,
    sms_notification_enabled BOOLEAN DEFAULT true,
    email_notification_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guardian_id, infant_id)
);

-- Create index for reminder settings
CREATE INDEX IF NOT EXISTS idx_reminder_settings_guardian ON appointment_reminder_settings(guardian_id);

-- Comment for documentation
COMMENT ON TABLE sms_logs IS 'Stores all SMS delivery logs for tracking and debugging';
COMMENT ON TABLE sms_verification_codes IS 'Stores time-limited verification codes for password reset and phone verification';
COMMENT ON TABLE guardian_phone_numbers IS 'Stores phone numbers with verification status for guardians';
COMMENT ON TABLE appointment_reminder_settings IS 'Stores reminder preferences per guardian/child';
