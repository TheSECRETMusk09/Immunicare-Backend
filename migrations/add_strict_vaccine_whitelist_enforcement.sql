-- Strict vaccine whitelist enforcement for new and updated vaccine master rows.
-- Uses NOT VALID constraints so existing legacy rows do not block the migration,
-- while all future inserts and updates must comply.

CREATE OR REPLACE FUNCTION public.immunicare_is_approved_vaccine_name(input_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT input_name = ANY (
    ARRAY[
      'BCG',
      'Diluent',
      'Hepa B',
      'Penta Valent',
      'OPV 20-doses',
      'PCV 13',
      'PCV 10',
      'Measles & Rubella (MR)',
      'MMR',
      'Diluent 5ml',
      'IPV multi dose'
    ]::text[]
  );
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vaccines'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vaccines_name_approved_whitelist_chk'
      AND conrelid = 'public.vaccines'::regclass
  ) THEN
    EXECUTE '
      ALTER TABLE public.vaccines
      ADD CONSTRAINT vaccines_name_approved_whitelist_chk
      CHECK (public.immunicare_is_approved_vaccine_name(name)) NOT VALID
    ';
  END IF;
END $$;
