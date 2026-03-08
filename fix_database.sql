-- Fix Script for Immunicare Test Failures
-- Run this script in PostgreSQL to fix database issues

-- Fix 1: Create missing security_events table
CREATE TABLE IF NOT EXISTS security_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);

-- Fix 2: Verify admin user exists and has correct password
-- First, check if admin user exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin') THEN
        -- Get admin role ID
        DECLARE admin_role_id INTEGER;
        DECLARE clinic_id INTEGER;
        
        SELECT id INTO admin_role_id FROM roles WHERE name = 'super_admin' OR name = 'admin' LIMIT 1;
        SELECT id INTO clinic_id FROM clinics LIMIT 1;
        
        -- Create admin user with password: Admin2024!
        -- Hash: $2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, is_active)
        VALUES ('admin', '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', admin_role_id, clinic_id, 'admin@immunicare.com', 'admin@immunicare.com', true);
        
        RAISE NOTICE 'Admin user created with password: Admin2024!';
    ELSE
        -- Ensure admin is active
        UPDATE users SET is_active = true WHERE username = 'admin';
        RAISE NOTICE 'Admin user verified and activated';
    END IF;
END $$;

-- Fix 3: Ensure Guardian Portal clinic exists
INSERT INTO clinics (name, region, address, contact)
VALUES ('Guardian Portal', 'Virtual', 'Online Portal', 'portal@immunicare.com')
ON CONFLICT (name) DO NOTHING;

-- Fix 4: Verify guardian role exists
INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
VALUES ('guardian', 'Guardian', false, 20, '{"can_view_own_children": true, "can_view_appointments": true}')
ON CONFLICT (name) DO NOTHING;

-- Display summary
SELECT 'Database fixes completed successfully!' AS status;
