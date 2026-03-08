-- ============================================================================
-- B1 MIGRATION: INF-YYYY-###### CONTROL NUMBER INTEGRITY
-- ============================================================================
-- Guarantees:
--   1) patients.control_number exists
--   2) deterministic generator function + sequence for INF-YYYY-######
--   3) active-row non-null enforcement for control_number
--   4) active-row uniqueness enforcement for control_number
--   5) immutability guard for control_number updates
--
-- Notes:
--   - Backfills missing control numbers for active patients only.
--   - Uses partial unique index for active rows so soft-deleted history can remain.
-- ============================================================================

BEGIN;

-- 1) Ensure required column exists
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS control_number VARCHAR(20);

COMMENT ON COLUMN patients.control_number IS
  'Authoritative immutable infant control number in format INF-YYYY-######';

-- 2) Sequence + generator function
CREATE SEQUENCE IF NOT EXISTS infant_control_number_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

CREATE OR REPLACE FUNCTION fn_generate_infant_control_number()
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
  v_year TEXT;
  v_seq BIGINT;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YYYY');
  v_seq := nextval('infant_control_number_seq');
  RETURN 'INF-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');
END;
$$;

COMMENT ON FUNCTION fn_generate_infant_control_number() IS
  'Generates control number in INF-YYYY-###### format using infant_control_number_seq';

-- 3) Backfill missing/blank active-row control numbers
WITH to_fix AS (
  SELECT id
  FROM patients
  WHERE is_active = true
    AND (control_number IS NULL OR BTRIM(control_number) = '')
)
UPDATE patients p
SET
  control_number = fn_generate_infant_control_number(),
  updated_at = NOW()
FROM to_fix t
WHERE p.id = t.id;

-- 4) Normalize casing/whitespace for active control numbers
UPDATE patients
SET
  control_number = UPPER(BTRIM(control_number)),
  updated_at = NOW()
WHERE is_active = true
  AND control_number IS NOT NULL
  AND control_number <> UPPER(BTRIM(control_number));

-- 5) Checkpoint guard: no null/blank for active rows
DO $$
DECLARE
  v_missing_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_missing_count
  FROM patients
  WHERE is_active = true
    AND (control_number IS NULL OR BTRIM(control_number) = '');

  IF v_missing_count > 0 THEN
    RAISE EXCEPTION
      'B1 failed: % active patient rows still missing control_number after backfill',
      v_missing_count;
  END IF;
END;
$$;

-- 6) Format check (active rows)
DO $$
DECLARE
  v_bad_format_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_bad_format_count
  FROM patients
  WHERE is_active = true
    AND control_number !~ '^INF-[0-9]{4}-[0-9]{6}$';

  IF v_bad_format_count > 0 THEN
    RAISE EXCEPTION
      'B1 failed: % active patient rows have invalid control_number format',
      v_bad_format_count;
  END IF;
END;
$$;

-- 7) Partial unique index for active rows
CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_control_number_active
  ON patients (control_number)
  WHERE is_active = true;

-- 8) Helpful lookup index
CREATE INDEX IF NOT EXISTS idx_patients_control_number_active
  ON patients (control_number)
  WHERE is_active = true;

-- 9) Insert trigger: auto-generate when missing
CREATE OR REPLACE FUNCTION fn_patients_assign_control_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active = true AND (NEW.control_number IS NULL OR BTRIM(NEW.control_number) = '') THEN
    NEW.control_number := fn_generate_infant_control_number();
  END IF;

  IF NEW.control_number IS NOT NULL THEN
    NEW.control_number := UPPER(BTRIM(NEW.control_number));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patients_assign_control_number ON patients;
CREATE TRIGGER trg_patients_assign_control_number
  BEFORE INSERT ON patients
  FOR EACH ROW
  EXECUTE FUNCTION fn_patients_assign_control_number();

-- 10) Immutability guard trigger
CREATE OR REPLACE FUNCTION fn_patients_control_number_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.control_number IS DISTINCT FROM NEW.control_number
     AND OLD.control_number IS NOT NULL
     AND BTRIM(OLD.control_number) <> '' THEN
    RAISE EXCEPTION 'control_number is immutable and cannot be modified once set'
      USING ERRCODE = '22000';
  END IF;

  IF NEW.control_number IS NOT NULL THEN
    NEW.control_number := UPPER(BTRIM(NEW.control_number));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patients_control_number_immutable ON patients;
CREATE TRIGGER trg_patients_control_number_immutable
  BEFORE UPDATE ON patients
  FOR EACH ROW
  EXECUTE FUNCTION fn_patients_control_number_immutable();

-- 11) Non-null check for active rows (NOT VALID first, then validate)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_patients_control_number_active_not_null'
      AND conrelid = 'patients'::regclass
  ) THEN
    ALTER TABLE patients
      ADD CONSTRAINT chk_patients_control_number_active_not_null
      CHECK (is_active = false OR (control_number IS NOT NULL AND BTRIM(control_number) <> ''))
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE patients
  VALIDATE CONSTRAINT chk_patients_control_number_active_not_null;

COMMIT;

