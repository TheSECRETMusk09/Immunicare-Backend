-- ============================================================================
-- ADMIN AND HEALTH WORKER DASHBOARD MANAGEMENT TABLE
-- ============================================================================
-- This table stores admin and health worker accounts that can manage the admin dashboard
-- ============================================================================

-- Drop table if exists for fresh setup
DROP TABLE IF EXISTS admin_dashboard_users CASCADE;

-- Create enum for admin types
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_user_type') THEN
        CREATE TYPE admin_user_type AS ENUM ('admin', 'health_worker', 'super_admin', 'manager');
    END IF;
END $$;

-- Create enum for dashboard access levels
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dashboard_access_level') THEN
        CREATE TYPE dashboard_access_level AS ENUM ('view_only', 'limited', 'standard', 'advanced', 'full');
    END IF;
END $$;

-- Create enum for employment status
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_status') THEN
        CREATE TYPE employment_status AS ENUM ('active', 'inactive', 'on_leave', 'suspended', 'terminated');
    END IF;
END $$;

-- ============================================================================
-- MAIN TABLE: admin_dashboard_users
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_dashboard_users (
    -- Primary identification
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    
    -- Admin/Health worker details
    admin_type USER-DEFINED NOT NULL DEFAULT 'health_worker'::admin_user_type,
    employee_id VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    suffix VARCHAR(20),
    
    -- Contact information
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20),
    alternate_phone VARCHAR(20),
    
    -- Employment details
    position VARCHAR(100) NOT NULL,
    department VARCHAR(100),
    specialization VARCHAR(100),
    license_number VARCHAR(50),
    license_expiry DATE,
    
    -- Dashboard access
    dashboard_access_level USER-DEFINED NOT NULL DEFAULT 'standard'::dashboard_access_level,
    dashboard_modules JSONB DEFAULT '[]'::jsonb,
    can_manage_users BOOLEAN DEFAULT FALSE,
    can_manage_settings BOOLEAN DEFAULT FALSE,
    can_manage_health_workers BOOLEAN DEFAULT FALSE,
    can_view_reports BOOLEAN DEFAULT TRUE,
    can_manage_announcements BOOLEAN DEFAULT FALSE,
    can_manage_inventory BOOLEAN DEFAULT FALSE,
    can_manage_vaccinations BOOLEAN DEFAULT FALSE,
    can_manage_patients BOOLEAN DEFAULT FALSE,
    
    -- System access
    is_primary_admin BOOLEAN DEFAULT FALSE,
    is_system_admin BOOLEAN DEFAULT FALSE,
    requires_2fa BOOLEAN DEFAULT FALSE,
    force_password_change BOOLEAN DEFAULT FALSE,
    
    -- Status
    employment_status USER-DEFINED NOT NULL DEFAULT 'active'::employment_status,
    hire_date DATE,
    termination_date DATE,
    
    -- Audit fields
    last_login TIMESTAMP WITH TIME ZONE,
    last_activity TIMESTAMP WITH TIME ZONE,
    password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT admin_dashboard_users_user_id_fkey 
        FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT admin_dashboard_users_created_by_fkey 
        FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT admin_dashboard_users_updated_by_fkey 
        FOREIGN KEY (updated_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT admin_dashboard_users_email_check 
        CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE admin_dashboard_users IS 'Stores admin and health worker accounts that can manage the admin dashboard';
COMMENT ON COLUMN admin_dashboard_users.id IS 'Unique identifier for admin/health worker';
COMMENT ON COLUMN admin_dashboard_users.user_id IS 'Reference to the users table for authentication';
COMMENT ON COLUMN admin_dashboard_users.admin_type IS 'Type of admin: admin, health_worker, super_admin, manager';
COMMENT ON COLUMN admin_dashboard_users.employee_id IS 'Unique employee identification number';
COMMENT ON COLUMN admin_dashboard_users.first_name IS 'First name of the admin/health worker';
COMMENT ON COLUMN admin_dashboard_users.last_name IS 'Last name of the admin/health worker';
COMMENT ON COLUMN admin_dashboard_users.middle_name IS 'Middle name of the admin/health worker';
COMMENT ON COLUMN admin_dashboard_users.suffix IS 'Suffix (Jr., Sr., III, etc.)';
COMMENT ON COLUMN admin_dashboard_users.email IS 'Email address for notifications and login';
COMMENT ON COLUMN admin_dashboard_users.phone IS 'Primary phone number';
COMMENT ON COLUMN admin_dashboard_users.alternate_phone IS 'Alternate phone number';
COMMENT ON COLUMN admin_dashboard_users.position IS 'Job position/title';
COMMENT ON COLUMN admin_dashboard_users.department IS 'Department within the organization';
COMMENT ON COLUMN admin_dashboard_users.specialization IS 'Medical or professional specialization';
COMMENT ON COLUMN admin_dashboard_users.license_number IS 'Professional license number (for health workers)';
COMMENT ON COLUMN admin_dashboard_users.license_expiry IS 'License expiration date';
COMMENT ON COLUMN admin_dashboard_users.dashboard_access_level IS 'Access level for dashboard features';
COMMENT ON COLUMN admin_dashboard_users.dashboard_modules IS 'JSON array of specific dashboard modules accessible';
COMMENT ON COLUMN admin_dashboard_users.can_manage_users IS 'Can manage user accounts';
COMMENT ON COLUMN admin_dashboard_users.can_manage_settings IS 'Can manage system settings';
COMMENT ON COLUMN admin_dashboard_users.can_manage_health_workers IS 'Can manage health worker accounts';
COMMENT ON COLUMN admin_dashboard_users.can_view_reports IS 'Can view and generate reports';
COMMENT ON COLUMN admin_dashboard_users.can_manage_announcements IS 'Can manage system announcements';
COMMENT ON COLUMN admin_dashboard_users.can_manage_inventory IS 'Can manage inventory system';
COMMENT ON COLUMN admin_dashboard_users.can_manage_vaccinations IS 'Can manage vaccination records';
COMMENT ON COLUMN admin_dashboard_users.can_manage_patients IS 'Can manage patient/infant records';
COMMENT ON COLUMN admin_dashboard_users.is_primary_admin IS 'Is the primary/super admin with full access';
COMMENT ON COLUMN admin_dashboard_users.is_system_admin IS 'Has system administrator privileges';
COMMENT ON COLUMN admin_dashboard_users.requires_2fa IS 'Requires two-factor authentication';
COMMENT ON COLUMN admin_dashboard_users.force_password_change IS 'Must change password on next login';
COMMENT ON COLUMN admin_dashboard_users.employment_status IS 'Current employment status';
COMMENT ON COLUMN admin_dashboard_users.hire_date IS 'Date of hire/employment start';
COMMENT ON COLUMN admin_dashboard_users.termination_date IS 'Date of employment termination';
COMMENT ON COLUMN admin_dashboard_users.last_login IS 'Timestamp of last successful login';
COMMENT ON COLUMN admin_dashboard_users.last_activity IS 'Timestamp of last activity';
COMMENT ON COLUMN admin_dashboard_users.password_changed_at IS 'Timestamp of last password change';
COMMENT ON COLUMN admin_dashboard_users.created_by IS 'User who created this record';
COMMENT ON COLUMN admin_dashboard_users.updated_by IS 'User who last updated this record';
COMMENT ON COLUMN admin_dashboard_users.created_at IS 'Record creation timestamp';
COMMENT ON COLUMN admin_dashboard_users.updated_at IS 'Record last update timestamp';
COMMENT ON COLUMN admin_dashboard_users.deleted_at IS 'Soft delete timestamp';

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_user_id 
    ON admin_dashboard_users(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_email 
    ON admin_dashboard_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_employee_id 
    ON admin_dashboard_users(employee_id);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_admin_type 
    ON admin_dashboard_users(admin_type);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_dashboard_access_level 
    ON admin_dashboard_users(dashboard_access_level);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_employment_status 
    ON admin_dashboard_users(employment_status);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_department 
    ON admin_dashboard_users(department);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_position 
    ON admin_dashboard_users(position);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_created_at 
    ON admin_dashboard_users(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_users_last_login 
    ON admin_dashboard_users(last_login);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to update the updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_admin_dashboard_users_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamp
DROP TRIGGER IF EXISTS trigger_update_admin_dashboard_users_timestamp 
    ON admin_dashboard_users;
CREATE TRIGGER trigger_update_admin_dashboard_users_timestamp
    BEFORE UPDATE ON admin_dashboard_users
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_dashboard_users_timestamp();

-- Function to get full name
CREATE OR REPLACE FUNCTION get_admin_full_name(user_id INTEGER)
RETURNS VARCHAR(255) AS $$
    SELECT CONCAT_WS(' ', first_name, middle_name, last_name, suffix)::VARCHAR(255)
    FROM admin_dashboard_users
    WHERE user_id = $1;
$$ LANGUAGE sql;

-- ============================================================================
-- DEFAULT ACCESSIBLE DASHBOARD MODULES
-- ============================================================================

COMMENT ON TYPE dashboard_access_level IS '
    view_only: Can only view dashboard, no modifications
    limited: Can view and make limited changes
    standard: Full access to standard dashboard features
    advanced: Access to advanced features and reports
    full: Complete access to all dashboard features
';

-- ============================================================================
-- SAMPLE DATA (Optional - Remove for production)
-- ============================================================================

-- INSERT INTO admin_dashboard_users (user_id, admin_type, employee_id, first_name, last_name, email, position, department, dashboard_access_level, can_manage_users, can_manage_settings, can_manage_health_workers, can_view_reports, can_manage_announcements, can_manage_inventory, can_manage_vaccinations, can_manage_patients, is_primary_admin, is_system_admin)
-- VALUES 
-- (1, 'super_admin', 'EMP001', 'System', 'Administrator', 'admin@immunicare.com', 'System Administrator', 'IT', 'full', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE),
-- (2, 'admin', 'EMP002', 'Health', 'Manager', 'manager@immunicare.com', 'Health Manager', 'Healthcare', 'advanced', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE),
-- (3, 'health_worker', 'EMP003', 'Nurse', 'Johnson', 'nurse@immunicare.com', 'Senior Nurse', 'Healthcare', 'standard', FALSE, FALSE, FALSE, TRUE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE);

-- ============================================================================
-- END OF FILE
-- ============================================================================
