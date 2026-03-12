-- =====================================================================================================
-- IMMUNICARE DATABASE-ONLY SYNTHETIC DATA GENERATION SCRIPT
-- MARKER PREFIX: SYNPH26
-- SQL DIALECT: PostgreSQL
-- =====================================================================================================

-- =====================================================================================================
-- 0) LIVE SCHEMA INSPECTION (metadata / catalogs)
-- =====================================================================================================
SELECT current_database() AS database_name, current_schema() AS schema_name, version() AS postgres_version;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

SELECT tc.table_name, tc.constraint_name, kcu.column_name, tc.constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY tc.table_name, kcu.ordinal_position;

SELECT tc.table_name,
       tc.constraint_name,
       kcu.column_name,
       ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name,
       rc.update_rule,
       rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema = tc.table_schema
LEFT JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;

SELECT tc.table_name, tc.constraint_name, kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'UNIQUE'
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;

SELECT tc.table_name, tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON cc.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'CHECK'
ORDER BY tc.table_name, tc.constraint_name;

SELECT t.typname AS enum_name, e.enumlabel AS enum_value, e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- =====================================================================================================
-- 1) REFERENCE DATA (clinics, roles, permissions, role_permissions, vaccines, schedules, templates)
-- =====================================================================================================

INSERT INTO clinics (name, region, address, contact, created_at, updated_at)
SELECT v.name, v.region, v.address, v.contact, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('Barangay San Nicolas Health Center', 'NCR', '118 P. Guevarra St, Barangay 281, San Nicolas, Manila, Metro Manila, NCR 1010', '+639171000101'),
    ('Tondo I District Health Center', 'NCR', '1852 Tayuman St, Barangay 93, Tondo, Manila, Metro Manila, NCR 1013', '+639171000102'),
    ('Batasan Hills Health Center', 'NCR', '44 IBP Rd, Batasan Hills, Quezon City, Metro Manila, NCR 1126', '+639171000103'),
    ('Bagong Silang Health Station', 'NCR', '243 Kanlaon St, Barangay 176, Bagong Silang, Caloocan, NCR 1428', '+639171000104'),
    ('Malanday Health Center', 'NCR', '72 Gen. Luna St, Malanday, Marikina, NCR 1805', '+639171000105'),
    ('Poblacion Health Center - San Jose Del Monte', 'Region III', '31 Quirino Hwy, Poblacion, San Jose del Monte, Bulacan, Region III 3023', '+639171000106'),
    ('Meycauayan City Primary Care Center', 'Region III', '20 Iba St, Sto. Niño, Meycauayan, Bulacan, Region III 3020', '+639171000107'),
    ('Angeles City Family Health Unit', 'Region III', '14 Sto. Rosario St, Angeles, Pampanga, Region III 2009', '+639171000108'),
    ('San Fernando Maternal and Child Clinic', 'Region III', '55 Lazatin Blvd, San Agustin, City of San Fernando, Pampanga, Region III 2000', '+639171000109'),
    ('Malolos City Child Wellness Center', 'Region III', '61 Paseo del Congreso, Malolos, Bulacan, Region III 3000', '+639171000110'),
    ('Antipolo City Health Center I', 'Region IV-A', '36 M. Santos Ext, San Roque, Antipolo, Rizal, Region IV-A 1870', '+639171000111'),
    ('Bacoor Family Immunization Unit', 'Region IV-A', '22 Aguinaldo Hwy, Bacoor, Cavite, Region IV-A 4102', '+639171000112'),
    ('Dasmarinas Child Care Clinic', 'Region IV-A', '18 Governor''s Dr, Dasmarinas, Cavite, Region IV-A 4114', '+639171000113'),
    ('Calamba Rural Health Unit 2', 'Region IV-A', '29 Crossing, Calamba, Laguna, Region IV-A 4027', '+639171000114'),
    ('Tanauan City Health and Nutrition Office', 'Region IV-A', '40 J. P. Laurel Hwy, Tanauan, Batangas, Region IV-A 4232', '+639171000115'),
    ('Lipa City Women and Child Center', 'Region IV-A', '64 C. M. Recto Ave, Lipa, Batangas, Region IV-A 4217', '+639171000116'),
    ('Cebu City Immunization Hub', 'Region VII', '87 Osmena Blvd, Cebu City, Cebu, Region VII 6000', '+639171000117'),
    ('Mandaue Child Health Clinic', 'Region VII', '29 A. S. Fortuna St, Mandaue, Cebu, Region VII 6014', '+639171000118'),
    ('Davao City North Health Center', 'Region XI', '91 Mamay Rd, Buhangin, Davao City, Region XI 8000', '+639171000119'),
    ('Cagayan de Oro Family Health Unit', 'Region X', '33 Velez St, Cagayan de Oro, Misamis Oriental, Region X 9000', '+639171000120')
) AS v(name, region, address, contact)
ON CONFLICT (name) DO UPDATE
SET region = EXCLUDED.region,
    address = EXCLUDED.address,
    contact = EXCLUDED.contact,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO roles (name, permissions, display_name, is_system_role, is_active, hierarchy_level, created_at, updated_at)
VALUES
  ('system_admin', '{"all": true}'::jsonb, 'System Administrator', true, true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('health_worker', '{"clinical": true}'::jsonb, 'Health Worker', true, true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inventory_manager', '{"inventory": true}'::jsonb, 'Inventory Manager', true, true, 65, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('guardian', '{"guardian": true}'::jsonb, 'Guardian', true, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (name) DO UPDATE
SET permissions = EXCLUDED.permissions,
    display_name = EXCLUDED.display_name,
    is_active = true,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO permissions (name, resource, action, scope, description, is_active, created_at, updated_at)
VALUES
  ('dashboard:view', 'dashboard', 'view', 'global', 'View dashboard summaries', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dashboard:analytics', 'dashboard', 'analytics', 'global', 'Access dashboard analytics', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('appointment:view', 'appointment', 'view', 'clinic', 'View appointments', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('appointment:create:own', 'appointment', 'create', 'own', 'Create own appointment requests', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('appointment:update', 'appointment', 'update', 'clinic', 'Update appointments', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('appointment:delete', 'appointment', 'delete', 'clinic', 'Delete appointments', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('vaccination:view', 'vaccination', 'view', 'clinic', 'View vaccination records', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('vaccination:create', 'vaccination', 'create', 'clinic', 'Create vaccination records', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('vaccination:update', 'vaccination', 'update', 'clinic', 'Update vaccination records', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('vaccination:delete', 'vaccination', 'delete', 'clinic', 'Delete vaccination records', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inventory:view', 'inventory', 'view', 'clinic', 'View inventory', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inventory:update', 'inventory', 'update', 'clinic', 'Update inventory', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('patient:view', 'patient', 'view', 'clinic', 'View patients', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('patient:create', 'patient', 'create', 'clinic', 'Create patients', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user:view', 'user', 'view', 'clinic', 'View users', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user:manage', 'user', 'manage', 'global', 'Manage users', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('notification:view', 'notification', 'view', 'clinic', 'View notifications', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (name) DO UPDATE
SET resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    scope = EXCLUDED.scope,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = CURRENT_TIMESTAMP;

WITH mapping(role_name, permission_name) AS (
  VALUES
    ('system_admin', 'dashboard:view'),
    ('system_admin', 'dashboard:analytics'),
    ('system_admin', 'appointment:view'),
    ('system_admin', 'appointment:update'),
    ('system_admin', 'appointment:delete'),
    ('system_admin', 'vaccination:view'),
    ('system_admin', 'vaccination:create'),
    ('system_admin', 'vaccination:update'),
    ('system_admin', 'vaccination:delete'),
    ('system_admin', 'inventory:view'),
    ('system_admin', 'inventory:update'),
    ('system_admin', 'patient:view'),
    ('system_admin', 'patient:create'),
    ('system_admin', 'user:view'),
    ('system_admin', 'user:manage'),
    ('system_admin', 'notification:view'),
    ('health_worker', 'dashboard:view'),
    ('health_worker', 'appointment:view'),
    ('health_worker', 'appointment:update'),
    ('health_worker', 'vaccination:view'),
    ('health_worker', 'vaccination:create'),
    ('health_worker', 'vaccination:update'),
    ('health_worker', 'patient:view'),
    ('health_worker', 'patient:create'),
    ('health_worker', 'notification:view'),
    ('inventory_manager', 'dashboard:view'),
    ('inventory_manager', 'inventory:view'),
    ('inventory_manager', 'inventory:update'),
    ('inventory_manager', 'notification:view'),
    ('guardian', 'dashboard:view'),
    ('guardian', 'appointment:create:own'),
    ('guardian', 'appointment:view'),
    ('guardian', 'vaccination:view'),
    ('guardian', 'notification:view'),
    ('guardian', 'patient:view')
)
INSERT INTO role_permissions (role_id, permission_id, granted_at, granted_by, restrictions, created_at, updated_at)
SELECT r.id,
       p.id,
       CURRENT_TIMESTAMP,
       NULL,
       NULL,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM mapping m
JOIN roles r ON r.name = m.role_name
JOIN permissions p ON p.name = m.permission_name
WHERE NOT EXISTS (
  SELECT 1
  FROM role_permissions rp
  WHERE rp.role_id = r.id
    AND rp.permission_id = p.id
);

INSERT INTO vaccines (
  code,
  name,
  description,
  manufacturer,
  recommended_age,
  dosage,
  number_of_doses,
  is_active,
  created_at,
  updated_at,
  doses_required
)
VALUES
  ('SYNPH26-BCG', 'BCG', 'Bacillus Calmette-Guérin vaccine for tuberculosis prevention', 'BioFiction Pharma PH', 'At birth', '0.05 mL intradermal', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1),
  ('SYNPH26-HEPB', 'Hepatitis B', 'Hepatitis B vaccine for newborns and infants', 'LuzVax Biologics', 'At birth', '0.5 mL IM', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 3),
  ('SYNPH26-PENTA', 'Pentavalent (DPT-HepB-Hib)', 'Combined vaccine against Diphtheria, Pertussis, Tetanus, HepB and Hib', 'ArchiMeds Vaccines', '6, 10, 14 weeks', '0.5 mL IM', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 3),
  ('SYNPH26-OPV', 'Oral Polio Vaccine', 'Oral vaccine for polio prevention', 'Pacific ImmunoCare', '6, 10, 14 weeks', '2 drops oral', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 3),
  ('SYNPH26-IPV', 'Inactivated Polio Vaccine', 'Injectable inactivated poliovirus vaccine', 'PrimeWell Pharma', '14 weeks and booster', '0.5 mL IM', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2),
  ('SYNPH26-PCV', 'Pneumococcal Conjugate Vaccine', 'Protection against pneumococcal disease', 'Central Biotech PH', '6, 10, 14 weeks', '0.5 mL IM', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 3),
  ('SYNPH26-ROTA', 'Rotavirus Vaccine', 'Oral vaccine against severe diarrhea from rotavirus', 'Harbor Life Sciences', '6 and 10 weeks', '1.5 mL oral', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2),
  ('SYNPH26-MMR', 'Measles-Mumps-Rubella', 'MMR first dose', 'Asteria Vaccines Inc', '9 months', '0.5 mL SC', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1),
  ('SYNPH26-MMR2', 'MMR Booster', 'MMR booster dose', 'Asteria Vaccines Inc', '12 months', '0.5 mL SC', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1),
  ('SYNPH26-VAR', 'Varicella', 'Chickenpox vaccine', 'Lifebridge Pharma', '12 months and booster', '0.5 mL SC', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2),
  ('SYNPH26-JE', 'Japanese Encephalitis', 'JE vaccine for endemic risk reduction', 'Northfield Bio', '9 months and booster', '0.5 mL IM', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2),
  ('SYNPH26-FLU', 'Influenza', 'Seasonal influenza vaccine', 'Metro VaxWorks', '6 months and annual', '0.25-0.5 mL IM', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2),
  ('SYNPH26-COVIDP', 'Pediatric COVID-19', 'Pediatric COVID-19 primary series', 'Unity Pharma Global', '6 months and above', '0.2-0.3 mL IM', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2),
  ('SYNPH26-DTP', 'DTP Booster', 'Diphtheria, Tetanus, Pertussis booster', 'Arkipelago Biopharm', '18 months', '0.5 mL IM', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1),
  ('SYNPH26-HIB', 'Hib Booster', 'Haemophilus influenzae type b booster', 'Pacific ImmunoCare', '18 months', '0.5 mL IM', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1),
  ('SYNPH26-MCV', 'Measles-Containing Vaccine', 'Measles-containing follow-up immunization', 'LuzVax Biologics', '9 months and follow-up', '0.5 mL SC', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2),
  ('SYNPH26-HPV', 'HPV', 'Human papillomavirus vaccine (for long-term analytics coverage)', 'Isla Biovax', '9 years and above', '0.5 mL IM', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2),
  ('SYNPH26-HEPA', 'Hepatitis A', 'Hepatitis A pediatric vaccine', 'Central Biotech PH', '12 months and booster', '0.5 mL IM', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2),
  ('SYNPH26-TCV', 'Typhoid Conjugate Vaccine', 'Typhoid conjugate vaccine', 'PrimeWell Pharma', '9 months and above', '0.5 mL IM', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1),
  ('SYNPH26-RV', 'Rabies Vaccine (Post-Exposure Pediatric)', 'Rabies vaccine for pediatric post-exposure schedules', 'Northfield Bio', 'As indicated', '0.5 mL IM', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 4)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    manufacturer = EXCLUDED.manufacturer,
    recommended_age = EXCLUDED.recommended_age,
    dosage = EXCLUDED.dosage,
    number_of_doses = EXCLUDED.number_of_doses,
    doses_required = EXCLUDED.doses_required,
    is_active = true,
    updated_at = CURRENT_TIMESTAMP;

WITH schedule_seed AS (
  SELECT *
  FROM (
    VALUES
      ('SYNPH26-BCG', 1, 1, 0, 0, 0, 4, 'Tuberculosis protection at birth', 'live_attenuated', 'high', true, true, 'Tuberculosis'),
      ('SYNPH26-HEPB', 1, 3, 0, 0, 0, 4, 'HepB birth dose', 'inactivated', 'high', true, true, 'Hepatitis B'),
      ('SYNPH26-HEPB', 2, 3, 1, 1, 4, 12, 'HepB second dose', 'inactivated', 'high', true, true, 'Hepatitis B'),
      ('SYNPH26-HEPB', 3, 3, 6, 6, 20, 32, 'HepB third dose', 'inactivated', 'high', true, true, 'Hepatitis B'),
      ('SYNPH26-PENTA', 1, 3, 1, 1, 4, 12, 'Pentavalent first dose', 'combination', 'high', true, true, 'Diphtheria/Pertussis/Tetanus/HepB/Hib'),
      ('SYNPH26-PENTA', 2, 3, 2, 2, 8, 16, 'Pentavalent second dose', 'combination', 'high', true, true, 'Diphtheria/Pertussis/Tetanus/HepB/Hib'),
      ('SYNPH26-PENTA', 3, 3, 3, 3, 12, 20, 'Pentavalent third dose', 'combination', 'high', true, true, 'Diphtheria/Pertussis/Tetanus/HepB/Hib'),
      ('SYNPH26-OPV', 1, 3, 1, 1, 4, 12, 'OPV first dose', 'live_attenuated', 'high', true, true, 'Polio'),
      ('SYNPH26-OPV', 2, 3, 2, 2, 8, 16, 'OPV second dose', 'live_attenuated', 'high', true, true, 'Polio'),
      ('SYNPH26-OPV', 3, 3, 3, 3, 12, 20, 'OPV third dose', 'live_attenuated', 'high', true, true, 'Polio'),
      ('SYNPH26-IPV', 1, 2, 3, 3, 12, 20, 'IPV first dose', 'inactivated', 'high', true, true, 'Polio'),
      ('SYNPH26-IPV', 2, 2, 18, 18, 68, 84, 'IPV booster dose', 'inactivated', 'medium', true, true, 'Polio'),
      ('SYNPH26-PCV', 1, 3, 1, 1, 4, 12, 'PCV first dose', 'conjugate', 'high', true, true, 'Pneumococcal disease'),
      ('SYNPH26-PCV', 2, 3, 2, 2, 8, 16, 'PCV second dose', 'conjugate', 'high', true, true, 'Pneumococcal disease'),
      ('SYNPH26-PCV', 3, 3, 3, 3, 12, 20, 'PCV third dose', 'conjugate', 'high', true, true, 'Pneumococcal disease'),
      ('SYNPH26-ROTA', 1, 2, 1, 1, 4, 12, 'Rotavirus first dose', 'live_attenuated', 'high', true, true, 'Rotavirus gastroenteritis'),
      ('SYNPH26-ROTA', 2, 2, 2, 2, 8, 16, 'Rotavirus second dose', 'live_attenuated', 'high', true, true, 'Rotavirus gastroenteritis'),
      ('SYNPH26-MMR', 1, 1, 9, 9, 36, 48, 'MMR first dose at 9 months', 'live_attenuated', 'high', true, true, 'Measles/Mumps/Rubella'),
      ('SYNPH26-MMR2', 1, 1, 12, 12, 44, 60, 'MMR booster at 12 months', 'live_attenuated', 'high', true, true, 'Measles/Mumps/Rubella'),
      ('SYNPH26-VAR', 1, 2, 12, 12, 44, 60, 'Varicella first dose', 'live_attenuated', 'medium', true, true, 'Varicella'),
      ('SYNPH26-VAR', 2, 2, 18, 18, 68, 84, 'Varicella booster dose', 'live_attenuated', 'medium', true, true, 'Varicella'),
      ('SYNPH26-JE', 1, 2, 9, 9, 36, 48, 'JE first dose', 'inactivated', 'medium', true, true, 'Japanese Encephalitis'),
      ('SYNPH26-JE', 2, 2, 24, 24, 92, 108, 'JE booster dose', 'inactivated', 'medium', true, true, 'Japanese Encephalitis'),
      ('SYNPH26-FLU', 1, 2, 6, 6, 24, 36, 'Flu first seasonal dose', 'inactivated', 'medium', true, true, 'Influenza'),
      ('SYNPH26-FLU', 2, 2, 7, 7, 28, 40, 'Flu second seasonal dose', 'inactivated', 'medium', true, true, 'Influenza'),
      ('SYNPH26-COVIDP', 1, 2, 6, 6, 24, 36, 'Pediatric COVID first dose', 'mrna', 'medium', true, true, 'COVID-19'),
      ('SYNPH26-COVIDP', 2, 2, 7, 7, 28, 40, 'Pediatric COVID second dose', 'mrna', 'medium', true, true, 'COVID-19'),
      ('SYNPH26-DTP', 1, 1, 18, 18, 68, 84, 'DTP booster', 'toxoid', 'high', true, true, 'Diphtheria/Pertussis/Tetanus'),
      ('SYNPH26-HIB', 1, 1, 18, 18, 68, 84, 'Hib booster', 'conjugate', 'high', true, true, 'Haemophilus influenzae b'),
      ('SYNPH26-MCV', 1, 2, 9, 9, 36, 48, 'MCV first dose', 'live_attenuated', 'high', true, true, 'Measles'),
      ('SYNPH26-MCV', 2, 2, 12, 12, 44, 60, 'MCV second dose', 'live_attenuated', 'high', true, true, 'Measles'),
      ('SYNPH26-HEPA', 1, 2, 12, 12, 44, 60, 'Hepatitis A first dose', 'inactivated', 'medium', true, true, 'Hepatitis A'),
      ('SYNPH26-HEPA', 2, 2, 18, 18, 68, 84, 'Hepatitis A second dose', 'inactivated', 'medium', true, true, 'Hepatitis A'),
      ('SYNPH26-TCV', 1, 1, 9, 9, 36, 48, 'Typhoid conjugate primary dose', 'conjugate', 'medium', true, true, 'Typhoid fever'),
      ('SYNPH26-RV', 1, 4, 0, 0, 0, 999, 'Rabies post-exposure day 0', 'inactivated', 'high', false, false, 'Rabies'),
      ('SYNPH26-RV', 2, 4, 0, 0, 0, 999, 'Rabies post-exposure day 3', 'inactivated', 'high', false, false, 'Rabies'),
      ('SYNPH26-RV', 3, 4, 0, 0, 0, 999, 'Rabies post-exposure day 7', 'inactivated', 'high', false, false, 'Rabies'),
      ('SYNPH26-RV', 4, 4, 0, 0, 0, 999, 'Rabies post-exposure day 14', 'inactivated', 'high', false, false, 'Rabies')
  ) AS t(
      vaccine_code,
      dose_number,
      total_doses,
      age_in_months,
      target_age_months,
      min_age_weeks,
      max_age_weeks,
      description,
      vaccine_type,
      priority_level,
      is_mandatory,
      is_routine,
      disease_prevented
  )
)
INSERT INTO vaccination_schedules (
  vaccine_id,
  vaccine_name,
  vaccine_code,
  disease_prevented,
  vaccine_type,
  manufacturer,
  age_in_weeks,
  age_in_months,
  target_age_weeks,
  target_age_months,
  min_age_weeks,
  max_age_weeks,
  dose_number,
  total_doses,
  interval_weeks,
  description,
  is_mandatory,
  is_routine,
  priority_level,
  is_active,
  created_at,
  updated_at
)
SELECT
  v.id,
  v.name,
  v.code,
  s.disease_prevented,
  s.vaccine_type::vaccine_type,
  v.manufacturer,
  COALESCE(s.age_in_months, 0) * 4,
  s.age_in_months,
  COALESCE(s.target_age_months, 0) * 4,
  s.target_age_months,
  s.min_age_weeks,
  s.max_age_weeks,
  s.dose_number,
  s.total_doses,
  CASE WHEN s.dose_number = 1 THEN 0 ELSE 4 END,
  'SYNPH26 | ' || s.description,
  s.is_mandatory,
  s.is_routine,
  s.priority_level::priority_level,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM schedule_seed s
JOIN vaccines v ON v.code = s.vaccine_code
WHERE NOT EXISTS (
  SELECT 1
  FROM vaccination_schedules vs
  WHERE vs.vaccine_id = v.id
    AND vs.dose_number = s.dose_number
    AND COALESCE(vs.age_in_months, -1) = COALESCE(s.age_in_months, -1)
    AND vs.description = ('SYNPH26 | ' || s.description)
);

INSERT INTO vaccination_reminder_templates (
  vaccine_id,
  dose_number,
  age_months,
  template_message,
  is_active,
  created_at,
  updated_at,
  template_name,
  template_type,
  language,
  subject,
  body_html,
  body_text,
  variables
)
SELECT
  vs.vaccine_id,
  vs.dose_number,
  COALESCE(vs.age_in_months, 0),
  'SYNPH26: Paalala para sa dose ' || vs.dose_number || ' ng ' || vs.vaccine_name || '. Mangyaring bisitahin ang inyong health center sa takdang araw.',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  'SYNPH26-TPL-' || REPLACE(vs.vaccine_code, 'SYNPH26-', '') || '-D' || LPAD(vs.dose_number::text, 2, '0'),
  'sms',
  'en',
  'Vaccination Reminder: ' || vs.vaccine_name,
  '<p>SYNPH26 reminder for <strong>' || vs.vaccine_name || '</strong> dose ' || vs.dose_number || '.</p>',
  'SYNPH26 reminder for ' || vs.vaccine_name || ' dose ' || vs.dose_number,
  jsonb_build_array('guardian_name', 'child_name', 'due_date', 'clinic_name')
FROM vaccination_schedules vs
WHERE vs.description LIKE 'SYNPH26 | %'
ON CONFLICT (template_name) DO UPDATE
SET vaccine_id = EXCLUDED.vaccine_id,
    dose_number = EXCLUDED.dose_number,
    age_months = EXCLUDED.age_months,
    template_message = EXCLUDED.template_message,
    template_type = EXCLUDED.template_type,
    language = EXCLUDED.language,
    subject = EXCLUDED.subject,
    body_html = EXCLUDED.body_html,
    body_text = EXCLUDED.body_text,
    variables = EXCLUDED.variables,
    is_active = true,
    updated_at = CURRENT_TIMESTAMP;

-- =====================================================================================================
-- 2) SUPPLIERS
-- =====================================================================================================
WITH city_ref AS (
  SELECT *
  FROM (
    VALUES
      (1, 'Manila', 'Metro Manila', 'NCR', '1000'),
      (2, 'Quezon City', 'Metro Manila', 'NCR', '1100'),
      (3, 'Caloocan', 'Metro Manila', 'NCR', '1400'),
      (4, 'Makati', 'Metro Manila', 'NCR', '1200'),
      (5, 'Pasig', 'Metro Manila', 'NCR', '1600'),
      (6, 'San Jose del Monte', 'Bulacan', 'Region III', '3023'),
      (7, 'Malolos', 'Bulacan', 'Region III', '3000'),
      (8, 'Meycauayan', 'Bulacan', 'Region III', '3020'),
      (9, 'Angeles', 'Pampanga', 'Region III', '2009'),
      (10, 'San Fernando', 'Pampanga', 'Region III', '2000'),
      (11, 'Antipolo', 'Rizal', 'Region IV-A', '1870'),
      (12, 'Bacoor', 'Cavite', 'Region IV-A', '4102'),
      (13, 'Dasmarinas', 'Cavite', 'Region IV-A', '4114'),
      (14, 'Calamba', 'Laguna', 'Region IV-A', '4027'),
      (15, 'Lipa', 'Batangas', 'Region IV-A', '4217'),
      (16, 'Batangas City', 'Batangas', 'Region IV-A', '4200'),
      (17, 'Cebu City', 'Cebu', 'Region VII', '6000'),
      (18, 'Mandaue', 'Cebu', 'Region VII', '6014'),
      (19, 'Davao City', 'Davao del Sur', 'Region XI', '8000'),
      (20, 'Cagayan de Oro', 'Misamis Oriental', 'Region X', '9000')
  ) AS x(loc_id, city, province, region, postal_code)
),
seed AS (
  SELECT
    gs AS n,
    c.city,
    c.province,
    c.region,
    c.postal_code,
    (ARRAY['Apex', 'Bayanihan', 'Mabuhay', 'Isla', 'Harbor', 'Lakbay', 'Silangan', 'Luzon', 'Visayas', 'Mindanao'])[1 + ((gs * 3) % 10)] AS prefix,
    (ARRAY['Pharma', 'Biologics', 'Meds', 'Distribution', 'Scientific', 'Medical', 'Immuno', 'Lifecare'])[1 + ((gs * 5) % 8)] AS suffix
  FROM generate_series(1, 120) gs
  JOIN city_ref c ON c.loc_id = ((gs - 1) % 20) + 1
)
INSERT INTO suppliers (
  name,
  supplier_code,
  contact_person,
  position,
  email,
  phone,
  mobile,
  website,
  address_line_1,
  city,
  province,
  postal_code,
  country,
  supplier_type,
  payment_terms,
  credit_limit,
  lead_time_days,
  minimum_order_amount,
  delivery_contact,
  delivery_phone,
  delivery_email,
  quality_rating,
  reliability_rating,
  service_rating,
  rating_count,
  is_preferred,
  is_active,
  payment_method,
  total_orders,
  total_order_value,
  created_at,
  updated_at
)
SELECT
  'SYNPH26 ' || s.prefix || ' ' || s.suffix || ' ' || LPAD(s.n::text, 3, '0'),
  'SYNPH26SUP' || LPAD(s.n::text, 4, '0'),
  (ARRAY['Miguel', 'Carla', 'Paolo', 'Rica', 'Jerome', 'Leah', 'Noel', 'Janine', 'Francis', 'Bianca'])[1 + ((s.n * 7) % 10)] || ' ' ||
  (ARRAY['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Torres', 'Mendoza', 'Flores', 'Navarro', 'Valdez'])[1 + ((s.n * 11) % 10)],
  (ARRAY['Account Manager', 'Sales Executive', 'Operations Lead', 'Medical Liaison'])[1 + ((s.n * 13) % 4)],
  'supplier' || LPAD(s.n::text, 3, '0') || '@synph26-supply.ph',
  '+6328' || LPAD((100000 + s.n)::text, 6, '0'),
  '+639' || LPAD((700000000 + s.n)::text, 9, '0'),
  'https://supplier' || s.n || '.synph26-supply.ph',
  (100 + (s.n % 900)) || ' Logistics Ave, Barangay Central',
  s.city,
  s.province,
  s.postal_code,
  'Philippines',
  (CASE (s.n % 7)
     WHEN 0 THEN 'pharmaceutical'
     WHEN 1 THEN 'medical_supplies'
     WHEN 2 THEN 'vaccines'
     WHEN 3 THEN 'distributor'
     WHEN 4 THEN 'manufacturer'
     WHEN 5 THEN 'wholesaler'
     ELSE 'other'
   END)::supplier_type,
  (ARRAY['30 days', '45 days', '60 days'])[1 + (s.n % 3)],
  (500000 + (s.n * 15000))::numeric,
  3 + (s.n % 15),
  (5000 + (s.n * 200))::numeric,
  'SYNPH26 Delivery Desk ' || LPAD(s.n::text, 3, '0'),
  '+639' || LPAD((600000000 + s.n)::text, 9, '0'),
  'delivery' || LPAD(s.n::text, 3, '0') || '@synph26-supply.ph',
  ROUND((3.2 + ((s.n % 18) * 0.1))::numeric, 2),
  ROUND((3.3 + ((s.n % 17) * 0.1))::numeric, 2),
  ROUND((3.1 + ((s.n % 19) * 0.1))::numeric, 2),
  10 + (s.n % 90),
  (s.n % 8 = 0),
  true,
  (CASE (s.n % 4)
     WHEN 0 THEN 'bank_transfer'
     WHEN 1 THEN 'check'
     WHEN 2 THEN 'cash'
     ELSE 'other'
   END)::payment_method,
  25 + (s.n % 500),
  (150000 + (s.n * 7500))::numeric,
  CURRENT_TIMESTAMP - ((s.n % 1500) * INTERVAL '1 day'),
  CURRENT_TIMESTAMP - ((s.n % 300) * INTERVAL '1 day')
FROM seed s
ON CONFLICT (supplier_code) DO UPDATE
SET name = EXCLUDED.name,
    contact_person = EXCLUDED.contact_person,
    position = EXCLUDED.position,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    mobile = EXCLUDED.mobile,
    website = EXCLUDED.website,
    address_line_1 = EXCLUDED.address_line_1,
    city = EXCLUDED.city,
    province = EXCLUDED.province,
    postal_code = EXCLUDED.postal_code,
    supplier_type = EXCLUDED.supplier_type,
    payment_terms = EXCLUDED.payment_terms,
    credit_limit = EXCLUDED.credit_limit,
    lead_time_days = EXCLUDED.lead_time_days,
    minimum_order_amount = EXCLUDED.minimum_order_amount,
    delivery_contact = EXCLUDED.delivery_contact,
    delivery_phone = EXCLUDED.delivery_phone,
    delivery_email = EXCLUDED.delivery_email,
    quality_rating = EXCLUDED.quality_rating,
    reliability_rating = EXCLUDED.reliability_rating,
    service_rating = EXCLUDED{
