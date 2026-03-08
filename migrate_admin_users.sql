-- ============================================================================
-- Migration Script: Move admin/administrator credentials from users table to admin table
-- Date: 2026-02-11
-- ============================================================================

-- Step 1: Ensure healthcare facilities exist (required for admin table foreign key)
INSERT INTO healthcare_facilities (name, region, address, contact) VALUES
    ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number'),
    ('Guardian Portal', 'Virtual', 'Online Portal', 'portal@immunicare.com')
ON CONFLICT (name) DO NOTHING;

-- Step 2: Ensure roles exist for mapping (for old users table)
-- First, ensure the roles table has admin roles
INSERT INTO roles (name, display_name, is_system_role, hierarchy_level) VALUES
    ('admin', 'Administrator', true, 10),
    ('super_admin', 'Super Administrator', true, 100),
    ('doctor', 'Doctor', true, 20),
    ('nurse', 'Nurse', true, 15)
ON CONFLICT (name) DO NOTHING;

-- Step 3: Get role IDs for mapping
DO $$
DECLARE
    admin_role_id INTEGER;
    super_admin_role_id INTEGER;
    doctor_role_id INTEGER;
    nurse_role_id INTEGER;
BEGIN
    SELECT id INTO admin_role_id FROM roles WHERE name = 'admin';
    SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin';
    SELECT id INTO doctor_role_id FROM roles WHERE name = 'doctor';
    SELECT id INTO nurse_role_id FROM roles WHERE name = 'nurse';
    
    -- Step 4: Migrate 'admin' and 'administrator' users from users table to admin table
    -- Using INSERT ... ON CONFLICT to handle duplicates
    
    -- For 'admin' username - map to super_admin role
    INSERT INTO admin (username, password_hash, role, facility_id, contact, email, is_active, last_login)
    SELECT 
        u.username,
        u.password_hash,
        'super_admin'::admin_role,
        COALESCE(u.clinic_id, 1),  -- Use clinic_id as facility_id, default to 1
        u.contact,
        u.email,
        u.is_active,
        u.last_login
    FROM users u
    WHERE LOWER(u.username) IN ('admin', 'administrator')
    ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        facility_id = EXCLUDED.facility_id,
        contact = EXCLUDED.contact,
        email = EXCLUDED.email,
        is_active = EXCLUDED.is_active,
        last_login = EXCLUDED.last_login,
        updated_at = CURRENT_TIMESTAMP;
        
    -- Log the migration
    RAISE NOTICE 'Admin/Administrator users migration completed successfully';
END $$;

-- Step 5: Verify the migration
SELECT 
    'admin' AS table_name,
    COUNT(*) AS total_admin_users
FROM admin
WHERE username IN ('admin', 'administrator')
UNION ALL
SELECT 
    'users' AS table_name,
    COUNT(*) AS total_admin_users
FROM users
WHERE LOWER(username) IN ('admin', 'administrator');

-- Step 6: Display migrated admin users
SELECT 
    id,
    username,
    role,
    facility_id,
    email,
    is_active,
    last_login,
    created_at,
    updated_at
FROM admin
WHERE LOWER(username) IN ('admin', 'administrator')
ORDER BY username;

-- ============================================================================
-- END OF MIGRATION SCRIPT
-- ============================================================================
