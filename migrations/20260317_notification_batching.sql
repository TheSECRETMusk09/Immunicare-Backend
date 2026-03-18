-- Notification Batching Tables
-- For grouping multiple notifications together to reduce notification fatigue

-- Table for storing notification batches
CREATE TABLE IF NOT EXISTS notification_batches (
    id SERIAL PRIMARY KEY,
    batch_id VARCHAR(100) NOT NULL,
    notification_data JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(batch_id, notification_data)
);

-- Index for efficient batch queries
CREATE INDEX IF NOT EXISTS idx_notification_batches_batch_id_status
ON notification_batches(batch_id, status);

-- Table for user batching settings
CREATE TABLE IF NOT EXISTS notification_batching_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    batch_interval_minutes INTEGER DEFAULT 60,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Index for user settings lookup
CREATE INDEX IF NOT EXISTS idx_notification_batching_settings_user_id
ON notification_batching_settings(user_id);

-- Add is_batched and batch_size columns to notifications table if they don't exist
DO $
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications' AND column_name = 'is_batched'
    ) THEN
        ALTER TABLE notifications ADD COLUMN is_batched BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications' AND column_name = 'batch_size'
    ) THEN
        ALTER TABLE notifications ADD COLUMN batch_size INTEGER;
    END IF;
END $;

-- Table for debounce settings (prevent notification spam)
CREATE TABLE IF NOT EXISTS notification_debounce_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    debounce_minutes INTEGER DEFAULT 10,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_debounce_settings_user_id
ON notification_debounce_settings(user_id);

COMMENT ON TABLE notification_batches IS 'Stores pending notifications for batch processing';
COMMENT ON TABLE notification_batching_settings IS 'Stores user preferences for notification batching';
COMMENT ON TABLE notification_debounce_settings IS 'Stores user preferences for notification debouncing';
