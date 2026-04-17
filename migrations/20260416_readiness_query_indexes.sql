-- Readiness query performance indexes
-- The immunizationScheduleService.getAdministeredVaccines query uses:
--   WHERE patient_id = $1 AND COALESCE(is_active, true) = true
-- The existing partial indexes (WHERE is_active = true) cannot be used for
-- COALESCE(is_active, true) = true because the conditions are not equivalent.
-- A full (non-partial) index on patient_id lets PostgreSQL do an index scan on
-- the small per-infant result set and evaluate is_active inline, instead of a
-- full sequential scan across 3.2M rows.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_immunization_records_patient_id
  ON immunization_records (patient_id);

-- infant_vaccine_readiness is queried by infant_id in getReadinessLookupsForPatients.
-- Without an index on infant_id, each readiness lookup scans the full table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_infant_vaccine_readiness_infant_id
  ON infant_vaccine_readiness (infant_id);

-- appointments is queried by infant_id in several schedule projection paths.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_infant_id
  ON appointments (infant_id)
  WHERE is_active = true;
