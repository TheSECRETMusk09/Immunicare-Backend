-- ============================================================================
-- Vaccination Reminder System Schema
-- ============================================================================
-- This migration adds tables for tracking vaccination reminders
-- and storing guardian notification preferences
-- ============================================================================

-- Vaccination Reminders Sent History
CREATE TABLE IF NOT EXISTS vaccination_reminders (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    guardian_id INTEGER NOT NULL REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE CASCADE,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    dose_number INTEGER NOT NULL,
    scheduled_date DATE NOT NULL,
    reminder_sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notification_id INTEGER REFERENCES notifications(id) ON UPDATE CASCADE ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'sent',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS patient_id INTEGER;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS guardian_id INTEGER;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS vaccine_id INTEGER;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS dose_number INTEGER;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS notification_id INTEGER;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'sent';
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE vaccination_reminders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

COMMENT ON TABLE vaccination_reminders IS 'Tracks vaccination reminders sent to guardians';

-- Indexes for vaccination_reminders
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vaccination_reminders' AND column_name = 'patient_id'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vaccination_reminders_patient_id ON vaccination_reminders(patient_id)';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vaccination_reminders' AND column_name = 'guardian_id'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vaccination_reminders_guardian_id ON vaccination_reminders(guardian_id)';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vaccination_reminders' AND column_name = 'scheduled_date'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vaccination_reminders_scheduled_date ON vaccination_reminders(scheduled_date)';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vaccination_reminders' AND column_name = 'status'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vaccination_reminders_status ON vaccination_reminders(status)';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vaccination_reminders' AND column_name = 'reminder_sent_at'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vaccination_reminders_sent_at ON vaccination_reminders(reminder_sent_at)';
    END IF;
END $$;

-- Guardian Notification Preferences
CREATE TABLE IF NOT EXISTS guardian_notification_preferences (
    id SERIAL PRIMARY KEY,
    guardian_id INTEGER NOT NULL REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE CASCADE,
    notification_type VARCHAR(100) NOT NULL,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    reminder_days_before INTEGER NOT NULL DEFAULT 7,
    preferred_time TIME DEFAULT '08:00:00',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guardian_id, notification_type)
);

ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS guardian_id INTEGER;
ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS notification_type VARCHAR(100);
ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS reminder_days_before INTEGER DEFAULT 7;
ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS preferred_time TIME DEFAULT '08:00:00';
ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE guardian_notification_preferences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'guardian_notification_preferences_guardian_id_notification_type_key'
          AND conrelid = 'guardian_notification_preferences'::regclass
    ) THEN
        ALTER TABLE guardian_notification_preferences
            ADD CONSTRAINT guardian_notification_preferences_guardian_id_notification_type_key
            UNIQUE (guardian_id, notification_type);
    END IF;
END $$;

COMMENT ON TABLE guardian_notification_preferences IS 'Stores guardian preferences for different notification types';

-- Index for guardian notification preferences
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'guardian_notification_preferences' AND column_name = 'guardian_id'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_guardian_notification_preferences_guardian_id ON guardian_notification_preferences(guardian_id)';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'guardian_notification_preferences' AND column_name = 'is_active'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_guardian_notification_preferences_active ON guardian_notification_preferences(is_active)';
    END IF;
END $$;

-- Vaccination Reminder Templates
CREATE TABLE IF NOT EXISTS vaccination_reminder_templates (
    id SERIAL PRIMARY KEY,
    template_name VARCHAR(255) NOT NULL UNIQUE,
    template_type VARCHAR(50) NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    subject VARCHAR(500),
    body_html TEXT,
    body_text TEXT,
    variables JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS template_name VARCHAR(255);
ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS template_type VARCHAR(50);
ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';
ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS subject VARCHAR(500);
ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS body_html TEXT;
ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS body_text TEXT;
ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS variables JSONB DEFAULT '[]';
ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE vaccination_reminder_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'vaccination_reminder_templates_template_name_key'
          AND conrelid = 'vaccination_reminder_templates'::regclass
    ) THEN
        ALTER TABLE vaccination_reminder_templates
            ADD CONSTRAINT vaccination_reminder_templates_template_name_key
            UNIQUE (template_name);
    END IF;
END $$;

COMMENT ON TABLE vaccination_reminder_templates IS 'Stores templates for vaccination reminder messages';

-- Insert default reminder templates
DO $$
BEGIN
    -- Legacy table variants may require non-null legacy columns.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vaccination_reminder_templates'
          AND column_name = 'template_message'
    ) THEN
        INSERT INTO vaccination_reminder_templates (
            template_name,
            template_type,
            language,
            subject,
            body_text,
            variables,
            is_active,
            vaccine_id,
            dose_number,
            age_months,
            template_message
        ) VALUES
        (
            'vaccination_reminder_email',
            'email',
            'en',
            'Vaccination Reminder for {{patient_name}} - {{vaccine}} Dose {{dose}}',
            'Dear {{guardian_name}}, this is a reminder that {{patient_name}} is due for {{vaccine}} dose {{dose}} on {{scheduled_date}}.',
            '["patient_name", "guardian_name", "vaccine", "dose", "scheduled_date"]',
            TRUE,
            NULL,
            1,
            0,
            'Reminder: {{patient_name}} vaccine {{vaccine}} dose {{dose}} on {{scheduled_date}}.'
        ),
        (
            'vaccination_reminder_sms',
            'sms',
            'en',
            NULL,
            'IMMUNICARE: {{patient_name}} needs {{vaccine}} dose {{dose}} on {{scheduled_date}}.',
            '["patient_name", "vaccine", "dose", "scheduled_date"]',
            TRUE,
            NULL,
            1,
            0,
            'IMMUNICARE: {{patient_name}} needs {{vaccine}} dose {{dose}} on {{scheduled_date}}.'
        ),
        (
            'first_vaccine_email',
            'email',
            'en',
            'Vaccine Administered - {{patient_name}} received {{vaccine}}',
            '{{patient_name}} received {{vaccine}} on {{admin_date}}. Next vaccine: {{next_vaccine}} on {{next_due_date}}.',
            '["patient_name", "vaccine", "admin_date", "next_vaccine", "next_due_date"]',
            TRUE,
            NULL,
            1,
            0,
            '{{patient_name}} received {{vaccine}} on {{admin_date}}. Next: {{next_vaccine}} on {{next_due_date}}.'
        ),
        (
            'first_vaccine_sms',
            'sms',
            'en',
            NULL,
            'IMMUNICARE: {{patient_name}} received {{vaccine}} on {{admin_date}}. Next: {{next_vaccine}} ({{next_due_date}}).',
            '["patient_name", "vaccine", "admin_date", "next_vaccine", "next_due_date"]',
            TRUE,
            NULL,
            1,
            0,
            'IMMUNICARE: {{patient_name}} received {{vaccine}} on {{admin_date}}. Next: {{next_vaccine}} ({{next_due_date}}).'
        )
        ON CONFLICT (template_name) DO NOTHING;
    ELSE
        INSERT INTO vaccination_reminder_templates (
            template_name,
            template_type,
            language,
            subject,
            body_text,
            variables,
            is_active
        ) VALUES
        (
            'vaccination_reminder_email',
            'email',
            'en',
            'Vaccination Reminder for {{patient_name}} - {{vaccine}} Dose {{dose}}',
            'Dear {{guardian_name}}, this is a reminder that {{patient_name}} is due for {{vaccine}} dose {{dose}} on {{scheduled_date}}.',
            '["patient_name", "guardian_name", "vaccine", "dose", "scheduled_date"]',
            TRUE
        ),
        (
            'vaccination_reminder_sms',
            'sms',
            'en',
            NULL,
            'IMMUNICARE: {{patient_name}} needs {{vaccine}} dose {{dose}} on {{scheduled_date}}.',
            '["patient_name", "vaccine", "dose", "scheduled_date"]',
            TRUE
        ),
        (
            'first_vaccine_email',
            'email',
            'en',
            'Vaccine Administered - {{patient_name}} received {{vaccine}}',
            '{{patient_name}} received {{vaccine}} on {{admin_date}}. Next vaccine: {{next_vaccine}} on {{next_due_date}}.',
            '["patient_name", "vaccine", "admin_date", "next_vaccine", "next_due_date"]',
            TRUE
        ),
        (
            'first_vaccine_sms',
            'sms',
            'en',
            NULL,
            'IMMUNICARE: {{patient_name}} received {{vaccine}} on {{admin_date}}. Next: {{next_vaccine}} ({{next_due_date}}).',
            '["patient_name", "vaccine", "admin_date", "next_vaccine", "next_due_date"]',
            TRUE
        )
        ON CONFLICT (template_name) DO NOTHING;
    END IF;
END $$;

-- Vaccination Schedule Configuration
CREATE TABLE IF NOT EXISTS vaccination_schedule_config (
    id SERIAL PRIMARY KEY,
    vaccine_id INTEGER REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    vaccine_name VARCHAR(255) NOT NULL,
    dose_number INTEGER NOT NULL,
    age_weeks INTEGER,
    age_months DECIMAL(5, 2),
    min_age_weeks INTEGER,
    max_age_weeks INTEGER,
    interval_days INTEGER,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vaccine_name, dose_number)
);

ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS vaccine_id INTEGER;
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS vaccine_name VARCHAR(255);
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS dose_number INTEGER;
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS age_weeks INTEGER;
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS age_months DECIMAL(5, 2);
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS min_age_weeks INTEGER;
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS max_age_weeks INTEGER;
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS interval_days INTEGER;
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN DEFAULT TRUE;
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE vaccination_schedule_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'vaccination_schedule_config_vaccine_name_dose_number_key'
          AND conrelid = 'vaccination_schedule_config'::regclass
    ) THEN
        ALTER TABLE vaccination_schedule_config
            ADD CONSTRAINT vaccination_schedule_config_vaccine_name_dose_number_key
            UNIQUE (vaccine_name, dose_number);
    END IF;
END $$;

COMMENT ON TABLE vaccination_schedule_config IS 'Stores vaccination schedule configuration';

-- Insert default schedule config
INSERT INTO vaccination_schedule_config (vaccine_name, dose_number, age_weeks, age_months, min_age_weeks, max_age_weeks, interval_days, is_mandatory) VALUES
('BCG', 1, 0, 0, 0, 4, NULL, TRUE),
('Hep B', 1, 0, 0, 0, 1, NULL, TRUE),
('Hep B', 2, 4, 1, 4, 8, 28, TRUE),
('Hep B', 3, 24, 6, 20, 28, 140, TRUE),
('Pentavalent', 1, 6, 1.5, 6, 10, NULL, TRUE),
('Pentavalent', 2, 10, 2.5, 10, 14, 28, TRUE),
('Pentavalent', 3, 14, 3.5, 14, 18, 28, TRUE),
('OPV', 1, 6, 1.5, 6, 10, NULL, TRUE),
('OPV', 2, 10, 2.5, 10, 14, 28, TRUE),
('OPV', 3, 14, 3.5, 14, 18, 28, TRUE),
('PCV', 1, 6, 1.5, 6, 10, NULL, TRUE),
('PCV', 2, 10, 2.5, 10, 14, 28, TRUE),
('PCV', 3, 14, 3.5, 14, 18, 28, TRUE),
('IPV', 1, 14, 3.5, 14, 18, NULL, TRUE),
('IPV', 2, 36, 9, 32, 40, 154, TRUE),
('MMR', 1, 36, 9, 32, 40, NULL, TRUE),
('MMR', 2, 48, 12, 44, 56, 84, TRUE)
ON CONFLICT (vaccine_name, dose_number) DO NOTHING;

-- Create trigger for timestamp update
DO $$
BEGIN
    IF to_regprocedure('fn_update_timestamp()') IS NULL THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_vaccination_reminders_update_timestamp'
          AND tgrelid = 'vaccination_reminders'::regclass
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_vaccination_reminders_update_timestamp
            BEFORE UPDATE ON vaccination_reminders
            FOR EACH ROW
            EXECUTE FUNCTION fn_update_timestamp()';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_guardian_notification_preferences_update_timestamp'
          AND tgrelid = 'guardian_notification_preferences'::regclass
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_guardian_notification_preferences_update_timestamp
            BEFORE UPDATE ON guardian_notification_preferences
            FOR EACH ROW
            EXECUTE FUNCTION fn_update_timestamp()';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_vaccination_reminder_templates_update_timestamp'
          AND tgrelid = 'vaccination_reminder_templates'::regclass
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_vaccination_reminder_templates_update_timestamp
            BEFORE UPDATE ON vaccination_reminder_templates
            FOR EACH ROW
            EXECUTE FUNCTION fn_update_timestamp()';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_vaccination_schedule_config_update_timestamp'
          AND tgrelid = 'vaccination_schedule_config'::regclass
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_vaccination_schedule_config_update_timestamp
            BEFORE UPDATE ON vaccination_schedule_config
            FOR EACH ROW
            EXECUTE FUNCTION fn_update_timestamp()';
    END IF;
END $$;

-- Verify migration
SELECT 'vaccination_reminders' as table_name, COUNT(*) as row_count FROM vaccination_reminders
UNION ALL
SELECT 'guardian_notification_preferences', COUNT(*) FROM guardian_notification_preferences
UNION ALL
SELECT 'vaccination_reminder_templates', COUNT(*) FROM vaccination_reminder_templates
UNION ALL
SELECT 'vaccination_schedule_config', COUNT(*) FROM vaccination_schedule_config;
