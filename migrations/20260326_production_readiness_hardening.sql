-- Production readiness hardening migration
-- Safe and idempotent:
-- 1. Ensures refresh_tokens schema is present and sized for current JWT payloads.
-- 2. Adds the missing announcement delivery ledger used by the publish/report flow.
-- 3. Adds an operational index for clinic/date inventory transaction analytics.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  user_agent TEXT,
  ip_address VARCHAR(45),
  is_revoked BOOLEAN DEFAULT false,
  revoked_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, token)
);

ALTER TABLE refresh_tokens
  ALTER COLUMN token TYPE TEXT;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
  ON refresh_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token
  ON refresh_tokens(token);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
  ON refresh_tokens(expires_at);

CREATE OR REPLACE FUNCTION update_refresh_token_updated_at()
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
    WHERE tgname = 'trigger_update_refresh_token_updated_at'
      AND tgrelid = to_regclass('public.refresh_tokens')
  ) THEN
    CREATE TRIGGER trigger_update_refresh_token_updated_at
      BEFORE UPDATE ON refresh_tokens
      FOR EACH ROW
      EXECUTE FUNCTION update_refresh_token_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS announcement_recipient_deliveries (
  id SERIAL PRIMARY KEY,
  announcement_id INTEGER NOT NULL,
  recipient_user_id INTEGER,
  recipient_guardian_id INTEGER,
  notification_id INTEGER,
  resolved_target_audience VARCHAR(50) NOT NULL DEFAULT 'all',
  delivery_channel VARCHAR(30) NOT NULL DEFAULT 'in_app',
  delivery_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  read_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ard_recipient_present'
      AND conrelid = to_regclass('public.announcement_recipient_deliveries')
  ) THEN
    ALTER TABLE announcement_recipient_deliveries
      ADD CONSTRAINT chk_ard_recipient_present
      CHECK (recipient_user_id IS NOT NULL OR recipient_guardian_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ard_delivery_status'
      AND conrelid = to_regclass('public.announcement_recipient_deliveries')
  ) THEN
    ALTER TABLE announcement_recipient_deliveries
      ADD CONSTRAINT chk_ard_delivery_status
      CHECK (delivery_status IN ('pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ard_delivery_attempts_non_negative'
      AND conrelid = to_regclass('public.announcement_recipient_deliveries')
  ) THEN
    ALTER TABLE announcement_recipient_deliveries
      ADD CONSTRAINT chk_ard_delivery_attempts_non_negative
      CHECK (delivery_attempts >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_ard_announcement_id'
      AND conrelid = to_regclass('public.announcement_recipient_deliveries')
  ) THEN
    ALTER TABLE announcement_recipient_deliveries
      ADD CONSTRAINT fk_ard_announcement_id
      FOREIGN KEY (announcement_id) REFERENCES announcements(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_ard_recipient_user_id'
      AND conrelid = to_regclass('public.announcement_recipient_deliveries')
  ) THEN
    ALTER TABLE announcement_recipient_deliveries
      ADD CONSTRAINT fk_ard_recipient_user_id
      FOREIGN KEY (recipient_user_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_ard_recipient_guardian_id'
      AND conrelid = to_regclass('public.announcement_recipient_deliveries')
  ) THEN
    ALTER TABLE announcement_recipient_deliveries
      ADD CONSTRAINT fk_ard_recipient_guardian_id
      FOREIGN KEY (recipient_guardian_id) REFERENCES guardians(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_ard_notification_id'
      AND conrelid = to_regclass('public.announcement_recipient_deliveries')
  ) THEN
    ALTER TABLE announcement_recipient_deliveries
      ADD CONSTRAINT fk_ard_notification_id
      FOREIGN KEY (notification_id) REFERENCES notifications(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ard_announcement_id
  ON announcement_recipient_deliveries(announcement_id);

CREATE INDEX IF NOT EXISTS idx_ard_recipient_user_id
  ON announcement_recipient_deliveries(recipient_user_id);

CREATE INDEX IF NOT EXISTS idx_ard_recipient_guardian_id
  ON announcement_recipient_deliveries(recipient_guardian_id);

CREATE INDEX IF NOT EXISTS idx_ard_notification_id
  ON announcement_recipient_deliveries(notification_id);

CREATE INDEX IF NOT EXISTS idx_ard_delivery_status
  ON announcement_recipient_deliveries(delivery_status);

CREATE INDEX IF NOT EXISTS idx_ard_created_at_desc
  ON announcement_recipient_deliveries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ard_announcement_status
  ON announcement_recipient_deliveries(announcement_id, delivery_status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ard_announcement_user
  ON announcement_recipient_deliveries(announcement_id, recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ard_announcement_guardian
  ON announcement_recipient_deliveries(announcement_id, recipient_guardian_id)
  WHERE recipient_user_id IS NULL AND recipient_guardian_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_set_ard_updated_at()
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
    WHERE tgname = 'trg_ard_set_updated_at'
      AND tgrelid = to_regclass('public.announcement_recipient_deliveries')
  ) THEN
    CREATE TRIGGER trg_ard_set_updated_at
      BEFORE UPDATE ON announcement_recipient_deliveries
      FOR EACH ROW
      EXECUTE FUNCTION fn_set_ard_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_clinic_created_at
  ON vaccine_inventory_transactions(clinic_id, created_at DESC);
