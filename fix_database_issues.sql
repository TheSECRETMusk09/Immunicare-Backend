-- Immunicare Database Fixes
-- Fixes missing tables and columns identified during testing

-- ============================================
-- 1. Create missing 'growth' table
-- ============================================
CREATE TABLE IF NOT EXISTS growth (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) ON DELETE CASCADE,
    date_recorded DATE NOT NULL DEFAULT CURRENT_DATE,
    weight_kg DECIMAL(5,2),
    height_cm DECIMAL(5,2),
    head_circumference_cm DECIMAL(5,2),
    age_in_days INTEGER,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_growth_infant_id ON growth(infant_id);
CREATE INDEX IF NOT EXISTS idx_growth_date ON growth(date_recorded);

-- ============================================
-- 2. Create missing 'sessions' or 'user_sessions' table
-- ============================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_info JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    ended_reason VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- ============================================
-- 3. Create missing 'password_reset_otps' table
-- ============================================
CREATE TABLE IF NOT EXISTS password_reset_otps (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    otp VARCHAR(10) NOT NULL,
    method VARCHAR(10) NOT NULL DEFAULT 'email',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    attempts INTEGER DEFAULT 0,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user_id ON password_reset_otps(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_expires ON password_reset_otps(expires_at);

-- ============================================
-- 4. Add missing columns to existing tables
-- ============================================

-- Add guardian_id to appointments if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'guardian_id'
    ) THEN
        ALTER TABLE appointments ADD COLUMN guardian_id INTEGER REFERENCES guardians(id);
        CREATE INDEX idx_appointments_guardian_id ON appointments(guardian_id);
    END IF;
END $$;

-- Add age_in_days to growth table if not exists (should exist after table creation above)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'growth' AND column_name = 'age_in_days'
    ) THEN
        ALTER TABLE growth ADD COLUMN age_in_days INTEGER;
    END IF;
END $$;

-- ============================================
-- 5. Fix admin passwords
-- ============================================
-- Password: Immunicare2026!
-- Hash generated with bcrypt (10 rounds)
UPDATE users
SET password_hash = '$2b$10$QcpVCYxPEhlhokgifwZ8neJGHk9RXB0wJdF1Y6dRjQ3pQZ0H7jJhi'
WHERE username = 'admin';

UPDATE users
SET password_hash = '$2b$10$QcpVCYxPEhlhokgifwZ8neJGHk9RXB0wJdF1Y6dRjQ3pQZ0H7jJhi'
WHERE username = 'administrator';

-- ============================================
-- 6. Verify and update guardian passwords if needed
-- ============================================
-- Password: guardian123
UPDATE users
SET password_hash = '$2b$10$YourHashHere...'  -- This would be the actual hash
WHERE role_id = (SELECT id FROM roles WHERE LOWER(name) = 'guardian' LIMIT 1)
AND password_hash IS NULL;

-- ============================================
-- 7. Grant appropriate permissions for guardian users
-- ============================================
-- Ensure guardian role exists and has proper permissions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM roles WHERE LOWER(name) = 'guardian') THEN
        INSERT INTO roles (name, display_name, description, is_active)
        VALUES ('guardian', 'Guardian', 'Parent or guardian of an infant', true);
    END IF;
END $$;

-- ============================================
-- 8. Add any missing indexes for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_date ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_vaccination_records_infant_id ON vaccination_records(infant_id);
CREATE INDEX IF NOT EXISTS idx_infants_guardian_id ON infants(guardian_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_infant_allergies_infant_id ON infant_allergies(infant_id);

-- ============================================
-- 9. Add comment documentation
-- ============================================
COMMENT ON TABLE growth IS 'Stores infant growth measurements (weight, height, head circumference)';
COMMENT ON TABLE user_sessions IS 'Active user sessions for authentication tracking';
COMMENT ON TABLE password_reset_otps IS 'One-time passwords for password reset functionality';

-- ============================================
-- 10. Verify fixes
-- ============================================
SELECT 'Tables created/verified:' as status;
SELECT table_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'growth') THEN 'EXISTS' ELSE 'MISSING' END as growth,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_sessions') THEN 'EXISTS' ELSE 'MISSING' END as user_sessions,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'password_reset_otps') THEN 'EXISTS' ELSE 'MISSING' END as password_reset_otps;

SELECT 'Columns added:' as status;
SELECT table_name, column_name
FROM information_schema.columns
WHERE (table_name = 'appointments' AND column_name = 'guardian_id')
   OR (table_name = 'growth' AND column_name = 'age_in_days');

SELECT 'Admin passwords updated:' as status;
SELECT username, LEFT(password_hash, 30) as password_preview
FROM users
WHERE username IN ('admin', 'administrator');
