-- IMMUNICARE Two-Role RBAC Collapse Migration
-- Target runtime roles:
--   1) SYSTEM_ADMIN
--   2) GUARDIAN
--
-- Scope:
-- - Collapse legacy roles into SYSTEM_ADMIN/GUARDIAN
-- - Re-map users.role_id to canonical roles
-- - Clean user_roles mapping to canonical role ids
-- - Add core integrity constraints and indexes
-- - Add idempotent unique index to prevent duplicate vaccination entries
--
-- Notes:
-- - Keeps historical rows in role/permission tables but deactivates non-canonical roles.
-- - Uses IF EXISTS / IF NOT EXISTS patterns where possible for safe re-run.

BEGIN;

-- ------------------------------------------------------------
-- 1) Ensure canonical roles exist and are active
-- ------------------------------------------------------------
INSERT INTO roles (name, display_name, hierarchy_level, is_active, created_at, updated_at)
SELECT 'SYSTEM_ADMIN', 'System Admin', 100, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE UPPER(name) = 'SYSTEM_ADMIN');

INSERT INTO roles (name, display_name, hierarchy_level, is_active, created_at, updated_at)
SELECT 'GUARDIAN', 'Guardian', 10, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE UPPER(name) = 'GUARDIAN');

UPDATE roles
SET name = 'SYSTEM_ADMIN', display_name = COALESCE(display_name, 'System Admin'), is_active = true, updated_at = NOW()
WHERE LOWER(name) = 'system_admin';

UPDATE roles
SET name = 'GUARDIAN', display_name = COALESCE(display_name, 'Guardian'), is_active = true, updated_at = NOW()
WHERE LOWER(name) = 'guardian';

-- Resolve canonical role ids
WITH canonical AS (
  SELECT
    MAX(CASE WHEN UPPER(name) = 'SYSTEM_ADMIN' THEN id END) AS system_admin_role_id,
    MAX(CASE WHEN UPPER(name) = 'GUARDIAN' THEN id END) AS guardian_role_id
  FROM roles
)
SELECT 1 FROM canonical;

-- ------------------------------------------------------------
-- 2) Re-map users.role_id to canonical model
-- ------------------------------------------------------------
WITH canonical AS (
  SELECT
    MAX(CASE WHEN UPPER(name) = 'SYSTEM_ADMIN' THEN id END) AS system_admin_role_id,
    MAX(CASE WHEN UPPER(name) = 'GUARDIAN' THEN id END) AS guardian_role_id
  FROM roles
),
legacy AS (
  SELECT r.id, LOWER(r.name) AS lname
  FROM roles r
)
UPDATE users u
SET role_id = CASE
  WHEN l.lname IN (
    'guardian', 'user', 'parent'
  ) THEN c.guardian_role_id
  WHEN l.lname IN (
    'system_admin', 'super_admin', 'admin', 'clinic_manager',
    'public_health_nurse', 'inventory_manager', 'physician', 'doctor',
    'health_worker', 'healthcare_worker', 'nurse', 'midwife',
    'nutritionist', 'dentist', 'staff', 'city_staff'
  ) THEN c.system_admin_role_id
  ELSE c.system_admin_role_id
END,
updated_at = NOW()
FROM canonical c
LEFT JOIN legacy l ON l.id = u.role_id;

-- Guardian-linked users should always be GUARDIAN role
WITH canonical AS (
  SELECT MAX(CASE WHEN UPPER(name) = 'GUARDIAN' THEN id END) AS guardian_role_id
  FROM roles
)
UPDATE users u
SET role_id = c.guardian_role_id,
    updated_at = NOW()
FROM canonical c
WHERE u.guardian_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3) Collapse user_roles (if table exists)
-- ------------------------------------------------------------
DO $$
DECLARE
  has_user_roles BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_roles'
  ) INTO has_user_roles;

  IF has_user_roles THEN
    -- Re-map existing entries to canonical role ids
    EXECUTE $$
      WITH canonical AS (
        SELECT
          MAX(CASE WHEN UPPER(name) = 'SYSTEM_ADMIN' THEN id END) AS system_admin_role_id,
          MAX(CASE WHEN UPPER(name) = 'GUARDIAN' THEN id END) AS guardian_role_id
        FROM roles
      ),
      role_map AS (
        SELECT
          r.id AS role_id,
          CASE
            WHEN LOWER(r.name) IN ('guardian', 'user', 'parent') THEN c.guardian_role_id
            ELSE c.system_admin_role_id
          END AS canonical_role_id
        FROM roles r
        CROSS JOIN canonical c
      )
      UPDATE user_roles ur
      SET role_id = rm.canonical_role_id
      FROM role_map rm
      WHERE ur.role_id = rm.role_id
    $$;

    -- Deduplicate user_roles pairs after remap
    EXECUTE $$
      DELETE FROM user_roles a
      USING user_roles b
      WHERE a.ctid < b.ctid
        AND a.user_id = b.user_id
        AND a.role_id = b.role_id
    $$;

    -- Ensure uniqueness and index
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_user_role_unique ON user_roles(user_id, role_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id)';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) Deactivate non-canonical roles
-- ------------------------------------------------------------
UPDATE roles
SET is_active = false,
    updated_at = NOW()
WHERE UPPER(name) NOT IN ('SYSTEM_ADMIN', 'GUARDIAN');

UPDATE roles
SET is_active = true,
    updated_at = NOW()
WHERE UPPER(name) IN ('SYSTEM_ADMIN', 'GUARDIAN');

-- ------------------------------------------------------------
-- 5) Core FK index hardening (idempotent)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_guardian_id ON users(guardian_id);

CREATE INDEX IF NOT EXISTS idx_infants_guardian_id ON infants(guardian_id);
CREATE INDEX IF NOT EXISTS idx_patients_guardian_id ON patients(guardian_id);

CREATE INDEX IF NOT EXISTS idx_appointments_infant_id ON appointments(infant_id);

CREATE INDEX IF NOT EXISTS idx_immunization_records_patient_id ON immunization_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_immunization_records_vaccine_id ON immunization_records(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_immunization_records_schedule_id ON immunization_records(schedule_id);

CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_vaccine_id ON vaccine_inventory(vaccine_id);

CREATE INDEX IF NOT EXISTS idx_patient_growth_patient_id ON patient_growth(patient_id);

-- ------------------------------------------------------------
-- 6) Duplicate vaccination protection
-- Prevent duplicate active entry for same infant/vaccine/dose/schedule tuple
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_immunization_records_unique_patient_schedule_active
ON immunization_records (
  patient_id,
  vaccine_id,
  dose_no,
  COALESCE(schedule_id, 0)
)
WHERE is_active = true;

COMMIT;

