-- Verification script to check health center workers setup
-- Run this to verify all workers were created successfully

-- Check if all health center workers were created
SELECT 
    u.username,
    r.display_name as role,
    hw.specialization,
    hw.license_number,
    c.name as clinic,
    hw.is_active,
    u.created_at
FROM users u
JOIN roles r ON u.role_id = r.id
JOIN healthcare_workers hw ON u.id = hw.user_id
JOIN clinics c ON u.clinic_id = c.id
WHERE r.name IN ('physician', 'nurse', 'midwife', 'nutritionist', 'barangay_nutrition_scholar', 'dentist')
ORDER BY r.hierarchy_level DESC, u.username;

-- Check role assignments
SELECT 
    r.name,
    r.display_name,
    r.hierarchy_level,
    COUNT(rp.permission_id) as permission_count
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
WHERE r.name IN ('physician', 'nurse', 'midwife', 'nutritionist', 'barangay_nutrition_scholar', 'dentist')
GROUP BY r.id, r.name, r.display_name, r.hierarchy_level
ORDER BY r.hierarchy_level DESC;

-- Check permissions assigned to each role
SELECT 
    r.display_name as role,
    p.name as permission_name,
    p.resource,
    p.action
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.name IN ('physician', 'nurse', 'midwife', 'nutritionist', 'barangay_nutrition_scholar', 'dentist')
ORDER BY r.display_name, p.resource, p.action;