CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF to_regclass('public.patients') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'patients'
        AND column_name = 'first_name'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_patients_vaccinations_first_name_trgm ON patients USING gin (first_name gin_trgm_ops)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'patients'
        AND column_name = 'last_name'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_patients_vaccinations_last_name_trgm ON patients USING gin (last_name gin_trgm_ops)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'patients'
        AND column_name = 'middle_name'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_patients_vaccinations_middle_name_trgm ON patients USING gin (middle_name gin_trgm_ops)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'patients'
        AND column_name = 'control_number'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_patients_vaccinations_control_number_trgm ON patients USING gin (control_number gin_trgm_ops)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'patients'
        AND column_name = 'dob'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_patients_vaccinations_dob_trgm ON patients USING gin ((dob::text) gin_trgm_ops)';
    END IF;
  END IF;

  IF to_regclass('public.infants') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'infants'
        AND column_name = 'first_name'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_infants_vaccinations_first_name_trgm ON infants USING gin (first_name gin_trgm_ops)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'infants'
        AND column_name = 'last_name'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_infants_vaccinations_last_name_trgm ON infants USING gin (last_name gin_trgm_ops)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'infants'
        AND column_name = 'middle_name'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_infants_vaccinations_middle_name_trgm ON infants USING gin (middle_name gin_trgm_ops)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'infants'
        AND column_name = 'patient_control_number'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_infants_vaccinations_control_number_trgm ON infants USING gin (patient_control_number gin_trgm_ops)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'infants'
        AND column_name = 'dob'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_infants_vaccinations_dob_trgm ON infants USING gin ((dob::text) gin_trgm_ops)';
    END IF;
  END IF;
END $$;
