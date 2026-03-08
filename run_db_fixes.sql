-- ============================================================================
-- IMMUNICARE DATABASE FIXES - Run this in PostgreSQL
-- ============================================================================
-- This script fixes all the issues identified in the test results:
-- 1. Creates missing security_events table
-- 2. Creates Guardian Portal clinic
-- 3. Creates guardian role
-- 4. Sets up admin user with correct password
-- ============================================================================

-- Fix 1: Create security_events table
CREATE TABLE IF NOT EXISTS security_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    resource_type VARCHAR(100),
    resource_id INTEGER,
    details JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_ip_address ON security_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);

-- Fix 2: Create Guardian Portal clinic
INSERT INTO clinics (name, region, address, contact)
VALUES ('Guardian Portal', 'Virtual', 'Online Portal', 'portal@immunicare.com')
ON CONFLICT (name) DO NOTHING;

-- Fix 3: Create guardian role if not exists
INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
VALUES ('guardian', 'Guardian', false, 20, '{"can_view_own_children": true, "can_view_appointments": true}')
ON CONFLICT (name) DO NOTHING;

-- Fix 4: Create admin user with correct password
-- Password: Admin2024! (hash: $2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q)
DO $$
DECLARE
    admin_role_id INTEGER;
    clinic_id_val INTEGER;
BEGIN
    -- Get admin role ID (super_admin or admin)
    SELECT id INTO admin_role_id FROM roles WHERE name = 'super_admin' OR name = 'admin' LIMIT 1;
    
    -- Get Main Health Center clinic ID
    SELECT id INTO clinic_id_val FROM clinics WHERE name = 'Main Health Center' LIMIT 1;
    
    -- If admin user doesn't exist, create it
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin') THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, is_active)
        VALUES (
            'admin',
            '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q',  -- Admin2024!
            COALESCE(admin_role_id, (SELECT id FROM roles LIMIT 1)),
            COALESCE(clinic_id_val, (SELECT id FROM clinics LIMIT 1)),
            'admin@immunicare.com',
            'admin@immunicare.com',
            true
        );
        RAISE NOTICE 'Admin user created successfully!';
    ELSE
        -- Update admin password to ensure it's correct
        UPDATE users 
        SET password_hash = '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q',
            is_active = true
        WHERE username = 'admin';
        RAISE NOTICE 'Admin password updated successfully!';
    END IF;
END $$;

-- Verify the fixes
SELECT 'security_events table created' AS status FROM (SELECT 1) t
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'security_events');

SELECT 'Guardian Portal clinic created' AS status FROM (SELECT 1) t
WHERE EXISTS (SELECT 1 FROM clinics WHERE name = 'Guardian Portal');

SELECT 'Admin user verified' AS status FROM (SELECT 1) t
WHERE EXISTS (SELECT 1 FROM users WHERE username = 'admin' AND is_active = true);

-- Display admin credentials
SELECT 'Admin credentials:' AS info;
SELECT 'Username: admin' AS info;
SELECT 'Password: Admin2024!' AS info;
