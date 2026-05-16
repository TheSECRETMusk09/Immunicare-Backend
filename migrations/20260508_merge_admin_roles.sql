-- Migration: Merge Station Admin (clinic_manager) and Super Admin (super_admin)
-- into the unified System Admin (system_admin) role.
--
-- Run this once against the live database.
-- Safe to re-run: all statements use IF EXISTS / ON CONFLICT guards.

BEGIN;

-- 1. Ensure the canonical system_admin role row exists
INSERT INTO roles (name, display_name, is_system_role, hierarchy_level)
VALUES ('system_admin', 'System Administrator', true, 100)
ON CONFLICT (name) DO UPDATE
  SET display_name     = 'System Administrator',
      is_system_role   = true,
      hierarchy_level  = 100;

-- 2. Re-point every user whose role_id points to super_admin → system_admin
UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'system_admin')
WHERE role_id IN (
  SELECT id FROM roles WHERE name IN ('super_admin', 'superadmin')
);

-- 3. Re-point every user whose role_id points to clinic_manager → system_admin
UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'system_admin')
WHERE role_id IN (
  SELECT id FROM roles WHERE name IN ('clinic_manager', 'station_admin')
);

-- 4. Remove the now-unused role rows (FK-safe because step 2 & 3 cleared users)
DELETE FROM roles WHERE name IN ('super_admin', 'superadmin', 'clinic_manager', 'station_admin');

COMMIT;
