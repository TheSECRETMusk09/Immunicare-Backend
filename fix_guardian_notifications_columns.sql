-- Fix for guardian notifications - Add missing columns to notifications table
-- This fixes the 500 Internal Server Error when fetching guardian notifications

-- Add guardian_id column (references guardians table)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS guardian_id INTEGER;

-- Add target_role column (to specify who the notification is for: guardian, admin, all)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_role VARCHAR(50);

-- Add title column (notification title)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(255);

-- Add is_read column (to track if notification has been read)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

-- Add action_url column (link to action when clicked)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url VARCHAR(500);

-- Add foreign key constraint for guardian_id (optional, uncomment if needed)
-- ALTER TABLE notifications ADD CONSTRAINT fk_guardian 
--   FOREIGN KEY (guardian_id) REFERENCES guardians(id) ON DELETE CASCADE;

-- Set default values for existing rows
UPDATE notifications SET target_role = 'guardian' WHERE target_role IS NULL;
UPDATE notifications SET is_read = FALSE WHERE is_read IS NULL;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_notifications_guardian_id ON notifications(guardian_id);
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON notifications(target_role);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

-- Add index for guardian_id + is_read combination (common query pattern)
CREATE INDEX IF NOT EXISTS idx_notifications_guardian_is_read 
  ON notifications(guardian_id, is_read) 
  WHERE guardian_id IS NOT NULL;

COMMENT ON COLUMN notifications.guardian_id IS 'The guardian ID this notification belongs to (for guardian-specific notifications)';
COMMENT ON COLUMN notifications.target_role IS 'Target role: guardian, admin, or all';
COMMENT ON COLUMN notifications.title IS 'Notification title';
COMMENT ON COLUMN notifications.is_read IS 'Whether the notification has been read';
COMMENT ON COLUMN notifications.action_url IS 'URL to navigate to when notification is clicked';
