-- Add indexes to improve the performance of the admin dashboard queries

-- patients table
CREATE INDEX IF NOT EXISTS idx_patients_guardian_id ON patients(guardian_id);
CREATE INDEX IF NOT EXISTS idx_patients_is_active ON patients(is_active);

-- immunization_records table
CREATE INDEX IF NOT EXISTS idx_immunization_records_patient_id ON immunization_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_immunization_records_vaccine_id ON immunization_records(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_immunization_records_status ON immunization_records(status);
CREATE INDEX IF NOT EXISTS idx_immunization_records_next_due_date ON immunization_records(next_due_date);
CREATE INDEX IF NOT EXISTS idx_immunization_records_is_active ON immunization_records(is_active);

-- appointments table
CREATE INDEX IF NOT EXISTS idx_appointments_infant_id ON appointments(infant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_date ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_is_active ON appointments(is_active);
