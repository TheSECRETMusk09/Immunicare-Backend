-- Admin User Setup Script
-- This script creates a default admin user for the Immunicare system

-- ===========================================
-- CREATE DEFAULT ADMIN USER
-- ===========================================

-- Insert default clinic if none exists
INSERT INTO clinics (name, region, address, contact) 
VALUES ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number')
ON CONFLICT DO NOTHING;

-- Get the admin role ID and clinic ID for reference
-- We'll use these in the user creation

-- Create Super Administrator user
INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
SELECT 
    'admin',
    '$2b$10$pqXmhkL/4r6ZZ7YyoUDQyuSkJkTO59O0kGU7lh7WLGLT3WxrEmOCK', -- password: Immunicare2026!
    r.id,
    c.id,
    'administrator@immunicare.com',
    NULL
FROM roles r, clinics c 
WHERE r.name = 'super_admin' AND c.name = 'Main Health Center'
ON CONFLICT (username) DO NOTHING;

-- Also create an Administrator role user as backup
INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
SELECT 
    'administrator',
    '$2b$10$pqXmhkL/4r6ZZ7YyoUDQyuSkJkTO59O0kGU7lh7WLGLT3WxrEmOCK', -- password: Immunicare2026!
    r.id,
    c.id,
    'administrator@immunicare.com',
    NULL
FROM roles r, clinics c 
WHERE r.name = 'admin' AND c.name = 'Main Health Center'
ON CONFLICT (username) DO NOTHING;

-- Grant all permissions to super_admin role
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.id, p.id, 
    (SELECT u.id FROM users u WHERE u.username = 'admin' LIMIT 1)
FROM roles r, permissions p
WHERE r.name = 'super_admin' 
AND p.name IN (
    'users.create', 'users.read', 'users.update', 'users.delete',
    'infants.create', 'infants.read', 'infants.update', 'infants.delete',
    'vaccinations.create', 'vaccinations.read', 'vaccinations.update',
    'reports.generate', 'reports.read'
)
ON CONFLICT DO NOTHING;

-- Grant all permissions to admin role
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.id, p.id,
    (SELECT u.id FROM users u WHERE u.username = 'admin' LIMIT 1)
FROM roles r, permissions p
WHERE r.name = 'admin' 
AND p.name IN (
    'users.create', 'users.read', 'users.update', 'users.delete',
    'infants.create', 'infants.read', 'infants.update', 'infants.delete',
    'vaccinations.create', 'vaccinations.read', 'vaccinations.update',
    'reports.generate', 'reports.read'
)
ON CONFLICT DO NOTHING;

-- ===========================================
-- VERIFICATION QUERY
-- ===========================================

-- Display created admin users
SELECT 
    u.username,
    r.display_name as role,
    r.hierarchy_level,
    c.name as clinic,
    u.contact
FROM users u
JOIN roles r ON u.role_id = r.id
JOIN clinics c ON u.clinic_id = c.id
WHERE r.name IN ('super_admin', 'admin')
ORDER BY r.hierarchy_level DESC, u.username;

-- Display admin role permissions
SELECT 
    r.display_name as role,
    COUNT(rp.permission_id) as permission_count
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
WHERE r.name IN ('super_admin', 'admin')
GROUP BY r.display_name, r.hierarchy_level
ORDER BY r.hierarchy_level DESC;