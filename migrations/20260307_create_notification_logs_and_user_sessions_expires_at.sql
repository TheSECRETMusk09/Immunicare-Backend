-- Ensure notification log table exists for scheduled cleanup jobs
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
    metadata JSONB DEFAULT '{}'::jsonb,
    error_details TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_recipient
    ON notification_logs(recipient_type, recipient_id);

CREATE INDEX IF NOT EXISTS idx_notification_logs_status
    ON notification_logs(status);

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
    ON notification_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_logs_type
    ON notification_logs(notification_type);

CREATE INDEX IF NOT EXISTS idx_notification_logs_channel
    ON notification_logs(channel);

-- Ensure session records carry expiration timestamp used by scheduler cleanup
ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- Backfill missing values for existing rows so cleanup can work immediately
UPDATE user_sessions
SET expires_at = NOW() + INTERVAL '8 hours'
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
    ON user_sessions(expires_at);

