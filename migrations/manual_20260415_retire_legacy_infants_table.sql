-- Manual migration: retire the legacy public.infants table after the app has
-- been deployed with patients-only runtime joins.
--
-- Why manual:
--   public.infants still has historical foreign-key dependents in production.
--   Running this through the normal migration manifest would be too easy to
--   trigger accidentally. Take a database backup first, run this in a planned
--   maintenance window, then verify the application before permanently dropping
--   the renamed legacy table.
--
-- Safe outcome:
--   1. Remap legacy infant_id values to patients.id when the old id differs.
--   2. Abort if any dependent infant_id cannot resolve to patients.id.
--   3. Repoint foreign keys from public.infants(id) to public.patients(id).
--   4. Rename public.infants to public.infants_legacy_retired_20260415.
--
-- Optional final deletion after a stable observation period:
--   DROP TABLE public.infants_legacy_retired_20260415;

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'Cannot retire public.infants because public.patients does not exist';
  END IF;

  IF to_regclass('public.infants') IS NULL THEN
    RAISE EXCEPTION 'public.infants is already absent; nothing to retire';
  END IF;

  IF to_regclass('public.infants_legacy_retired_20260415') IS NOT NULL THEN
    RAISE EXCEPTION 'public.infants_legacy_retired_20260415 already exists; inspect before continuing';
  END IF;

  EXECUTE 'LOCK TABLE public.patients IN SHARE ROW EXCLUSIVE MODE';
  EXECUTE 'LOCK TABLE public.infants IN SHARE ROW EXCLUSIVE MODE';
END $$;

CREATE TEMP TABLE legacy_infant_patient_map ON COMMIT DROP AS
SELECT DISTINCT ON (legacy.id)
  legacy.id AS legacy_infant_id,
  patient.id AS patient_id
FROM public.infants legacy
JOIN public.patients patient
  ON patient.id = legacy.id
  OR (
    NULLIF(BTRIM(legacy.patient_control_number), '') IS NOT NULL
    AND patient.control_number = legacy.patient_control_number
  )
ORDER BY
  legacy.id,
  CASE WHEN patient.id = legacy.id THEN 0 ELSE 1 END,
  patient.id;

CREATE UNIQUE INDEX legacy_infant_patient_map_legacy_id_idx
  ON legacy_infant_patient_map (legacy_infant_id);

CREATE TEMP TABLE legacy_infants_fk_plan ON COMMIT DROP AS
SELECT
  source_ns.nspname AS source_schema,
  source_table.relname AS source_table,
  constraint_info.conname AS constraint_name,
  source_column.attname AS source_column,
  constraint_info.confupdtype,
  constraint_info.confdeltype
FROM pg_constraint constraint_info
JOIN pg_class source_table
  ON source_table.oid = constraint_info.conrelid
JOIN pg_namespace source_ns
  ON source_ns.oid = source_table.relnamespace
JOIN LATERAL unnest(constraint_info.conkey) WITH ORDINALITY AS key_columns(attnum, ordinality)
  ON true
JOIN pg_attribute source_column
  ON source_column.attrelid = constraint_info.conrelid
  AND source_column.attnum = key_columns.attnum
WHERE constraint_info.contype = 'f'
  AND constraint_info.confrelid = 'public.infants'::regclass
  AND array_length(constraint_info.conkey, 1) = 1;

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT *
    FROM legacy_infants_fk_plan
    ORDER BY source_schema, source_table, constraint_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      fk.source_schema,
      fk.source_table,
      fk.constraint_name
    );

    RAISE NOTICE
      'Temporarily dropped %.% constraint % before remapping infant_id values',
      fk.source_schema,
      fk.source_table,
      fk.constraint_name;
  END LOOP;
END $$;

DO $$
DECLARE
  target_table text;
  updated_count bigint;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'adoption_documents',
    'document_generation',
    'documents',
    'growth',
    'growth_records',
    'health_records',
    'infant_growth',
    'messages',
    'vaccination_records',
    'vaccination_reminders',
    'vaccine_availability_notifications',
    'vaccine_transactions',
    'vaccine_waitlist'
  ]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND column_name = 'infant_id'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      $sql$
        UPDATE public.%I AS target
        SET infant_id = map.patient_id
        FROM legacy_infant_patient_map map
        WHERE target.infant_id = map.legacy_infant_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.patients p
            WHERE p.id = target.infant_id
          )
      $sql$,
      target_table
    );

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count > 0 THEN
      RAISE NOTICE 'Remapped %.infant_id rows to patients.id: %', target_table, updated_count;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  target_table text;
  missing_count bigint;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'adoption_documents',
    'document_generation',
    'documents',
    'growth',
    'growth_records',
    'health_records',
    'infant_growth',
    'messages',
    'vaccination_records',
    'vaccination_reminders',
    'vaccine_availability_notifications',
    'vaccine_transactions',
    'vaccine_waitlist'
  ]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND column_name = 'infant_id'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      $sql$
        SELECT COUNT(*)::bigint
        FROM public.%I target
        LEFT JOIN public.patients p ON p.id = target.infant_id
        WHERE target.infant_id IS NOT NULL
          AND p.id IS NULL
      $sql$,
      target_table
    )
    INTO missing_count;

    IF missing_count > 0 THEN
      RAISE EXCEPTION
        'Cannot retire public.infants: %.infant_id has % rows that do not resolve to public.patients.id',
        target_table,
        missing_count;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  fk record;
  update_action text;
  delete_action text;
BEGIN
  FOR fk IN
    SELECT *
    FROM legacy_infants_fk_plan
    ORDER BY source_schema, source_table, constraint_name
  LOOP
    update_action := CASE fk.confupdtype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE 'NO ACTION'
    END;

    delete_action := CASE fk.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE 'NO ACTION'
    END;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.patients(id) ON UPDATE %s ON DELETE %s',
      fk.source_schema,
      fk.source_table,
      fk.constraint_name,
      fk.source_column,
      update_action,
      delete_action
    );

    RAISE NOTICE
      'Repointed %.% constraint % from public.infants(id) to public.patients(id)',
      fk.source_schema,
      fk.source_table,
      fk.constraint_name;
  END LOOP;
END $$;

ALTER TABLE public.infants RENAME TO infants_legacy_retired_20260415;

COMMENT ON TABLE public.infants_legacy_retired_20260415 IS
  'Retired legacy child table. Canonical child data is public.patients. Keep temporarily after 2026-04-15 retirement before final drop.';

COMMIT;
