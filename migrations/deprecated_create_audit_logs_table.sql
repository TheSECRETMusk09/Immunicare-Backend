-- ============================================================================
-- DEPRECATED MIGRATION FILE
-- ============================================================================
-- Status: DEPRECATED as of 2026-02-04
-- Reason: This structure is already included in backend/schema.sql
-- Canonical Source: backend/schema.sql
-- ============================================================================
-- 
-- Audit Logs Table Migration
-- Creates the audit_logs table for tracking all access control events
-- 
-- NOTE: This migration is deprecated. The audit_logs table is already defined
-- in the main schema (backend/schema.sql) with more complete structure.
-- 
-- DO NOT RUN THIS FILE. Use backend/schema.sql instead.
-- ============================================================================

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    username VARCHAR(255),
    role VARCHAR(50),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) DEFAULT 'INFO',
    resource VARCHAR(255),
    resource_id INTEGER,
    action VARCHAR(50),
    ip_address VARCHAR(50),
    user_agent TEXT,
    details JSONB,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_role ON audit_logs(role);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON audit_logs(ip_address);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_created ON audit_logs(event_type, created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE audit_logs IS 'Stores all audit log entries for access control and security monitoring';
COMMENT ON COLUMN audit_logs.id IS 'Unique identifier for the audit log entry';
COMMENT ON COLUMN audit_logs.user_id IS 'ID of the user who performed the action (null for anonymous)';
COMMENT ON COLUMN audit_logs.username IS 'Username of the user who performed the action';
COMMENT ON COLUMN audit_logs.role IS 'Role of the user at the time of the action';
COMMENT ON COLUMN audit_logs.event_type IS 'Type of event (LOGIN_SUCCESS, ACCESS_DENIED, etc.)';
COMMENT ON COLUMN audit_logs.severity IS 'Severity level (INFO, WARNING, ERROR, CRITICAL)';
COMMENT ON COLUMN audit_logs.resource IS 'The resource or endpoint being accessed';
COMMENT ON COLUMN audit_logs.resource_id IS 'ID of the specific resource being accessed';
COMMENT ON COLUMN audit_logs.action IS 'HTTP method or action performed';
COMMENT ON COLUMN audit_logs.ip_address IS 'IP address of the client';
COMMENT ON COLUMN audit_logs.user_agent IS 'User agent string from the client';
COMMENT ON COLUMN audit_logs.details IS 'JSON object with additional details';
COMMENT ON COLUMN audit_logs.success IS 'Whether the action was successful';
COMMENT ON COLUMN audit_logs.error_message IS 'Error message if the action failed';
COMMENT ON COLUMN audit_logs.created_at IS 'Timestamp when the event occurred';

-- ============================================================================
-- END OF DEPRECATED MIGRATION
-- ============================================================================
