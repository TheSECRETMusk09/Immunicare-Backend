-- Migration: Add SMS notification tracking columns to appointments table
-- This helps prevent duplicate SMS sends for reminders and missed appointments

-- Add columns for appointment reminder tracking
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS reminder_sent_24h BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reminder_sent_48h BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sms_missed_notification_sent BOOLEAN DEFAULT FALSE;

-- Add index for efficient querying of upcoming appointments
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_date_status
ON appointments(scheduled_date, status)
WHERE status IN ('scheduled', 'confirmed') AND is_active = true;

-- Add index for efficient querying of missed appointments
CREATE INDEX IF NOT EXISTS idx_appointments_missed_notification
ON appointments(scheduled_date, status, sms_missed_notification_sent)
WHERE status IN ('scheduled', 'pending', 'confirmed');

-- Add index for infants table sex column for faster lookups
CREATE INDEX IF NOT EXISTS idx_patients_sex ON patients(sex);

COMMENT ON COLUMN appointments.reminder_sent_24h IS 'Whether 24-hour appointment reminder SMS has been sent';
COMMENT ON COLUMN appointments.reminder_sent_48h IS 'Whether 48-hour appointment reminder SMS has been sent';
COMMENT ON COLUMN appointments.sms_missed_notification_sent IS 'Whether missed appointment SMS notification has been sent';
