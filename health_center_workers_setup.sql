-- Health Center Workers Database Setup
-- This script adds the health center workers with their credentials and roles

-- ===========================================
-- CLINIC SETUP (if not exists)
-- ===========================================

-- Insert a default clinic if none exists
INSERT INTO clinics (name, region, address, contact) 
VALUES ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number')
ON CONFLICT DO NOTHING;

-- Get the clinic ID for reference
-- We'll use this in the user creation

-- ===========================================
-- ROLE ASSIGNMENTS FOR HEALTH CENTER WORKERS
-- ===========================================

-- Create specific roles for health center workers if they don't exist
INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions) VALUES
('physician', 'Physician', false, 50, '{"can_administer_vaccines": true, "can_view_all_records": true}'),
('nurse', 'Nurse', false, 35, '{"can_administer_vaccines": true, "can_record_vitals": true, "can_view_patient_records": true}'),
('midwife', 'Midwife', false, 30, '{"can_assist_deliveries": true, "can_record_births": true, "can_view_maternal_records": true}'),
('nutritionist', 'Nutritionist', false, 35, '{"can_record_growth_data": true, "can_provide_nutrition_advice": true, "can_view_growth_records": true}'),
('barangay_nutrition_scholar', 'Barangay Nutrition Scholar', false, 25, '{"can_assist_nutrition_programs": true, "can_record_basic_data": true}'),
('dentist', 'Dentist', false, 45, '{"can_provide_dental_care": true, "can_view_dental_records": true, "can_create_dental_reports": true}')
ON CONFLICT (name) DO NOTHING;

-- ===========================================
-- CREATE HEALTH CENTER WORKER USERS
-- ===========================================

-- 1. Maria Laarni C. Bernales - PHYSICIAN
INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
SELECT 
    'maria.bernales',
    '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', -- password: Physician2024!
    r.id,
    c.id,
    'Contact: +63-XXX-XXX-XXXX',
    NULL
FROM roles r, clinics c 
WHERE r.name = 'physician' AND c.name = 'Main Health Center'
ON CONFLICT (username) DO NOTHING;

-- Create healthcare worker record for Maria
INSERT INTO healthcare_workers (user_id, license_number, specialization, years_experience, is_active)
SELECT 
    u.id,
    'MD-REG-XXXX-XXXX',
    'General Medicine',
    10,
    true
FROM users u
WHERE u.username = 'maria.bernales'
ON CONFLICT DO NOTHING;

-- 2. Jane Preciouse B. Ferrer - NURSE
INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
SELECT 
    'jane.ferrer',
    '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', -- password: Nurse2024!
    r.id,
    c.id,
    'Contact: +63-XXX-XXX-XXXX',
    NULL
FROM roles r, clinics c 
WHERE r.name = 'nurse' AND c.name = 'Main Health Center'
ON CONFLICT (username) DO NOTHING;

-- Create healthcare worker record for Jane
INSERT INTO healthcare_workers (user_id, license_number, specialization, years_experience, is_active)
SELECT 
    u.id,
    'RN-REG-XXXX-XXXX',
    'General Nursing',
    5,
    true
FROM users u
WHERE u.username = 'jane.ferrer'
ON CONFLICT DO NOTHING;

-- 3. Luzminda U. Rebenito - MIDWIFE
INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
SELECT 
    'luzminda.rebenito',
    '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', -- password: Midwife2024!
    r.id,
    c.id,
    'Contact: +63-XXX-XXX-XXXX',
    NULL
FROM roles r, clinics c 
WHERE r.name = 'midwife' AND c.name = 'Main Health Center'
ON CONFLICT (username) DO NOTHING;

-- Create healthcare worker record for Luzminda
INSERT INTO healthcare_workers (user_id, license_number, specialization, years_experience, is_active)
SELECT 
    u.id,
    'RM-REG-XXXX-XXXX',
    'Maternal and Child Health',
    8,
    true
FROM users u
WHERE u.username = 'luzminda.rebenito'
ON CONFLICT DO NOTHING;

-- 4. Dianne Jane Fanio - NUTRITIONIST
INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
SELECT 
    'dianne.fanio',
    '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', -- password: Nutritionist2024!
    r.id,
    c.id,
    'Contact: +63-XXX-XXX-XXXX',
    NULL
FROM roles r, clinics c 
WHERE r.name = 'nutritionist' AND c.name = 'Main Health Center'
ON CONFLICT (username) DO NOTHING;

-- Create healthcare worker record for Dianne
INSERT INTO healthcare_workers (user_id, license_number, specialization, years_experience, is_active)
SELECT 
    u.id,
    'RND-REG-XXXX-XXXX',
    'Clinical Nutrition',
    6,
    true
FROM users u
WHERE u.username = 'dianne.fanio'
ON CONFLICT DO NOTHING;

-- 5. Mirasol SA. Herradura - BARANGAY NUTRITION SCHOLAR
INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
SELECT 
    'mirasol.herradura',
    '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', -- password: BNS2024!
    r.id,
    c.id,
    'Contact: +63-XXX-XXX-XXXX',
    NULL
FROM roles r, clinics c 
WHERE r.name = 'barangay_nutrition_scholar' AND c.name = 'Main Health Center'
ON CONFLICT (username) DO NOTHING;

-- Create healthcare worker record for Mirasol
INSERT INTO healthcare_workers (user_id, license_number, specialization, years_experience, is_active)
SELECT 
    u.id,
    'BNS-CERT-XXXX-XXXX',
    'Community Nutrition',
    3,
    true
FROM users u
WHERE u.username = 'mirasol.herradura'
ON CONFLICT DO NOTHING;

-- 6. Lenie M. Agcongay - DENTIST
INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login) 
SELECT 
    'lenie.agcongay',
    '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', -- password: Dentist2024!
    r.id,
    c.id,
    'Contact: +63-XXX-XXX-XXXX',
    NULL
FROM roles r, clinics c 
WHERE r.name = 'dentist' AND c.name = 'Main Health Center'
ON CONFLICT (username) DO NOTHING;

-- Create healthcare worker record for Lenie
INSERT INTO healthcare_workers (user_id, license_number, specialization, years_experience, is_active)
SELECT 
    u.id,
    'DMD-REG-XXXX-XXXX',
    'General Dentistry',
    7,
    true
FROM users u
WHERE u.username = 'lenie.agcongay'
ON CONFLICT DO NOTHING;

-- ===========================================
-- ASSIGN PERMISSIONS TO ROLES
-- ===========================================

-- Grant basic permissions to each role
-- Physician permissions
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.id, p.id, 1
FROM roles r, permissions p
WHERE r.name = 'physician' 
AND p.name IN ('infants.create', 'infants.read', 'infants.update', 'vaccinations.create', 'vaccinations.read', 'vaccinations.update', 'reports.generate', 'reports.read')
ON CONFLICT DO NOTHING;

-- Nurse permissions
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.id, p.id, 1
FROM roles r, permissions p
WHERE r.name = 'nurse' 
AND p.name IN ('infants.read', 'infants.update', 'vaccinations.create', 'vaccinations.read', 'vaccinations.update', 'reports.read')
ON CONFLICT DO NOTHING;

-- Midwife permissions
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.id, p.id, 1
FROM roles r, permissions p
WHERE r.name = 'midwife' 
AND p.name IN ('infants.create', 'infants.read', 'infants.update', 'vaccinations.read', 'reports.read')
ON CONFLICT DO NOTHING;

-- Nutritionist permissions
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.id, p.id, 1
FROM roles r, permissions p
WHERE r.name = 'nutritionist' 
AND p.name IN ('infants.read', 'infants.update', 'reports.generate', 'reports.read')
ON CONFLICT DO NOTHING;

-- Barangay Nutrition Scholar permissions
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.id, p.id, 1
FROM roles r, permissions p
WHERE r.name = 'barangay_nutrition_scholar' 
AND p.name IN ('infants.read', 'reports.read')
ON CONFLICT DO NOTHING;

-- Dentist permissions
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.id, p.id, 1
FROM roles r, permissions p
WHERE r.name = 'dentist' 
AND p.name IN ('infants.read', 'infants.update', 'reports.generate', 'reports.read')
ON CONFLICT DO NOTHING;

-- ===========================================
-- CREATE DEFAULT CLINIC SCHEDULE CONFIGURATION
-- ===========================================

-- Insert system configuration for working hours
INSERT INTO system_config (config_key, config_value, description) VALUES
('working_hours', '{"start": "08:00", "end": "17:00", "days": ["monday", "tuesday", "wednesday", "thursday", "friday"]}', 'Standard working hours for health center')
ON CONFLICT (config_key) DO NOTHING;

-- ===========================================
-- VERIFICATION QUERIES
-- ===========================================

-- Display created users and their roles
SELECT 
    u.username,
    r.display_name as role,
    hw.specialization,
    hw.license_number,
    c.name as clinic
FROM users u
JOIN roles r ON u.role_id = r.id
JOIN healthcare_workers hw ON u.id = hw.user_id
JOIN clinics c ON u.clinic_id = c.id
ORDER BY r.hierarchy_level DESC, u.username;

-- Display role hierarchy
SELECT name, display_name, hierarchy_level, is_system_role FROM roles ORDER BY hierarchy_level DESC;