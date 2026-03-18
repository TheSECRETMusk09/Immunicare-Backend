-- Update notification categories to support all required notification types
-- This migration updates the CHECK constraint on the notifications.category column
-- to include all categories used by the Notifications module in the admin dashboard

DO $$
BEGIN
    -- Drop the existing constraint if it exists
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notifications_category_check'
        AND conrelid = 'notifications'::regclass
    ) THEN
        ALTER TABLE notifications
        DROP CONSTRAINT notifications_category_check;
    END IF;

    -- Add the new constraint with all required categories
    ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check
    CHECK (category IN (
        'appointment',
        'vaccination_schedule',
        'missed_schedule',
        'inventory_low_stock',
        'inventory_out_of_stock',
        'guardian_registration',
        'infant_registration',
        'report',
        'system_announcement',
        'outbound_message_failed',
        'general'
    ));

    -- Also update the alerts table category constraint if needed
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'alerts_category_check'
        AND conrelid = 'alerts'::regclass
    ) THEN
        ALTER TABLE alerts
        DROP CONSTRAINT alerts_category_check;
    END IF;

    ALTER TABLE alerts
    ADD CONSTRAINT alerts_category_check
    CHECK (category IN (
        'inventory',
        'system',
        'security',
        'compliance',
        'maintenance',
        'appointment',
        'vaccination_schedule',
        'missed_schedule',
        'inventory_low_stock',
        'inventory_out_of_stock',
        'guardian_registration',
        'infant_registration',
        'report',
        'system_announcement',
        'outbound_message_failed',
        'general'
    ));
END $$;

-- Update any existing notifications that might have invalid categories
-- Set them to 'general' as a fallback
UPDATE notifications
SET category = 'general'
WHERE category NOT IN (
    'appointment',
    'vaccination_schedule',
    'missed_schedule',
    'inventory_low_stock',
    'inventory_out_of_stock',
    'guardian_registration',
    'infant_registration',
    'report',
    'system_announcement',
    'outbound_message_failed',
    'general'
);

-- Update any existing alerts that might have invalid categories
UPDATE alerts
SET category = 'system'
WHERE category NOT IN (
    'inventory',
    'system',
    'security',
    'compliance',
    'maintenance',
    'appointment',
    'vaccination_schedule',
    'missed_schedule',
    'inventory_low_stock',
    'inventory_out_of_stock',
    'guardian_registration',
    'infant_registration',
    'report',
    'system_announcement',
    'outbound_message_failed',
    'general'
);
