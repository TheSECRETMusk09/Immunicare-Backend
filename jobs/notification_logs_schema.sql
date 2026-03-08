-- Notification Logs Table Schema for Immunicare
-- Stores all notification delivery logs for tracking and debugging
-- This table supports the scheduler's cleanupOldNotifications() function

-- Drop existing notification_logs table if exists
DROP TABLE IF EXISTS notification_logs CASCADE;

-- Create notification logs table
CREATE TABLE IF NOT EXISTS notification_logs (
    id SERIAL PRIMARY KEY,
    recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('guardian', 'user', 'admin')),
    recipient_id INTEGER NOT NULL,
    notification_type VARCHAR(50) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('sms', 'email', 'push', 'in_app')),
    subject VARCHAR(255),
    content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced')),
    external_message_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    error_details TEXT,
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    failed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_notification_logs_recipient ON notification_logs(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_type ON notification_logs(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_logs_channel ON notification_logs(channel);

-- Composite index for cleanup query (keeps last 90 days)
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_cleanup ON notification_logs(created_at) WHERE created_at < NOW() - INTERVAL '90 days';

-- Comments for documentation
COMMENT ON TABLE notification_logs IS 'Stores all notification delivery logs for tracking and debugging';
COMMENT ON COLUMN notification_logs.recipient_type IS 'Type of recipient: guardian, user, or admin';
COMMENT ON COLUMN notification_logs.channel IS 'Notification channel: sms, email, push, or in_app';
COMMENT ON COLUMN notification_logs.status IS 'Current status: pending, sent, delivered, failed, or bounced';
