-- Add delivery tracking columns to notifications table
-- This migration adds columns to track notification delivery attempts and status

-- Add status column to track notification lifecycle
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';

-- Add delivery tracking columns
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER DEFAULT 0;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS first_attempt_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- Add channel-specific tracking columns
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS channel_message_id VARCHAR(255);

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS channel_status VARCHAR(50);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_delivery_attempts ON notifications(delivery_attempts);
CREATE INDEX IF NOT EXISTS idx_notifications_last_attempt_at ON notifications(last_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notifications_delivered_at ON notifications(delivered_at);

-- Update existing rows to have a default status
UPDATE notifications
SET status = CASE
    WHEN is_read THEN 'read'
    ELSE 'pending'
END
WHERE status IS NULL OR status = '';

-- Add check constraint for valid status values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE constraint_name = 'chk_notification_status'
    ) THEN
        ALTER TABLE notifications
        ADD CONSTRAINT chk_notification_status
        CHECK (status IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'scheduled', 'read', 'dismissed'));
    END IF;
END $$;
