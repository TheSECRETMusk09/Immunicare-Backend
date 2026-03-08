-- ============================================================================
-- DEPRECATED MIGRATION FILE
-- ============================================================================
-- Status: DEPRECATED as of 2026-02-04
-- Reason: These tables are already included in backend/schema.sql
-- Canonical Source: backend/schema.sql
-- ============================================================================
-- 
-- Security Events Table Migration
-- Fix for 401 login error caused by missing security_events table
-- 
-- NOTE: This migration is deprecated. The security_events, failed_login_attempts,
-- and ip_whitelist tables are already defined in backend/schema.sql.
-- 
-- DO NOT RUN THIS FILE. Use backend/schema.sql instead.
-- ============================================================================

-- Create security_events table
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

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_ip_address ON security_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);

-- Create failed_login_attempts table for brute force protection
CREATE TABLE IF NOT EXISTS failed_login_attempts (
    id SERIAL PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    attempt_count INTEGER DEFAULT 1,
    last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    locked_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for failed_login_attempts
CREATE INDEX IF NOT EXISTS idx_failed_login_identifier ON failed_login_attempts(identifier);
CREATE INDEX IF NOT EXISTS idx_failed_login_locked ON failed_login_attempts(locked_until);

-- Create ip_whitelist table for trusted IPs
CREATE TABLE IF NOT EXISTS ip_whitelist (
    id SERIAL PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    description VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add sample trusted IPs
INSERT INTO ip_whitelist (ip_address, description) VALUES
    ('127.0.0.1', 'Localhost'),
    ('::1', 'IPv6 Localhost')
ON CONFLICT (ip_address) DO NOTHING;

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for failed_login_attempts
DROP TRIGGER IF EXISTS update_failed_login_attempts_updated ON failed_login_attempts;
CREATE TRIGGER update_failed_login_attempts_updated
    BEFORE UPDATE ON failed_login_attempts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for ip_whitelist
DROP TRIGGER IF EXISTS update_ip_whitelist_updated ON ip_whitelist;
CREATE TRIGGER update_ip_whitelist_updated
    BEFORE UPDATE ON ip_whitelist
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Run this SQL to fix the login issue
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'security_events') THEN
        RAISE NOTICE 'Creating security_events table...';
    ELSE
        RAISE NOTICE 'security_events table already exists.';
    END IF;
END $$;

SELECT 'Migration completed successfully' as status;

-- ============================================================================
-- END OF DEPRECATED MIGRATION
-- ============================================================================
