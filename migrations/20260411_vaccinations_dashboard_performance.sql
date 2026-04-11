-- Vaccinations dashboard performance indexes
-- These support the large infant directory load, vaccination record pagination,
-- and reconciliation lookups used by the Admin Dashboard Vaccinations module.

CREATE INDEX IF NOT EXISTS idx_patients_active_created_at_desc
  ON patients (created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_patients_facility_active_created_at_desc
  ON patients (facility_id, created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_immunization_records_active_admin_date_desc
  ON immunization_records (admin_date DESC, created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_immunization_records_active_patient_vaccine_dose
  ON immunization_records (patient_id, vaccine_id, dose_no)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_immunization_records_active_patient_admin_date_desc
  ON immunization_records (patient_id, admin_date DESC)
  WHERE is_active = true;
