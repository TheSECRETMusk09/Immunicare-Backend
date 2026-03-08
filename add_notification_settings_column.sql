-- Add notification_settings JSON column to users table if it doesn't exist
-- This is an idempotent migration

DO $$ 
BEGIN
    -- Check if column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'notification_settings'
    ) THEN
        -- Add the column
        ALTER TABLE users ADD COLUMN notification_settings JSONB DEFAULT '{}'::jsonb;
        
        -- Create index for faster queries
        CREATE INDEX IF NOT EXISTS idx_users_notification_settings 
        ON users USING gin (notification_settings);
        
        RAISE NOTICE 'Added notification_settings column to users table';
    ELSE
        RAISE NOTICE 'notification_settings column already exists in users table';
    END IF;
END $$;
