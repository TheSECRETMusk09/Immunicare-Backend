-- =====================================================================================================
-- IMMUNICARE DATABASE-ONLY SYNTHETIC DATA GENERATION SCRIPT
-- MARKER PREFIX: SYNPH26
-- SQL DIALECT: PostgreSQL
-- CONSTRAINTS: NO SCHEMA CHANGES | NO NEW TABLES | NO PROCEDURES/FUNCTIONS | NO DELETE/TRUNCATE
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
    ('San Nicolas Health Center Pasig City', 'NCR', '45 San Nicolas St, Barangay San Nicolas, Pasig City, Metro Manila, NCR 1600', '+639171000101')
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
      (1, 'Pasig', 'Metro Manila', 'NCR', '1600'),
      (2, 'Quezon City', 'Metro Manila', 'NCR', '1100'),
      (3, 'Manila', 'Metro Manila', 'NCR', '1000'),
      (4, 'Taguig', 'Metro Manila', 'NCR', '1630'),
      (5, 'Makati', 'Metro Manila', 'NCR', '1226'),
      (6, 'Mandaluyong', 'Metro Manila', 'NCR', '1550'),
      (7, 'Marikina', 'Metro Manila', 'NCR', '1800'),
      (8, 'San Juan', 'Metro Manila', 'NCR', '1500'),
      (9, 'Caloocan', 'Metro Manila', 'NCR', '1400'),
      (10, 'Pasay', 'Metro Manila', 'NCR', '1300'),
      (11, 'Paranaque', 'Metro Manila', 'NCR', '1700'),
      (12, 'Las Pinas', 'Metro Manila', 'NCR', '1740'),
      (13, 'Muntinlupa', 'Metro Manila', 'NCR', '1780'),
      (14, 'Valenzuela', 'Metro Manila', 'NCR', '1440'),
      (15, 'Malabon', 'Metro Manila', 'NCR', '1470'),
      (16, 'Navotas', 'Metro Manila', 'NCR', '1485'),
      (17, 'Pateros', 'Metro Manila', 'NCR', '1620'),
      (18, 'Antipolo', 'Rizal', 'Region IV-A', '1870'),
      (19, 'Cainta', 'Rizal', 'Region IV-A', '1900'),
      (20, 'Taytay', 'Rizal', 'Region IV-A', '1920')
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
    service_rating = EXCLUDED.service_rating,
    rating_count = EXCLUDED.rating_count,
    is_preferred = EXCLUDED.is_preferred,
    is_active = true,
    payment_method = EXCLUDED.payment_method,
    total_orders = EXCLUDED.total_orders,
    total_order_value = EXCLUDED.total_order_value,
    updated_at = CURRENT_TIMESTAMP;

-- =====================================================================================================
-- 3) GUARDIANS + GUARDIAN CONTACTS + SYSTEM USERS (deterministic top-up)
-- =====================================================================================================
WITH target_clinic AS (
  SELECT id AS clinic_id
  FROM clinics
  WHERE name = 'San Nicolas Health Center Pasig City'
  LIMIT 1
),
target_guardians AS (
  SELECT
    gs AS n,
    'SYNPH26 Guardian ' || LPAD(gs::text, 5, '0') AS full_name,
    (ARRAY['Santos','Reyes','Cruz','Bautista','Garcia','Torres','Mendoza','Flores','Navarro','Valdez'])[1 + ((gs * 11) % 10)] AS last_name,
    (ARRAY['Miguel','Carla','Paolo','Rica','Jerome','Leah','Noel','Janine','Francis','Bianca'])[1 + ((gs * 7) % 10)] AS first_name,
    '+639' || LPAD((700000000 + gs)::text, 9, '0') AS phone,
    'syn_guard_' || LPAD(gs::text, 5, '0') || '@synthetic-immunicare.ph' AS email,
    ((gs % 999) + 1)::text || ' Purok ' || ((gs % 20) + 1)::text || ', Brgy. San Nicolas, Pasig City, Metro Manila, NCR 1600' AS address,
    CASE WHEN gs % 2 = 0 THEN 'Mother' ELSE 'Father' END AS relationship
  FROM generate_series(1, 40000) gs
),
resolved AS (
  SELECT
    tg.n,
    tg.full_name,
    tg.first_name,
    tg.last_name,
    tg.phone,
    tg.email,
    tg.address,
    tg.relationship,
    tc.clinic_id
  FROM target_guardians tg
  CROSS JOIN target_clinic tc
)
INSERT INTO guardians (
  name,
  phone,
  email,
  address,
  relationship,
  is_active,
  created_at,
  updated_at,
  first_name,
  last_name,
  is_primary_guardian,
  clinic_id,
  emergency_contact,
  emergency_phone
)
SELECT
  r.full_name,
  r.phone,
  r.email,
  r.address,
  r.relationship,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  r.first_name,
  r.last_name,
  true,
  r.clinic_id,
  'Emergency Contact ' || r.first_name || ' ' || r.last_name,
  '+639' || LPAD((800000000 + r.n)::text, 9, '0')
FROM resolved r
WHERE NOT EXISTS (
  SELECT 1
  FROM guardians gx
  WHERE gx.email = r.email
     OR gx.phone = r.phone
);

INSERT INTO guardian_phone_numbers (
  guardian_id,
  phone_number,
  is_primary,
  is_verified,
  created_at,
  updated_at
)
SELECT
  g.id,
  g.phone,
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM guardians g
WHERE g.email LIKE 'syn_guard_%@synthetic-immunicare.ph'
  AND g.phone LIKE '+639%'
  AND NOT EXISTS (
    SELECT 1
    FROM guardian_phone_numbers gp
    WHERE gp.guardian_id = g.id
      AND gp.phone_number = g.phone
  );

INSERT INTO guardian_notification_preferences (
  guardian_id,
  sms_enabled,
  email_enabled,
  push_enabled,
  reminder_days_before,
  notification_type,
  preferred_time,
  is_active,
  created_at,
  updated_at
)
SELECT
  g.id,
  true,
  true,
  false,
  3,
  'vaccination_reminder',
  '08:00'::time,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM guardians g
WHERE g.email LIKE 'syn_guard_%@synthetic-immunicare.ph'
ON CONFLICT DO NOTHING;

WITH role_map AS (
  SELECT id
  FROM roles
  WHERE name = 'guardian'
  LIMIT 1
),
seed_users AS (
  SELECT
    g.id AS guardian_id,
    g.clinic_id,
    'syn_guard_user_' || LPAD(g.id::text, 6, '0') AS username,
    'syn_guard_user_' || LPAD(g.id::text, 6, '0') || '@synthetic-immunicare.ph' AS email,
    g.phone
  FROM guardians g
  WHERE g.email LIKE 'syn_guard_%@synthetic-immunicare.ph'
)
INSERT INTO users (
  username,
  password_hash,
  role_id,
  clinic_id,
  contact,
  email,
  guardian_id,
  is_active,
  created_at,
  updated_at,
  force_password_change,
  role
)
SELECT
  su.username,
  'SYNPH26_HASH_PLACEHOLDER',
  rm.id,
  su.clinic_id,
  su.phone,
  su.email,
  su.guardian_id,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  false,
  'guardian'
FROM seed_users su
CROSS JOIN role_map rm
WHERE NOT EXISTS (
  SELECT 1
  FROM users u
  WHERE u.guardian_id = su.guardian_id
);

-- =====================================================================================================
-- 4) PATIENTS + INFANTS TOP-UP TO EXACT 100000 MARKER ROWS (last 5 years)
-- =====================================================================================================
WITH desired AS (
  SELECT
    gs AS n,
    'SYNPH26-INF-' || LPAD(gs::text, 6, '0') AS marker_control,
    (ARRAY['Juan','Maria','Jose','Ana','Carlo','Liza','Noah','Mika','Ethan','Luna'])[1 + ((gs * 3) % 10)] AS first_name,
    (ARRAY['Dela Cruz','Santos','Reyes','Garcia','Torres','Mendoza','Flores','Navarro','Bautista','Valdez'])[1 + ((gs * 5) % 10)] AS last_name,
    (ARRAY['A','B','C','D','E','F','G','H','I','J'])[1 + ((gs * 7) % 10)] AS middle_name,
    (CURRENT_DATE - ((gs * 17) % 1825) * INTERVAL '1 day')::date AS dob,
    CASE WHEN (gs % 2 = 0) THEN 'F' ELSE 'M' END AS sex,
    ((gs - 1) % GREATEST((SELECT COUNT(*) FROM guardians WHERE email LIKE 'syn_guard_%@synthetic-immunicare.ph'), 1)) + 1 AS guardian_ordinal
  FROM generate_series(1, 100000) gs
),
guardian_pool AS (
  SELECT
    g.id,
    g.clinic_id,
    ROW_NUMBER() OVER (ORDER BY g.id) AS rn
  FROM guardians g
  WHERE g.email LIKE 'syn_guard_%@synthetic-immunicare.ph'
),
resolved AS (
  SELECT
    d.n,
    d.marker_control,
    d.first_name,
    d.last_name,
    d.middle_name,
    d.dob,
    d.sex,
    gp.id AS guardian_id,
    gp.clinic_id,
    '+639' || LPAD((710000000 + d.n)::text, 9, '0') AS cellphone
  FROM desired d
  JOIN guardian_pool gp
    ON gp.rn = d.guardian_ordinal
)
INSERT INTO patients (
  name,
  date_of_birth,
  gender,
  parent_guardian,
  contact_number,
  address,
  created_at,
  updated_at,
  guardian_id,
  first_name,
  last_name,
  middle_name,
  dob,
  sex,
  contact,
  barangay,
  health_center,
  cellphone_number,
  control_number,
  facility_id,
  is_active
)
SELECT
  r.first_name || ' ' || r.last_name,
  r.dob,
  CASE WHEN r.sex = 'F' THEN 'Female' ELSE 'Male' END,
  'SYNPH26 Guardian Link',
  r.cellphone,
  'SYNPH26 Address Block, Brgy. San Nicolas, Pasig City, Metro Manila',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  r.guardian_id,
  r.first_name,
  r.last_name,
  r.middle_name,
  r.dob,
  r.sex,
  r.cellphone,
  'Brgy. San Isidro',
  'Barangay Health Center',
  r.cellphone,
  r.marker_control,
  r.clinic_id,
  true
FROM resolved r
WHERE NOT EXISTS (
  SELECT 1
  FROM patients p
  WHERE p.control_number = r.marker_control
);

WITH target_controls AS (
  SELECT
    gs AS n,
    'SYNPH26-INF-' || LPAD(gs::text, 6, '0') AS marker_control
  FROM generate_series(1, 100000) gs
),
marker_patients AS (
  SELECT
    p.id,
    tc.marker_control AS control_number,
    p.first_name,
    p.last_name,
    p.middle_name,
    p.dob,
    p.sex,
    p.guardian_id,
    p.facility_id,
    p.contact,
    p.cellphone_number,
    ROW_NUMBER() OVER (PARTITION BY tc.marker_control ORDER BY p.id) AS control_rank
  FROM target_controls tc
  JOIN patients p
    ON p.control_number = tc.marker_control
),
canonical_marker_patients AS (
  SELECT
    mp.id,
    mp.control_number,
    mp.first_name,
    mp.last_name,
    mp.middle_name,
    mp.dob,
    mp.sex,
    mp.guardian_id,
    mp.facility_id,
    mp.contact,
    mp.cellphone_number,
    ROW_NUMBER() OVER (ORDER BY mp.id) AS rn
  FROM marker_patients mp
  WHERE mp.control_rank = 1
),
missing_infants AS (
  SELECT cmp.*
  FROM canonical_marker_patients cmp
  WHERE NOT EXISTS (
    SELECT 1
    FROM infants i
    WHERE i.patient_control_number = cmp.control_number
  )
)
INSERT INTO infants (
  first_name,
  last_name,
  middle_name,
  dob,
  sex,
  address,
  contact,
  guardian_id,
  clinic_id,
  mother_name,
  father_name,
  barangay,
  health_center,
  family_no,
  place_of_birth,
  nbs_done,
  nbs_date,
  cellphone_number,
  is_active,
  created_at,
  updated_at,
  patient_control_number
)
SELECT
  mi.first_name,
  mi.last_name,
  mi.middle_name,
  mi.dob,
  mi.sex::infant_sex,
  'SYNPH26 Address Block, Brgy. San Nicolas, Pasig City, Metro Manila',
  COALESCE(mi.contact, mi.cellphone_number, '+639199000000'),
  mi.guardian_id,
  mi.facility_id,
  'SYNPH26 Mother ' || mi.last_name,
  'SYNPH26 Father ' || mi.last_name,
  'Brgy. San Isidro',
  'Barangay Health Center',
  'SYNFAM-' || LPAD(mi.rn::text, 6, '0'),
  'Pasig City',
  true,
  mi.dob + INTERVAL '2 days',
  COALESCE(mi.cellphone_number, mi.contact, '+639199000000'),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  mi.control_number
FROM missing_infants mi;

-- =====================================================================================================
-- 5) STAFF / CREATOR PREREQUISITES FOR TRANSACTIONS
-- =====================================================================================================
WITH role_admin AS (
  SELECT id
  FROM roles
  WHERE name = 'system_admin'
  LIMIT 1
),
role_hw AS (
  SELECT id
  FROM roles
  WHERE name = 'health_worker'
  LIMIT 1
),
base_clinic AS (
  SELECT id
  FROM clinics
  WHERE name = 'San Nicolas Health Center Pasig City'
  LIMIT 1
),
seed_staff AS (
  SELECT *
  FROM (
    VALUES
      ('syn_admin_001', 'syn_admin_001@synthetic-immunicare.ph', 'system_admin'),
      ('syn_admin_002', 'syn_admin_002@synthetic-immunicare.ph', 'system_admin'),
      ('syn_hw_001', 'syn_hw_001@synthetic-immunicare.ph', 'health_worker'),
      ('syn_hw_002', 'syn_hw_002@synthetic-immunicare.ph', 'health_worker'),
      ('syn_hw_003', 'syn_hw_003@synthetic-immunicare.ph', 'health_worker'),
      ('syn_hw_004', 'syn_hw_004@synthetic-immunicare.ph', 'health_worker')
  ) AS x(username, email, role_name)
)
INSERT INTO users (
  username,
  password_hash,
  role_id,
  clinic_id,
  contact,
  email,
  is_active,
  created_at,
  updated_at,
  force_password_change,
  role
)
SELECT
  ss.username,
  'SYNPH26_HASH_PLACEHOLDER',
  CASE
    WHEN ss.role_name = 'system_admin' THEN ra.id
    ELSE rh.id
  END,
  bc.id,
  '+639' || LPAD((720000000 + ROW_NUMBER() OVER (ORDER BY ss.username))::text, 9, '0'),
  ss.email,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  false,
  CASE WHEN ss.role_name = 'system_admin' THEN 'admin' ELSE 'health_worker' END
FROM seed_staff ss
CROSS JOIN role_admin ra
CROSS JOIN role_hw rh
CROSS JOIN base_clinic bc
WHERE NOT EXISTS (
  SELECT 1
  FROM users u
  WHERE u.username = ss.username
);

-- =====================================================================================================
-- 6) VACCINE BATCHES + INVENTORY BASELINES
-- =====================================================================================================
WITH active_vaccines AS (
  SELECT id, code, name
  FROM vaccines
  WHERE is_active = true
    AND code LIKE 'SYNPH26-%'
),
active_clinics AS (
  SELECT id
  FROM clinics
  WHERE name = 'San Nicolas Health Center Pasig City'
),
staff_user AS (
  SELECT id AS user_id
  FROM users
  WHERE username IN ('syn_admin_001', 'syn_hw_001')
  ORDER BY id
  LIMIT 1
),
crossed AS (
  SELECT
    v.id AS vaccine_id,
    c.id AS clinic_id,
    ROW_NUMBER() OVER (ORDER BY v.id, c.id) AS rn
  FROM active_vaccines v
  CROSS JOIN active_clinics c
)
INSERT INTO vaccine_batches (
  vaccine_id,
  lot_no,
  expiry_date,
  manufacture_date,
  qty_received,
  qty_current,
  qty_initial,
  supplier_id,
  clinic_id,
  storage_conditions,
  status,
  is_active,
  created_at,
  updated_at
)
SELECT
  cr.vaccine_id,
  'SYNLOT-' || LPAD(cr.vaccine_id::text, 4, '0') || '-' || LPAD(cr.clinic_id::text, 4, '0'),
  CURRENT_DATE + (((cr.rn % 730) + 365) * INTERVAL '1 day'),
  CURRENT_DATE - (((cr.rn % 180) + 30) * INTERVAL '1 day'),
  500 + (cr.rn % 1500),
  250 + (cr.rn % 900),
  500 + (cr.rn % 1500),
  (SELECT s.id FROM suppliers s WHERE s.supplier_code LIKE 'SYNPH26SUP%' ORDER BY s.id OFFSET ((cr.rn - 1) % 120) LIMIT 1),
  cr.clinic_id,
  'SYNPH26 cold chain compliant',
  'active'::batch_status,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM crossed cr
WHERE NOT EXISTS (
  SELECT 1
  FROM vaccine_batches vb
  WHERE vb.lot_no = 'SYNLOT-' || LPAD(cr.vaccine_id::text, 4, '0') || '-' || LPAD(cr.clinic_id::text, 4, '0')
);

WITH inventory_seed AS (
  SELECT
    vb.vaccine_id,
    vb.clinic_id,
    vb.lot_no,
    ROW_NUMBER() OVER (ORDER BY vb.vaccine_id, vb.clinic_id) AS rn
  FROM vaccine_batches vb
  WHERE vb.lot_no LIKE 'SYNLOT-%'
),
seed_user AS (
  SELECT id AS user_id
  FROM users
  WHERE username = 'syn_admin_001'
  LIMIT 1
)
INSERT INTO vaccine_inventory (
  vaccine_id,
  clinic_id,
  beginning_balance,
  received_during_period,
  lot_batch_number,
  transferred_in,
  transferred_out,
  expired_wasted,
  issuance,
  low_stock_threshold,
  critical_stock_threshold,
  is_low_stock,
  is_critical_stock,
  period_start,
  period_end,
  created_by,
  updated_by,
  created_at,
  updated_at,
  stock_on_hand,
  is_active
)
SELECT
  i.vaccine_id,
  i.clinic_id,
  800 + (i.rn % 300),
  500 + (i.rn % 200),
  i.lot_no,
  100 + (i.rn % 50),
  90 + (i.rn % 40),
  10 + (i.rn % 10),
  700 + (i.rn % 250),
  120,
  60,
  false,
  false,
  date_trunc('month', CURRENT_DATE)::date,
  (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date,
  su.user_id,
  su.user_id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  0,
  true
FROM inventory_seed i
CROSS JOIN seed_user su
WHERE NOT EXISTS (
  SELECT 1
  FROM vaccine_inventory vi
  WHERE vi.vaccine_id = i.vaccine_id
    AND vi.clinic_id = i.clinic_id
    AND COALESCE(vi.lot_batch_number, '') = i.lot_no
);

UPDATE vaccine_inventory vi
SET stock_on_hand = GREATEST(
      COALESCE(vi.beginning_balance, 0)
      + COALESCE(vi.received_during_period, 0)
      + COALESCE(vi.transferred_in, 0)
      - COALESCE(vi.transferred_out, 0)
      - COALESCE(vi.expired_wasted, 0)
      - COALESCE(vi.issuance, 0),
      0
    ),
    is_critical_stock = (
      GREATEST(
        COALESCE(vi.beginning_balance, 0)
        + COALESCE(vi.received_during_period, 0)
        + COALESCE(vi.transferred_in, 0)
        - COALESCE(vi.transferred_out, 0)
        - COALESCE(vi.expired_wasted, 0)
        - COALESCE(vi.issuance, 0),
        0
      ) <= COALESCE(vi.critical_stock_threshold, 5)
    ),
    is_low_stock = (
      GREATEST(
        COALESCE(vi.beginning_balance, 0)
        + COALESCE(vi.received_during_period, 0)
        + COALESCE(vi.transferred_in, 0)
        - COALESCE(vi.transferred_out, 0)
        - COALESCE(vi.expired_wasted, 0)
        - COALESCE(vi.issuance, 0),
        0
      ) <= COALESCE(vi.low_stock_threshold, 10)
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE vi.lot_batch_number LIKE 'SYNLOT-%';

-- =====================================================================================================
-- 7) VACCINATION REMINDERS (top-up ~1,000,000)
-- =====================================================================================================
WITH target_controls AS (
  SELECT
    'SYNPH26-INF-' || LPAD(gs::text, 6, '0') AS marker_control
  FROM generate_series(1, 100000) gs
),
marker_patients AS (
  SELECT
    canonical.id,
    canonical.guardian_id,
    canonical.dob,
    ROW_NUMBER() OVER (ORDER BY canonical.id) AS rn
  FROM (
    SELECT
      p.id,
      p.guardian_id,
      p.dob,
      ROW_NUMBER() OVER (PARTITION BY tc.marker_control ORDER BY p.id) AS control_rank
    FROM target_controls tc
    JOIN patients p
      ON p.control_number = tc.marker_control
  ) canonical
  WHERE canonical.control_rank = 1
),
target AS (
  SELECT 1000000::bigint AS target_count
),
current_count AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM vaccination_reminders vr
  WHERE COALESCE(vr.notes, '') LIKE 'SYNPH26-TXN-%'
),
deficit AS (
  SELECT GREATEST(t.target_count - c.cnt, 0)::bigint AS to_add
  FROM target t
  CROSS JOIN current_count c
),
seed AS (
  SELECT
    gs AS n,
    mp.id AS patient_id,
    mp.guardian_id,
    v.id AS vaccine_id,
    1 + (gs % 3) AS dose_number,
    (CURRENT_DATE - ((gs * 5) % 365))::date AS due_date,
    (CURRENT_DATE - ((gs * 5) % 365) - ((gs % 14) * INTERVAL '1 day'))::date AS reminder_date,
    CASE (gs % 5)
      WHEN 0 THEN 'pending'
      WHEN 1 THEN 'sent'
      WHEN 2 THEN 'read'
      WHEN 3 THEN 'completed'
      ELSE 'pending'
    END AS status
  FROM deficit d
  JOIN generate_series(1, d.to_add) gs ON d.to_add > 0
  JOIN marker_patients mp ON mp.rn = ((gs - 1) % 100000) + 1
  JOIN vaccines v ON v.code IN ('SYNPH26-BCG','SYNPH26-HEPB','SYNPH26-PENTA','SYNPH26-OPV','SYNPH26-IPV','SYNPH26-PCV','SYNPH26-MMR')
           AND v.id = (
             SELECT vv.id
             FROM vaccines vv
             WHERE vv.code IN ('SYNPH26-BCG','SYNPH26-HEPB','SYNPH26-PENTA','SYNPH26-OPV','SYNPH26-IPV','SYNPH26-PCV','SYNPH26-MMR')
             ORDER BY vv.id
             OFFSET ((gs - 1) % 7)
             LIMIT 1
           )
)
INSERT INTO vaccination_reminders (
  infant_id,
  vaccine_id,
  due_date,
  reminder_date,
  status,
  sent_at,
  created_at,
  updated_at,
  patient_id,
  guardian_id,
  dose_number,
  scheduled_date,
  reminder_sent_at,
  is_read,
  is_completed,
  completed_at,
  notes
)
SELECT
  NULL,
  s.vaccine_id,
  s.due_date,
  s.reminder_date,
  s.status,
  CASE WHEN s.status IN ('sent','read','completed') THEN (s.reminder_date + INTERVAL '8 hours')::timestamp ELSE NULL END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  s.patient_id,
  s.guardian_id,
  s.dose_number,
  s.due_date,
  CASE WHEN s.status IN ('sent','read','completed') THEN (s.reminder_date + INTERVAL '8 hours')::timestamp ELSE NULL END,
  (s.status IN ('read','completed')),
  (s.status = 'completed'),
  CASE WHEN s.status = 'completed' THEN (s.due_date + INTERVAL '1 day')::timestamp ELSE NULL END,
  'SYNPH26-TXN-VR-' || LPAD(s.n::text, 10, '0')
FROM seed s;

-- =====================================================================================================
-- 8) APPOINTMENTS (top-up to 2,700,000 marker rows)
-- =====================================================================================================
WITH target_controls AS (
  SELECT
    'SYNPH26-INF-' || LPAD(gs::text, 6, '0') AS marker_control
  FROM generate_series(1, 100000) gs
),
marker_patients AS (
  SELECT
    canonical.id,
    canonical.guardian_id,
    COALESCE(canonical.facility_id, 1) AS clinic_id,
    canonical.dob,
    ROW_NUMBER() OVER (ORDER BY canonical.id) AS rn
  FROM (
    SELECT
      p.id,
      p.guardian_id,
      p.facility_id,
      p.dob,
      ROW_NUMBER() OVER (PARTITION BY tc.marker_control ORDER BY p.id) AS control_rank
    FROM target_controls tc
    JOIN patients p
      ON p.control_number = tc.marker_control
  ) canonical
  WHERE canonical.control_rank = 1
),
creator_users AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM users
  WHERE username LIKE 'syn_%'
),
target AS (
  SELECT 2700000::bigint AS target_count
),
current_count AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM appointments a
  WHERE COALESCE(a.notes, '') LIKE 'SYNPH26-TXN-AP-%'
),
deficit AS (
  SELECT GREATEST(t.target_count - c.cnt, 0)::bigint AS to_add
  FROM target t
  CROSS JOIN current_count c
),
seed AS (
  SELECT
    gs AS n,
    mp.id AS patient_id,
    mp.guardian_id,
    mp.clinic_id,
    cu.id AS created_by,
    (CURRENT_DATE - ((gs % 730) * INTERVAL '1 day') + ((gs % 24) * INTERVAL '1 hour'))::timestamptz AS scheduled_date,
    CASE (gs % 6)
      WHEN 0 THEN 'scheduled'
      WHEN 1 THEN 'attended'
      WHEN 2 THEN 'confirmed'
      WHEN 3 THEN 'rescheduled'
      WHEN 4 THEN 'cancelled'
      ELSE 'no-show'
    END::appointment_status AS status,
    CASE WHEN gs % 5 = 0 THEN 'Follow-up Visit' ELSE 'Vaccination Appointment' END AS type,
    'Room ' || ((gs % 12) + 1)::text || ', Immunization Wing' AS location
  FROM deficit d
  JOIN generate_series(1, d.to_add) gs ON d.to_add > 0
  JOIN marker_patients mp ON mp.rn = ((gs - 1) % 100000) + 1
  JOIN creator_users cu ON cu.rn = ((gs - 1) % GREATEST((SELECT COUNT(*) FROM creator_users), 1)) + 1
)
INSERT INTO appointments (
  infant_id,
  scheduled_date,
  type,
  status,
  notes,
  cancellation_reason,
  completion_notes,
  duration_minutes,
  created_by,
  clinic_id,
  is_active,
  created_at,
  updated_at,
  location,
  confirmation_status,
  confirmed_at,
  confirmation_method,
  sms_confirmation_sent,
  sms_confirmation_sent_at,
  guardian_id
)
SELECT
  s.patient_id,
  s.scheduled_date,
  s.type,
  s.status,
  'SYNPH26-TXN-AP-' || LPAD(s.n::text, 10, '0'),
  CASE WHEN s.status = 'cancelled' THEN 'SYNPH26 schedule conflict' ELSE NULL END,
  CASE WHEN s.status = 'attended' THEN 'SYNPH26 completed successfully' ELSE NULL END,
  15 + (s.n % 45),
  s.created_by,
  s.clinic_id,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  s.location,
  CASE
    WHEN s.status IN ('confirmed','attended') THEN 'confirmed'
    WHEN s.status = 'cancelled' THEN 'cancelled'
    ELSE 'pending'
  END,
  CASE WHEN s.status IN ('confirmed','attended') THEN s.scheduled_date - INTERVAL '1 day' ELSE NULL END,
  CASE WHEN s.status IN ('confirmed','attended') THEN 'sms' ELSE NULL END,
  (s.status IN ('confirmed','attended')),
  CASE WHEN s.status IN ('confirmed','attended') THEN s.scheduled_date - INTERVAL '1 day' ELSE NULL END,
  s.guardian_id
FROM seed s;

-- =====================================================================================================
-- 9) IMMUNIZATION RECORDS (top-up to 3,200,000 marker rows)
-- =====================================================================================================
WITH target_controls AS (
  SELECT
    'SYNPH26-INF-' || LPAD(gs::text, 6, '0') AS marker_control
  FROM generate_series(1, 100000) gs
),
marker_patients AS (
  SELECT
    canonical.id,
    canonical.dob,
    ROW_NUMBER() OVER (ORDER BY canonical.id) AS rn
  FROM (
    SELECT
      p.id,
      p.dob,
      ROW_NUMBER() OVER (PARTITION BY tc.marker_control ORDER BY p.id) AS control_rank
    FROM target_controls tc
    JOIN patients p
      ON p.control_number = tc.marker_control
  ) canonical
  WHERE canonical.control_rank = 1
),
vaccines_pick AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM vaccines
  WHERE code IN ('SYNPH26-BCG','SYNPH26-HEPB','SYNPH26-PENTA','SYNPH26-OPV','SYNPH26-IPV','SYNPH26-PCV','SYNPH26-MMR')
),
batches_pick AS (
  SELECT id, vaccine_id, ROW_NUMBER() OVER (PARTITION BY vaccine_id ORDER BY id) AS rn
  FROM vaccine_batches
  WHERE lot_no LIKE 'SYNLOT-%'
),
admin_users AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM users
  WHERE username LIKE 'syn_%'
),
target AS (
  SELECT 3200000::bigint AS target_count
),
current_count AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM immunization_records ir
  WHERE COALESCE(ir.notes, '') LIKE 'SYNPH26-TXN-IR-%'
),
deficit AS (
  SELECT GREATEST(t.target_count - c.cnt, 0)::bigint AS to_add
  FROM target t
  CROSS JOIN current_count c
),
seed AS (
  SELECT
    gs AS n,
    mp.id AS patient_id,
    mp.dob,
    vp.id AS vaccine_id,
    vp.rn AS vaccine_rn,
    au.id AS administered_by,
    CASE
      WHEN gs % 5 IN (0,1,2) THEN 'completed'
      WHEN gs % 5 = 3 THEN 'scheduled'
      ELSE 'pending'
    END AS status,
    (mp.dob + (((gs % 1600) + 14) * INTERVAL '1 day'))::date AS admin_date_raw,
    (mp.dob + (((gs % 1600) + 42) * INTERVAL '1 day'))::date AS next_due_raw,
    1 + (gs % 3) AS dose_no
  FROM deficit d
  JOIN generate_series(1, d.to_add) gs ON d.to_add > 0
  JOIN marker_patients mp ON mp.rn = ((gs - 1) % 100000) + 1
  JOIN vaccines_pick vp ON vp.rn = ((gs - 1) % 7) + 1
  JOIN admin_users au ON au.rn = ((gs - 1) % GREATEST((SELECT COUNT(*) FROM admin_users), 1)) + 1
),
seed_with_batch AS (
  SELECT
    s.*,
    (
      SELECT bp.id
      FROM batches_pick bp
      WHERE bp.vaccine_id = s.vaccine_id
      ORDER BY bp.rn
      OFFSET ((s.n - 1) % GREATEST((SELECT COUNT(*) FROM batches_pick b2 WHERE b2.vaccine_id = s.vaccine_id), 1))
      LIMIT 1
    ) AS batch_id,
    LEAST(s.admin_date_raw, CURRENT_DATE)::date AS admin_date,
    LEAST(s.next_due_raw, CURRENT_DATE + 365)::date AS next_due_date
  FROM seed s
)
INSERT INTO immunization_records (
  patient_id,
  vaccine_id,
  batch_id,
  admin_date,
  next_due_date,
  status,
  notes,
  administered_by,
  created_at,
  updated_at,
  is_active,
  dose_no,
  site_of_injection,
  reactions
)
SELECT
  swb.patient_id,
  swb.vaccine_id,
  swb.batch_id,
  CASE WHEN swb.status = 'completed' THEN swb.admin_date ELSE NULL END,
  CASE WHEN swb.status IN ('scheduled','pending') THEN swb.next_due_date ELSE NULL END,
  swb.status,
  'SYNPH26-TXN-IR-' || LPAD(swb.n::text, 10, '0'),
  swb.administered_by,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  true,
  swb.dose_no,
  CASE (swb.n % 4)
    WHEN 0 THEN 'left deltoid'
    WHEN 1 THEN 'right deltoid'
    WHEN 2 THEN 'left thigh'
    ELSE 'right thigh'
  END,
  CASE WHEN swb.n % 20 = 0 THEN 'SYNPH26 mild fever observed' ELSE NULL END
FROM seed_with_batch swb;

-- =====================================================================================================
-- 10) NOTIFICATIONS (top-up to 1,400,000 marker rows)
-- =====================================================================================================
WITH target_controls AS (
  SELECT
    'SYNPH26-INF-' || LPAD(gs::text, 6, '0') AS marker_control
  FROM generate_series(1, 100000) gs
),
marker_patients AS (
  SELECT
    canonical.id,
    canonical.guardian_id,
    ROW_NUMBER() OVER (ORDER BY canonical.id) AS rn
  FROM (
    SELECT
      p.id,
      p.guardian_id,
      ROW_NUMBER() OVER (PARTITION BY tc.marker_control ORDER BY p.id) AS control_rank
    FROM target_controls tc
    JOIN patients p
      ON p.control_number = tc.marker_control
  ) canonical
  WHERE canonical.control_rank = 1
),
creator_users AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM users
  WHERE username LIKE 'syn_%'
),
target AS (
  SELECT 1400000::bigint AS target_count
),
current_count AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM notifications n
  WHERE COALESCE(n.message, '') LIKE 'SYNPH26-TXN-NF-%'
),
deficit AS (
  SELECT GREATEST(t.target_count - c.cnt, 0)::bigint AS to_add
  FROM target t
  CROSS JOIN current_count c
),
seed AS (
  SELECT
    gs AS n,
    mp.id AS patient_id,
    mp.guardian_id,
    cu.id AS created_by,
    CASE (gs % 4)
      WHEN 0 THEN 'sms'
      WHEN 1 THEN 'push'
      WHEN 2 THEN 'email'
      ELSE 'both'
    END::channel_type AS channel,
    CASE (gs % 4)
      WHEN 0 THEN 'normal'
      WHEN 1 THEN 'high'
      WHEN 2 THEN 'urgent'
      ELSE 'low'
    END::notification_priority AS priority,
    CASE (gs % 7)
      WHEN 0 THEN 'pending'
      WHEN 1 THEN 'queued'
      WHEN 2 THEN 'sending'
      WHEN 3 THEN 'sent'
      WHEN 4 THEN 'delivered'
      WHEN 5 THEN 'read'
      ELSE 'failed'
    END::notification_status AS status,
    CURRENT_TIMESTAMP - ((gs % 365) * INTERVAL '1 day') AS created_at
  FROM deficit d
  JOIN generate_series(1, d.to_add) gs ON d.to_add > 0
  JOIN marker_patients mp ON mp.rn = ((gs - 1) % 100000) + 1
  JOIN creator_users cu ON cu.rn = ((gs - 1) % GREATEST((SELECT COUNT(*) FROM creator_users), 1)) + 1
)
INSERT INTO notifications (
  notification_type,
  target_type,
  target_id,
  recipient_name,
  recipient_email,
  recipient_phone,
  channel,
  priority,
  status,
  scheduled_for,
  sent_at,
  delivered_at,
  read_at,
  failed_at,
  failure_reason,
  retry_count,
  max_retries,
  subject,
  message,
  template_id,
  related_entity_type,
  related_entity_id,
  language,
  requires_response,
  created_by,
  created_at,
  updated_at,
  user_id,
  guardian_id,
  target_role,
  title,
  is_read,
  action_url
)
SELECT
  'vaccination_reminder',
  'guardian',
  s.guardian_id,
  'SYNPH26 Guardian ' || s.guardian_id,
  'syn_guard_user_' || LPAD(s.guardian_id::text, 6, '0') || '@synthetic-immunicare.ph',
  '+639' || LPAD((700000000 + ((s.guardian_id % 100000) + 1))::text, 9, '0'),
  s.channel,
  s.priority,
  s.status,
  s.created_at + INTERVAL '1 hour',
  CASE WHEN s.status IN ('sent','delivered','read') THEN s.created_at + INTERVAL '2 hours' ELSE NULL END,
  CASE WHEN s.status IN ('delivered','read') THEN s.created_at + INTERVAL '3 hours' ELSE NULL END,
  CASE WHEN s.status = 'read' THEN s.created_at + INTERVAL '4 hours' ELSE NULL END,
  CASE WHEN s.status = 'failed' THEN s.created_at + INTERVAL '2 hours' ELSE NULL END,
  CASE WHEN s.status = 'failed' THEN 'SYNPH26 simulated gateway timeout' ELSE NULL END,
  (s.n % 3),
  3,
  'SYNPH26 Vaccination Reminder',
  'SYNPH26-TXN-NF-' || LPAD(s.n::text, 10, '0') || ' | Your child has a vaccination schedule due soon.',
  'SYNPH26-TPL',
  'patient',
  s.patient_id,
  'en',
  false,
  s.created_by,
  s.created_at,
  CURRENT_TIMESTAMP,
  s.created_by,
  s.guardian_id,
  'guardian',
  'SYNPH26 Vaccination Update',
  (s.status = 'read'),
  '/guardian/vaccinations'
FROM seed s;

-- =====================================================================================================
-- 11) SMS LOGS (top-up to 1,100,000 marker rows)
-- =====================================================================================================
WITH marker_guardians AS (
  SELECT
    g.id,
    g.phone,
    ROW_NUMBER() OVER (ORDER BY g.id) AS rn
  FROM guardians g
  WHERE g.email LIKE 'syn_guard_%@synthetic-immunicare.ph'
),
target AS (
  SELECT 1100000::bigint AS target_count
),
current_count AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM sms_logs s
  WHERE COALESCE(s.message, '') LIKE 'SYNPH26-TXN-SMS-%'
),
deficit AS (
  SELECT GREATEST(t.target_count - c.cnt, 0)::bigint AS to_add
  FROM target t
  CROSS JOIN current_count c
),
seed AS (
  SELECT
    gs AS n,
    mg.phone,
    CASE (gs % 4)
      WHEN 0 THEN 'appointment_reminder'
      WHEN 1 THEN 'vaccination_reminder'
      WHEN 2 THEN 'otp'
      ELSE 'general'
    END AS message_type,
    CASE (gs % 5)
      WHEN 0 THEN 'pending'
      WHEN 1 THEN 'sent'
      WHEN 2 THEN 'delivered'
      WHEN 3 THEN 'failed'
      ELSE 'sent'
    END AS status,
    CURRENT_TIMESTAMP - ((gs % 365) * INTERVAL '1 day') AS created_at
  FROM deficit d
  JOIN generate_series(1, d.to_add) gs ON d.to_add > 0
  JOIN marker_guardians mg ON mg.rn = ((gs - 1) % GREATEST((SELECT COUNT(*) FROM marker_guardians), 1)) + 1
)
INSERT INTO sms_logs (
  phone_number,
  message,
  message_type,
  status,
  provider,
  message_id,
  metadata,
  attempts,
  sent_at,
  failed_at,
  error_message,
  created_at
)
SELECT
  s.phone,
  'SYNPH26-TXN-SMS-' || LPAD(s.n::text, 10, '0') || ' | Immunicare reminder message.',
  s.message_type,
  s.status,
  'log',
  'SYNMSG-' || LPAD(s.n::text, 12, '0'),
  jsonb_build_object('marker', 'SYNPH26', 'sequence', s.n),
  jsonb_build_array(jsonb_build_object('attempt', 1, 'status', s.status)),
  CASE WHEN s.status IN ('sent','delivered') THEN s.created_at + INTERVAL '2 minutes' ELSE NULL END,
  CASE WHEN s.status = 'failed' THEN s.created_at + INTERVAL '2 minutes' ELSE NULL END,
  CASE WHEN s.status = 'failed' THEN 'SYNPH26 simulated carrier reject' ELSE NULL END,
  s.created_at
FROM seed s;

-- =====================================================================================================
-- 12) INVENTORY TRANSACTIONS (top-up to 550,000 marker rows)
-- =====================================================================================================
WITH batches AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM vaccine_batches
  WHERE lot_no LIKE 'SYNLOT-%'
),
users_pick AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM users
  WHERE username LIKE 'syn_%'
),
target AS (
  SELECT 550000::bigint AS target_count
),
current_count AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM inventory_transactions it
  WHERE COALESCE(it.notes, '') LIKE 'SYNPH26-TXN-IT-%'
),
deficit AS (
  SELECT GREATEST(t.target_count - c.cnt, 0)::bigint AS to_add
  FROM target t
  CROSS JOIN current_count c
),
seed AS (
  SELECT
    gs AS n,
    b.id AS batch_id,
    u.id AS user_id,
    CASE (gs % 4)
      WHEN 0 THEN 'RECEIVE'
      WHEN 1 THEN 'ISSUE'
      WHEN 2 THEN 'WASTAGE'
      ELSE 'ADJUST'
    END::txn_type AS txn_type,
    1 + (gs % 50) AS qty,
    CURRENT_TIMESTAMP - ((gs % 365) * INTERVAL '1 day') AS created_at
  FROM deficit d
  JOIN generate_series(1, d.to_add) gs ON d.to_add > 0
  JOIN batches b ON b.rn = ((gs - 1) % GREATEST((SELECT COUNT(*) FROM batches), 1)) + 1
  JOIN users_pick u ON u.rn = ((gs - 1) % GREATEST((SELECT COUNT(*) FROM users_pick), 1)) + 1
)
INSERT INTO inventory_transactions (
  batch_id,
  txn_type,
  qty,
  user_id,
  notes,
  created_at
)
SELECT
  s.batch_id,
  s.txn_type,
  s.qty,
  s.user_id,
  'SYNPH26-TXN-IT-' || LPAD(s.n::text, 10, '0'),
  s.created_at
FROM seed s;

-- =====================================================================================================
-- 13) VACCINE INVENTORY TRANSACTIONS (top-up to 650,000 marker rows)
-- =====================================================================================================
WITH inventories AS (
  SELECT
    vi.id,
    vi.vaccine_id,
    vi.clinic_id,
    COALESCE(vi.stock_on_hand, 0) AS stock_on_hand,
    ROW_NUMBER() OVER (ORDER BY vi.id) AS rn
  FROM vaccine_inventory vi
  WHERE COALESCE(vi.lot_batch_number, '') LIKE 'SYNLOT-%'
),
users_pick AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM users
  WHERE username LIKE 'syn_%'
),
target AS (
  SELECT 650000::bigint AS target_count
),
current_count AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM vaccine_inventory_transactions vit
  WHERE COALESCE(vit.reference_number, '') LIKE 'SYNREF-%'
),
deficit AS (
  SELECT GREATEST(t.target_count - c.cnt, 0)::bigint AS to_add
  FROM target t
  CROSS JOIN current_count c
),
seed AS (
  SELECT
    gs AS n,
    i.id AS vaccine_inventory_id,
    i.vaccine_id,
    i.clinic_id,
    u.id AS performed_by,
    CASE (gs % 4)
      WHEN 0 THEN 'RECEIVE'
      WHEN 1 THEN 'ISSUE'
      WHEN 2 THEN 'WASTAGE'
      ELSE 'ADJUST'
    END AS transaction_type,
    1 + (gs % 40) AS quantity,
    (100 + (gs % 900)) AS previous_balance,
    CURRENT_TIMESTAMP - ((gs % 365) * INTERVAL '1 day') AS created_at
  FROM deficit d
  JOIN generate_series(1, d.to_add) gs ON d.to_add > 0
  JOIN inventories i ON i.rn = ((gs - 1) % GREATEST((SELECT COUNT(*) FROM inventories), 1)) + 1
  JOIN users_pick u ON u.rn = ((gs - 1) % GREATEST((SELECT COUNT(*) FROM users_pick), 1)) + 1
)
INSERT INTO vaccine_inventory_transactions (
  vaccine_inventory_id,
  vaccine_id,
  clinic_id,
  transaction_type,
  quantity,
  previous_balance,
  new_balance,
  lot_number,
  batch_number,
  expiry_date,
  supplier_name,
  reference_number,
  performed_by,
  approved_by,
  notes,
  triggered_low_stock_alert,
  triggered_critical_stock_alert,
  created_at
)
SELECT
  s.vaccine_inventory_id,
  s.vaccine_id,
  s.clinic_id,
  s.transaction_type,
  s.quantity,
  s.previous_balance,
  CASE
    WHEN s.transaction_type IN ('ISSUE', 'WASTAGE') THEN GREATEST(s.previous_balance - s.quantity, 0)
    ELSE s.previous_balance + s.quantity
  END,
  'SYNLOT-' || LPAD(s.vaccine_id::text, 4, '0') || '-' || LPAD(s.clinic_id::text, 4, '0'),
  'SYNLOT-' || LPAD(s.vaccine_id::text, 4, '0') || '-' || LPAD(s.clinic_id::text, 4, '0'),
  CURRENT_DATE + (((s.n % 700) + 300) * INTERVAL '1 day'),
  'SYNPH26 Supplier',
  'SYNREF-' || LPAD(s.n::text, 12, '0'),
  s.performed_by,
  s.performed_by,
  'SYNPH26 inventory movement',
  (s.n % 20 = 0),
  (s.n % 55 = 0),
  s.created_at
FROM seed s;

-- =====================================================================================================
-- 14) AUDIT LOGS (top-up to 400,000 marker rows)
-- =====================================================================================================
WITH users_pick AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM users
  WHERE username LIKE 'syn_%'
),
target AS (
  SELECT 400000::bigint AS target_count
),
current_count AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM audit_logs al
  WHERE COALESCE(al.new_values, '') LIKE '%SYNPH26-TXN-AUD-%'
),
deficit AS (
  SELECT GREATEST(t.target_count - c.cnt, 0)::bigint AS to_add
  FROM target t
  CROSS JOIN current_count c
),
seed AS (
  SELECT
    gs AS n,
    u.id AS user_id,
    CASE (gs % 6)
      WHEN 0 THEN 'appointment.create'
      WHEN 1 THEN 'appointment.update'
      WHEN 2 THEN 'immunization.record'
      WHEN 3 THEN 'inventory.transaction'
      WHEN 4 THEN 'notification.dispatch'
      ELSE 'dashboard.view'
    END AS event_type,
    CASE (gs % 5)
      WHEN 0 THEN 'appointments'
      WHEN 1 THEN 'immunization_records'
      WHEN 2 THEN 'vaccine_inventory_transactions'
      WHEN 3 THEN 'notifications'
      ELSE 'patients'
    END AS entity_type,
    1 + (gs % 100000) AS entity_id,
    CURRENT_TIMESTAMP - ((gs % 365) * INTERVAL '1 day') AS ts
  FROM deficit d
  JOIN generate_series(1, d.to_add) gs ON d.to_add > 0
  JOIN users_pick u ON u.rn = ((gs - 1) % GREATEST((SELECT COUNT(*) FROM users_pick), 1)) + 1
)
INSERT INTO audit_logs (
  user_id,
  event_type,
  entity_type,
  entity_id,
  old_values,
  new_values,
  metadata,
  timestamp,
  ip_address,
  user_agent
)
SELECT
  s.user_id,
  s.event_type,
  s.entity_type,
  s.entity_id,
  NULL,
  'SYNPH26-TXN-AUD-' || LPAD(s.n::text, 10, '0'),
  json_build_object('marker', 'SYNPH26', 'event_seq', s.n)::text,
  s.ts,
  '127.0.0.1',
  'SYNPH26 synthetic generator'
FROM seed s;

-- =====================================================================================================
-- 15) DOWNSTREAM CONSISTENCY UPDATES (marker-scoped only)
-- =====================================================================================================

UPDATE notifications n
SET sent_at = COALESCE(n.sent_at, CASE WHEN n.status IN ('sent','delivered','read') THEN n.created_at + INTERVAL '2 hours' END),
    delivered_at = COALESCE(n.delivered_at, CASE WHEN n.status IN ('delivered','read') THEN n.created_at + INTERVAL '3 hours' END),
    read_at = COALESCE(n.read_at, CASE WHEN n.status = 'read' THEN n.created_at + INTERVAL '4 hours' END),
    failed_at = COALESCE(n.failed_at, CASE WHEN n.status = 'failed' THEN n.created_at + INTERVAL '2 hours' END),
    is_read = CASE WHEN n.status = 'read' THEN true ELSE n.is_read END,
    updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(n.message, '') LIKE 'SYNPH26-TXN-NF-%';

UPDATE appointments a
SET scheduled_date = GREATEST(a.scheduled_date, (p.dob + INTERVAL '7 days')::timestamptz),
    updated_at = CURRENT_TIMESTAMP
FROM patients p
WHERE a.infant_id = p.id
  AND p.control_number LIKE 'SYNPH26-INF-%'
  AND a.scheduled_date::date < p.dob;

UPDATE immunization_records ir
SET admin_date = CASE
      WHEN ir.admin_date IS NOT NULL AND ir.admin_date < p.dob THEN p.dob + INTERVAL '14 days'
      ELSE ir.admin_date
    END,
    next_due_date = CASE
      WHEN ir.next_due_date IS NOT NULL AND ir.next_due_date < p.dob THEN p.dob + INTERVAL '42 days'
      ELSE ir.next_due_date
    END,
    updated_at = CURRENT_TIMESTAMP
FROM patients p
WHERE ir.patient_id = p.id
  AND p.control_number LIKE 'SYNPH26-INF-%'
  AND (
    (ir.admin_date IS NOT NULL AND ir.admin_date < p.dob)
    OR (ir.next_due_date IS NOT NULL AND ir.next_due_date < p.dob)
  );

UPDATE vaccine_inventory vi
SET stock_on_hand = GREATEST(
      COALESCE(vi.beginning_balance, 0)
      + COALESCE(vi.received_during_period, 0)
      + COALESCE(vi.transferred_in, 0)
      - COALESCE(vi.transferred_out, 0)
      - COALESCE(vi.expired_wasted, 0)
      - COALESCE(vi.issuance, 0),
      0
    ),
    is_critical_stock = (
      GREATEST(
        COALESCE(vi.beginning_balance, 0)
        + COALESCE(vi.received_during_period, 0)
        + COALESCE(vi.transferred_in, 0)
        - COALESCE(vi.transferred_out, 0)
        - COALESCE(vi.expired_wasted, 0)
        - COALESCE(vi.issuance, 0),
        0
      ) <= COALESCE(vi.critical_stock_threshold, 5)
    ),
    is_low_stock = (
      GREATEST(
        COALESCE(vi.beginning_balance, 0)
        + COALESCE(vi.received_during_period, 0)
        + COALESCE(vi.transferred_in, 0)
        - COALESCE(vi.transferred_out, 0)
        - COALESCE(vi.expired_wasted, 0)
        - COALESCE(vi.issuance, 0),
        0
      ) <= COALESCE(vi.low_stock_threshold, 10)
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(vi.lot_batch_number, '') LIKE 'SYNLOT-%';

-- =====================================================================================================
-- 16) VALIDATION QUERIES
-- =====================================================================================================

-- 16.1 Exact target counts
WITH target_controls AS (
  SELECT
    'SYNPH26-INF-' || LPAD(gs::text, 6, '0') AS marker_control
  FROM generate_series(1, 100000) gs
)
SELECT
  'marker_patients_exact_100000' AS check_name,
  COUNT(*)::bigint AS actual_count
FROM target_controls tc
WHERE EXISTS (
  SELECT 1
  FROM patients p
  WHERE p.control_number = tc.marker_control
);

WITH target_controls AS (
  SELECT
    'SYNPH26-INF-' || LPAD(gs::text, 6, '0') AS marker_control
  FROM generate_series(1, 100000) gs
),
marker_patients AS (
  SELECT
    tc.marker_control,
    COUNT(p.id)::bigint AS patient_rows
  FROM target_controls tc
  LEFT JOIN patients p
    ON p.control_number = tc.marker_control
  GROUP BY tc.marker_control
),
marker_infants AS (
  SELECT
    tc.marker_control,
    COUNT(i.id)::bigint AS infant_rows
  FROM target_controls tc
  LEFT JOIN infants i
    ON i.patient_control_number = tc.marker_control
  GROUP BY tc.marker_control
),
marker_infants_outside_target AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM infants i
  WHERE i.patient_control_number LIKE 'SYNPH26-INF-%'
    AND NOT EXISTS (
      SELECT 1
      FROM target_controls tc
      WHERE tc.marker_control = i.patient_control_number
    )
)
SELECT
  'marker_patients_duplicate_controls_should_be_0' AS check_name,
  COALESCE(SUM(GREATEST(mp.patient_rows - 1, 0)), 0)::bigint AS actual_count
FROM marker_patients mp
UNION ALL
SELECT
  'marker_infants_exact_100000' AS check_name,
  COALESCE(SUM(mi.infant_rows), 0)::bigint AS actual_count
FROM marker_infants mi
UNION ALL
SELECT
  'marker_infants_distinct_control_exact_100000' AS check_name,
  COUNT(*) FILTER (WHERE mi.infant_rows > 0)::bigint AS actual_count
FROM marker_infants mi
UNION ALL
SELECT
  'marker_infants_duplicate_controls_should_be_0' AS check_name,
  COALESCE(SUM(GREATEST(mi.infant_rows - 1, 0)), 0)::bigint AS actual_count
FROM marker_infants mi
UNION ALL
SELECT
  'target_controls_missing_patient_should_be_0' AS check_name,
  COUNT(*) FILTER (WHERE mp.patient_rows = 0)::bigint AS actual_count
FROM marker_patients mp
UNION ALL
SELECT
  'target_controls_missing_infant_should_be_0' AS check_name,
  COUNT(*) FILTER (WHERE mi.infant_rows = 0)::bigint AS actual_count
FROM marker_infants mi
UNION ALL
SELECT
  'marker_infants_without_patient_should_be_0' AS check_name,
  COUNT(*) FILTER (WHERE mp.patient_rows = 0 AND mi.infant_rows > 0)::bigint AS actual_count
FROM marker_patients mp
JOIN marker_infants mi
  ON mi.marker_control = mp.marker_control
UNION ALL
SELECT
  'marker_infants_outside_target_range_should_be_0' AS check_name,
  cnt AS actual_count
FROM marker_infants_outside_target
UNION ALL
SELECT
  'marker_infants_over_target_100000' AS check_name,
  GREATEST((SELECT COALESCE(SUM(infant_rows), 0)::bigint FROM marker_infants) - 100000, 0)::bigint AS actual_count;

SELECT
  'appointments_marker_target_2700000' AS check_name,
  COUNT(*)::bigint AS actual_count
FROM appointments
WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-AP-%';

SELECT
  'immunization_records_marker_target_3200000' AS check_name,
  COUNT(*)::bigint AS actual_count
FROM immunization_records
WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IR-%';

SELECT
  'notifications_marker_target_1400000' AS check_name,
  COUNT(*)::bigint AS actual_count
FROM notifications
WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-NF-%';

SELECT
  'sms_logs_marker_target_1100000' AS check_name,
  COUNT(*)::bigint AS actual_count
FROM sms_logs
WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-SMS-%';

SELECT
  'inventory_transactions_marker_target_550000' AS check_name,
  COUNT(*)::bigint AS actual_count
FROM inventory_transactions
WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IT-%';

SELECT
  'vaccine_inventory_transactions_marker_target_650000' AS check_name,
  COUNT(*)::bigint AS actual_count
FROM vaccine_inventory_transactions
WHERE COALESCE(reference_number, '') LIKE 'SYNREF-%';

SELECT
  'audit_logs_marker_target_400000' AS check_name,
  COUNT(*)::bigint AS actual_count
FROM audit_logs
WHERE COALESCE(new_values, '') LIKE '%SYNPH26-TXN-AUD-%';

SELECT
  'vaccination_reminders_marker_target_1000000' AS check_name,
  COUNT(*)::bigint AS actual_count
FROM vaccination_reminders
WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-VR-%';

SELECT
  'transactional_marker_total_10000000' AS check_name,
  (
    (SELECT COUNT(*)::bigint FROM appointments WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-AP-%')
    + (SELECT COUNT(*)::bigint FROM immunization_records WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IR-%')
    + (SELECT COUNT(*)::bigint FROM notifications WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-NF-%')
    + (SELECT COUNT(*)::bigint FROM sms_logs WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-SMS-%')
    + (SELECT COUNT(*)::bigint FROM inventory_transactions WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IT-%')
    + (SELECT COUNT(*)::bigint FROM vaccine_inventory_transactions WHERE COALESCE(reference_number, '') LIKE 'SYNREF-%')
    + (SELECT COUNT(*)::bigint FROM audit_logs WHERE COALESCE(new_values, '') LIKE '%SYNPH26-TXN-AUD-%')
  ) AS actual_count;

-- 16.2 Dashboard module coverage status distributions
SELECT status, COUNT(*)::bigint AS cnt
FROM appointments
WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-AP-%'
GROUP BY status
ORDER BY cnt DESC;

SELECT status, COUNT(*)::bigint AS cnt
FROM immunization_records
WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IR-%'
GROUP BY status
ORDER BY cnt DESC;

SELECT status, COUNT(*)::bigint AS cnt
FROM notifications
WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-NF-%'
GROUP BY status
ORDER BY cnt DESC;

SELECT status, COUNT(*)::bigint AS cnt
FROM sms_logs
WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-SMS-%'
GROUP BY status
ORDER BY cnt DESC;

SELECT
  COUNT(*) FILTER (WHERE is_low_stock)::bigint AS low_stock_rows,
  COUNT(*) FILTER (WHERE is_critical_stock)::bigint AS critical_stock_rows
FROM vaccine_inventory
WHERE COALESCE(lot_batch_number, '') LIKE 'SYNLOT-%';

-- 16.3 FK integrity checks for marker-scoped data
SELECT
  COUNT(*)::bigint AS orphan_appointments
FROM appointments a
LEFT JOIN patients p ON p.id = a.infant_id
WHERE COALESCE(a.notes, '') LIKE 'SYNPH26-TXN-AP-%'
  AND p.id IS NULL;

SELECT
  COUNT(*)::bigint AS orphan_immunization_patients
FROM immunization_records ir
LEFT JOIN patients p ON p.id = ir.patient_id
WHERE COALESCE(ir.notes, '') LIKE 'SYNPH26-TXN-IR-%'
  AND p.id IS NULL;

SELECT
  COUNT(*)::bigint AS orphan_immunization_batches
FROM immunization_records ir
LEFT JOIN vaccine_batches vb ON vb.id = ir.batch_id
WHERE COALESCE(ir.notes, '') LIKE 'SYNPH26-TXN-IR-%'
  AND vb.id IS NULL;

SELECT
  COUNT(*)::bigint AS orphan_inventory_txn_batches
FROM inventory_transactions it
LEFT JOIN vaccine_batches vb ON vb.id = it.batch_id
WHERE COALESCE(it.notes, '') LIKE 'SYNPH26-TXN-IT-%'
  AND vb.id IS NULL;

SELECT
  COUNT(*)::bigint AS orphan_vaccine_inventory_txn_inventory
FROM vaccine_inventory_transactions vit
LEFT JOIN vaccine_inventory vi ON vi.id = vit.vaccine_inventory_id
WHERE COALESCE(vit.reference_number, '') LIKE 'SYNREF-%'
  AND vi.id IS NULL;

-- 16.4 Date sanity checks
SELECT
  COUNT(*)::bigint AS appointments_before_dob
FROM appointments a
JOIN patients p ON p.id = a.infant_id
WHERE COALESCE(a.notes, '') LIKE 'SYNPH26-TXN-AP-%'
  AND a.scheduled_date::date < p.dob;

SELECT
  COUNT(*)::bigint AS immunization_before_dob
FROM immunization_records ir
JOIN patients p ON p.id = ir.patient_id
WHERE COALESCE(ir.notes, '') LIKE 'SYNPH26-TXN-IR-%'
  AND ir.admin_date IS NOT NULL
  AND ir.admin_date < p.dob;

-- 16.5 Philippine format checks
SELECT
  COUNT(*)::bigint AS invalid_guardian_mobile_format
FROM guardians g
WHERE g.email LIKE 'syn_guard_%@synthetic-immunicare.ph'
  AND g.phone !~ '^\+639[0-9]{9}$';

SELECT
  COUNT(*)::bigint AS invalid_patient_mobile_format
FROM patients p
WHERE p.control_number LIKE 'SYNPH26-INF-%'
  AND COALESCE(p.cellphone_number, p.contact, '') !~ '^\+639[0-9]{9}$';

SELECT
  COUNT(*)::bigint AS incomplete_guardian_address_format
FROM guardians g
WHERE g.email LIKE 'syn_guard_%@synthetic-immunicare.ph'
  AND (
    g.address IS NULL
    OR g.address NOT ILIKE '%Brgy.%'
    OR g.address NOT ILIKE '%Metro Manila%'
  );

-- 16.6 Rerun deficit proof (all should be zero after successful run)
WITH target_controls AS (
  SELECT
    'SYNPH26-INF-' || LPAD(gs::text, 6, '0') AS marker_control
  FROM generate_series(1, 100000) gs
)
SELECT
  GREATEST(
    100000 - (
      SELECT COUNT(*)::bigint
      FROM target_controls tc
      WHERE EXISTS (
        SELECT 1
        FROM patients p
        WHERE p.control_number = tc.marker_control
      )
    ),
    0
  )::bigint AS patients_deficit,
  GREATEST(
    100000 - (
      SELECT COUNT(*)::bigint
      FROM target_controls tc
      WHERE EXISTS (
        SELECT 1
        FROM infants i
        WHERE i.patient_control_number = tc.marker_control
      )
    ),
    0
  )::bigint AS infants_deficit,
  GREATEST(2700000 - (SELECT COUNT(*)::bigint FROM appointments WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-AP-%'), 0)::bigint AS appointments_deficit,
  GREATEST(3200000 - (SELECT COUNT(*)::bigint FROM immunization_records WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IR-%'), 0)::bigint AS immunization_deficit,
  GREATEST(1400000 - (SELECT COUNT(*)::bigint FROM notifications WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-NF-%'), 0)::bigint AS notifications_deficit,
  GREATEST(1100000 - (SELECT COUNT(*)::bigint FROM sms_logs WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-SMS-%'), 0)::bigint AS sms_deficit,
  GREATEST(550000 - (SELECT COUNT(*)::bigint FROM inventory_transactions WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IT-%'), 0)::bigint AS inventory_txn_deficit,
  GREATEST(650000 - (SELECT COUNT(*)::bigint FROM vaccine_inventory_transactions WHERE COALESCE(reference_number, '') LIKE 'SYNREF-%'), 0)::bigint AS vaccine_inventory_txn_deficit,
  GREATEST(400000 - (SELECT COUNT(*)::bigint FROM audit_logs WHERE COALESCE(new_values, '') LIKE '%SYNPH26-TXN-AUD-%'), 0)::bigint AS audit_deficit,
  GREATEST(1000000 - (SELECT COUNT(*)::bigint FROM vaccination_reminders WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-VR-%'), 0)::bigint AS reminders_deficit;

-- 16.7 Over-target diagnostics (non-zero means marker rows already exceeded target before rerun)
SELECT
  GREATEST((SELECT COUNT(*)::bigint FROM appointments WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-AP-%') - 2700000, 0)::bigint AS appointments_over_target,
  GREATEST((SELECT COUNT(*)::bigint FROM immunization_records WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IR-%') - 3200000, 0)::bigint AS immunization_over_target,
  GREATEST((SELECT COUNT(*)::bigint FROM notifications WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-NF-%') - 1400000, 0)::bigint AS notifications_over_target,
  GREATEST((SELECT COUNT(*)::bigint FROM sms_logs WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-SMS-%') - 1100000, 0)::bigint AS sms_over_target,
  GREATEST((SELECT COUNT(*)::bigint FROM inventory_transactions WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IT-%') - 550000, 0)::bigint AS inventory_txn_over_target,
  GREATEST((SELECT COUNT(*)::bigint FROM vaccine_inventory_transactions WHERE COALESCE(reference_number, '') LIKE 'SYNREF-%') - 650000, 0)::bigint AS vaccine_inventory_txn_over_target,
  GREATEST((SELECT COUNT(*)::bigint FROM audit_logs WHERE COALESCE(new_values, '') LIKE '%SYNPH26-TXN-AUD-%') - 400000, 0)::bigint AS audit_over_target,
  GREATEST(
    (
      (SELECT COUNT(*)::bigint FROM appointments WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-AP-%')
      + (SELECT COUNT(*)::bigint FROM immunization_records WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IR-%')
      + (SELECT COUNT(*)::bigint FROM notifications WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-NF-%')
      + (SELECT COUNT(*)::bigint FROM sms_logs WHERE COALESCE(message, '') LIKE 'SYNPH26-TXN-SMS-%')
      + (SELECT COUNT(*)::bigint FROM inventory_transactions WHERE COALESCE(notes, '') LIKE 'SYNPH26-TXN-IT-%')
      + (SELECT COUNT(*)::bigint FROM vaccine_inventory_transactions WHERE COALESCE(reference_number, '') LIKE 'SYNREF-%')
      + (SELECT COUNT(*)::bigint FROM audit_logs WHERE COALESCE(new_values, '') LIKE '%SYNPH26-TXN-AUD-%')
    ) - 10000000,
    0
  )::bigint AS transactional_total_over_target;

-- =====================================================================================================
-- END OF SINGLE EXECUTABLE SQL OUTPUT
-- =====================================================================================================
