-- Migration: Add role-based notification targeting
-- Description: Adds target_role field to notifications table for proper role-based filtering
-- Date: 2026-02-15

-- Add target_role column to notifications table
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS target_role VARCHAR(50) DEFAULT 'all';

-- Add guardian_id column to link notifications directly to guardians
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS guardian_id INTEGER REFERENCES guardians(id) ON DELETE CASCADE;

-- Add index for guardian_id for faster queries
CREATE INDEX IF NOT EXISTS idx_notifications_guardian_id ON notifications(guardian_id);

-- Add index for target_role for faster filtering
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON notifications(target_role);

-- Create composite index for guardian notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_guardian_unread ON notifications(guardian_id, is_read) WHERE is_read = FALSE;

-- Add comment
COMMENT ON COLUMN notifications.target_role IS 'Target audience role: admin, guardian, or all';
COMMENT ON COLUMN notifications.guardian_id IS 'Direct link to guardian for guardian-specific notifications';

-- Insert notification types for guardians
INSERT INTO system_config (config_key, config_value, description) VALUES
  ('guardian_notification_types', '["appointment_reminder", "appointment_status", "vaccination_reminder", "profile_update", "new_message", "health_alert"]', 'Allowed notification types for guardians'),
  ('admin_notification_types', '["inventory_alert", "supplier_update", "analytics_alert", "staff_action", "system_alert", "appointment_reminder", "appointment_status"]', 'Allowed notification types for admins')
ON CONFLICT (config_key) DO NOTHING;
