-- ============================================================================
-- SAMPLE DATA SEED: Guardians and Patients
-- For testing guardian login functionality
-- ============================================================================

-- First, ensure we have a healthcare facility for patients
INSERT INTO healthcare_facilities (name, region, address, contact) VALUES
    ('Sample Health Center', 'Metro Manila', '123 Health Center Street, Manila', '+63-2-1234-5678')
ON CONFLICT (name) DO NOTHING;

-- Get the facility ID
DO $$
DECLARE
    facility_id_val INTEGER;
BEGIN
    SELECT id INTO facility_id_val FROM healthcare_facilities WHERE name = 'Sample Health Center' LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO healthcare_facilities (name, region, address, contact)
        VALUES ('Sample Health Center', 'Metro Manila', '123 Health Center Street, Manila', '+63-2-1234-5678')
        RETURNING id INTO facility_id_val;
    END IF;
END $$;

-- ============================================================================
-- INSERT 5 GUARDIANS
-- ============================================================================

-- Guardian 1: Maria Santos
INSERT INTO guardians (name, phone, email, address, relationship, is_active)
VALUES (
    'Maria Elena Santos',
    '+63-917-123-4567',
    'maria.santos@email.com',
    '123 Sampaguita Street, Barangay Maliksi, Quezon City',
    'mother',
    true
);

-- Guardian 2: Juan dela Cruz
INSERT INTO guardians (name, phone, email, address, relationship, is_active)
VALUES (
    'Juan Miguel dela Cruz',
    '+63-918-234-5678',
    'juan.delacruz@email.com',
    '456 Rose Avenue, Barangay Santol, Manila',
    'father',
    true
);

-- Guardian 3: Ana Reyes
INSERT INTO guardians (name, phone, email, address, relationship, is_active)
VALUES (
    'Ana Marie Reyes',
    '+63-919-345-6789',
    'ana.reyes@email.com',
    '789 Lily Lane, Barangay Holy Spirit, Quezon City',
    'mother',
    true
);

-- Guardian 4: Pedro Garcia
INSERT INTO guardians (name, phone, email, address, relationship, is_active)
VALUES (
    'Pedro Luis Garcia',
    '+63-920-456-7890',
    'pedro.garcia@email.com',
    '321 Jasmine Road, Barangay San Antonio, Makati',
    'father',
    true
);

-- Guardian 5: Carmen Lim
INSERT INTO guardians (name, phone, email, address, relationship, is_active)
VALUES (
    'Carmen Victoria Lim',
    '+63-921-567-8901',
    'carmen.lim@email.com',
    '654 Orchid Street, Barangay Bel-Air, Makati',
    'grandmother',
    true
);

-- ============================================================================
-- INSERT 5 PATIENTS (each linked to a guardian)
-- Guardian 1 (Maria Santos) - 2 patients
-- Guardian 2 (Juan dela Cruz) - 1 patient
-- Guardian 3 (Ana Reyes) - 1 patient
-- Guardian 4 (Pedro Garcia) - 1 patient
-- Guardian 5 (Carmen Lim) - 0 patients (grandmother can have guardian_id for grandchild)
-- ============================================================================

-- Patient 1: Baby of Maria Santos (Baby Sofia)
INSERT INTO patients (first_name, last_name, middle_name, dob, sex, address, contact, guardian_id, facility_id, mother_name, father_name, barangay, health_center, family_no, place_of_birth, type_of_delivery, doctor_midwife_nurse, cellphone_number, is_active)
VALUES (
    'Sofia',
    'Santos',
    'Garcia',
    '2024-06-15',
    'female',
    '123 Sampaguita Street, Barangay Maliksi, Quezon City',
    '+63-917-123-4567',
    (SELECT id FROM guardians WHERE email = 'maria.santos@email.com'),
    (SELECT id FROM healthcare_facilities WHERE name = 'Sample Health Center'),
    'Maria Elena Santos',
    'Roberto Santos',
    'Maliksi',
    'Sample Health Center',
    'FAM-2024-001',
    'quezon_city_medical_center',
    'normal',
    'Dr. Maria Cruz',
    '+63-917-123-4567',
    true
);

-- Patient 2: Baby of Maria Santos (Baby Mateo)
INSERT INTO patients (first_name, last_name, middle_name, dob, sex, address, contact, guardian_id, facility_id, mother_name, father_name, barangay, health_center, family_no, place_of_birth, type_of_delivery, doctor_midwife_nurse, cellphone_number, is_active)
VALUES (
    'Mateo',
    'Santos',
    'Garcia',
    '2024-08-20',
    'male',
    '123 Sampaguita Street, Barangay Maliksi, Quezon City',
    '+63-917-123-4567',
    (SELECT id FROM guardians WHERE email = 'maria.santos@email.com'),
    (SELECT id FROM healthcare_facilities WHERE name = 'Sample Health Center'),
    'Maria Elena Santos',
    'Roberto Santos',
    'Maliksi',
    'Sample Health Center',
    'FAM-2024-001',
    'quezon_city_medical_center',
    'cesarean',
    'Dr. Maria Cruz',
    '+63-917-123-4567',
    true
);

-- Patient 3: Baby of Juan dela Cruz (Baby Isabella)
INSERT INTO patients (first_name, last_name, middle_name, dob, sex, address, contact, guardian_id, facility_id, mother_name, father_name, barangay, health_center, family_no, place_of_birth, type_of_delivery, doctor_midwife_nurse, cellphone_number, is_active)
VALUES (
    'Isabella',
    'dela Cruz',
    'Ramos',
    '2024-03-10',
    'female',
    '456 Rose Avenue, Barangay Santol, Manila',
    '+63-918-234-5678',
    (SELECT id FROM guardians WHERE email = 'juan.delacruz@email.com'),
    (SELECT id FROM healthcare_facilities WHERE name = 'Sample Health Center'),
    'Ana dela Cruz',
    'Juan Miguel dela Cruz',
    'Santol',
    'Sample Health Center',
    'FAM-2024-002',
    'manila_medical_center',
    'normal',
    'Dr. Juan Perez',
    '+63-918-234-5678',
    true
);

-- Patient 4: Baby of Ana Reyes (Baby Gabriel)
INSERT INTO patients (first_name, last_name, middle_name, dob, sex, address, contact, guardian_id, facility_id, mother_name, father_name, barangay, health_center, family_no, place_of_birth, type_of_delivery, doctor_midwife_nurse, cellphone_number, is_active)
VALUES (
    'Gabriel',
    'Reyes',
    'Vargas',
    '2024-09-05',
    'male',
    '789 Lily Lane, Barangay Holy Spirit, Quezon City',
    '+63-919-345-6789',
    (SELECT id FROM guardians WHERE email = 'ana.reyes@email.com'),
    (SELECT id FROM healthcare_facilities WHERE name = 'Sample Health Center'),
    'Ana Marie Reyes',
    'Carlos Reyes',
    'Holy Spirit',
    'Sample Health Center',
    'FAM-2024-003',
    'quezon_city_medical_center',
    'normal',
    'Dr. Rosa Flores',
    '+63-919-345-6789',
    true
);

-- Patient 5: Baby of Pedro Garcia (Baby Camila)
INSERT INTO patients (first_name, last_name, middle_name, dob, sex, address, contact, guardian_id, facility_id, mother_name, father_name, barangay, health_center, family_no, place_of_birth, type_of_delivery, doctor_midwife_nurse, cellphone_number, is_active)
VALUES (
    'Camila',
    'Garcia',
    'Mendoza',
    '2024-07-22',
    'female',
    '321 Jasmine Road, Barangay San Antonio, Makati',
    '+63-920-456-7890',
    (SELECT id FROM guardians WHERE email = 'pedro.garcia@email.com'),
    (SELECT id FROM healthcare_facilities WHERE name = 'Sample Health Center'),
    'Maria Garcia',
    'Pedro Luis Garcia',
    'San Antonio',
    'Sample Health Center',
    'FAM-2024-004',
    'makati_medical_center',
    'normal',
    'Dr. Jose Santos',
    '+63-920-456-7890',
    true
);

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================

-- Check the inserted data
SELECT 
    'Guardians' as data_type,
    COUNT(*) as total_count
FROM guardians
WHERE email IN (
    'maria.santos@email.com',
    'juan.delacruz@email.com',
    'ana.reyes@email.com',
    'pedro.garcia@email.com',
    'carmen.lim@email.com'
)
UNION ALL
SELECT 
    'Patients' as data_type,
    COUNT(*) as total_count
FROM patients
WHERE guardian_id IN (
    SELECT id FROM guardians WHERE email IN (
        'maria.santos@email.com',
        'juan.delacruz@email.com',
        'ana.reyes@email.com',
        'pedro.garcia@email.com',
        'carmen.lim@email.com'
    )
);

-- Show relationships
SELECT 
    g.name as guardian_name,
    g.relationship,
    g.phone,
    p.first_name as patient_first_name,
    p.last_name as patient_last_name,
    p.dob as patient_dob,
    p.sex as patient_sex
FROM guardians g
LEFT JOIN patients p ON g.id = p.guardian_id
WHERE g.email IN (
    'maria.santos@email.com',
    'juan.delacruz@email.com',
    'ana.reyes@email.com',
    'pedro.garcia@email.com',
    'carmen.lim@email.com'
)
ORDER BY g.name;
