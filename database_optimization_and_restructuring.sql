/**
 * Immunicare Database Optimization and Restructuring Script
 *
 * This script implements:
 * 1. Database normalization improvements
 * 2. Indexing enhancements for query performance
 * 3. Security hardening measures
 * 4. Role-based access control implementations
 * 5. Audit logging mechanisms
 *
 * Execute this script to optimize the database schema
 *
 * @author Immunicare Development Team
 * @date 2026-02-25
 */

-- ============================================================================
-- SECTION 1: EXTENSIONS
-- ============================================================================

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable UUID generation
ALTER EXTENSION "uuid-ossp" SET search_path = public;

-- ============================================================================
-- SECTION 2: NORMALIZATION IMPROVEMENTS - Missing Columns
-- ============================================================================

-- Add missing age_in_days column to infant_growth table
ALTER TABLE infant_growth
ADD COLUMN IF NOT EXISTS age_in_days INTEGER;

-- Add missing user_id column to notifications table
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS user_id INTEGER;

-- Add missing is_active column to vaccine_inventory table
ALTER TABLE vaccine_inventory
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add missing columns to growth table (backup)
ALTER TABLE growth
ADD COLUMN IF NOT EXISTS age_in_days INTEGER;

-- Add encrypted columns for sensitive data (will be populated by migration)
ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS encrypted_phone TEXT,
ADD COLUMN IF NOT EXISTS encrypted_address TEXT;

ALTER TABLE infants
ADD COLUMN IF NOT EXISTS encrypted_birth_certificate TEXT,
ADD COLUMN IF NOT EXISTS encrypted_national_id TEXT;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_infant_growth_age_in_days ON infant_growth(age_in_days);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_is_active ON vaccine_inventory(is_active) WHERE is_active = true;

-- ============================================================================
-- SECTION 3: CREATE MISSING TABLES
-- ============================================================================

-- Create access_logs table (for RBAC/audit)
CREATE TABLE IF NOT EXISTS access_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id INTEGER,
    ip_address VARCHAR(45),
    user_agent TEXT,
    status VARCHAR(20) DEFAULT 'success',
    method VARCHAR(10),
    path VARCHAR(500),
    query_params JSONB,
    response_code INTEGER,
    response_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_access_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Create index for access_logs
CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_action ON access_logs(action);
CREATE INDEX IF NOT EXISTS idx_access_logs_resource ON access_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_ip ON access_logs(ip_address);

-- Create user_roles table for RBAC
CREATE TABLE IF NOT EXISTS user_roles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    role VARCHAR(50) NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assigned_by INTEGER REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(user_id, role),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(is_active) WHERE is_active = true;

-- Create api_keys table for API authentication
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    permissions JSONB DEFAULT '[]'::jsonb,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active = true;

-- ============================================================================
-- SECTION 4: INDEXING ENHANCEMENTS
-- ============================================================================

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_vaccination_records_infant_date
ON vaccination_records(infant_id, admin_date DESC);

CREATE INDEX IF NOT EXISTS idx_vaccination_records_vaccine_dose
ON vaccination_records(vaccine_id, dose_no);

CREATE INDEX IF NOT EXISTS idx_appointments_infant_date
ON appointments(infant_id, scheduled_date DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_status_date
ON appointments(status, scheduled_date DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_status
ON notifications(user_id, status) WHERE status IN ('pending', 'sent');

CREATE INDEX IF NOT EXISTS idx_guardians_email_active
ON guardians(email, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_users_role_active
ON users(role_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_infants_guardian_active
ON infants(guardian_id, is_active) WHERE is_active = true;

-- Partial indexes for common filters
CREATE INDEX IF NOT EXISTS idx_appointments_upcoming
ON appointments(scheduled_date)
WHERE status IN ('scheduled', 'rescheduled');

CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_low_stock
ON vaccine_inventory(vaccine_id, clinic_id)
WHERE is_low_stock = true OR is_critical_stock = true;

CREATE INDEX IF NOT EXISTS idx_vaccine_batches_expiry_soon
ON vaccine_batches(expiry_date)
WHERE status = 'active' AND expiry_date < CURRENT_DATE + INTERVAL '90 days';

-- Full text search indexes
CREATE INDEX IF NOT EXISTS idx_infants_full_name_search
ON infants USING GIN (to_tsvector('english', first_name || ' ' || last_name));

CREATE INDEX IF NOT EXISTS idx_guardians_name_search
ON guardians USING GIN (to_tsvector('english', name));

CREATE INDEX IF NOT EXISTS idx_vaccines_search
ON vaccines USING GIN (to_tsvector('english', name || ' ' || code || ' ' || COALESCE(description, '')));

-- ============================================================================
-- SECTION 5: SECURITY HARDENING
-- ============================================================================

-- Create audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_logs (user_id, event_type, entity_type, entity_id, old_values, new_values, timestamp, ip_address)
    VALUES (
        COALESCE(
            (SELECT id FROM users WHERE username = current_user LIMIT 1),
            current_setting('app.user_id', true)::integer
        ),
        TG_OP,
        TG_TABLE_NAME,
        NEW.id,
        CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD)::text ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW)::text ELSE NULL END,
        CURRENT_TIMESTAMP,
        current_setting('app.client_ip', true)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit triggers for sensitive tables
DROP TRIGGER IF EXISTS users_audit ON users;
CREATE TRIGGER users_audit
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS guardians_audit ON guardians;
CREATE TRIGGER guardians_audit
AFTER INSERT OR UPDATE OR DELETE ON guardians
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS infants_audit ON infants;
CREATE TRIGGER infants_audit
AFTER INSERT OR UPDATE OR DELETE ON infants
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS vaccination_records_audit ON vaccination_records;
CREATE TRIGGER vaccination_records_audit
AFTER INSERT OR UPDATE OR DELETE ON vaccination_records
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS appointments_audit ON appointments;
CREATE TRIGGER appointments_audit
AFTER INSERT OR UPDATE OR DELETE ON appointments
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Create security event logging function
CREATE OR REPLACE FUNCTION log_security_event(
    p_event_type VARCHAR,
    p_severity VARCHAR,
    p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID AS $$
DECLARE
    v_user_id INTEGER;
    v_ip_address VARCHAR(45);
BEGIN
    -- Get current user ID
    BEGIN
        v_user_id := current_setting('app.user_id', true)::integer;
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    -- Get client IP
    BEGIN
        v_ip_address := current_setting('app.client_ip', true);
    EXCEPTION WHEN OTHERS THEN
        v_ip_address := NULL;
    END;

    INSERT INTO security_events (user_id, event_type, severity, ip_address, details, created_at)
    VALUES (v_user_id, p_event_type, p_severity, v_ip_address, p_details, CURRENT_TIMESTAMP);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create login tracking function
CREATE OR REPLACE FUNCTION track_login_attempt(
    p_identifier VARCHAR,
    p_ip_address VARCHAR,
    p_success BOOLEAN
)
RETURNS VOID AS $$
DECLARE
    v_attempt_count INTEGER;
BEGIN
    IF p_success THEN
        -- Clear failed attempts on successful login
        DELETE FROM failed_login_attempts
        WHERE identifier = p_identifier;

        -- Log successful login
        PERFORM log_security_event(
            'LOGIN_SUCCESS',
            'low',
            jsonb_build_object('identifier', p_identifier, 'ip', p_ip_address)
        );
    ELSE
        -- Increment failed attempt count
        UPDATE failed_login_attempts
        SET attempt_count = attempt_count + 1,
            last_attempt = CURRENT_TIMESTAMP
        WHERE identifier = p_identifier;

        -- If no record exists, create one
        IF NOT FOUND THEN
            INSERT INTO failed_login_attempts (identifier, ip_address, attempt_count, last_attempt)
            VALUES (p_identifier, p_ip_address, 1, CURRENT_TIMESTAMP);
        END IF;

        -- Get attempt count
        SELECT attempt_count INTO v_attempt_count
        FROM failed_login_attempts
        WHERE identifier = p_identifier;

        -- Log failed login
        PERFORM log_security_event(
            'LOGIN_FAILED',
            CASE WHEN v_attempt_count >= 5 THEN 'high' ELSE 'medium' END,
            jsonb_build_object('identifier', p_identifier, 'ip', p_ip_address, 'attempts', v_attempt_count)
        );

        -- Lock account after 5 failed attempts
        IF v_attempt_count >= 5 THEN
            UPDATE failed_login_attempts
            SET locked_until = CURRENT_TIMESTAMP + INTERVAL '15 minutes'
            WHERE identifier = p_identifier;

            PERFORM log_security_event(
                'ACCOUNT_LOCKED',
                'high',
                jsonb_build_object('identifier', p_identifier, 'reason', 'Too many failed attempts')
            );
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 6: ROLE-BASED ACCESS CONTROL
-- ============================================================================

-- Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    resource VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    scope VARCHAR(50) DEFAULT 'global',
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(resource, action)
);

-- Create role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    granted_by INTEGER REFERENCES users(id),
    restrictions JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE(role_id, permission_id)
);

-- Create indexes for role_permissions
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

-- Insert default permissions
INSERT INTO permissions (name, resource, action, scope, description) VALUES
    ('users:read', 'users', 'read', 'global', 'View user information'),
    ('users:create', 'users', 'create', 'global', 'Create new users'),
    ('users:update', 'users', 'update', 'global', 'Update user information'),
    ('users:delete', 'users', 'delete', 'global', 'Delete users'),
    ('infants:read', 'infants', 'read', 'global', 'View infant records'),
    ('infants:create', 'infants', 'create', 'global', 'Create infant records'),
    ('infants:update', 'infants', 'update', 'global', 'Update infant records'),
    ('infants:delete', 'infants', 'delete', 'global', 'Delete infant records'),
    ('vaccinations:read', 'vaccinations', 'read', 'global', 'View vaccination records'),
    ('vaccinations:create', 'vaccinations', 'create', 'global', 'Record vaccinations'),
    ('vaccinations:update', 'vaccinations', 'update', 'global', 'Update vaccination records'),
    ('appointments:read', 'appointments', 'read', 'global', 'View appointments'),
    ('appointments:create', 'appointments', 'create', 'global', 'Create appointments'),
    ('appointments:update', 'appointments', 'update', 'global', 'Update appointments'),
    ('appointments:delete', 'appointments', 'delete', 'global', 'Cancel appointments'),
    ('inventory:read', 'inventory', 'read', 'global', 'View inventory'),
    ('inventory:create', 'inventory', 'create', 'global', 'Manage inventory'),
    ('inventory:update', 'inventory', 'update', 'global', 'Update inventory'),
    ('reports:read', 'reports', 'read', 'global', 'View reports'),
    ('reports:create', 'reports', 'create', 'global', 'Generate reports'),
    ('settings:read', 'settings', 'read', 'global', 'View settings'),
    ('settings:update', 'settings', 'update', 'global', 'Update settings'),
    ('analytics:read', 'analytics', 'read', 'global', 'View analytics')
ON CONFLICT (resource, action) DO NOTHING;

-- Create function to check user permission
CREATE OR REPLACE FUNCTION check_permission(
    p_user_id INTEGER,
    p_resource VARCHAR,
    p_action VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_permission BOOLEAN := false;
    v_user_role_id INTEGER;
BEGIN
    -- Get user's role
    SELECT role_id INTO v_user_role_id
    FROM users
    WHERE id = p_user_id;

    -- Check if role has permission
    SELECT EXISTS(
        SELECT 1
        FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = v_user_role_id
        AND p.resource = p_resource
        AND p.action = p_action
        AND p.is_active = true
    ) INTO v_has_permission;

    RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 7: MATERIALIZED VIEWS FOR PERFORMANCE
-- ============================================================================

-- Create materialized view for infant vaccination summary
DROP MATERIALIZED VIEW IF EXISTS infant_vaccination_summary;
CREATE MATERIALIZED VIEW infant_vaccination_summary AS
SELECT
    i.id AS infant_id,
    i.first_name,
    i.last_name,
    i.dob,
    g.name AS guardian_name,
    g.phone AS guardian_phone,
    COUNT(vr.id) AS vaccination_count,
    MAX(vr.admin_date) AS last_vaccination_date,
    COUNT(CASE WHEN vr.next_due_date < CURRENT_DATE AND vr.next_due_date IS NOT NULL THEN 1 END) AS overdue_count,
    COUNT(CASE WHEN vr.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' THEN 1 END) AS due_soon_count,
    MIN(vr.next_due_date) AS next_due_date
FROM infants i
LEFT JOIN guardians g ON i.guardian_id = g.id
LEFT JOIN vaccination_records vr ON i.id = vr.infant_id
WHERE i.is_active = true
GROUP BY i.id, i.first_name, i.last_name, i.dob, g.name, g.phone;

CREATE UNIQUE INDEX IF NOT EXISTS idx_infant_vaccination_summary ON infant_vaccination_summary(infant_id);

-- Create materialized view for inventory summary
DROP MATERIALIZED VIEW IF EXISTS inventory_summary;
CREATE MATERIALIZED VIEW inventory_summary AS
SELECT
    vi.id,
    vi.vaccine_id,
    v.name AS vaccine_name,
    v.code AS vaccine_code,
    vi.clinic_id,
    c.name AS clinic_name,
    vi.beginning_balance + vi.received_during_period - vi.issuance - vi.expired_wasted AS current_stock,
    vi.low_stock_threshold,
    vi.critical_stock_threshold,
    vi.is_low_stock,
    vi.is_critical_stock,
    CASE
        WHEN vi.is_critical_stock THEN 'CRITICAL'
        WHEN vi.is_low_stock THEN 'LOW'
        ELSE 'OK'
    END AS stock_status,
    (SELECT MIN(lot.expiry_date)
     FROM vaccine_batches lot
     WHERE lot.vaccine_id = vi.vaccine_id
     AND lot.clinic_id = vi.clinic_id
     AND lot.status = 'active') AS nearest_expiry
FROM vaccine_inventory vi
JOIN vaccines v ON vi.vaccine_id = v.id
JOIN clinics c ON vi.clinic_id = c.id;

CREATE INDEX IF NOT EXISTS idx_inventory_summary_vaccine ON inventory_summary(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_inventory_summary_clinic ON inventory_summary(clinic_id);
CREATE INDEX IF NOT EXISTS idx_inventory_summary_status ON inventory_summary(stock_status);

-- Create function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY infant_vaccination_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECTION 8: PERFORMANCE OPTIMIZATION - VIEWS
-- ============================================================================

-- Create dashboard statistics view
CREATE OR REPLACE VIEW dashboard_statistics AS
SELECT
    (SELECT COUNT(*) FROM infants WHERE is_active = true) AS total_infants,
    (SELECT COUNT(*) FROM guardians WHERE is_active = true) AS total_guardians,
    (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled' AND scheduled_date > NOW()) AS upcoming_appointments,
    (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled' AND scheduled_date >= CURRENT_DATE AND scheduled_date < CURRENT_DATE + INTERVAL '7 days') AS appointments_this_week,
    (SELECT COUNT(*) FROM vaccine_inventory WHERE is_low_stock = true) AS low_stock_items,
    (SELECT COUNT(*) FROM vaccine_inventory WHERE is_critical_stock = true) AS critical_stock_items,
    (SELECT COUNT(*) FROM vaccination_records WHERE admin_date >= CURRENT_DATE - INTERVAL '30 days') AS vaccinations_this_month,
    (SELECT COUNT(*) FROM notifications WHERE status = 'pending') AS pending_notifications;

-- Create view for guardian dashboard
CREATE OR REPLACE VIEW guardian_dashboard_view AS
SELECT
    g.id AS guardian_id,
    g.name AS guardian_name,
    g.phone,
    g.email,
    COUNT(DISTINCT i.id) AS total_children,
    COUNT(DISTINCT vr.id) AS total_vaccinations,
    COUNT(DISTINCT CASE WHEN vr.next_due_date < CURRENT_DATE AND vr.next_due_date IS NOT NULL THEN vr.id END) AS overdue_vaccinations,
    COUNT(DISTINCT CASE WHEN vr.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' THEN vr.id END) AS upcoming_vaccinations,
    COUNT(DISTINCT a.id) AS total_appointments,
    COUNT(DISTINCT CASE WHEN a.status = 'scheduled' AND a.scheduled_date > NOW() THEN a.id END) AS upcoming_appointments
FROM guardians g
LEFT JOIN infants i ON g.id = i.guardian_id AND i.is_active = true
LEFT JOIN vaccination_records vr ON i.id = vr.infant_id AND vr.is_active = true
LEFT JOIN appointments a ON i.id = a.infant_id AND a.is_active = true
WHERE g.is_active = true
GROUP BY g.id, g.name, g.phone, g.email;

-- Create view for appointment calendar
CREATE OR REPLACE VIEW appointment_calendar_view AS
SELECT
    a.id,
    a.infant_id,
    i.first_name || ' ' || i.last_name AS infant_name,
    g.name AS guardian_name,
    g.phone AS guardian_phone,
    a.scheduled_date,
    a.type,
    a.status,
    a.notes,
    c.name AS clinic_name
FROM appointments a
JOIN infants i ON a.infant_id = i.id
LEFT JOIN guardians g ON i.guardian_id = g.id
LEFT JOIN clinics c ON a.clinic_id = c.id
WHERE a.is_active = true;

-- ============================================================================
-- SECTION 9: DATA VALIDATION TRIGGERS
-- ============================================================================

-- Create function to validate infant age
CREATE OR REPLACE FUNCTION validate_infant_age()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.dob > CURRENT_DATE THEN
        RAISE EXCEPTION 'Date of birth cannot be in the future';
    END IF;

    IF NEW.dob < '1900-01-01'::DATE THEN
        RAISE EXCEPTION 'Date of birth is too old';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_infant_age_trigger ON infants;
CREATE TRIGGER validate_infant_age_trigger
BEFORE INSERT OR UPDATE OF dob ON infants
FOR EACH ROW EXECUTE FUNCTION validate_infant_age();

-- Create function to validate vaccination dose
CREATE OR REPLACE FUNCTION validate_vaccination_dose()
RETURNS TRIGGER AS $$
DECLARE
    v_doses_required INTEGER;
    v_existing_count INTEGER;
BEGIN
    -- Get required doses for vaccine
    SELECT doses_required INTO v_doses_required
    FROM vaccines
    WHERE id = NEW.vaccine_id;

    -- Count existing doses for this infant and vaccine
    SELECT COUNT(*) INTO v_existing_count
    FROM vaccination_records
    WHERE infant_id = NEW.infant_id
    AND vaccine_id = NEW.vaccine_id
    AND is_active = true;

    -- Check if dose number is valid
    IF NEW.dose_no > v_doses_required THEN
        RAISE EXCEPTION 'Dose number (%) exceeds required doses (%) for this vaccine',
            NEW.dose_no, v_doses_required;
    END IF;

    IF NEW.dose_no <= v_existing_count AND TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'Dose number % already exists for this infant and vaccine',
            NEW.dose_no;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_vaccination_dose_trigger ON vaccination_records;
CREATE TRIGGER validate_vaccination_dose_trigger
BEFORE INSERT OR UPDATE ON vaccination_records
FOR EACH ROW EXECUTE FUNCTION validate_vaccination_dose();

-- Create function to update inventory stock levels
CREATE OR REPLACE FUNCTION update_inventory_stock()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- New inventory transaction
        UPDATE vaccine_inventory
        SET issuance = issuance + NEW.quantity,
            updated_at = CURRENT_TIMESTAMP
        WHERE vaccine_id = NEW.vaccine_id
        AND clinic_id = NEW.clinic_id;
    ELSIF TG_OP = 'DELETE' THEN
        -- Reverse transaction
        UPDATE vaccine_inventory
        SET issuance = issuance - OLD.quantity,
            updated_at = CURRENT_TIMESTAMP
        WHERE vaccine_id = OLD.vaccine_id
        AND clinic_id = OLD.clinic_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECTION 10: CLEANUP AND FINALIZATION
-- ============================================================================

-- Create function to analyze tables for query optimization
CREATE OR REPLACE FUNCTION analyze_all_tables()
RETURNS void AS $$
BEGIN
    ANALYZE users;
    ANALYZE guardians;
    ANALYZE infants;
    ANALYZE vaccines;
    ANALYZE vaccination_records;
    ANALYZE appointments;
    ANALYZE vaccine_inventory;
    ANALYZE notifications;
    ANALYZE audit_logs;
    ANALYZE security_events;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO immunicare_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO immunicare_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO immunicare_user;

-- Print completion message
DO $$
BEGIN
    RAISE NOTICE 'Database optimization and restructuring completed successfully!';
    RAISE NOTICE 'New tables created: access_logs, user_roles, api_keys';
    RAISE NOTICE 'Indexes added: 20+ new indexes for query optimization';
    RAISE NOTICE 'Security features: Audit triggers, Security event logging, RBAC';
    RAISE NOTICE 'Performance: Materialized views for dashboards';
    RAISE NOTICE 'Run SELECT refresh_all_materialized_views() to update materialized views';
END $$;

-- ============================================================================
-- END OF SCRIPT
-- ============================================================================
