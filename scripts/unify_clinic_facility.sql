-- Unify Clinic and Facility IDs to San Nicolas Health Center, Pasig City
-- This script consolidates all data to use clinic_id = 203

-- Step 1: Update all patients to use San Nicolas Health Center Pasig City (ID: 203)
UPDATE patients 
SET clinic_id = 203 
WHERE clinic_id IS NOT NULL AND clinic_id != 203;

-- Step 2: Update all guardians to use San Nicolas Health Center Pasig City (ID: 203)
UPDATE guardians 
SET clinic_id = 203 
WHERE clinic_id IS NOT NULL AND clinic_id != 203;

-- Step 3: Update all appointments to use San Nicolas Health Center Pasig City (ID: 203)
UPDATE appointments 
SET clinic_id = 203 
WHERE clinic_id IS NOT NULL AND clinic_id != 203;

-- Step 4: Update all immunization records to use San Nicolas Health Center Pasig City (ID: 203)
UPDATE immunization_records 
SET clinic_id = 203 
WHERE clinic_id IS NOT NULL AND clinic_id != 203;

-- Step 5: Update all users to use San Nicolas Health Center Pasig City (ID: 203)
UPDATE users 
SET clinic_id = 203, facility_id = 203
WHERE (clinic_id IS NOT NULL AND clinic_id != 203) 
   OR (facility_id IS NOT NULL AND facility_id != 203);

-- Step 6: Update inventory items to use San Nicolas Health Center Pasig City (ID: 203)
UPDATE inventory 
SET clinic_id = 203 
WHERE clinic_id IS NOT NULL AND clinic_id != 203;

-- Step 7: Verify the changes
SELECT 
  'patients' as table_name, 
  COUNT(*) as total_records, 
  COUNT(CASE WHEN clinic_id = 203 THEN 1 END) as san_nicolas_records,
  COUNT(CASE WHEN clinic_id != 203 THEN 1 END) as other_clinic_records
FROM patients
WHERE is_active = true

UNION ALL

SELECT 
  'guardians' as table_name, 
  COUNT(*) as total_records, 
  COUNT(CASE WHEN clinic_id = 203 THEN 1 END) as san_nicolas_records,
  COUNT(CASE WHEN clinic_id != 203 THEN 1 END) as other_clinic_records
FROM guardians

UNION ALL

SELECT 
  'appointments' as table_name, 
  COUNT(*) as total_records, 
  COUNT(CASE WHEN clinic_id = 203 THEN 1 END) as san_nicolas_records,
  COUNT(CASE WHEN clinic_id != 203 THEN 1 END) as other_clinic_records
FROM appointments
WHERE is_active = true

UNION ALL

SELECT 
  'immunization_records' as table_name, 
  COUNT(*) as total_records, 
  COUNT(CASE WHEN clinic_id = 203 THEN 1 END) as san_nicolas_records,
  COUNT(CASE WHEN clinic_id != 203 THEN 1 END) as other_clinic_records
FROM immunization_records
WHERE is_active = true

UNION ALL

SELECT 
  'users' as table_name, 
  COUNT(*) as total_records, 
  COUNT(CASE WHEN clinic_id = 203 THEN 1 END) as san_nicolas_records,
  COUNT(CASE WHEN clinic_id != 203 THEN 1 END) as other_clinic_records
FROM users
WHERE is_active = true;
