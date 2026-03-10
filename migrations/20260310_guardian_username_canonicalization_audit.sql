-- Wave 1 migration: guardian username canonicalization audit artifact
-- This migration DOES NOT rename users.username.
-- It only records deterministic proposed mappings for later approval-gated application.

DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Required table public.users is missing';
  END IF;

  IF to_regclass('public.guardians') IS NULL THEN
    RAISE EXCEPTION 'Required table public.guardians is missing';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS guardian_username_migration_audit (
  id SERIAL PRIMARY KEY,
  guardian_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  current_username VARCHAR(255),
  proposed_username VARCHAR(255) NOT NULL,
  base_slug VARCHAR(255) NOT NULL,
  collision_rank INTEGER NOT NULL DEFAULT 1,
  rename_required BOOLEAN NOT NULL DEFAULT TRUE,
  generation_batch_key VARCHAR(80) NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_for_apply BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMP WITH TIME ZONE,
  approved_by INTEGER,
  applied_at TIMESTAMP WITH TIME ZONE,
  apply_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_guma_guardian_id'
      AND conrelid = to_regclass('public.guardian_username_migration_audit')
  ) THEN
    ALTER TABLE guardian_username_migration_audit
      ADD CONSTRAINT fk_guma_guardian_id
      FOREIGN KEY (guardian_id) REFERENCES guardians(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_guma_user_id'
      AND conrelid = to_regclass('public.guardian_username_migration_audit')
  ) THEN
    ALTER TABLE guardian_username_migration_audit
      ADD CONSTRAINT fk_guma_user_id
      FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.users') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'fk_guma_approved_by'
         AND conrelid = to_regclass('public.guardian_username_migration_audit')
     ) THEN
    ALTER TABLE guardian_username_migration_audit
      ADD CONSTRAINT fk_guma_approved_by
      FOREIGN KEY (approved_by) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_guma_collision_rank_positive'
      AND conrelid = to_regclass('public.guardian_username_migration_audit')
  ) THEN
    ALTER TABLE guardian_username_migration_audit
      ADD CONSTRAINT chk_guma_collision_rank_positive
      CHECK (collision_rank >= 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guma_guardian_id
  ON guardian_username_migration_audit(guardian_id);

CREATE INDEX IF NOT EXISTS idx_guma_user_id
  ON guardian_username_migration_audit(user_id);

CREATE INDEX IF NOT EXISTS idx_guma_batch_key
  ON guardian_username_migration_audit(generation_batch_key);

CREATE INDEX IF NOT EXISTS idx_guma_rename_required
  ON guardian_username_migration_audit(rename_required);

CREATE INDEX IF NOT EXISTS idx_guma_approved_for_apply
  ON guardian_username_migration_audit(approved_for_apply);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guma_batch_user
  ON guardian_username_migration_audit(generation_batch_key, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guma_batch_proposed_username
  ON guardian_username_migration_audit(generation_batch_key, LOWER(proposed_username));

CREATE OR REPLACE FUNCTION fn_set_guma_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_guma_set_updated_at'
      AND tgrelid = to_regclass('public.guardian_username_migration_audit')
  ) THEN
    CREATE TRIGGER trg_guma_set_updated_at
      BEFORE UPDATE ON guardian_username_migration_audit
      FOR EACH ROW
      EXECUTE FUNCTION fn_set_guma_updated_at();
  END IF;
END $$;

WITH guardian_linked_users AS (
  SELECT
    g.id AS guardian_id,
    u.id AS user_id,
    u.username AS current_username,
    g.name AS guardian_name,
    LOWER(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            TRANSLATE(COALESCE(g.name, ''),
              'ÀÁÂÃÄÅàáâãäåĀāĂăĄąÇçĆćĈĉĊċČčÐďĐđÈÉÊËèéêëĒēĔĕĖėĘęĚěÌÍÎÏìíîïĨĩĪīĬĭĮįİıÑñŃńŅņŇňÒÓÔÕÖØòóôõöøŌōŎŏŐőÙÚÛÜùúûüŨũŪūŬŭŮůŰűŲųÝýÿŶŷŸŹźŻżŽž',
              'AAAAAAaaaaaaAaAaAaCcCcCcCcCcDdDdEEEEeeeeEeEeEeEeIIIIiiiiIiIiIiIiNnNnNnNnOOOOOOooooooOoOoOoUUUUuuuuUuUuUuUuUuYyyYyYZzZzZz'
            ),
            '[^a-zA-Z0-9]+',
            '.',
            'g'
          ),
          '\\.{2,}',
          '.',
          'g'
        ),
        '^\\.|\\.$',
        '',
        'g'
      )
    ) AS base_slug
  FROM guardians g
  JOIN users u
    ON u.guardian_id = g.id
  JOIN roles r
    ON r.id = u.role_id
   AND LOWER(r.name) = 'guardian'
  WHERE COALESCE(u.is_active, true) = true
), normalized AS (
  SELECT
    guardian_id,
    user_id,
    current_username,
    CASE
      WHEN base_slug IS NULL OR base_slug = '' THEN CONCAT('guardian', guardian_id::text)
      WHEN LENGTH(base_slug) > 240 THEN LEFT(base_slug, 240)
      ELSE base_slug
    END AS base_slug
  FROM guardian_linked_users
), ranked AS (
  SELECT
    guardian_id,
    user_id,
    current_username,
    base_slug,
    ROW_NUMBER() OVER (PARTITION BY base_slug ORDER BY guardian_id, user_id) AS collision_rank
  FROM normalized
), proposed AS (
  SELECT
    guardian_id,
    user_id,
    current_username,
    base_slug,
    collision_rank,
    CASE
      WHEN collision_rank = 1 THEN base_slug
      ELSE CONCAT(base_slug, '.', collision_rank::text)
    END AS proposed_username
  FROM ranked
), latest_batch AS (
  SELECT
    CONCAT('batch-', TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDDHH24MISS')) AS generation_batch_key
)
INSERT INTO guardian_username_migration_audit (
  guardian_id,
  user_id,
  current_username,
  proposed_username,
  base_slug,
  collision_rank,
  rename_required,
  generation_batch_key,
  metadata
)
SELECT
  p.guardian_id,
  p.user_id,
  p.current_username,
  p.proposed_username,
  p.base_slug,
  p.collision_rank,
  COALESCE(LOWER(p.current_username), '') <> LOWER(p.proposed_username) AS rename_required,
  lb.generation_batch_key,
  jsonb_build_object(
    'source', '20260310_guardian_username_canonicalization_audit',
    'policy', 'firstname.lastname then firstname.lastname.2+',
    'note', 'proposal-only migration; no username updates applied'
  )
FROM proposed p
CROSS JOIN latest_batch lb
ON CONFLICT DO NOTHING;

COMMENT ON TABLE guardian_username_migration_audit IS
  'Audit artifact storing proposed guardian username canonicalization mappings prior to approval-gated apply migration.';

COMMENT ON COLUMN guardian_username_migration_audit.rename_required IS
  'True when current_username differs from proposed_username (case-insensitive).';
