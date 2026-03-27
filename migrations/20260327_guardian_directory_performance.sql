CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_guardians_created_at_desc
  ON guardians(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patients_guardian_active_lookup
  ON patients(guardian_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_users_guardian_id_latest
  ON users(guardian_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_guardians_name_trgm
  ON guardians
  USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_guardians_email_trgm
  ON guardians
  USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_guardians_phone_trgm
  ON guardians
  USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_guardians_address_trgm
  ON guardians
  USING gin (address gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_username_trgm
  ON users
  USING gin (username gin_trgm_ops);
