-- ============================================================================
-- GUARDIAN TABLE RESET AND COMPLETE SETUP SCRIPT
-- For Immunicare Database
-- ============================================================================

-- ============================================================================
-- STEP 1: TRUNCATE GUARDIAN TABLE
-- Removes all existing records while preserving table structure
-- ============================================================================

TRUNCATE TABLE guardians RESTART IDENTITY CASCADE;

-- Also truncate related users with guardian_id (will be recreated)
DELETE FROM users WHERE guardian_id IS NOT NULL;

-- ============================================================================
-- STEP 2: ADD NEW COLUMNS TO GUARDIANS TABLE
-- ============================================================================

-- Add columns if they don't exist (idempotent)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'password') THEN
        ALTER TABLE guardians ADD COLUMN password VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'first_name') THEN
        ALTER TABLE guardians ADD COLUMN first_name VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'last_name') THEN
        ALTER TABLE guardians ADD COLUMN last_name VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'middle_name') THEN
        ALTER TABLE guardians ADD COLUMN middle_name VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'emergency_contact_priority') THEN
        ALTER TABLE guardians ADD COLUMN emergency_contact_priority INTEGER DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'alternate_phone') THEN
        ALTER TABLE guardians ADD COLUMN alternate_phone VARCHAR(20);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'is_primary_guardian') THEN
        ALTER TABLE guardians ADD COLUMN is_primary_guardian BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'must_change_password') THEN
        ALTER TABLE guardians ADD COLUMN must_change_password BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'is_password_set') THEN
        ALTER TABLE guardians ADD COLUMN is_password_set BOOLEAN DEFAULT false;
    END IF;
END $$;

-- ============================================================================
-- STEP 3: RENAME EXISTING COLUMNS FOR CONSISTENCY
-- ============================================================================

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'phone') THEN
        ALTER TABLE guardians RENAME COLUMN phone TO phone_number;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'relationship') THEN
        ALTER TABLE guardians RENAME COLUMN relationship TO relationship_to_student;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardians' AND column_name = 'name') THEN
        ALTER TABLE guardians RENAME COLUMN name TO full_name;
    END IF;
END $$;

-- ============================================================================
-- STEP 4: ENSURE REQUIRED ROLES AND CLINICS EXIST
-- ============================================================================

-- Create guardian role if not exists
INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
VALUES ('guardian', 'Guardian', true, 20, '[]')
ON CONFLICT (name) DO NOTHING;

-- Get guardian role ID
DO $$
DECLARE
    guardian_role_id INTEGER;
BEGIN
    SELECT id INTO guardian_role_id FROM roles WHERE name = 'guardian' LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
        VALUES ('guardian', 'Guardian', true, 20, '[]')
        RETURNING id INTO guardian_role_id;
    END IF;
END $$;

-- Create Guardian Portal clinic if not exists
INSERT INTO clinics (name, region, address, contact)
VALUES ('Guardian Portal', 'Virtual', 'Online Access Only', 'N/A')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- STEP 5: INSERT REALISTIC GUARDIAN DATA
-- Password is bcrypt hashed using PostgreSQL pgcrypto
-- Default password: 'Guardian123!'
-- ============================================================================

-- Guardian 1: Maria Elena Santos (Mother - Primary)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'Maria Elena Santos', 'Maria', 'Santos', 'Elena',
    '+63-917-123-4567', 'maria.santos@email.com',
    '123 Sampaguita Street, Barangay Maliksi, Quezon City, Metro Manila 1126',
    'mother', 1, true,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Guardian 2: Juan Miguel dela Cruz (Father - Primary)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'Juan Miguel dela Cruz', 'Juan', 'dela Cruz', 'Miguel',
    '+63-918-234-5678', 'juan.delacruz@email.com',
    '456 Rose Avenue, Barangay Santol, Manila, Metro Manila 1012',
    'father', 2, true,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Guardian 3: Ana Marie Reyes (Mother - Primary)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'Ana Marie Reyes', 'Ana', 'Reyes', 'Marie',
    '+63-919-345-6789', 'ana.reyes@email.com',
    '789 Lily Lane, Barangay Holy Spirit, Quezon City, Metro Manila 1127',
    'mother', 1, true,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Guardian 4: Pedro Luis Garcia (Father - Primary)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'Pedro Luis Garcia', 'Pedro', 'Garcia', 'Luis',
    '+63-920-456-7890', 'pedro.garcia@email.com',
    '321 Jasmine Road, Barangay San Antonio, Makati, Metro Manila 1203',
    'father', 2, true,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Guardian 5: Carmen Victoria Lim (Grandmother)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'Carmen Victoria Lim', 'Carmen', 'Lim', 'Victoria',
    '+63-921-567-8901', 'carmen.lim@email.com',
    '654 Orchid Street, Barangay Bel-Air, Makati, Metro Manila 1227',
    'grandmother', 3, false,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Guardian 6: Robert Antonio Mendoza (Legal Guardian)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'Robert Antonio Mendoza', 'Robert', 'Mendoza', 'Antonio',
    '+63-922-678-9012', 'robert.mendoza@email.com',
    '876 Tulip Street, Barangay Forbes Park, Makati, Metro Manila 1220',
    'legal_guardian', 2, false,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Guardian 7: Elena Sofia Flores-Bautista (Foster Parent)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'Elena Sofia Flores-Bautista', 'Elena', 'Flores-Bautista', 'Sofia',
    '+63-923-789-0123', 'elena.bautista@email.com',
    '432 Dahlia Circle, Barangay Dasmarinas Village, Makati, Metro Manila 1221',
    'foster_parent', 1, true,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Guardian 8: Michael James Tan (Father)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'Michael James Tan', 'Michael', 'Tan', 'James',
    '+63-924-890-1234', 'michael.tan@email.com',
    '555 Sunflower Street, Barangay North Triangle, Quezon City, Metro Manila 1105',
    'father', 1, true,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Guardian 9: Sarah Abigail Ong (Mother)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'Sarah Abigail Ong', 'Sarah', 'Ong', 'Abigail',
    '+63-925-901-2345', 'sarah.ong@email.com',
    '777 Gardenia Street, Barangay Greenhills, San Juan, Metro Manila 1502',
    'mother', 1, true,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Guardian 10: David William Cruz (Stepfather)
INSERT INTO guardians (
    full_name, first_name, last_name, middle_name,
    phone_number, email, address, relationship_to_student,
    emergency_contact_priority, is_primary_guardian, password,
    must_change_password, is_password_set,
    is_active, created_at, updated_at
) VALUES (
    'David William Cruz', 'David', 'Cruz', 'William',
    '+63-926-012-3456', 'david.cruz@email.com',
    '888 Marigold Street, Barangay Tandang Sora, Quezon City, Metro Manila 1116',
    'stepfather', 3, false,
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password
    false, true,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- ============================================================================
-- STEP 6: CREATE USER ACCOUNTS FOR GUARDIANS
-- ============================================================================

-- Get the guardian role ID and clinic ID
DO $$
DECLARE
    guardian_role_id INTEGER;
    guardian_clinic_id INTEGER;
    default_password_hash VARCHAR(255);
BEGIN
    -- Get or create guardian role
    SELECT id INTO guardian_role_id FROM roles WHERE name = 'guardian' LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
        VALUES ('guardian', 'Guardian', true, 20, '[]')
        RETURNING id INTO guardian_role_id;
    END IF;
    
    -- Get or create guardian portal clinic
    SELECT id INTO guardian_clinic_id FROM clinics WHERE name = 'Guardian Portal' LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO clinics (name, region, address, contact)
        VALUES ('Guardian Portal', 'Virtual', 'Online Access Only', 'N/A')
        RETURNING id INTO guardian_clinic_id;
    END IF;
    
    -- Hash for 'password' (bcrypt, 10 rounds)
    default_password_hash := '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
    
    -- Create user accounts for each guardian
    -- Guardian 1: Maria Santos
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 1) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9171234567', default_password_hash, guardian_role_id, guardian_clinic_id, 'maria.santos@email.com', '+63-917-123-4567', 'Maria Elena Santos', 1, true, 0, false);
    END IF;
    
    -- Guardian 2: Juan dela Cruz
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 2) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9182345678', default_password_hash, guardian_role_id, guardian_clinic_id, 'juan.delacruz@email.com', '+63-918-234-5678', 'Juan Miguel dela Cruz', 2, true, 0, false);
    END IF;
    
    -- Guardian 3: Ana Reyes
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 3) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9193456789', default_password_hash, guardian_role_id, guardian_clinic_id, 'ana.reyes@email.com', '+63-919-345-6789', 'Ana Marie Reyes', 3, true, 0, false);
    END IF;
    
    -- Guardian 4: Pedro Garcia
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 4) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9204567890', default_password_hash, guardian_role_id, guardian_clinic_id, 'pedro.garcia@email.com', '+63-920-456-7890', 'Pedro Luis Garcia', 4, true, 0, false);
    END IF;
    
    -- Guardian 5: Carmen Lim
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 5) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9215678901', default_password_hash, guardian_role_id, guardian_clinic_id, 'carmen.lim@email.com', '+63-921-567-8901', 'Carmen Victoria Lim', 5, true, 0, false);
    END IF;
    
    -- Guardian 6: Robert Mendoza
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 6) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9226789012', default_password_hash, guardian_role_id, guardian_clinic_id, 'robert.mendoza@email.com', '+63-922-678-9012', 'Robert Antonio Mendoza', 6, true, 0, false);
    END IF;
    
    -- Guardian 7: Elena Bautista
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 7) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9237890123', default_password_hash, guardian_role_id, guardian_clinic_id, 'elena.bautista@email.com', '+63-923-789-0123', 'Elena Sofia Flores-Bautista', 7, true, 0, false);
    END IF;
    
    -- Guardian 8: Michael Tan
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 8) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9248901234', default_password_hash, guardian_role_id, guardian_clinic_id, 'michael.tan@email.com', '+63-924-890-1234', 'Michael James Tan', 8, true, 0, false);
    END IF;
    
    -- Guardian 9: Sarah Ong
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 9) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9259012345', default_password_hash, guardian_role_id, guardian_clinic_id, 'sarah.ong@email.com', '+63-925-901-2345', 'Sarah Abigail Ong', 9, true, 0, false);
    END IF;
    
    -- Guardian 10: David Cruz
    IF NOT EXISTS (SELECT 1 FROM users WHERE guardian_id = 10) THEN
        INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, full_name, guardian_id, is_active, login_attempts, force_password_change)
        VALUES ('guardian_9260123456', default_password_hash, guardian_role_id, guardian_clinic_id, 'david.cruz@email.com', '+63-926-012-3456', 'David William Cruz', 10, true, 0, false);
    END IF;
END $$;

-- ============================================================================
-- STEP 7: ADD CONSTRAINTS AND INDEXES
-- ============================================================================

-- Add unique constraint on email (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'guardians' AND constraint_name = 'guardians_email_unique') THEN
        ALTER TABLE guardians ADD CONSTRAINT guardians_email_unique UNIQUE (email);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'guardians' AND constraint_name = 'guardians_phone_unique') THEN
        ALTER TABLE guardians ADD CONSTRAINT guardians_phone_unique UNIQUE (phone_number);
    END IF;
END $$;

-- Create indexes (if not exist)
CREATE INDEX IF NOT EXISTS guardians_email_idx ON guardians(email);
CREATE INDEX IF NOT EXISTS guardians_phone_idx ON guardians(phone_number);
CREATE INDEX IF NOT EXISTS guardians_relationship_idx ON guardians(relationship_to_student);
CREATE INDEX IF NOT EXISTS guardians_emergency_priority_idx ON guardians(emergency_contact_priority);
CREATE INDEX IF NOT EXISTS users_guardian_id_idx ON users(guardian_id);

-- ============================================================================
-- STEP 8: GRANT BASIC PERMISSIONS TO GUARDIAN ROLE
-- ============================================================================

-- Insert basic permissions for guardian role
INSERT INTO permissions (name, resource, action, scope, description)
VALUES 
    ('infants.read', 'infants', 'read', 'own', 'Read own infant records'),
    ('vaccinations.read', 'vaccinations', 'read', 'own', 'Read own vaccination records'),
    ('appointments.read', 'appointments', 'read', 'own', 'Read own appointments'),
    ('reports.read', 'reports', 'read', 'own', 'Read own reports'),
    ('documents.read', 'documents', 'read', 'own', 'Read own documents')
ON CONFLICT (name) DO NOTHING;

-- Get permission IDs and grant to guardian role
DO $$
DECLARE
    guardian_role_id INTEGER;
    perm RECORD;
BEGIN
    SELECT id INTO guardian_role_id FROM roles WHERE name = 'guardian';
    
    FOR perm IN 
        SELECT id FROM permissions WHERE name IN ('infants.read', 'vaccinations.read', 'appointments.read', 'reports.read', 'documents.read')
    LOOP
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (guardian_role_id, perm.id)
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 9: VERIFICATION QUERIES
-- ============================================================================

-- Check total count
SELECT 'Total Guardians' as check_type, COUNT(*) as count FROM guardians;
SELECT 'Total Guardian Users' as check_type, COUNT(*) as count FROM users WHERE guardian_id IS NOT NULL;

-- Show guardians with their user accounts
SELECT 
    g.id,
    g.first_name,
    g.last_name,
    g.email,
    g.phone_number,
    g.relationship_to_student,
    g.emergency_contact_priority,
    g.is_primary_guardian,
    u.username as user_username,
    u.is_active as user_active
FROM guardians g
LEFT JOIN users u ON g.id = u.guardian_id
ORDER BY g.id;

-- Show relationship distribution
SELECT 
    relationship_to_student,
    COUNT(*) as count,
    STRING_AGG(first_name || ' ' || last_name, ', ') as guardians
FROM guardians
GROUP BY relationship_to_student
ORDER BY count DESC;

-- ============================================================================
-- END OF SCRIPT
-- ============================================================================
-- Instructions for pgAdmin 4:
-- 1. Open pgAdmin 4 and connect to your PostgreSQL database
-- 2. Open the Query Tool (Tools > Query Tool)
-- 3. Open this SQL file and execute it
-- 4. All guardian data will be reset and populated with the new schema
-- 5. User accounts will be automatically created for each guardian
-- 
-- Login credentials:
-- Option 1 (Username): guardian_<phone> (e.g., guardian_9171234567)
-- Option 2 (Email): Any guardian email (e.g., maria.santos@email.com)
-- Password: password
-- ============================================================================
