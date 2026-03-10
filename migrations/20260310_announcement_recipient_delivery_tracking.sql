-- Wave 1 migration: per-recipient announcement delivery tracking
-- Runtime model source of truth: users / roles / clinics
-- Safe and idempotent. Does not modify auth, RBAC, CORS, cookies, or deployment behavior.

DO $$
BEGIN
  IF to_regclass('public.announcements') IS NULL THEN
    RAISE EXCEPTION 'Required table public.announcements is missing';
  END IF;

  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Required table public.users is missing';
  END IF;

  IF to_regclass('public.guardians') IS NULL THEN
    RAISE EXCEPTION 'Required table public.guardians is missing';
  END IF;

  IF to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Required table public.notifications is missing';
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

COMMENT ON TABLE announcement_recipient_deliveries IS
  'Per-recipient announcement delivery ledger linked to notifications for publish tracking and summary APIs.';

COMMENT ON COLUMN announcement_recipient_deliveries.resolved_target_audience IS
  'Audience value resolved at publish time (all, patients, staff, or future scoped values).';

COMMENT ON COLUMN announcement_recipient_deliveries.delivery_status IS
  'Recipient delivery status lifecycle: pending, queued, sent, delivered, read, failed, cancelled.';
